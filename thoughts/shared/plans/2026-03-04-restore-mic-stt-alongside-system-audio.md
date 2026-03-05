# Restore Mic-Based STT System Alongside System Audio Daemon

## Overview

Restore all 24 deleted speech-to-text UI components from `master` so both audio paradigms coexist side-by-side: the **speaker module** (system audio loopback capture + VAD + STT pipeline) and the **system audio daemon** (passive ring-buffer capture attached to screenshots). The STT backend infrastructure is already intact on this branch — only the UI, Rust speaker module, and wiring were removed.

> **IMPORTANT CLARIFICATION**: Despite its name, the "speaker" module on master captures **system audio output** (loopback), NOT microphone input. On macOS it uses CoreAudio Process Tap, on Linux it uses PulseAudio `.monitor` sources, and on Windows it uses WASAPI Render direction. The VAD then detects speech in the system audio and sends it to STT. This means we are restoring a **second system audio capture pipeline** alongside the daemon — they use different approaches (speaker = real-time VAD + STT transcription, daemon = ring-buffer + attach to screenshots).

## Code Rules (from `.claude/rules/rule_one.md`)

Every change in this plan MUST adhere to these rules — they are non-negotiable:

1. **Clean and readable code** — Junior developers on a HealthTech team (hospital setting) will maintain this. No clever tricks, no dense one-liners.
2. **Functions that do only one thing, well** — Each restored function must have a single responsibility. If a function does two things, split it.
3. **Descriptive variable names** — Never `r`, `res`, `cb`, `fn`. Use `response`, `callback`, `audioDeviceList`, `isRecording`, etc.
4. **Highly accurate and maintainable** — Restored code must be verified against master, with `pluely` renamed to `nyx` consistently.
5. **NEVER compress scope without asking permission** — Every feature from master must be restored in full. No "we can skip this for now" shortcuts.

## Current State Analysis

### What exists on `tweak-runningbord` (this branch):

- **System audio daemon**: `system_audio.rs` + platform files (`_macos.rs`, `_linux.rs`, `_windows.rs`) — passive ring-buffer capture
- **SystemAudioDaemonToggle.tsx** — single toggle button in completion bar
- **STT backend intact but orphaned**: `stt.constants.ts`, `stt.function.ts`, `stt-providers.ts`, `useCustomSttProviders.ts`, dev STT config UI
- **No mic recording UI, no speech panel, no audio visualizer, no chat audio, no speaker module**

### What exists on `master` (to restore):

- 5 Rust speaker files (`src-tauri/src/speaker/`)
- 1 hook (`src/hooks/useSystemAudio.ts` — 928 lines)
- 11 speech panel components (`src/pages/app/components/speech/`)
- 2 completion audio components (`Audio.tsx`, `AutoSpeechVad.tsx`)
- 3 audio settings page files (`src/pages/audio/`)
- 2 chat audio components (`AudioRecorder.tsx`, `ChatAudio.tsx`)
- Larger versions of `useGlobalShortcuts.ts` (269 vs 220 lines), `useCompletion.ts`, `shortcuts.rs`, `completion.hook.ts`, `context.type.ts`, `app.context.tsx`

### Key Discoveries:

- Master's `Cargo.toml` used `cidre` (macOS), `libpulse-binding`/`libpulse-simple-binding` (Linux), `wasapi` (Windows), `hound`, `cpal` for speaker — all removed on this branch
- This branch uses `objc2-core-audio` (macOS), `pipewire` (Linux), `cpal` (Windows) for system audio daemon
- **Speaker module captures system audio output (loopback), NOT microphone input** — macOS uses `ca::TapDesc::with_mono_global_tap_excluding_processes` (Process Tap), Linux uses PulseAudio `.monitor` sources, Windows uses WASAPI `Direction::Render`
- Master's `shortcuts.rs:109-111` had `audio_recording` and `system_audio` match arms
- Master's `useCompletion.ts:74-75` had `micOpen`/`enableVAD` state
- Master's `context.type.ts:48-52` had `selectedAudioDevices` state
- Master's `useGlobalShortcuts.ts` had `audio` and `systemAudio` listener slots + `registerAudioCallback`/`registerSystemAudioCallback`
- `registerSystemAudioCallback` is registered in THREE places on master: `useSystemAudio.ts` (the hook itself), `useShortcuts.ts`, and defined in `useGlobalShortcuts.ts`
- macOS `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription` already exist in this branch's `Info.plist` — no entitlement changes needed
- Linux will need both PulseAudio dev packages (for speaker) AND PipeWire (for daemon) installed simultaneously

