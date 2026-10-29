import { useState } from 'react';
import { Logo } from './icons';
import { ThemeButton } from './LookControls';
import { continueWithApp, shareInviteUrl } from '../lib/invite';
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
  const [appStatus, setAppStatus] = useState<'idle' | 'opening' | 'download'>('idle');

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(shareInviteUrl(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function onContinueApp() {
    setAppStatus('opening');
    continueWithApp(code, () => setAppStatus('download'));
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
        <p className="hint">Continue with the LetsConnect app, or join in this browser. You will sign in before the waiting room.</p>
        <button type="button" className="join-gate-code" onClick={() => void copyCode()}>
          {code}
          <span>{copied ? 'Link copied' : 'Copy invite'}</span>
        </button>
        <button type="button" className="primary join-gate-btn" onClick={onContinueApp}>
          {appStatus === 'opening' ? 'Opening the app…' : appStatus === 'download' ? 'Downloading the app…' : 'Continue with app'}
        </button>
        <button type="button" className="secondary join-gate-btn" onClick={onContinueWeb}>
          Continue in web
        </button>
        {appStatus === 'download' ? (
          <p className="hint">App not installed, so the LetsConnect APK is downloading. Install it, then tap Continue with app again.</p>
        ) : null}
      </section>
    </main>
  );
}
