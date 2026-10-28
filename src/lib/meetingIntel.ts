/** Unique meeting intelligence — Catch-Up, airtime, promises, receipt. */

export type AirtimeMap = Record<string, number>;

export type PromiseItem = {
  id: string;
  name: string;
  text: string;
  ts: number;
};

export type CatchUpEvent = {
  id: string;
  ts: number;
  kind: 'join' | 'chat' | 'hand' | 'share' | 'poll' | 'note' | 'board';
  text: string;
};

const PROMISE_RE =
  /\b(i'?ll|i will|we'?ll|we will|todo\b|action item|follow[- ]?up|send (you|the)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|eow|tomorrow|tonight)|\bowner:|\bdeadline:)/i;

export function harvestPromises(
  chat: { id?: string; name: string; text: string; ts: number; system?: boolean; from?: string }[],
): PromiseItem[] {
  return chat
    .filter((message) => !message.system && PROMISE_RE.test(message.text))
    .map((message, index) => ({
      id: message.id || `${message.ts}-${index}`,
      name: message.name,
      text: message.text.trim(),
      ts: message.ts,
    }));
}

export function buildCatchUp(input: {
  joinedAt: number;
  chat: { id: string; name: string; text: string; ts: number; system?: boolean }[];
  airtime: AirtimeMap;
  names: Record<string, string>;
  hands: string[];
  sharing: string[];
}): CatchUpEvent[] {
  const events: CatchUpEvent[] = [];
  for (const message of input.chat) {
    if (message.ts < input.joinedAt - 60_000) continue;
    if (message.system) {
      events.push({ id: message.id, ts: message.ts, kind: 'join', text: message.text });
    } else {
      events.push({
        id: message.id,
        ts: message.ts,
        kind: 'chat',
        text: `${message.name}: ${message.text.slice(0, 120)}`,
      });
    }
  }
  for (const name of input.hands) {
    events.push({ id: `hand-${name}`, ts: Date.now(), kind: 'hand', text: `${name} has a hand raised` });
  }
  for (const name of input.sharing) {
    events.push({ id: `share-${name}`, ts: Date.now(), kind: 'share', text: `${name} is presenting` });
  }
  const ranked = Object.entries(input.airtime)
    .map(([id, ms]) => ({ id, ms, name: input.names[id] || 'Someone' }))
    .filter((row) => row.ms > 1500)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3);
  if (ranked.length) {
    events.push({
      id: 'airtime',
      ts: Date.now(),
      kind: 'note',
      text: `Most airtime: ${ranked.map((row) => `${row.name} (${formatAirtime(row.ms)})`).join(', ')}`,
    });
  }
  return events.sort((a, b) => b.ts - a.ts).slice(0, 24);
}

export function formatAirtime(ms: number) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function buildReceipt(input: {
  code: string;
  durationMs: number;
  attendees: { name: string; role: string; airtimeMs: number }[];
  promises: PromiseItem[];
  chatCount: number;
}): string {
  const lines = [
    'LetsConnect · Meeting receipt',
    `Code: ${input.code}`,
    `Duration: ${formatAirtime(input.durationMs)}`,
    `Chat messages: ${input.chatCount}`,
    '',
    'Attendees & airtime',
    ...input.attendees.map(
      (person) => `- ${person.name} (${person.role}) · ${formatAirtime(person.airtimeMs)}`,
    ),
    '',
    'Promises & follow-ups',
    ...(input.promises.length
      ? input.promises.map((item) => `- ${item.name}: ${item.text}`)
      : ['- None detected in chat']),
    '',
    `Saved ${new Date().toLocaleString()}`,
  ];
  return lines.join('\n');
}
