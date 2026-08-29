import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

export interface UserRow {
  user_id: string;
  msg_count: number;
  voice_sec: number;
  boxes: number;
  msg_tier: number;
  voice_tier: number;
  points: number;
  crafts: number;
  last_daily: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  msg_count  INTEGER NOT NULL DEFAULT 0,
  voice_sec  INTEGER NOT NULL DEFAULT 0,
  boxes      INTEGER NOT NULL DEFAULT 0,
  msg_tier   INTEGER NOT NULL DEFAULT 0,
  voice_tier INTEGER NOT NULL DEFAULT 0,
  points     INTEGER NOT NULL DEFAULT 0,
  crafts     INTEGER NOT NULL DEFAULT 0,
  last_daily TEXT
);
CREATE TABLE IF NOT EXISTS items (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_open (
  user_id   TEXT PRIMARY KEY,
  joined_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points ON users(points DESC);
CREATE INDEX IF NOT EXISTS idx_msg    ON users(msg_count DESC);
CREATE INDEX IF NOT EXISTS idx_voice  ON users(voice_sec DESC);
CREATE INDEX IF NOT EXISTS idx_crafts ON users(crafts DESC);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function ensureUser(db: DB, userId: string): UserRow {
  db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as UserRow;
}

export function addMsg(db: DB, userId: string): void {
  ensureUser(db, userId);
  db.prepare('UPDATE users SET msg_count = msg_count + 1 WHERE user_id = ?').run(userId);
}

export function addVoiceSec(db: DB, userId: string, sec: number): void {
  ensureUser(db, userId);
  db.prepare('UPDATE users SET voice_sec = voice_sec + ? WHERE user_id = ?').run(sec, userId);
}

export function tiersReached(value: number, tiers: number[]): number {
  return tiers.filter((x) => value >= x).length;
}

export function claimBoxes(
  db: DB,
  userId: string,
  msgTiers: number[],
  voiceTiers: number[]
): { gained: number; boxes: number; msgCount: number; voiceSec: number } {
  return db.transaction(() => {
    const u = ensureUser(db, userId);
    const wantMsg = Math.max(u.msg_tier, tiersReached(u.msg_count, msgTiers));
    const wantVoice = Math.max(u.voice_tier, tiersReached(Math.floor(u.voice_sec / 60), voiceTiers));
    const gained = wantMsg - u.msg_tier + (wantVoice - u.voice_tier);
    db.prepare('UPDATE users SET boxes = boxes + ?, msg_tier = ?, voice_tier = ? WHERE user_id = ?')
      .run(gained, wantMsg, wantVoice, userId);
    return { gained, boxes: u.boxes + gained, msgCount: u.msg_count, voiceSec: u.voice_sec };
  })();
}

export function claimDaily(db: DB, userId: string, today: string, amount: number): { ok: boolean; boxes: number } {
  return db.transaction(() => {
    const u = ensureUser(db, userId);
    if (u.last_daily === today) return { ok: false, boxes: u.boxes };
    db.prepare('UPDATE users SET boxes = boxes + ?, last_daily = ? WHERE user_id = ?').run(amount, today, userId);
    return { ok: true, boxes: u.boxes + amount };
  })();
}

export function addBoxes(db: DB, userId: string, delta: number): number {
  return db.transaction(() => {
    const u = ensureUser(db, userId);
    const next = Math.max(0, u.boxes + delta);
    db.prepare('UPDATE users SET boxes = ? WHERE user_id = ?').run(next, userId);
    return next;
  })();
}

export function openVoice(db: DB, userId: string, now: number): void {
  ensureUser(db, userId);
  db.prepare('INSERT OR IGNORE INTO voice_open (user_id, joined_at) VALUES (?, ?)').run(userId, now);
}

export function closeVoice(db: DB, userId: string, now: number): void {
  db.transaction(() => {
    const row = db.prepare('SELECT joined_at FROM voice_open WHERE user_id = ?').get(userId) as
      | { joined_at: number }
      | undefined;
    if (!row) return;
    db.prepare('UPDATE users SET voice_sec = voice_sec + ? WHERE user_id = ?')
      .run(Math.max(0, now - row.joined_at), userId);
    db.prepare('DELETE FROM voice_open WHERE user_id = ?').run(userId);
  })();
}

export function flushVoice(db: DB, now: number): void {
  db.transaction(() => {
    const rows = db.prepare('SELECT user_id, joined_at FROM voice_open').all() as {
      user_id: string;
      joined_at: number;
    }[];
    for (const r of rows) {
      db.prepare('UPDATE users SET voice_sec = voice_sec + ? WHERE user_id = ?')
        .run(Math.max(0, now - r.joined_at), r.user_id);
    }
    db.prepare('UPDATE voice_open SET joined_at = ?').run(now);
  })();
}

export function resetVoiceSessions(db: DB): void {
  db.prepare('DELETE FROM voice_open').run();
}

export function openVoiceIds(db: DB): string[] {
  return (db.prepare('SELECT user_id FROM voice_open').all() as { user_id: string }[]).map((r) => r.user_id);
}

export function openBox(
  db: DB,
  userId: string,
  itemId: string,
  points: number
): { boxes: number; points: number } | null {
  return db.transaction(() => {
    const u = ensureUser(db, userId);
    if (u.boxes <= 0) return null;
    db.prepare('UPDATE users SET boxes = boxes - 1, points = points + ? WHERE user_id = ?').run(points, userId);
    db.prepare(
      `INSERT INTO items (user_id, item_id, qty) VALUES (?, ?, 1)
       ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + 1`
    ).run(userId, itemId);
    return { boxes: u.boxes - 1, points: u.points + points };
  })();
}

export function getItems(db: DB, userId: string): { item_id: string; qty: number }[] {
  return db.prepare('SELECT item_id, qty FROM items WHERE user_id = ? AND qty > 0 ORDER BY item_id')
    .all(userId) as { item_id: string; qty: number }[];
}

export function craft(db: DB, userId: string, itemIds: string[], gain: number): boolean {
  return db.transaction(() => {
    const need = new Map<string, number>();
    for (const id of itemIds) need.set(id, (need.get(id) ?? 0) + 1);
    for (const [id, n] of need) {
      const row = db.prepare('SELECT qty FROM items WHERE user_id = ? AND item_id = ?').get(userId, id) as
        | { qty: number }
        | undefined;
      if (!row || row.qty < n) return false;
    }
    for (const [id, n] of need) {
      db.prepare('UPDATE items SET qty = qty - ? WHERE user_id = ? AND item_id = ?').run(n, userId, id);
    }
    db.prepare('DELETE FROM items WHERE user_id = ? AND qty <= 0').run(userId);
    db.prepare('UPDATE users SET points = points + ?, crafts = crafts + 1 WHERE user_id = ?').run(gain, userId);
    return true;
  })();
}

const TOP_COLUMNS = {
  points: 'points',
  msg: 'msg_count',
  voice: 'voice_sec',
  crafts: 'crafts'
} as const;

export type TopKey = keyof typeof TOP_COLUMNS;

export function topPage(db: DB, key: TopKey, offset: number, limit = 10): { user_id: string; value: number }[] {
  const col = TOP_COLUMNS[key];
  return db
    .prepare(
      `SELECT user_id, ${col} AS value FROM users WHERE ${col} > 0
       ORDER BY ${col} DESC, user_id ASC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as { user_id: string; value: number }[];
}

export function topCount(db: DB, key: TopKey): number {
  const col = TOP_COLUMNS[key];
  return (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${col} > 0`).get() as { n: number }).n;
}

export function rankOf(db: DB, key: TopKey, userId: string): number {
  const col = TOP_COLUMNS[key];
  const me = db.prepare(`SELECT ${col} AS v FROM users WHERE user_id = ?`).get(userId) as { v: number } | undefined;
  if (!me || me.v <= 0) return 0;
  const above = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${col} > ?`).get(me.v) as { n: number };
  return above.n + 1;
}
