import { useState, type FormEvent } from 'react';
import { Logo } from './icons';
import { formatCode, isValidMeetingCode } from '../lib/code';

type Props = {
  onLogin: () => void;
  onRegister: () => void;
  onApp: () => void;
  signedIn: boolean;
};

const steps = [
  {
    n: '1',
    title: 'Create a room',
    body: 'One click opens a private LetsConnect room with a waiting room by default.',
  },
  {
    n: '2',
    title: 'Share the link',
    body: 'Send the code or invite URL. Guests knock; you admit who belongs.',
  },
  {
    n: '3',
    title: 'Meet & keep the recap',
    body: 'Catch-Up, FaceCast cuts, chat, and airtime stay on your account after you leave.',
  },
];

const compareRows = [
  { feature: 'Waiting room & co-hosts', us: true, them: true },
  { feature: 'Catch-Up for late joins', us: true, them: false },
  { feature: '4-cut FaceCast ZIP', us: true, them: false },
  { feature: 'Promise harvest from chat', us: true, them: false },
  { feature: 'Same-room local mute', us: true, them: false },
  { feature: 'Meeting history in your account', us: true, them: 'Limited' },
];

const featureCards = [
  { title: 'Waiting room', body: 'Knock first. Hosts and co-hosts admit people.', icon: 'door' },
  { title: 'FaceCast cuts', body: 'Host, room, screen, and chat as one ZIP.', icon: 'cast' },
  { title: 'Catch-Up', body: 'See joins, hands, and chat you missed.', icon: 'clock' },
  { title: 'Same-room mute', body: 'Mute a desk neighbor locally — no echo.', icon: 'mute' },
  { title: 'Polls', body: 'Quick votes without leaving the call.', icon: 'poll' },
  { title: 'Screen share', body: 'Present a tab or window with one stop.', icon: 'share' },
  { title: 'Hand raise', body: 'Queue speakers without interrupting.', icon: 'hand' },
  { title: 'Live chat', body: 'Side chat that feeds Catch-Up & promises.', icon: 'chat' },
];

const privacyTiles = [
  { title: 'Link-gated rooms', body: 'Only people with the code can knock.' },
  { title: 'Admit control', body: 'Hosts decide who enters — every time.' },
  { title: 'Your account data', body: 'History stays with your login, not a shared board.' },
  { title: 'No sale of meetings', body: 'We do not sell your call content.' },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    hook: 'While we grow',
    cta: 'Start for free',
    featured: true,
    perks: ['Unlimited meetings', 'Waiting room & co-hosts', 'FaceCast ZIP', 'Catch-Up + airtime', 'Account history'],
  },
  {
    name: 'Pro',
    price: 'Soon',
    period: '',
    hook: 'Early access',
    cta: 'Notify me',
    featured: false,
    perks: ['Cloud recording vault', 'Branded lobby', 'Longer FaceCast archives', 'Priority support'],
  },
  {
    name: 'Studio',
    price: 'Soon',
    period: '',
    hook: 'For orgs',
    cta: 'Notify me',
    featured: false,
    perks: ['SSO', 'Admin controls', 'Shared playbooks', 'Usage analytics'],
  },
];

const faqs = [
  {
    q: 'Is LetsConnect really free?',
    a: 'Yes. Core meetings, waiting room, Catch-Up, and FaceCast are free while we grow. Pro and Studio are waitlist-only for later.',
  },
  {
    q: 'How do I invite others?',
    a: 'Start or open a meeting, copy the link or code, and send it. Guests ask to join; you admit them from People.',
  },
  {
    q: 'What is FaceCast?',
    a: 'One stop records four playable cuts — host, room, screen, and chat — packed into a ZIP you can preview and download.',
  },
  {
    q: 'Do I need an account?',
    a: 'Yes for hosts. Sign in with Google or email so your meetings and history stay on your account across devices.',
  },
  {
    q: 'Does it work on mobile?',
    a: 'Yes in the mobile browser, and there is an Android app build. Use headphones if two devices share a desk.',
  },
];

const trusts = [
  { label: 'Waiting room', sub: 'Admit control' },
  { label: 'Catch-Up', sub: 'Late-join memory' },
  { label: 'FaceCast', sub: '4 marketing cuts' },
  { label: 'Peer video', sub: 'WebRTC direct' },
];

