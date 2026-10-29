let autoFloatPause = 0;

function syncNativeSuppress() {
  void import('./nativeMeeting')
    .then((mod) => mod.setSuppressPip(autoFloatPause > 0))
    .catch(() => undefined);
}

/** Pause auto-float while a browser picker (screen share, permissions) is open. */
export function pauseAutoFloat() {
  autoFloatPause += 1;
  syncNativeSuppress();
  return () => {
    autoFloatPause = Math.max(0, autoFloatPause - 1);
    syncNativeSuppress();
  };
}

export function autoFloatPaused() {
  return autoFloatPause > 0;
}
