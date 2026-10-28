import { Logo } from './icons';
import { ThemeButton } from './LookControls';
import { BUILD_VERSION } from '../lib/build';
import type { ThemeMode } from '../types';

type Kind = 'privacy' | 'terms';

type Props = {
  kind: Kind;
  theme: ThemeMode;
  onTheme: (theme: ThemeMode) => void;
  onHome: () => void;
};

export function LegalPage({ kind, theme, onTheme, onHome }: Props) {
  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  return (
    <main className="legal-page">
      <header className="legal-top">
        <button type="button" className="luma-brand" onClick={onHome}>
          <Logo size={28} />
          <strong>LetsConnect</strong>
        </button>
        <ThemeButton theme={theme} onChange={onTheme} />
      </header>
      <article className="legal-body">
        <p className="hint">Version {BUILD_VERSION}</p>
        <h1>{title}</h1>
        {kind === 'privacy' ? <PrivacyCopy /> : <TermsCopy />}
      </article>
    </main>
  );
}

function PrivacyCopy() {
  return (
    <>
      <p>LetsConnect is a video meeting product. We collect the minimum needed to run your account and your calls.</p>
      <h2>What we store</h2>
      <ul>
        <li>Account email, display name, and a password hash or Google id if you sign in.</li>
        <li>Meeting codes, titles, start and end times for meetings you host.</li>
        <li>Waitlist emails if you ask to be notified about pricing.</li>
      </ul>
      <h2>What stays on your device</h2>
      <p>
        Camera and microphone media are sent peer-to-peer. Theme, devices, and frame preferences stay in this browser.
        Chat files you send go through the meeting signaling channel to people in that room only.
      </p>
      <h2>Cookies</h2>
      <p>We use an httpOnly session cookie so you stay signed in. There are no advertising cookies.</p>
      <h2>Contact</h2>
      <p>Questions about this policy: use the email on your LetsConnect account.</p>
    </>
  );
}

function TermsCopy() {
  return (
    <>
      <p>By using LetsConnect you agree to use it for lawful meetings and to respect other people in the room.</p>
      <h2>The service</h2>
      <p>
        LetsConnect is provided as-is while we grow. Features such as Pro pricing are listed as coming soon until they
        ship. We may change free limits with notice on this site.
      </p>
      <h2>Your content</h2>
      <p>
        You own the video, chat, whiteboard, and recordings you create. You grant us a limited license to transmit them
        so the meeting can run. Do not share illegal or harmful material.
      </p>
      <h2>Accounts</h2>
      <p>Guests may join a meeting with a name only. Hosts are responsible for admitting people into their rooms.</p>
    </>
  );
}
