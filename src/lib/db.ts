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
