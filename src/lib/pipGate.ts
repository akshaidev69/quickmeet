let autoFloatPause = 0;

/** Pause auto-float while a browser picker (screen share, permissions) is open. */
export function pauseAutoFloat() {
  autoFloatPause += 1;
  return () => {
    autoFloatPause = Math.max(0, autoFloatPause - 1);
  };
}

export function autoFloatPaused() {
  return autoFloatPause > 0;
}
