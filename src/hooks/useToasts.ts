import { useCallback, useState } from 'react';
import { uid } from '../lib/code';

export function useToasts() {
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const push = useCallback((text: string) => {
    const id = uid();
    setToasts((items) => [...items.slice(-3), { id, text }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 2800);
  }, []);
  return { toasts, push };
}
