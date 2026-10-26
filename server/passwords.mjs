import bcrypt from 'bcryptjs';
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

const ROUNDS = 12;

/** Prefer bcrypt; still verify legacy scrypt `salt:hash` rows. */
export async function hashPassword(password) {
  return bcrypt.hash(String(password), ROUNDS);
}

export async function verifyPassword(password, stored) {
  const value = String(stored || '');
  if (!value) return false;
  if (value.includes(':') && !value.startsWith('$2')) {
    // Legacy scrypt: salt:hex
    const [salt, hash] = value.split(':');
    if (!salt || !hash) return false;
    try {
      const next = scryptSync(password, salt, 64);
      const prev = Buffer.from(hash, 'hex');
      if (prev.length !== next.length) return false;
      return timingSafeEqual(prev, next);
    } catch {
      return false;
    }
  }
  try {
    return await bcrypt.compare(String(password), value);
  } catch {
    return false;
  }
}

export function newSalt() {
  return randomBytes(16).toString('hex');
}
