//! Windows system audio capture using WASAPI loopback via the `cpal` crate.
//! Captures what is being played through the default output device (speakers/headphones)
//! on Windows 10/11. Building an input stream on an output device triggers WASAPI's
//! `AUDCLNT_STREAMFLAGS_LOOPBACK` mode automatically.

use crate::system_audio::{SystemAudioState, CHANNELS, SAMPLE_RATE};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex as StdMutex};

/// Holds the active cpal loopback stream. Dropping it stops capture.
struct CaptureHandle {
    _stream: cpal::Stream,
}

// SAFETY: cpal::Stream is Send on the WASAPI backend.
unsafe impl Send for CaptureHandle {}

static CAPTURE_STATE: StdMutex<Option<CaptureHandle>> = StdMutex::new(None);

/// Start capturing system audio via WASAPI loopback.
///
/// Opens the default output device and builds an **input** stream on it, which
/// tells WASAPI to capture the loopback (monitor) audio — i.e. everything that
/// is being played to speakers.
pub async fn start_capture(state: Arc<SystemAudioState>) -> Result<(), String> {
    // Check if already capturing
    {
        let guard = CAPTURE_STATE.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
    }

    let host = cpal::default_host();

    let device = host
        .default_output_device()
        .ok_or_else(|| "No default output audio device found".to_string())?;

    let supported_config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get default output config: {}", e))?;

    let device_sample_rate = supported_config.sample_rate().0;
    let device_channels = supported_config.channels() as u16;

    tracing::info!(
        "WASAPI loopback: device config {} Hz, {} ch, {:?}",
        device_sample_rate,
        device_channels,
        supported_config.sample_format()
    );

    let stream_config: cpal::StreamConfig = supported_config.into();

    // Build an input stream on the output device → WASAPI loopback mode.
    // The data callback receives interleaved f32 samples.
    let state_clone = state.clone();
    let stream = device
        .build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if device_sample_rate == SAMPLE_RATE && device_channels == CHANNELS {
                    // Fast path: format already matches 48 kHz stereo
                    state_clone.push_samples_realtime(data);
                } else {
                    // Slow path: convert to 48 kHz stereo first
                    let converted =
                        convert_to_48k_stereo(data, device_sample_rate, device_channels);
                    state_clone.push_samples_realtime(&converted);
                }
            },
            |err| {
                tracing::error!("WASAPI loopback stream error: {}", err);
            },
            None, // no timeout
        )
        .map_err(|e| format!("Failed to build WASAPI loopback stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start WASAPI loopback stream: {}", e))?;

    tracing::info!("WASAPI loopback system audio capture started");

    let mut guard = CAPTURE_STATE.lock().map_err(|e| e.to_string())?;
    *guard = Some(CaptureHandle { _stream: stream });

    Ok(())
}

/// Stop the WASAPI loopback capture. Dropping the stream handle releases all
/// WASAPI / COM resources.
pub async fn stop_capture() {
    let handle = {
        let mut guard = match CAPTURE_STATE.lock() {
            Ok(g) => g,
            Err(e) => {
                tracing::error!("CAPTURE_STATE mutex poisoned: {}", e);
                return;
            }
        };
        guard.take()
    };

    if handle.is_some() {
        // The stream is dropped here, which stops playback and releases resources.
        tracing::info!("WASAPI loopback system audio capture stopped");
    }
}

// ---------------------------------------------------------------------------
// Format conversion helpers
// ---------------------------------------------------------------------------

/// Convert interleaved f32 audio from an arbitrary sample rate / channel count
/// to 48 kHz stereo interleaved f32 to match the shared ring buffer format.
fn convert_to_48k_stereo(data: &[f32], src_rate: u32, src_channels: u16) -> Vec<f32> {
    let src_ch = src_channels as usize;
    if src_ch == 0 {
        return Vec::new();
    }
    let num_frames = data.len() / src_ch;
    if num_frames == 0 {
        return Vec::new();
    }

    // Step 1: Extract stereo frames from the source data.
    let stereo_frames: Vec<[f32; 2]> = (0..num_frames)
        .map(|i| {
            let off = i * src_ch;
            match src_ch {
                1 => {
                    let m = data[off];
                    [m, m] // mono → duplicate to both channels
                }
                2 => [data[off], data[off + 1]],
                _ => {
                    // Multi-channel: take first two channels (L/R)
                    [data[off], data[off + 1]]
                }
            }
        })
        .collect();

    // Step 2: If sample rate already matches, just flatten and return.
    if src_rate == SAMPLE_RATE {
        let mut out = Vec::with_capacity(stereo_frames.len() * 2);
        for [l, r] in &stereo_frames {
            out.push(*l);
            out.push(*r);
        }
        return out;
    }

    // Step 3: Linear interpolation resampling → 48 kHz.
    let ratio = SAMPLE_RATE as f64 / src_rate as f64;
    let out_frames = (num_frames as f64 * ratio) as usize;
    let mut out = Vec::with_capacity(out_frames * 2);

    for i in 0..out_frames {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;

        let [l0, r0] = if idx < stereo_frames.len() {
            stereo_frames[idx]
        } else {
            [0.0, 0.0]
        };
        let [l1, r1] = if idx + 1 < stereo_frames.len() {
            stereo_frames[idx + 1]
        } else {
            [l0, r0]
        };

        out.push(l0 + (l1 - l0) * frac);
        out.push(r0 + (r1 - r0) * frac);
    }

    out
}
