import { useCallback, useRef, useState } from 'react';
import { uid } from '../lib/code';

const TOAST_MS = 3200;
const MAX_VISIBLE = 2;
const SESSION_ONCE = new Set<string>();

export function useToasts() {
  const [toasts, setToasts] = useState<{ id: string; text: string; key: string }[]>([]);
  const timers = useRef(new Map<string, number>());
  const recent = useRef(new Map<string, number>());

  const push = useCallback((text: string, opts?: { key?: string; oncePerSession?: boolean }) => {
    const key = (opts?.key || text).trim();
    if (opts?.oncePerSession) {
      if (SESSION_ONCE.has(key)) return;
      SESSION_ONCE.add(key);
    }
    const now = Date.now();
    const last = recent.current.get(key) || 0;
    if (now - last < TOAST_MS) return;
    recent.current.set(key, now);

    setToasts((items) => {
      const existing = items.find((item) => item.key === key || item.text === text);
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
      return [...items.slice(-(MAX_VISIBLE - 1)), { id, text, key }];
    });
  }, []);

  return { toasts, push };
}
