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
