import { Logo } from './icons';

type Props = {
  onLogin: () => void;
  onRegister: () => void;
  onApp: () => void;
  signedIn: boolean;
};

const differences = [
  {
    title: 'Four cuts, one stop',
    vs: 'Meet / Zoom give you one blob — if recording works at all.',
    us: 'FaceCast exports host, room, screen, and chat as a ZIP you can preview in-app.',
  },
  {
    title: 'Late? Catch up live',
    vs: 'Others leave you guessing what happened before you joined.',
    us: 'Catch-Up shows joins, chat highlights, hands, and who has been talking.',
  },
  {
    title: 'Same-room sanity',
    vs: 'Two laptops on one desk = echo city.',
    us: 'Mute a teammate sitting next to you — locally — so the room stays clean.',
  },
  {
    title: 'Promises, not scrollback',
    vs: '“I’ll send that” disappears into chat forever.',
    us: 'Promise harvest pulls follow-ups into a list you can keep after the call.',
  },
];

const features = [
  {
    title: 'Admit waiting room',
    body: 'Knock first. Hosts and co-hosts admit people — no random drop-ins.',
  },
  {
    title: 'FaceCast director cuts',
    body: 'Record four marketing-ready videos in one stop: host, room, screen, chat.',
  },
  {
    title: 'Catch-Up for late joins',
    body: 'See what you missed — chat highlights, hands, and who has been talking.',
  },
  {
    title: 'Same-room mute',
    body: 'Sitting next to a teammate? Mute their audio for you so the room does not echo.',
  },
  {
    title: 'Promise harvest',
    body: 'LetsConnect spots “I’ll send that” moments in chat and builds a follow-up list.',
  },
  {
    title: 'Your meeting history',
    body: 'Every account keeps its own meetings, notes, and airtime — not a shared whiteboard.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    hook: 'Now · while we grow',
    cta: 'Start free',
    perks: ['Unlimited meetings', 'Waiting room & co-hosts', '4-cut FaceCast ZIP', 'Catch-Up + airtime', 'Meeting history in your account'],
    featured: true,
  },
  {
    name: 'Pro',
    price: 'Soon',
    hook: 'Hook · early access waitlist',
    cta: 'Notify me',
    perks: ['Cloud recording vault', 'Branded lobby', 'Longer FaceCast archives', 'Priority support'],
    featured: false,
  },
  {
    name: 'Teams',
    price: 'Soon',
    hook: 'Hook · for orgs',
    cta: 'Notify me',
    perks: ['SSO', 'Admin controls', 'Shared playbooks', 'Usage analytics'],
    featured: false,
  },
];

export function MarketingPage({ onLogin, onRegister, onApp, signedIn }: Props) {
  return (
    <div className="market">
      <div className="market-atmosphere" aria-hidden="true" />

      <header className="market-nav">
        <button type="button" className="market-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Logo size={28} />
          <strong>LetsConnect</strong>
        </button>
        <nav className="market-links">
          <a href="#different">Why us</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          {signedIn ? (
            <button type="button" className="primary slim" onClick={onApp}>
              Open app
            </button>
          ) : (
            <>
              <button type="button" className="textbtn" onClick={onLogin}>
                Log in
              </button>
              <button type="button" className="primary slim" onClick={onRegister}>
                Sign up free
              </button>
            </>
          )}
        </nav>
      </header>

      <section className="market-hero">
        <div className="market-hero-stage">
          <div className="market-hero-copy">
            <p className="market-kicker">Meetings that remember</p>
            <h1>LetsConnect</h1>
            <p className="market-lead">
              Start a room, admit who you want, and keep Catch-Up plus FaceCast on your account — free while we grow.
            </p>
            <div className="market-cta">
              {signedIn ? (
                <button type="button" className="primary xl" onClick={onApp}>
                  Go to your meetings
                </button>
              ) : (
                <button type="button" className="primary xl" onClick={onRegister}>
                  Start free
                </button>
              )}
              {!signedIn && (
                <button type="button" className="textbtn market-cta-login" onClick={onLogin}>
                  Log in
                </button>
              )}
            </div>
            <p className="market-note">No credit card. Google or email.</p>
          </div>

          <div className="market-hero-visual">
            <figure className="demo-shot">
              <img
                src="/letsconnect-demo-meeting.jpg"
                alt="LetsConnect meeting with participants and Catch-Up"
                width={1280}
                height={720}
                loading="eager"
              />
              <figcaption>
                <span className="demo-live">Product look</span>
                Waiting room · Catch-Up · FaceCast
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="market-section market-different" id="different">
        <h2>How we’re different</h2>
        <p className="market-sub">Meet and Zoom are great at calls. LetsConnect is built for what happens around the call.</p>
        <div className="diff-grid">
          {differences.map((item) => (
            <article key={item.title} className="diff-card">
              <h3>{item.title}</h3>
              <p className="diff-vs">
                <span>Others</span>
                {item.vs}
              </p>
              <p className="diff-us">
                <span>LetsConnect</span>
                {item.us}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="market-section" id="features">
        <h2>Everything in one room</h2>
        <p className="market-sub">Built for real rooms — offices, classrooms, and messy Wi‑Fi — not demo decks.</p>
        <div className="feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="feature-card">
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="market-section" id="pricing">
        <h2>Pricing</h2>
        <p className="market-sub">Everything useful is free today. Paid tiers are hooks for later — not walls.</p>
        <div className="price-grid">
          {plans.map((plan) => (
            <article key={plan.name} className={plan.featured ? 'price-card featured' : 'price-card'}>
              <p className="price-hook">{plan.hook}</p>
              <h3>{plan.name}</h3>
              <p className="price-amount">{plan.price}</p>
              <ul>
                {plan.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
              <button
                type="button"
                className={plan.featured ? 'primary' : 'secondary'}
                onClick={plan.featured ? (signedIn ? onApp : onRegister) : onRegister}
              >
                {plan.cta}
              </button>
            </article>
          ))}
        </div>
      </section>

      <footer className="market-foot">
        <Logo size={22} />
        <span>LetsConnect · free for everyone right now</span>
      </footer>
    </div>
  );
}