export function MarketingPage({ onLogin, onRegister, onApp, signedIn }: Props) {
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const start = signedIn ? onApp : onRegister;

  function onJoin(event: FormEvent) {
    event.preventDefault();
    const code = formatCode(joinCode);
    if (!isValidMeetingCode(code)) {
      setJoinError('Enter a valid code (abc-defg-hij).');
      return;
    }
    setJoinError('');
    if (signedIn) {
      window.location.assign(`/app?room=${encodeURIComponent(code)}`);
      return;
    }
    sessionStorage.setItem('lc-pending-join', code);
    onLogin();
  }

  return (
    <div className="luma-page">
      <header className="luma-nav">
        <button type="button" className="luma-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Logo size={32} />
          <strong>LetsConnect</strong>
        </button>
        <nav className="luma-nav-links" aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#compare">Why us</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">Help</a>
        </nav>
        <div className="luma-nav-actions">
          {signedIn ? (
            <button type="button" className="luma-btn luma-btn-primary" onClick={onApp}>
              Open app
            </button>
          ) : (
            <>
              <button type="button" className="luma-linkbtn" onClick={onLogin}>
                Log in
              </button>
              <button type="button" className="luma-btn luma-btn-primary" onClick={onRegister}>
                Get started
              </button>
            </>
          )}
        </div>
      </header>

      <section className="luma-hero">
        <div className="luma-hero-grid">
          <div className="luma-hero-copy">
            <p className="luma-pill">Built for every workflow</p>
            <h1>
              Video meetings that <em>remember</em> what matters.
            </h1>
            <p className="luma-lead">
              Start a room, admit who you want, and keep Catch-Up plus FaceCast on your account — so the call is not the only thing that survives.
            </p>
            <div className="luma-hero-actions">
              <button type="button" className="luma-btn luma-btn-primary luma-btn-lg" onClick={start}>
                Get started for free
              </button>
              <p className="luma-fine">No credit card required</p>
            </div>
            <form className="luma-join" onSubmit={onJoin}>
              <label className="sr-only" htmlFor="luma-join-code">
                Meeting link or code
              </label>
              <input
                id="luma-join-code"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  if (joinError) setJoinError('');
                }}
                placeholder="Paste a meeting link or code"
                autoComplete="off"
              />
              <button type="submit" className="luma-btn luma-btn-dark">
                Join
              </button>
            </form>
            {joinError && <p className="luma-field-error">{joinError}</p>}
          </div>

          <div className="luma-hero-visual" aria-hidden="true">
            <div className="luma-mock">
              <div className="luma-mock-main">
                <div className="luma-mock-grid">
                  <div className="luma-tile t1"><span>Anmol</span></div>
                  <div className="luma-tile t2"><span>Priya</span></div>
                  <div className="luma-tile t3"><span>Dev</span></div>
                  <div className="luma-tile t4"><span>Sam</span></div>
                </div>
                <div className="luma-mock-bar">
                  <span />
                  <span />
                  <span />
                  <span className="end" />
                </div>
              </div>
              <aside className="luma-mock-side">
                <strong>Catch-Up</strong>
                <p>Priya joined</p>
                <p>Dev raised a hand</p>
                <p>Promise: send deck</p>
                <p className="muted">FaceCast ready</p>
              </aside>
            </div>
          </div>
        </div>

        <div className="luma-trust">
          <p>Trusted for rooms that need memory</p>
          <ul>
            {trusts.map((item) => (
              <li key={item.label}>
                <strong>{item.label}</strong>
                <span>{item.sub}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="luma-section" id="how">
        <div className="luma-section-head">
          <h2>From link to live in under a minute</h2>
          <p>No install maze. Open LetsConnect, share a code, and keep what happened after the call.</p>
        </div>
        <div className="luma-steps">
          {steps.map((step) => (
            <article key={step.n} className="luma-step">
              <span className="luma-step-n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="luma-section" id="compare">
        <div className="luma-section-head">
          <h2>Other online meetings are great at calls.</h2>
          <p>LetsConnect is built for what happens around them — memory, cuts, and follow-through.</p>
        </div>
        <div className="luma-table-wrap">
          <table className="luma-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">LetsConnect</th>
                <th scope="col">Other online meetings</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td>{row.us === true ? <Check /> : row.us}</td>
                  <td>
                    {row.them === true ? <Check soft /> : row.them === false ? <Empty /> : <span className="luma-limited">{row.them}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="luma-section" id="features">
        <div className="luma-section-head">
          <h2>Everything in one room</h2>
          <p>HD video and low-latency audio, plus the tools teams actually reopen after the call.</p>
        </div>
        <div className="luma-feat-grid">
          <article className="luma-feat-hero">
            <p className="luma-feat-kicker">Video & audio</p>
            <h3>The best of video calls — then memory on top</h3>
            <p>Peer-to-peer WebRTC with STUN/TURN, waiting room, layouts, reactions, and captions when your browser allows.</p>
            <ul>
              <li>Grid, speaker, and sidebar layouts</li>
              <li>Screen share with a clear stop control</li>
              <li>Works when a guest has no camera</li>
            </ul>
          </article>
          {featureCards.map((card) => (
            <article key={card.title} className="luma-feat-card">
              <span className={`luma-feat-ico ${card.icon}`} aria-hidden="true" />
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="luma-privacy" id="privacy">
        <div className="luma-privacy-inner">
          <div className="luma-privacy-copy">
            <h2>Private by design, not by add-on.</h2>
            <p>
              Rooms are link-gated. Admission is host-controlled. Your meeting history lives on your LetsConnect account —
              not a shared whiteboard for whoever finds the URL.
            </p>
            <a className="luma-btn luma-btn-ghost" href="#faq">
              Read common questions
            </a>
          </div>
          <div className="luma-privacy-tiles">
            {privacyTiles.map((tile) => (
              <article key={tile.title}>
                <h3>{tile.title}</h3>
                <p>{tile.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="luma-section" id="pricing">
        <div className="luma-section-head center">
          <h2>Free now. Fair later.</h2>
          <p>Everything useful is free today. Paid tiers are hooks for later — not walls.</p>
        </div>
        <div className="luma-price-grid">
          {plans.map((plan) => (
            <article key={plan.name} className={plan.featured ? 'luma-price featured' : 'luma-price'}>
              <p className="luma-price-hook">{plan.hook}</p>
              <h3>{plan.name}</h3>
              <p className="luma-price-amount">
                {plan.price}
                {plan.period && <span>{plan.period}</span>}
              </p>
              <ul>
                {plan.perks.map((perk) => (
                  <li key={perk}>
                    <Check />
                    {perk}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={plan.featured ? 'luma-btn luma-btn-primary' : 'luma-btn luma-btn-quiet'}
                onClick={plan.featured ? start : onRegister}
              >
                {plan.cta}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="luma-section" id="faq">
        <div className="luma-section-head">
          <h2>Questions, answered</h2>
          <p>Short answers for hosts, guests, and people comparing tools.</p>
        </div>
        <div className="luma-faq">
          {faqs.map((item, index) => {
            const open = faqOpen === index;
            return (
              <div key={item.q} className={open ? 'luma-faq-item open' : 'luma-faq-item'}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setFaqOpen(open ? null : index)}
                >
                  <span>{item.q}</span>
                  <em aria-hidden="true">{open ? '−' : '+'}</em>
                </button>
                {open && <p>{item.a}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="luma-final">
        <div className="luma-final-banner">
          <h2>Your next meeting can remember itself.</h2>
          <p>Open a room in seconds. Keep Catch-Up and FaceCast when you are done.</p>
          <div className="luma-final-actions">
            <button type="button" className="luma-btn luma-btn-light" onClick={start}>
              Start your meeting
            </button>
            <button type="button" className="luma-btn luma-btn-ghost" onClick={signedIn ? onApp : onLogin}>
              {signedIn ? 'Go to dashboard' : 'Host your first chat'}
            </button>
          </div>
        </div>
      </section>

      <footer className="luma-foot">
        <div className="luma-foot-brand">
          <Logo size={28} />
          <div>
            <strong>LetsConnect</strong>
            <p>Free video meetings with memory.</p>
            <small>© {new Date().getFullYear()} LetsConnect</small>
          </div>
        </div>
        <div className="luma-foot-cols">
          <div>
            <h4>Product</h4>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#how">How it works</a>
          </div>
          <div>
            <h4>Resources</h4>
            <a href="#faq">Help</a>
            <a href="#compare">Why us</a>
            <a href="#privacy">Privacy</a>
          </div>
          <div>
            <h4>Account</h4>
            {signedIn ? (
              <button type="button" className="luma-linkbtn" onClick={onApp}>
                Open app
              </button>
            ) : (
              <>
                <button type="button" className="luma-linkbtn" onClick={onLogin}>
                  Log in
                </button>
                <button type="button" className="luma-linkbtn" onClick={onRegister}>
                  Get started
                </button>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

function Check({ soft = false }: { soft?: boolean }) {
  return (
    <span className={soft ? 'luma-check soft' : 'luma-check'} aria-label="Yes">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 5-5L12.6 5 6.5 11.2z"
        />
      </svg>
    </span>
  );
}

function Empty() {
  return <span className="luma-empty" aria-label="No" />;
}
