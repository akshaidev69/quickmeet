import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNativeApp } from './lib/native';
import './styles.css';

function markShell() {
  const root = document.documentElement;
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const native = isNativeApp();
  // Layout shell follows viewport width (and native) — never coarse pointer alone,
  // or touch laptops/tablets get a broken phone layout on a wide screen.
  root.classList.toggle('is-native', native);
  root.classList.toggle('is-mobile', native || narrow);
  root.classList.toggle('is-touch', native || coarse);
  root.dataset.shell = native ? 'native' : narrow ? 'mobile' : 'desktop';
}

markShell();
window.matchMedia('(max-width: 820px)').addEventListener('change', markShell);
window.matchMedia('(pointer: coarse)').addEventListener('change', markShell);

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
