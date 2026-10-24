import { useEffect, useRef } from 'react';

export function useCaptions(enabled: boolean, onText: (text: string, final: boolean) => void) {
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (!enabled || !supported) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    let stopped = false;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (event) => {
      let text = '';
      let isFinal = false;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript;
        if (event.results[index].isFinal) isFinal = true;
      }
      const cleaned = text.trim();
      if (cleaned) onTextRef.current(cleaned, isFinal);
    };
    rec.onerror = () => undefined;
    rec.onend = () => {
      if (stopped) return;
      try {
        rec.start();
      } catch {
        /* already running */
      }
    };
    try {
      rec.start();
    } catch {
      /* browser blocked speech recognition */
    }
    return () => {
      stopped = true;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, supported]);

  return supported;
}
