import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNativeApp } from './lib/native';
import './styles.css';

function markShell() {
  const root = document.documentElement;
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const native = isNativeApp();
  root.classList.toggle('is-native', native);
  root.classList.toggle('is-mobile', native || narrow || coarse);
  root.dataset.shell = native ? 'native' : narrow || coarse ? 'mobile' : 'desktop';
}

markShell();
window.matchMedia('(max-width: 820px)').addEventListener('change', markShell);
window.matchMedia('(pointer: coarse)').addEventListener('change', markShell);

createRoot(document.getElementById('root')!).render(<App />);