## Desired End State

After implementation:

1. The completion bar shows: Input + Screenshot + **Mic Button** + SystemAudioDaemonToggle + Files
2. Clicking the mic button opens the speech panel with recording controls, waveform visualizer, VAD, and transcription results
3. The system audio daemon toggle continues to work independently for passive capture
4. An "Audio" settings page is accessible from the sidebar menu
5. Chat history supports audio recording and playback components
6. Both features can be used simultaneously without conflict
7. All Rust code compiles cleanly on macOS, Linux, and Windows

### How to verify:

- `cargo build` passes (especially `cidre` + `objc2-core-audio` coexistence on macOS — **must use `cargo build`, not `cargo check`**, because symbol conflicts only appear at link time)
- `npm run build` passes with zero TypeScript errors
- Mic button visible in completion bar alongside system audio toggle
- Speech panel opens when mic capture starts
- Audio settings page accessible from sidebar
- System audio daemon still works independently

## What We're NOT Doing

- **No new features** — We are restoring exactly what master had, with `pluely` → `nyx` renames
- **No refactoring** of the restored components beyond the rename
- **No merging** of the two audio paradigms — they remain independent features
- **No changes** to the system audio daemon code
- **No TTS/text-to-speech playback** unless it was part of the speaker module on master

## Known Tension: Code Rules vs Restored Code

Master's `useSystemAudio.ts` is a 928-line hook that may not fully comply with the "functions that do only one thing" and "clean and readable" code rules. Since we are restoring master's code as-is (no refactoring), some restored files may contain code-rule violations. The decision is: **restore first, refactor later** — getting both features working side-by-side takes priority over code-rule compliance in restored files. A follow-up refactoring pass can address any violations after the restoration is validated.

---

## Phase 0: Dependencies

### Overview

Install all npm and Cargo dependencies required by the restored components.

### Changes Required:

#### 1. Install npm dependency

```bash
npm install @ricky0123/vad-react@^0.0.30
```

Required by `AutoSpeechVad.tsx`.

#### 2. Update `src-tauri/Cargo.toml`

**Add to `[dependencies]`:**

```toml
hound = "3.5.1"
```

**Add to `[target.'cfg(target_os = "macos")'.dependencies]`:**

```toml
cidre = "0.11.3"
```

**Add to `[target.'cfg(target_os = "linux")'.dependencies]`:**

```toml
libpulse-binding = "2.30.1"
libpulse-simple-binding = "2.29.0"
```

**Modify `[target.'cfg(target_os = "windows")'.dependencies]`:**

```toml
# cpal = "0.15" already exists — also add:
wasapi = "0.19.0"
```

**Note**: `cpal` was cross-platform on master but is Windows-only on this branch. The speaker module needs it on all platforms for audio device enumeration. We need to move `cpal = "0.15"` from the Windows-only section to the main `[dependencies]` section, OR add it to macOS/Linux sections too. Check master's approach — master had `cpal = "0.15.3"` in main `[dependencies]`.

**Action**: Move `cpal` from Windows-only to main `[dependencies]`:

```toml
# In [dependencies] section, add:
cpal = "0.15"

# Remove from [target.'cfg(target_os = "windows")'.dependencies]
```

### Success Criteria:

#### Automated Verification:

