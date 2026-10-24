import { useEffect, useRef, useState } from 'react';
import { LookEngine, type LookStatus } from '../lib/look';
import { getPreviewVideo } from '../lib/previewVideo';
import type { BackgroundId } from '../types';

export function useSelfLook(enabled: boolean, effect: BackgroundId) {
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const live = enabled && effect !== 'none';
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<LookStatus>('real');

  useEffect(() => {
    if (!live) {
      setTrack(null);
      setCanvas(null);
      setStatus('real');
      return;
    }
    let engine: LookEngine;
    try {
      engine = new LookEngine(getPreviewVideo(), () => effectRef.current, setStatus);
    } catch {
      setStatus('fallback');
      setTrack(null);
      setCanvas(null);
      return;
    }
    setTrack(engine.track);
    setCanvas(engine.canvas);
    setStatus('loading');
    return () => {
      engine.stop();
      setTrack(null);
      setCanvas(null);
    };
  }, [live]);

  return { track, canvas: live ? canvas : null, status: live ? status : 'real' };
}
