const alphabet = 'abcdefghjkmnpqrstuvwxyz';

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function meetingCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const pick = (offset: number, n: number) =>
    Array.from({ length: n }, (_, i) => alphabet[bytes[offset + i] % alphabet.length]).join('');
  return `${pick(0, 3)}-${pick(3, 4)}-${pick(7, 3)}`;
}

export function compactCode(raw: string) {
  const text = String(raw || '').trim();
  const fromRoom = text.match(/[?&#]room=([a-zA-Z0-9-]+)/i);
  if (fromRoom?.[1]) return fromRoom[1].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  const fromJoin = text.match(/\/(?:join|meeting|room)\/([a-zA-Z0-9-]+)/i);
  if (fromJoin?.[1]) return fromJoin[1].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
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

/** Allow letters, digits, spaces, and common punctuation. Digits must not be stripped. */
export function safeName(name: string) {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^a-zA-Z0-9 .'_\-()&+,]/g, '')
    .slice(0, 40)
    .trim();
  return cleaned || 'Guest';
}

/** Session-scoped display name for a room (never writes to account settings). */
export function roomDisplayNameKey(code: string) {
  return `lc-room-name:${formatCode(code)}`;
}

export function loadRoomDisplayName(code: string, fallback = '') {
  try {
    return safeName(sessionStorage.getItem(roomDisplayNameKey(code)) || fallback);
  } catch {
    return safeName(fallback);
  }
}

export function saveRoomDisplayName(code: string, name: string) {
  try {
    sessionStorage.setItem(roomDisplayNameKey(code), safeName(name));
  } catch {
    /* private mode */
  }
}
