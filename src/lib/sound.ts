let ctx: AudioContext | null = null;

function audio() {
  const AudioCtx = window.AudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  void ctx.resume();
  return ctx;
}

export function beep(kind: 'join' | 'chat' | 'hand' | 'react') {
  const context = audio();
  if (!context) return;
  const now = context.currentTime;

  if (kind === 'hand') {
    // Soft Meet-like tink when someone raises a hand
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(context.destination);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);
    return;
  }

  if (kind === 'react') {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(990, now + 0.06);
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(context.destination);
    gain.gain.exponentialRampToValueAtTime(0.03, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.13);
    return;
  }

  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  osc.frequency.value = kind === 'chat' ? 740 : 520;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(context.destination);
  gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.start(now);
  osc.stop(now + 0.15);
}
