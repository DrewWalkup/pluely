// Runningbord API checks removed for free build. Always returns false by default.

// Helper function to check if Runningbord API should be used
export async function shouldUseRunningbordAPI(): Promise<boolean> {
  // try {
  //   // Check if Runningbord API is enabled in localStorage
  //   const runningbordApiEnabled =
  //     safeLocalStorage.getItem(STORAGE_KEYS.RUNNINGBORD_API_ENABLED) === "true";
  //   if (!runningbordApiEnabled) return false;

  //   // Check if license is available
  //   const hasLicense = await invoke<boolean>("check_license_status");
  //   return hasLicense;
  // } catch (error) {
  //   console.warn("Failed to check Runningbord API availability:", error);
  //   return false;
  // }
  return false;
}
