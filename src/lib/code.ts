const alphabet = 'abcdefghjkmnpqrstuvwxyz';

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function meetingCode() {
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

export function compactCode(raw: string) {
  const fromUrl = raw.match(/room=([a-zA-Z0-9-]+)/);
  const source = fromUrl ? fromUrl[1] : raw;
  return source.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
}

export function formatCode(raw: string) {
  const c = compactCode(raw);
  if (c.length <= 3) return c;
  if (c.length <= 7) return `${c.slice(0, 3)}-${c.slice(3)}`;
  return `${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}`;
}

export function isFullCode(raw: string) {
  return compactCode(raw).length === 10;
}

const meetingCodePattern = /^[a-hjkmnp-z]{3}-[a-hjkmnp-z]{4}-[a-hjkmnp-z]{3}$/;

export function isValidMeetingCode(raw: string) {
  const compact = compactCode(raw);
  if (compact.length !== 10) return false;
  for (const char of compact) {
    if (!alphabet.includes(char)) return false;
  }
  return meetingCodePattern.test(formatCode(raw));
}

export function safeName(name: string) {
  const trimmed = name.trim().slice(0, 40);
  return trimmed || 'Guest';
}
