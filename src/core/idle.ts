export const IDLE_SECONDS = 900;

export async function isUserIdle(): Promise<boolean> {
  try {
    return (await chrome.idle.queryState(IDLE_SECONDS)) !== 'active';
  } catch {
    return false;
  }
}

export function onUserActive(callback: () => void): void {
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === 'active') callback();
  });
}

export function configureIdleDetection(): void {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
}
