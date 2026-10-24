import { useEffect, useRef, useState } from 'react';

type CaptionError = 'unsupported' | 'denied' | 'failed' | null;

export function useCaptions(enabled: boolean, onText: (text: string, final: boolean) => void) {
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const supported = Boolean(
    typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition),
  );
  const [error, setError] = useState<CaptionError>(null);

  useEffect(() => {
    if (!enabled) {
      setError(null);
      return;
    }
    if (!supported) {
      setError('unsupported');
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setError('unsupported');
      return;
    }

    const rec = new Ctor();
    let stopped = false;
    let restartTimer = 0;
    setError(null);

    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      // Prefer the newest interim chunk so captions feel live.
      let interim = '';
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const piece = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += piece;
        else interim = piece;
      }
      const finalClean = finalText.trim();
      const interimClean = interim.trim();
      if (finalClean) onTextRef.current(finalClean, true);
      else if (interimClean) onTextRef.current(interimClean, false);
    };

    rec.onerror = (event) => {
      const code = event?.error || '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('denied');
        stopped = true;
        return;
      }
      if (code === 'no-speech' || code === 'aborted' || code === 'audio-capture') return;
      setError('failed');
    };

    rec.onend = () => {
      if (stopped) return;
      window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(() => {
        if (stopped) return;
        try {
          rec.start();
        } catch {
          /* already running */
        }
      }, 250);
    };

    try {
      rec.start();
    } catch {
      setError('failed');
    }

    return () => {
      stopped = true;
      window.clearTimeout(restartTimer);
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, supported]);

  return { supported, error };
}
