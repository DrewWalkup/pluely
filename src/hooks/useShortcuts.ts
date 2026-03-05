import { useEffect } from "react";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

interface UseShortcutsProps {
	onScreenshot?: () => void;
	onAudioRecording?: () => void;
	onSystemAudio?: () => void;
	customShortcuts?: Record<string, () => void>;
}

/**
 * Hook to manage global shortcuts for the application
 * Automatically registers callbacks for all shortcut actions
 */
export const useShortcuts = ({
	onScreenshot,
	onAudioRecording,
	onSystemAudio,
	customShortcuts = {},
}: UseShortcutsProps = {}) => {
	const {
		registerScreenshotCallback,
		registerAudioCallback,
		registerSystemAudioCallback,
		registerCustomShortcutCallback,
		unregisterCustomShortcutCallback,
	} = useGlobalShortcuts();

	useEffect(() => {
		if (onScreenshot) {
			registerScreenshotCallback(onScreenshot);
		}
	}, [onScreenshot, registerScreenshotCallback]);

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

	// Register custom shortcut callbacks
	useEffect(() => {
		Object.entries(customShortcuts).forEach(([actionId, callback]) => {
			registerCustomShortcutCallback(actionId, callback);
		});

		// Cleanup on unmount
		return () => {
			Object.keys(customShortcuts).forEach((actionId) => {
				unregisterCustomShortcutCallback(actionId);
			});
		};
	}, [
		customShortcuts,
		registerCustomShortcutCallback,
		unregisterCustomShortcutCallback,
	]);

	return useGlobalShortcuts();
};
