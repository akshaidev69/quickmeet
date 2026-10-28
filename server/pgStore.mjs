/**
 * Optional Postgres-backed user store when DATABASE_URL is set (Render).
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;

/** @type {import('pg').Pool | null} */
let pool = null;
/** @type {Promise<boolean> | null} */
let ready = null;

export function pgEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === '0' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function ensurePg() {
  if (!pgEnabled()) return false;
  if (ready) return ready;
  ready = (async () => {
    const client = await getPool().connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          email_norm TEXT NOT NULL,
          name TEXT NOT NULL,
          password_hash TEXT,
          google_id TEXT,
          avatar TEXT,
          plan TEXT NOT NULL DEFAULT 'free',
          created_at BIGINT NOT NULL
        );
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_norm_uidx ON users (email_norm)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_uidx ON users (google_id) WHERE google_id IS NOT NULL`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS meetings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          code TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          started_at BIGINT NOT NULL,
          ended_at BIGINT,
          duration_ms BIGINT NOT NULL DEFAULT 0,
          attendees INTEGER NOT NULL DEFAULT 1,
          notes TEXT NOT NULL DEFAULT ''
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS meetings_user_idx ON meetings (user_id, started_at DESC)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS waitlist (
          email TEXT PRIMARY KEY,
          created_at BIGINT NOT NULL
        );
      `);
    } finally {
      client.release();
    }
    return true;
  })().catch((err) => {
    console.error('Postgres init failed; using JSON store.', err.message);
    ready = Promise.resolve(false);
    return false;
  });
  return ready;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email_norm || String(row.email || '').toLowerCase(),
    name: row.name,
    passwordHash: row.password_hash,
    googleId: row.google_id,
    avatar: row.avatar,
    plan: row.plan || 'free',
    createdAt: Number(row.created_at) || Date.now(),
  };
}

export async function pgFindUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const { rows } = await getPool().query('SELECT * FROM users WHERE email_norm = $1 LIMIT 1', [normalized]);
  return mapUser(rows[0]);
}

export async function pgFindUserById(id) {
  const { rows } = await getPool().query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return mapUser(rows[0]);
}

export async function pgFindUserByGoogleId(googleId) {
  const { rows } = await getPool().query('SELECT * FROM users WHERE google_id = $1 LIMIT 1', [googleId]);
  return mapUser(rows[0]);
}

export async function pgCreateUser({ email, name, passwordHash = null, googleId = null, avatar = null, id = null }) {
  const normalized = String(email || '').trim().toLowerCase();
  const existing = await pgFindUserByEmail(normalized);
  if (existing) throw Object.assign(new Error('Email already registered.'), { status: 409 });
  const userId = id || randomUUID();
  const display = String(name || '').trim().slice(0, 60) || normalized.split('@')[0];
  try {
    await getPool().query(
      `INSERT INTO users (id, email, email_norm, name, password_hash, google_id, avatar, plan, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'free',$8)`,
      [userId, normalized, normalized, display, passwordHash, googleId, avatar, Date.now()],
    );
  } catch (err) {
    if (String(err.code) === '23505') throw Object.assign(new Error('Email already registered.'), { status: 409 });
    throw err;
  }
  return pgFindUserById(userId);
}

export async function pgUpsertUserProfile({ id, email, name, passwordHash = undefined, googleId = null, avatar = null }) {
  const normalized = String(email || '').trim().toLowerCase();
  const existing = (id && (await pgFindUserById(id))) || (await pgFindUserByEmail(normalized));
  if (!existing) {
    return pgCreateUser({
      id: id || undefined,
      email: normalized,
      name: name || normalized.split('@')[0],
      passwordHash: passwordHash ?? null,
      googleId,
      avatar,
    });
  }
  if (passwordHash === undefined) {
    await getPool().query(
      `UPDATE users SET
         name = COALESCE(NULLIF($2,''), name),
         google_id = COALESCE($3, google_id),
         avatar = COALESCE($4, avatar),
         email = $5,
         email_norm = $5
       WHERE id = $1`,
      [existing.id, name || '', googleId, avatar, normalized],
    );
  } else {
    await getPool().query(
      `UPDATE users SET
         name = COALESCE(NULLIF($2,''), name),
         password_hash = $3,
         google_id = COALESCE($4, google_id),
         avatar = COALESCE($5, avatar),
         email = $6,
         email_norm = $6
       WHERE id = $1`,
      [existing.id, name || '', passwordHash, googleId, avatar, normalized],
    );
  }
  return pgFindUserById(existing.id);
}

