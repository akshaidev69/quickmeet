import { useMemo, useState } from 'react';
import { Logo } from './icons';
import { useToasts } from '../hooks/useToasts';
import { formatDurationLabel, formatMeetingWhen } from '../lib/formatTime';

export type SummaryHighlight = {
  id?: string;
  ts: number;
  text: string;
};

export type SummaryPromiseItem = {
  text: string;
  owner?: string;
};

export type ParticipantPresence = {
  name: string;
  ms?: number;
};

export type MeetingSummaryData = {
  code: string;
  title: string;
  startedAt: number;
  endedAt: number;
  participants: string[];
  catchUp: SummaryHighlight[];
  promises: SummaryPromiseItem[] | string[];
  faceCastReady: boolean;
  onDownloadFaceCast?: () => void;
  pollCount?: number;
  followUpCount?: number;
  recordingAvailable?: boolean;
  presence?: ParticipantPresence[];
  endedForEveryone?: boolean;
  guest?: boolean;
};

type Props = {
  data: MeetingSummaryData;
  onDashboard: () => void;
  onNewMeeting: () => void;
  onRejoin?: () => void;
};

const FEEDBACK_TAGS = ['Clear audio', 'Smooth video', 'Good pace', 'Well organized', 'Connection issues'] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatHighlightTs(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatMeetingRange(start: number, end: number) {
  const startLabel = formatMeetingWhen(start);
  const endTime = new Date(end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${startLabel} – ${endTime}`;
}

function normalizeHighlights(items: SummaryHighlight[]): SummaryHighlight[] {
  return items.filter((item) => item.text?.trim());
}

function normalizePromises(items: MeetingSummaryData['promises']): SummaryPromiseItem[] {
  if (!items.length) return [];
  if (typeof items[0] === 'string') {
    return (items as string[]).map((text) => {
      const match = text.match(/^([^:]{2,40}):\s*(.+)$/);
      if (match) return { owner: match[1].trim(), text: match[2].trim() };
      return { text: text.trim() };
    });
  }
  return items as SummaryPromiseItem[];
}

function harvestPromisesFromHighlights(highlights: SummaryHighlight[]): SummaryPromiseItem[] {
  const re =
    /\b(i'?ll|i will|we'?ll|we will|todo\b|action item|follow[- ]?up|send (you|the)|by (monday|tuesday|wednesday|thursday|friday|eod|tomorrow))/i;
  const found: SummaryPromiseItem[] = [];
  for (const item of highlights) {
    if (!re.test(item.text)) continue;
    const match = item.text.match(/^([^:]{2,40}):\s*(.+)$/);
    if (match) found.push({ owner: match[1].trim(), text: match[2].trim() });
    else found.push({ text: item.text.trim().slice(0, 160) });
  }
  return [...new Map(found.map((row) => [row.text, row])).values()].slice(0, 12);
}

function buildShareUrl(code: string) {
  const url = new URL(location.href);
  url.pathname = '/app';
  url.searchParams.set('room', code);
  url.hash = '';
  return url.toString();
}

function buildSummaryText(data: MeetingSummaryData, highlights: SummaryHighlight[], promises: SummaryPromiseItem[]) {
  const duration = formatDurationLabel(data.endedAt - data.startedAt, data.endedAt);
  const lines = [
    `${data.title || 'LetsConnect meeting'}`,
    `Code: ${data.code}`,
    `${formatMeetingRange(data.startedAt, data.endedAt)} · ${duration}`,
    '',
    'Catch-Up highlights',
    ...(highlights.length
      ? highlights.map((item) => `- [${formatHighlightTs(item.ts)}] ${item.text}`)
      : ['- None captured']),
    '',
    'Promises & follow-ups',
    ...(promises.length ? promises.map((item) => `- ${item.owner ? `${item.owner}: ` : ''}${item.text}`) : ['- None']),
    '',
    `Participants (${data.participants.length}): ${data.participants.join(', ') || 'Just you'}`,
  ];
  return lines.join('\n');
}

function presenceRows(data: MeetingSummaryData): ParticipantPresence[] {
  if (data.presence?.length) return data.presence;
  return data.participants.map((name) => ({ name }));
}

export function MeetingSummary({ data, onDashboard, onNewMeeting, onRejoin }: Props) {
  const { toasts, push: toast } = useToasts();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());

  const durationMs = data.endedAt - data.startedAt;
  const duration = formatDurationLabel(durationMs, data.endedAt);
  const highlights = useMemo(() => normalizeHighlights(data.catchUp), [data.catchUp]);
  const promises = useMemo(() => {
    const base = normalizePromises(data.promises);
    return base.length ? base : harvestPromisesFromHighlights(highlights);
  }, [data.promises, highlights]);

  const followUpCount = data.followUpCount ?? promises.length;
  const pollCount = data.pollCount ?? 0;
  const attendees = presenceRows(data);
  const maxPresence = Math.max(...attendees.map((row) => row.ms ?? 1), 1);
  const showRejoin = Boolean(onRejoin);

  const summaryText = useMemo(
    () => buildSummaryText(data, highlights, promises),
    [data, highlights, promises],
  );

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  function togglePromise(text: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopiedSummary(true);
      window.setTimeout(() => setCopiedSummary(false), 1800);
    } catch {
      toast('Could not copy summary.');
    }
  }

  async function shareLink() {
    const link = buildShareUrl(data.code);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
      toast('Meeting link copied.');
    } catch {
      toast(link);
    }
  }

  function sendFeedback() {
    if (!rating && !tags.length && !feedbackNote.trim()) {
      toast('Pick a rating or add a note first.');
      return;
    }
    try {
      const key = `LetsConnect.summaryFeedback.${data.code}.${data.endedAt}`;
      localStorage.setItem(
        key,
        JSON.stringify({ rating, tags, note: feedbackNote.trim(), savedAt: Date.now() }),
      );
      setFeedbackSent(true);
      toast('Thanks — feedback saved on this device.');
    } catch {
      toast('Could not save feedback.');
    }
  }

  return (
    <main className="summary-page">
      <header className="summary-topbar">
        <div className="summary-brand">
          <Logo size={32} />
          <span>LetsConnect</span>
        </div>
        <div className="summary-topbar-actions">
          <button type="button" className="secondary" onClick={onDashboard}>
            Back to home
          </button>
          {data.guest ? (
            <button type="button" className="secondary" onClick={() => (location.href = '/register')}>
              Create an account
            </button>
          ) : null}
          {showRejoin ? (
            <button type="button" className="primary" onClick={onRejoin}>
              Rejoin
            </button>
          ) : (
            <button type="button" className="primary" onClick={onNewMeeting}>
              New meeting
            </button>
          )}
        </div>
      </header>

      <section className="summary-hero" aria-labelledby="summary-hero-title">
        <p className="summary-hero-kicker">
          {data.endedForEveryone
            ? `Meeting ended · ${formatMeetingRange(data.startedAt, data.endedAt)}`
            : 'You left the meeting'}
        </p>
        <h1 id="summary-hero-title">{data.title || 'LetsConnect meeting'}</h1>
        <p className="summary-hero-privacy">Private to people who were in this call · Code {data.code}</p>
        <dl className="summary-stats">
          <div>
            <dt>Duration</dt>
            <dd>{duration}</dd>
          </div>
          <div>
            <dt>Participants</dt>
            <dd>{data.participants.length}</dd>
          </div>
          <div>
            <dt>Follow-ups</dt>
            <dd>{followUpCount}</dd>
          </div>
          <div>
            <dt>Polls</dt>
            <dd>{pollCount}</dd>
          </div>
        </dl>
      </section>

      <div className="summary-columns">
        <article className="summary-panel">
          <header className="summary-panel-head">
            <h2>Catch-Up highlights</h2>
            <div className="summary-panel-actions">
              <button type="button" className="textbtn" onClick={() => void copySummary()}>
                {copiedSummary ? 'Copied' : 'Copy summary'}
              </button>
              <button type="button" className="textbtn" onClick={() => void shareLink()}>
                {copiedLink ? 'Link copied' : 'Share link'}
              </button>
            </div>
          </header>
          {highlights.length === 0 ? (
            <p className="summary-empty">No highlights from this call yet.</p>
          ) : (
            <ul className="summary-timeline">
              {highlights.slice(0, 10).map((item) => (
                <li key={item.id ?? `${item.ts}-${item.text}`}>
                  <time dateTime={new Date(item.ts).toISOString()}>{formatHighlightTs(item.ts)}</time>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="summary-panel">
          <header className="summary-panel-head">
            <h2>Promises & follow-ups</h2>
          </header>
          {promises.length === 0 ? (
            <p className="summary-empty">Nothing to harvest yet — chat during the call to capture follow-ups.</p>
          ) : (
            <ul className="summary-checklist">
              {promises.map((item) => {
                const key = item.text;
                const done = checked.has(key);
                return (
                  <li key={key}>
                    <label className={done ? 'is-done' : undefined}>
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => togglePromise(key)}
                      />
                      {item.owner ? (
                        <span className="summary-owner" aria-hidden="true">
                          {initials(item.owner)}
                        </span>
                      ) : null}
                      <span className="summary-check-text">{item.text}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {data.faceCastReady && (
            <button
              type="button"
              className="secondary summary-facecast-btn"
              onClick={() => data.onDownloadFaceCast?.() ?? toast('Download FaceCast from the meeting room before leaving next time.')}
            >
              FaceCast · Download ZIP
            </button>
          )}
        </article>

        <article className="summary-panel summary-panel-stack">
          <div>
            <header className="summary-panel-head">
              <h2>Who joined</h2>
            </header>
            {attendees.length === 0 ? (
              <p className="summary-empty">Just you in this room.</p>
            ) : (
              <ul className="summary-attendance">
                {attendees.map((person) => {
                  const share = person.ms != null ? person.ms / maxPresence : 1 / attendees.length;
                  const pct = Math.round(Math.max(8, Math.min(100, share * 100)));
                  return (
                    <li key={person.name}>
                      <div className="summary-attendance-row">
                        <span className="summary-owner">{initials(person.name)}</span>
                        <span className="summary-attendance-name">{person.name}</span>
                      </div>
                      <div className="summary-attendance-bar" aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="summary-rating-block">
            <h2>Rate the call</h2>
            <div className="summary-stars" role="group" aria-label="Call quality">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={rating >= star ? 'star on' : 'star'}
                  aria-label={`${star} star${star === 1 ? '' : 's'}`}
                  aria-pressed={rating === star}
                  onClick={() => setRating(star)}
                >
                  {'★'}
                </button>
              ))}
            </div>
            <div className="summary-tags">
              {FEEDBACK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={tags.includes(tag) ? 'summary-tag on' : 'summary-tag'}
                  aria-pressed={tags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              className="summary-feedback-input"
              rows={2}
              placeholder="Optional note (saved on this device)"
              value={feedbackNote}
              onChange={(event) => setFeedbackNote(event.target.value)}
            />
            <button type="button" className="primary summary-feedback-send" onClick={sendFeedback}>
              {feedbackSent ? 'Feedback saved' : 'Send feedback'}
            </button>
          </div>
        </article>
      </div>

      <div className="summary-footer-cards">
        <button
          type="button"
          className="summary-footer-card"
          onClick={() => toast('Schedule follow-up is coming soon.')}
        >
          <strong>Schedule follow-up</strong>
          <span>Coming soon</span>
        </button>
        <button
          type="button"
          className="summary-footer-card"
          onClick={() => toast('Email summary is coming soon.')}
        >
          <strong>Email summary</strong>
          <span>Coming soon</span>
        </button>
        {data.recordingAvailable ? (
          <button
            type="button"
            className="summary-footer-card"
            onClick={() => toast('Recording playback is coming soon.')}
          >
            <strong>Recording</strong>
            <span>Coming soon</span>
          </button>
        ) : null}
      </div>

      {toasts.length > 0 && (
        <div className="toasts summary-toasts" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className="toast">
              {item.text}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
