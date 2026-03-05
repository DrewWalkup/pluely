// Nyx API checks removed for free build. Always returns false by default.

// Helper function to check if Nyx API should be used
export async function shouldUseNyxAPI(): Promise<boolean> {
	// try {
	//   // Check if Nyx API is enabled in localStorage
	//   const nyxApiEnabled =
	//     safeLocalStorage.getItem(STORAGE_KEYS.RUNNINGBORD_API_ENABLED) === "true";
	//   if (!nyxApiEnabled) return false;

	//   // Check if license is available
	//   const hasLicense = await invoke<boolean>("check_license_status");
	//   return hasLicense;
	// } catch (error) {
	//   console.warn("Failed to check Nyx API availability:", error);
	//   return false;
	// }
	return false;
}