- [x] `npm install` completes without errors
- [x] `cargo build` compiles and **links** on macOS — validates `cidre` + `objc2-core-audio` coexistence (**MUST use `cargo build`, not `cargo check`** — `cargo check` skips linking and won't catch duplicate CoreAudio symbol errors)
- [x] No duplicate symbol errors at link time

#### Manual Verification:

- [ ] `package.json` contains `@ricky0123/vad-react`
- [ ] `Cargo.toml` contains all new deps

**RISK 1 — macOS CoreAudio symbol conflicts**: `cidre` and `objc2-core-audio` both bind macOS CoreAudio. If `cargo build` fails with symbol conflicts, the fallback is to port `speaker/macos.rs` to use `objc2-core-audio` instead of `cidre`. This is Phase 0 specifically so we catch this early.

**RISK 2 — Linux dual audio libraries**: Adding `libpulse-binding`/`libpulse-simple-binding` (for speaker) alongside `pipewire` (for daemon) requires both PulseAudio AND PipeWire dev packages installed. Verify dev environments and CI have both: `libpulse-dev` (or `pulseaudio-libs-devel`) and PipeWire dev packages. If Linux build environments are minimal containers, this may fail.

**RISK 3 — VAD WASM/model assets**: `@ricky0123/vad-react` loads ONNX/WASM model files at runtime. Verify that Vite/Tauri serves these correctly — check if master had any special Vite config (`assetsInclude`, copy plugins, or public directory entries) for VAD assets. If the model fails to load at runtime, the VAD feature will silently break.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that `cargo build` succeeds (full link, not just check) before proceeding.

---

## Phase 1: Restore Rust Speaker Module

### Overview

Retrieve the 5 speaker module files from `master`, rename `pluely` → `nyx`, and wire them into `lib.rs` and `shortcuts.rs`.

> **NAMING CLARIFICATION for junior developers**: The "speaker" module name is inherited from master. Despite its name, it captures **system audio output** (what your computer is playing — loopback capture), NOT microphone input. It then runs Voice Activity Detection (VAD) on the captured audio to detect speech. This is a different capture approach than the system audio daemon (which uses a ring buffer for screenshot-time extraction). Both capture system audio, but:
> - **Speaker module**: Real-time stream → VAD → STT transcription → text result
> - **System audio daemon**: Ring buffer → extract last N seconds as OGG/Opus → attach to screenshot → send raw audio to multimodal AI

### Changes Required:

#### 1. Retrieve speaker module files from master

**Files** (all from `git show master:<path>`):

- `src-tauri/src/speaker/mod.rs`
- `src-tauri/src/speaker/commands.rs`
- `src-tauri/src/speaker/macos.rs`
- `src-tauri/src/speaker/linux.rs`
- `src-tauri/src/speaker/windows.rs`

**For each file**: Replace all occurrences of `pluely` with `nyx` (case-sensitive, check both `pluely` and `Pluely`).

#### 2. Wire into `src-tauri/src/lib.rs`

**Add module declaration** (after `mod system_audio;` on line 7):

```rust
mod speaker;
```

**Add import** (after the `use` block around line 23):

```rust
use speaker::VadConfig;
```

**Add speaker commands to invoke_handler** (after the `system_audio::` commands, around line 107):

```rust
speaker::start_system_audio_capture,
speaker::stop_system_audio_capture,
speaker::manual_stop_continuous,
speaker::check_system_audio_access,
speaker::request_system_audio_access,
speaker::get_vad_config,
speaker::update_vad_config,
speaker::get_capture_status,
speaker::get_audio_sample_rate,
speaker::get_input_devices,
speaker::get_output_devices,
```

**Important**: These command names (`start_system_audio_capture`, etc.) are DIFFERENT from the system audio daemon commands (`system_audio_start`, `system_audio_stop`), so there are no naming conflicts.

#### 3. Wire into `src-tauri/src/shortcuts.rs`

**Add two match arms** in `handle_shortcut_action` (before the `custom_action` catch-all on line 110):

```rust
"audio_recording" => handle_audio_shortcut(app),
"system_audio" => handle_system_audio_shortcut(app),
```

**Add two handler functions** (after `handle_screenshot_shortcut`, around line 262):

```rust
/// Handle audio recording shortcut — emits event for frontend to start mic capture
fn handle_audio_shortcut<R: Runtime>(app: &AppHandle<R>) {
    // Check license
    {
        let license_state = app.state::<LicenseState>();
        if !license_state.is_active() {
            eprintln!("Ignoring audio shortcut - license inactive");
            return;
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        // Emit event to start audio recording
        if let Err(e) = window.emit("start-audio-recording", json!({})) {
            eprintln!("Failed to emit audio recording event: {}", e);
        }

        // Also show and focus the window
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Handle system audio toggle shortcut — emits event for frontend to toggle capture
fn handle_system_audio_shortcut<R: Runtime>(app: &AppHandle<R>) {
    // Check license
    {
        let license_state = app.state::<LicenseState>();
        if !license_state.is_active() {
            eprintln!("Ignoring system audio shortcut - license inactive");
            return;
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        // Emit event to toggle system audio capture
        if let Err(e) = window.emit("toggle-system-audio", json!({})) {
            eprintln!("Failed to emit system audio event: {}", e);
        }
    }
}
```

### Success Criteria:

#### Automated Verification:

- [x] `cargo build` compiles and links cleanly (not just `cargo check`)
- [x] No naming conflicts between speaker commands and system audio daemon commands
- [x] `cargo clippy` produces no new warnings in speaker module

#### Manual Verification:

- [ ] All 5 speaker files are present in `src-tauri/src/speaker/`
- [ ] No remaining references to `pluely` (search: `grep -r "pluely" src-tauri/src/speaker/`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Restore Frontend Hooks

### Overview

Restore `useSystemAudio.ts` from master, merge audio event listeners into `useGlobalShortcuts.ts`, and update `useApp.ts`.

### Changes Required:

#### 1. Create `src/hooks/useSystemAudio.ts`

- Retrieve full 928-line hook from `git show master:src/hooks/useSystemAudio.ts`
- Rename all occurrences: `pluely` → `nyx`, `pluelyApiEnabled` → `nyxApiEnabled`
- Verify import paths are correct for current branch structure

> **NAMING HAZARD for junior developers**: On this branch, "system audio" already refers to the daemon (`SystemAudioDaemonToggle`, `system_audio.rs`). This restored hook `useSystemAudio` manages the **speaker module's** real-time capture + VAD + STT pipeline — a completely different system. Do NOT confuse them. When importing, always use the full name `useSystemAudio` (never alias to something generic). Add a prominent JSDoc comment at the top of the restored file clarifying this distinction:
> ```typescript
> /**
>  * useSystemAudio — Manages the speaker module's real-time system audio capture,
>  * Voice Activity Detection (VAD), and Speech-to-Text (STT) pipeline.
>  *
>  * NOT to be confused with the System Audio Daemon (SystemAudioDaemonToggle /
>  * system_audio.rs), which is a passive ring-buffer capture used for screenshot
>  * audio attachments.
>  */
> ```

#### 2. Export from `src/hooks/index.ts`

**Add line:**

```typescript
export * from "./useSystemAudio";
```

#### 3. Merge `src/hooks/useGlobalShortcuts.ts`

The current file (220 lines) needs to grow to match master's version (269 lines). Specifically:

**Add to `globalEventListeners` type (line 8):**

```typescript
audio?: UnlistenFn;
systemAudio?: UnlistenFn;
```

**Add global callback refs (after line 20):**

```typescript
let globalAudioCallback: (() => void) | null = null;
let globalSystemAudioCallback: (() => void) | null = null;
```

**Add refs inside the hook (after line 25):**

```typescript
const audioCallbackRef = useRef<(() => void) | null>(null);
const systemAudioCallbackRef = useRef<(() => void) | null>(null);
```

**Add register functions (after `registerScreenshotCallback`, around line 76):**

```typescript
// Register audio recording callback
const registerAudioCallback = useCallback((callback: () => void) => {
	audioCallbackRef.current = callback;
	globalAudioCallback = callback;
}, []);

// Register system audio toggle callback
const registerSystemAudioCallback = useCallback((callback: () => void) => {
	systemAudioCallbackRef.current = callback;
	globalSystemAudioCallback = callback;
}, []);
```

**Add cleanup and listeners in `setupEventListeners`** (after the screenshot listener cleanup around line 110):

```typescript
// Clean up audio listener
if (globalEventListeners.audio) {
	try {
		globalEventListeners.audio();
	} catch (error) {
		console.warn("Error cleaning up audio listener:", error);
	}
}
// Clean up system audio listener
if (globalEventListeners.systemAudio) {
	try {
		globalEventListeners.systemAudio();
	} catch (error) {
		console.warn("Error cleaning up system audio listener:", error);
	}
}
```

**Add event listeners** (after the screenshot trigger listener, around line 173):

```typescript
// Listen for audio recording start event
const unlistenAudio = await listen("start-audio-recording", () => {
	if (globalAudioCallback) {
		globalAudioCallback();
	}
});
globalEventListeners.audio = unlistenAudio;

// Listen for system audio toggle event
const unlistenSystemAudio = await listen("toggle-system-audio", () => {
	if (globalSystemAudioCallback) {
		globalSystemAudioCallback();
	}
});
globalEventListeners.systemAudio = unlistenSystemAudio;
```

**Add to return object:**

```typescript
registerAudioCallback,
registerSystemAudioCallback,
```

#### 4. Update `src/hooks/useShortcuts.ts` — Add audio callback support

The current `useShortcuts.ts` does not destructure `registerAudioCallback` or `registerSystemAudioCallback`. On master, it did. Update the hook:

**Add to destructured imports from `useGlobalShortcuts`:**
```typescript
registerAudioCallback,
registerSystemAudioCallback,
```

**Add to `UseShortcutsProps` interface:**
```typescript
onAudioRecording?: () => void;
onSystemAudio?: () => void;
```

**Add registration effects** (after the screenshot registration):
```typescript
useEffect(() => {
    if (onAudioRecording) {
        registerAudioCallback(onAudioRecording);
    }
}, [onAudioRecording, registerAudioCallback]);

useEffect(() => {
    if (onSystemAudio) {
        registerSystemAudioCallback(onSystemAudio);
    }
}, [onSystemAudio, registerSystemAudioCallback]);
```

**IMPORTANT — `registerSystemAudioCallback` wiring**: On master, this callback is registered in `useSystemAudio.ts` (the restored 928-line hook registers it internally). Verify after restoring the hook that it calls `globalShortcuts.registerSystemAudioCallback(...)`. If it does not, the system audio keyboard shortcut will silently do nothing — the event fires from Rust but no frontend callback is registered to handle it.

#### 5. No changes needed to `src/hooks/useApp.ts`

After re-reading the current `useApp.ts`, it does NOT import `useSystemAudio` — that hook is consumed directly by the speech panel component, not by `useApp`. The brainstorm suggested updating `useApp.ts`, but examining master's actual code shows `useSystemAudio` is used directly in the speech panel's `index.tsx`, not routed through `useApp`. **No changes to `useApp.ts` are needed.**

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles without TypeScript errors
- [x] No duplicate exports in `src/hooks/index.ts`

#### Manual Verification:

- [ ] `useSystemAudio.ts` exists with ~928 lines, no `pluely` references
- [ ] `useGlobalShortcuts.ts` exports `registerAudioCallback` and `registerSystemAudioCallback`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Restore Types & Context State

### Overview

Add mic/VAD fields to the completion hook type, add `selectedAudioDevices` to context, and wire mic state into `useCompletion`.

### Changes Required:

#### 1. `src/types/completion.hook.ts` — Add mic/VAD fields

**Add after the `keepEngaged`/`setKeepEngaged` block (around line 80):**

```typescript
// Voice Activity Detection (VAD) and microphone
/** Whether VAD is enabled for auto-recording */
enableVAD: boolean;
/** Function to toggle VAD state */
setEnableVAD: Dispatch<SetStateAction<boolean>>;
/** Whether microphone is currently open/active */
micOpen: boolean;
/** Function to control microphone state */
setMicOpen: Dispatch<SetStateAction<boolean>>;
```

#### 2. `src/types/context.type.ts` — Add `selectedAudioDevices`

**Add after the `setSystemAudioDaemonConfig` line (around line 47):**

```typescript
selectedAudioDevices: {
	input: string;
	output: string;
}
setSelectedAudioDevices: Dispatch<
	SetStateAction<{
		input: string;
		output: string;
	}>
>;
```

#### 3. `src/contexts/app.context.tsx` — Add `selectedAudioDevices` state

**Add state declaration** (after `systemAudioDaemonConfig` state, around line 124):

```typescript
const [selectedAudioDevices, setSelectedAudioDevices] = useState<{
	input: string;
	output: string;
}>(() => {
	const stored = safeLocalStorage.getItem(
		STORAGE_KEYS.SELECTED_AUDIO_DEVICES,
	);
	if (stored) {
		try {
			return JSON.parse(stored);
		} catch {
			return { input: "", output: "" };
		}
	}
	return { input: "", output: "" };
});
```

**Add localStorage persistence effect** (after the `systemAudioDaemonConfig` persistence effect, around line 641):

```typescript
// Persist selected audio devices
useEffect(() => {
	safeLocalStorage.setItem(
		STORAGE_KEYS.SELECTED_AUDIO_DEVICES,
		JSON.stringify(selectedAudioDevices),
	);
}, [selectedAudioDevices]);
```

**Add to context value** (in the `value: IContextType` object, around line 836):

```typescript
selectedAudioDevices,
setSelectedAudioDevices,
```

**Add `SELECTED_AUDIO_DEVICES` to `STORAGE_KEYS`** in `src/config/constants.ts`:

```typescript
SELECTED_AUDIO_DEVICES: "selected_audio_devices",
```

#### 4. `src/hooks/useCompletion.ts` — Add mic/VAD state

**Add state declarations** (after `keepEngaged` state, around line 108):

```typescript
const [micOpen, setMicOpen] = useState(false);
const [enableVAD, setEnableVAD] = useState(false);
```

**Update `isPopoverOpen` computation** (line ~903) to include `micOpen`:

```typescript
const isPopoverOpen =
	state.isLoading ||
	state.response !== "" ||
	state.error !== null ||
	keepEngaged ||
	micOpen;
```

**Add toggle recording callback** (before the global shortcuts registration effect, around line 1178):

```typescript
const toggleRecording = useCallback(() => {
	setEnableVAD(!enableVAD);
	setMicOpen(!micOpen);
}, [enableVAD, micOpen]);
```

**Register audio callback in the global shortcuts effect** (add alongside screenshot callback registration, around line 1181):

```typescript
globalShortcuts.registerAudioCallback(toggleRecording);
```

**Add to the effect's dependency array:**

```typescript
globalShortcuts.registerAudioCallback,
toggleRecording,
```

**Add to return object** (around line 1213):

```typescript
enableVAD,
setEnableVAD,
micOpen,
setMicOpen,
```

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles without TypeScript errors
- [x] No type mismatches between `UseCompletionReturn` and actual return value

#### Manual Verification:

- [ ] `UseCompletionReturn` interface includes `enableVAD`, `setEnableVAD`, `micOpen`, `setMicOpen`
- [ ] `IContextType` includes `selectedAudioDevices`, `setSelectedAudioDevices`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Restore UI Components (18 new files)

### Overview

Retrieve all 18 deleted UI component files from `master`, apply `pluely` → `nyx` renames, and place them in their correct directories. (The other 6 deleted files — 5 speaker Rust files + 1 useSystemAudio hook — are restored in Phases 1 and 2.)

### Changes Required:

#### 4A. Speech Panel — `src/pages/app/components/speech/` (11 files)

Retrieve from `git show master:<path>`, rename `pluely` → `nyx`:

| File                   | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `index.tsx`            | Main `SystemAudio` component — speech panel container |
| `Header.tsx`           | Panel header with title and close button              |
| `ModeSwitcher.tsx`     | Switch between manual/VAD recording modes             |
| `PermissionFlow.tsx`   | Microphone permission request UI                      |
| `QuickActions.tsx`     | Quick action buttons (submit, clear, etc.)            |
| `RecordingPanel.tsx`   | Recording controls and status                         |
| `ResultsSection.tsx`   | Transcription results display                         |
| `SettingsPanel.tsx`    | In-panel audio settings                               |
| `StatusIndicator.tsx`  | Recording status indicator                            |
| `Warning.tsx`          | Warning messages for audio issues                     |
| `audio-visualizer.tsx` | Waveform/audio level visualizer                       |

**Code Rules Reminder**: Each component file should contain a single component that does one thing well. Variable names must be descriptive (`isRecordingActive`, not `isRec`).

#### 4B. Completion Bar Audio — `src/pages/app/components/completion/` (2 files)

| File                | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `Audio.tsx`         | Mic recording button in the completion bar                             |
| `AutoSpeechVad.tsx` | Auto-start recording when voice detected (uses `@ricky0123/vad-react`) |

#### 4C. Audio Settings Page — `src/pages/audio/` (3 files)

| File                            | Purpose                                 |
| ------------------------------- | --------------------------------------- |
| `index.tsx`                     | Audio settings page (default export)    |
| `components/AudioSelection.tsx` | Audio device selection dropdowns        |
| `components/index.ts`           | Barrel export for audio page components |

#### 4D. Chat Audio — `src/pages/chats/components/` (2 files)

| File                | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `AudioRecorder.tsx` | Record audio within chat history view      |
| `ChatAudio.tsx`     | Audio playback component for chat messages |

### For ALL files:

1. `git show master:<path>` to retrieve content
2. Replace all `pluely` → `nyx` (case-sensitive, check `Pluely` → `Nyx` too)
3. Verify import paths match current branch structure — path aliases (`@/…`) should be consistent
4. Ensure variable names are descriptive per code rules
5. **Beyond rename**: Check for Tauri v1 vs v2 API differences (e.g., `get_webview_window` vs `getWindow`, event API changes, `UnlistenFn` types). Master may have used slightly different Tauri APIs — adjust to match this branch's Tauri v2 patterns. Expect small compile breaks beyond just the rename.

### Success Criteria:

#### Automated Verification:

- [x] All 18 new files exist in correct directories
- [x] `npm run build` compiles (may have wiring errors — those are addressed in Phase 5)
- [x] `grep -r "pluely" src/pages/app/components/speech/ src/pages/app/components/completion/Audio.tsx src/pages/app/components/completion/AutoSpeechVad.tsx src/pages/audio/ src/pages/chats/components/AudioRecorder.tsx src/pages/chats/components/ChatAudio.tsx` returns nothing

#### Manual Verification:

- [ ] Each file contains clean, readable code with descriptive variable names
- [ ] No compressed scope — all features from master are present

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5: Wire Up the UI

### Overview

Connect all restored components into the existing UI: completion bar, app layout, routing, navigation, and chat view.

### Changes Required:

#### 5A. `src/pages/app/components/completion/index.tsx` — Add mic button

**Current** (line 7-18):

```tsx
export const Completion = ({ isHidden }: { isHidden: boolean }) => {
	const completion = useCompletion();
	return (
		<>
			<Input {...completion} isHidden={isHidden} />
			<Screenshot {...completion} />
			<SystemAudioDaemonToggle />
			<Files {...completion} />
		</>
	);
};
```

**Updated** — add `Audio` component:

```tsx
import { Audio } from "./Audio";

export const Completion = ({ isHidden }: { isHidden: boolean }) => {
	const completion = useCompletion();
	return (
		<>
			<Input {...completion} isHidden={isHidden} />
			<Screenshot {...completion} />
			<Audio {...completion} />
			<SystemAudioDaemonToggle />
			<Files {...completion} />
		</>
	);
};
```

#### 5B. `src/pages/app/index.tsx` — Dual-mode rendering

The app layout needs to conditionally show the speech panel when mic recording is active. Import and use the speech panel alongside the completion bar.

**Add imports:**

```tsx
import { SystemAudio } from "./components/speech";
import { useSystemAudio } from "@/hooks";
```

**Inside the `App` component, add:**

```tsx
const systemAudio = useSystemAudio();
```

**Conditional rendering** — when `systemAudio.capturing` is true, show the speech panel instead of (or alongside) the completion bar. The exact rendering logic should match master's pattern: the speech panel overlays/replaces the completion bar while recording.

Retrieve the exact rendering pattern from `git show master:src/pages/app/index.tsx`.

#### 5C. `src/pages/app/components/index.ts` — Add speech exports

**Add:**

```typescript
export * from "./speech";
```

#### 5D. `src/pages/chats/components/index.ts` — Add chat audio exports

**Add:**

```typescript
export * from "./ChatAudio";
export * from "./AudioRecorder";
```

#### 5E. `src/pages/chats/components/View.tsx` — Re-integrate audio components

**Add imports** (these are already imported from `"."` on master):

```typescript
import { ChatAudio, AudioRecorder } from ".";
```

Retrieve the exact integration pattern from `git show master:src/pages/chats/components/View.tsx` — specifically lines around 254 and 274 where `AudioRecorder` and `ChatAudio` are rendered.

#### 5F. Routing & Navigation

**`src/routes/index.tsx`** — Add audio route:

```tsx
import { Audio } from "@/pages";
// Inside <Route element={<DashboardLayout />}>:
<Route path="/audio" element={<Audio />} />
```

**`src/pages/index.ts`** — Add audio page export:

```typescript
export { default as Audio } from "./audio";
```

**`src/hooks/useMenuItems.tsx`** — Add Audio menu item:

```tsx
import { AudioLinesIcon } from "lucide-react";
// Add to menu array:
{
    icon: AudioLinesIcon,
    label: "Audio",
    href: "/audio",
},
```

**`src/config/shortcuts.ts`** — Add audio recording shortcut:

```typescript
{
    id: "audio_recording",
    name: "Toggle Audio Recording",
    description: "Start/stop microphone recording for speech-to-text",
    defaultKey: {
        macos: "cmd+shift+a",
        windows: "ctrl+shift+a",
        linux: "ctrl+shift+a",
    },
},
```

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles with zero TypeScript errors
- [x] All imports resolve correctly
- [x] No circular dependency warnings

#### Manual Verification:

- [ ] Mic button visible in completion bar alongside system audio toggle
- [ ] Speech panel opens when mic capture starts
- [ ] Audio settings page accessible from sidebar navigation
- [ ] Chat view shows AudioRecorder and ChatAudio components
- [ ] System audio daemon toggle still works independently
- [ ] `/audio` route loads the audio settings page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation of all UI elements before proceeding.

---

## Phase 6: Validate

### Overview

Full validation pass to ensure both audio systems work correctly side-by-side.

### Automated Verification:

- [x] `cargo build` — Rust compiles AND links cleanly (not just `cargo check`)
- [x] `cargo clippy` — No new warnings in speaker module
- [x] `npm run build` — TypeScript/Vite builds with zero errors
- [x] `grep -r "pluely" src-tauri/src/speaker/ src/hooks/useSystemAudio.ts src/pages/app/components/speech/ src/pages/app/components/completion/Audio.tsx src/pages/app/components/completion/AutoSpeechVad.tsx src/pages/audio/ src/pages/chats/components/AudioRecorder.tsx src/pages/chats/components/ChatAudio.tsx` — returns nothing

### Manual Verification:

- [ ] `npm run tauri dev` — app launches, both windows render
- [ ] Mic button visible in completion bar alongside system audio toggle
- [ ] Clicking mic button opens speech panel with recording controls
- [ ] VAD auto-record mode works when enabled
- [ ] Waveform visualizer displays audio levels during recording
- [ ] Transcription results appear after recording stops
- [ ] Speech panel closes cleanly and returns to completion bar
- [ ] System audio daemon toggle still enables/disables passive capture
- [ ] Screenshot + system audio capture still works (screenshot with audio attachment)
- [ ] Audio settings page accessible from sidebar, shows device selection
- [ ] Chat history shows audio recording and playback components
- [ ] Keyboard shortcut for audio recording works (Cmd+Shift+A / Ctrl+Shift+A)
- [ ] No console errors related to audio components

---

## Testing Strategy

### Unit Tests:

- Verify `useSystemAudio` hook initializes without errors
- Verify `useCompletion` returns `micOpen`, `enableVAD`, `setMicOpen`, `setEnableVAD`
- Verify `useGlobalShortcuts` returns `registerAudioCallback`, `registerSystemAudioCallback`

### Integration Tests:

- Verify shortcut `audio_recording` emits `start-audio-recording` event
- Verify shortcut `system_audio` emits `toggle-system-audio` event
- Verify both audio features can be toggled without interfering with each other

### Manual Testing Steps:

1. Launch app with `npm run tauri dev`
2. Verify mic button appears in completion bar
3. Click mic button → speech panel should open
4. Grant microphone permission if prompted
5. Record audio → waveform should animate
6. Stop recording → transcription should appear
7. Toggle system audio daemon → should work independently
8. Take screenshot with system audio enabled → audio should attach
9. Navigate to Audio settings page from sidebar
10. Open a chat → AudioRecorder and ChatAudio should render

## Performance Considerations

- `useSystemAudio` (928 lines) is a large hook — it manages system audio capture, VAD, waveform data, and STT. It only initializes when the speech panel is mounted, so it doesn't impact the completion bar's performance.
- `@ricky0123/vad-react` loads a WASM/ONNX model — first load may be slow. This is expected behavior from master. Verify the model files are served correctly by Vite/Tauri at runtime.
- Both audio systems running simultaneously (speaker capture + system audio daemon) will use more CPU/memory. This is acceptable as it matches the intended dual-mode design.

## Concurrent Capture Risk: Device/Resource Contention

Both the speaker module and the system audio daemon capture system audio output. Running them simultaneously may cause issues:

- **macOS**: Both use CoreAudio Process Tap — may conflict on tap creation or cause audio glitching if sample rates don't match
- **Windows**: WASAPI loopback capture may deadlock or stutter depending on share modes if both attempt to capture the same render device
- **Linux**: PulseAudio monitor source (speaker) + PipeWire sink monitor (daemon) — different audio servers, may conflict on device access

**Mitigation during validation**: Test both features running simultaneously and verify:
1. No audio glitching or stuttering
2. Both capture pipelines produce valid audio data
3. Stopping one doesn't break the other
4. Device selection in the Audio settings page works independently for each pipeline

## Key Risk: cidre + objc2-core-audio Coexistence

**Risk**: Both crates bind macOS CoreAudio C APIs. Potential duplicate symbol errors at **link time** (not compile time — `cargo check` will NOT catch this).

**Mitigation**: Phase 0 validates this immediately with `cargo build` (full link). If it fails:

1. **Fallback A**: Port `speaker/macos.rs` to use `objc2-core-audio` instead of `cidre` (preferred — unifies the binding approach)
2. **Fallback B**: Use `cpal` for the speaker module on macOS instead of `cidre` (simpler but less control)

## File Summary

| Action                | Count | Files                                                                                                                                                                                                                                                                                          |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create (from master)  | 24    | speaker module (5), useSystemAudio (1), speech panel (11), completion audio (2), audio page (3), chat audio (2)                                                                                                                                                                                |
| Merge (edit existing) | ~17   | Cargo.toml, lib.rs, shortcuts.rs, package.json, useGlobalShortcuts, useShortcuts, useCompletion, hooks/index, types (2), app.context, completion/index, app/index, app/components/index, chats/components/index, View.tsx, routes/index, pages/index, useMenuItems, shortcuts config, constants |

## References

- Master branch: `git show master:<path>` for all original files
- System audio daemon (current branch): `src-tauri/src/system_audio.rs`, `system_audio_macos.rs`, `system_audio_linux.rs`, `system_audio_windows.rs`
- STT backend (intact): `src/config/stt.constants.ts`, `src/lib/functions/stt.function.ts`, `src/lib/storage/stt-providers.ts`
