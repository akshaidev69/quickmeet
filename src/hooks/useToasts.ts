import { useCallback, useRef, useState } from 'react';
import { uid } from '../lib/code';

const TOAST_MS = 2800;

export function useToasts() {
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const timers = useRef(new Map<string, number>());
  const recent = useRef(new Map<string, number>());

  const push = useCallback((text: string) => {
    const key = text.trim();
    const now = Date.now();
    const last = recent.current.get(key) || 0;
    if (now - last < TOAST_MS) return;
    recent.current.set(key, now);

    setToasts((items) => {
      const existing = items.find((item) => item.text === text);
      if (existing) {
        const prior = timers.current.get(existing.id);
        if (prior) window.clearTimeout(prior);
        timers.current.set(
          existing.id,
          window.setTimeout(() => {
            setToasts((current) => current.filter((item) => item.id !== existing.id));
            timers.current.delete(existing.id);
          }, TOAST_MS),
        );
        return items;
      }
      const id = uid();
      timers.current.set(
        id,
        window.setTimeout(() => {
          setToasts((current) => current.filter((item) => item.id !== id));
          timers.current.delete(id);
        }, TOAST_MS),
      );
      return [...items.slice(-3), { id, text }];
    });
  }, []);

  return { toasts, push };
}
