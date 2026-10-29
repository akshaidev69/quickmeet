import { useEffect, useState } from 'react';
import { Logo } from './icons';
import { ThemeButton } from './LookControls';
import {
  isAndroidWeb,
  isIosWeb,
  openAppStore,
  openInNativeApp,
  shareInviteUrl,
} from '../lib/invite';
import type { ThemeMode } from '../types';

type Props = {
  code: string;
  theme: ThemeMode;
  onTheme: (theme: ThemeMode) => void;
  onContinueWeb: () => void;
  onHome: () => void;
};

export function JoinGate({ code, theme, onTheme, onContinueWeb, onHome }: Props) {
  const [copied, setCopied] = useState(false);
  const android = isAndroidWeb();
  const ios = isIosWeb();

  useEffect(() => {
    if (!android) return;
    const id = window.setTimeout(() => openInNativeApp(code), 280);
    return () => window.clearTimeout(id);
  }, [android, code]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(shareInviteUrl(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="join-gate">
      <header className="join-gate-top">
        <button type="button" className="luma-brand" onClick={onHome}>
          <Logo size={28} />
          <strong>LetsConnect</strong>
        </button>
        <ThemeButton theme={theme} onChange={onTheme} />
      </header>
      <section className="join-gate-card">
        <p className="join-gate-kicker">You are invited</p>
        <h1>Join this meeting</h1>
        <p className="hint">
          {android
            ? 'Opening LetsConnect if it is installed on this phone. If nothing happens, download the app or continue in the browser.'
            : ios
              ? 'Open the LetsConnect app to join, download it if you do not have it yet, or continue in this browser.'
              : 'Open the LetsConnect app, download it, or continue in this browser.'}
        </p>
        <button type="button" className="join-gate-code" onClick={() => void copyCode()}>
          {code}
          <span>{copied ? 'Link copied' : 'Copy invite'}</span>
        </button>
        <button type="button" className="primary join-gate-btn" onClick={() => openInNativeApp(code)}>
          Open in app
        </button>
        <button type="button" className="secondary join-gate-btn" onClick={() => openAppStore()}>
          Download the app
        </button>
        <button type="button" className="join-gate-web" onClick={onContinueWeb}>
          Continue in browser
        </button>
      </section>
    </main>
  );
}
