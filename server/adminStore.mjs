import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { pgEnabled, pgInsertAdminEvent, pgListAdminEvents } from './pgStore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LETSCONNECT_DATA || path.join(__dirname, '..', 'data');
const jsonPath = path.join(dataDir, 'admin-events.json');
const MAX_EVENTS = 2000;

/** @typedef {{ id: string, ts: number, type: string, room: string | null, userId: string | null, name: string | null, email: string | null, detail: string | null, ip: string | null }} AdminEvent */

/** @type {AdminEvent[]} */
let events = [];
let persistTimer = null;
let pgHydrated = false;

function load() {
  try {
    if (!fs.existsSync(jsonPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return Array.isArray(parsed) ? parsed.slice(0, MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

events = load();

function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = `${jsonPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(events.slice(0, MAX_EVENTS)));
      fs.renameSync(tmp, jsonPath);
    } catch {
      /* disk full / read-only */
    }
  }, 400);
}

async function hydrateFromPg() {
  if (!pgEnabled() || pgHydrated) return;
  pgHydrated = true;
  try {
    const rows = await pgListAdminEvents(MAX_EVENTS);
    if (!rows.length) return;
    const seen = new Set(events.map((item) => item.id));
    for (const row of rows) {
      if (!seen.has(row.id)) events.push(row);
    }
    events.sort((a, b) => b.ts - a.ts);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  } catch {
    pgHydrated = false;
  }
}

void hydrateFromPg();

/**
 * Append a real activity event. Never throws. Does not store chat/caption text.
 * @param {Partial<AdminEvent> & { type: string }} partial
 */
export function recordEvent(partial) {
  try {
    const event = {
      id: randomUUID(),
      ts: Date.now(),
      type: String(partial.type || 'unknown').slice(0, 64),
      room: partial.room ? String(partial.room).trim().toLowerCase().slice(0, 40) : null,
      userId: partial.userId ? String(partial.userId).slice(0, 80) : null,
      name: partial.name ? String(partial.name).trim().slice(0, 80) : null,
      email: partial.email ? String(partial.email).trim().toLowerCase().slice(0, 120) : null,
      detail: partial.detail ? String(partial.detail).slice(0, 240) : null,
      ip: partial.ip ? String(partial.ip).slice(0, 64) : null,
    };
    events.unshift(event);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    persistSoon();
    if (pgEnabled()) {
      void pgInsertAdminEvent(event).catch(() => undefined);
    }
  } catch {
    /* never break meetings for telemetry */
  }
}

export function listEvents(limit = 200) {
  void hydrateFromPg();
  return events.slice(0, Math.min(Math.max(Number(limit) || 200, 1), 500));
}

export function eventStats(now = Date.now()) {
  const hour = now - 60 * 60 * 1000;
  const day = now - 24 * 60 * 60 * 1000;
  let lastHour = 0;
  let lastDay = 0;
  for (const event of events) {
    if (event.ts >= hour) lastHour += 1;
    if (event.ts >= day) lastDay += 1;
    else break;
  }
  return { lastHour, lastDay, total: events.length };
}
