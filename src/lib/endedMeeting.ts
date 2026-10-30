import { formatCode } from './code';

const PREFIX = 'lc-ended:';
const TTL_MS = 24 * 60 * 60 * 1000;

export function markMeetingEnded(code: string) {
  const key = formatCode(code);
  if (!key) return;
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, String(Date.now()));
  } catch {
    /* private mode */
  }
}

export function isMeetingEndedLocal(code: string) {
  const key = formatCode(code);
  if (!key) return false;
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at) || Date.now() - at > TTL_MS) {
      sessionStorage.removeItem(`${PREFIX}${key}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchRoomJoinState(code: string): Promise<'live' | 'ended' | 'missing'> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(formatCode(code))}`);
    if (res.status === 410) return 'ended';
    if (res.ok) return 'live';
    return 'missing';
  } catch {
    return 'missing';
  }
}
