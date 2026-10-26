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