export async function pgLinkGoogle(userId, googleId, avatar) {
  await getPool().query('UPDATE users SET google_id = $2, avatar = COALESCE($3, avatar) WHERE id = $1', [
    userId,
    googleId,
    avatar,
  ]);
}

export async function pgUpdateUserProfile(userId, { name }) {
  if (name != null) {
    await getPool().query('UPDATE users SET name = $2 WHERE id = $1', [userId, String(name).trim().slice(0, 60)]);
  }
  return pgFindUserById(userId);
}

function mapMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    title: row.title,
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    durationMs: Number(row.duration_ms) || 0,
    attendees: Number(row.attendees) || 1,
    notes: row.notes || '',
  };
}

export async function pgListMeetings(userId) {
  const { rows } = await getPool().query(
    'SELECT * FROM meetings WHERE user_id = $1 ORDER BY started_at DESC LIMIT 200',
    [userId],
  );
  return rows.map(mapMeeting);
}

export async function pgUpsertMeeting(userId, payload) {
  const code = String(payload.code || '').trim().toLowerCase();
  if (!code) throw Object.assign(new Error('Meeting code required'), { status: 400 });
  const { rows } = await getPool().query('SELECT * FROM meetings WHERE code = $1 LIMIT 1', [code]);
  const existing = rows[0];
  if (existing) {
    const endedAt = payload.endedAt ? Number(payload.endedAt) : existing.ended_at;
    const durationMs = payload.endedAt
      ? Math.max(0, Number(payload.endedAt) - Number(existing.started_at))
      : existing.duration_ms;
    await getPool().query(
      `UPDATE meetings SET
         attendees = GREATEST(attendees, $2),
         notes = COALESCE(NULLIF($3, ''), notes),
         ended_at = $4,
         duration_ms = $5
       WHERE code = $1`,
      [code, Number(payload.attendees) || 1, String(payload.notes || ''), endedAt, durationMs],
    );
    const next = await getPool().query('SELECT * FROM meetings WHERE code = $1', [code]);
    return mapMeeting(next.rows[0]);
  }
  const meeting = {
    id: randomUUID(),
    userId,
    code,
    title: String(payload.title || 'LetsConnect meeting').slice(0, 80),
    startedAt: payload.startedAt || Date.now(),
    endedAt: payload.endedAt || null,
    durationMs: payload.durationMs || 0,
    attendees: Number(payload.attendees) || 1,
    notes: String(payload.notes || '').slice(0, 4000),
  };
  await getPool().query(
    `INSERT INTO meetings (id, user_id, code, title, started_at, ended_at, duration_ms, attendees, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (code) DO NOTHING`,
    [
      meeting.id,
      meeting.userId,
      meeting.code,
      meeting.title,
      meeting.startedAt,
      meeting.endedAt,
      meeting.durationMs,
      meeting.attendees,
      meeting.notes,
    ],
  );
  const next = await getPool().query('SELECT * FROM meetings WHERE code = $1', [code]);
  return mapMeeting(next.rows[0]) || meeting;
}

export async function pgDeleteMeeting(userId, meetingId) {
  await getPool().query('DELETE FROM meetings WHERE id = $1 AND user_id = $2', [meetingId, userId]);
}

export async function pgEndMeetingsByCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return 0;
  const now = Date.now();
  const result = await getPool().query(
    `UPDATE meetings
     SET ended_at = $2, duration_ms = GREATEST(0, $2 - started_at)
     WHERE code = $1 AND ended_at IS NULL`,
    [normalized, now],
  );
  return result.rowCount || 0;
}

export async function pgListOpenMeetingCodes() {
  const { rows } = await getPool().query('SELECT DISTINCT code FROM meetings WHERE ended_at IS NULL');
  return rows.map((row) => row.code);
}

export async function pgAddWaitlistEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { ok: false, already: false };
  try {
    await getPool().query('INSERT INTO waitlist (email, created_at) VALUES ($1, $2)', [normalized, Date.now()]);
    return { ok: true, already: false };
  } catch (err) {
    if (String(err.code) === '23505') return { ok: true, already: true };
    throw err;
  }
}
