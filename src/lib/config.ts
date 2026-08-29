import type { DB } from './db.js';
import type { Rarity } from './items.js';

export interface Config {
  channels: string[];
  event_start: number | null;
  event_end: number | null;
  enabled: boolean;
  msg_tiers: number[];
  voice_tiers: number[];
  rarity_weights: Record<Rarity, number>;
  rarity_points: Record<Rarity, number>;
  daily_boxes: number;
  min_msg_len: number;
  msg_cooldown: number;
  log_channel: string | null;
}

export const DEFAULTS: Config = {
  channels: [],
  event_start: null,
  event_end: null,
  enabled: true,
  msg_tiers: [15, 30, 60, 120, 200],
  voice_tiers: [30, 60, 120, 240, 480],
  rarity_weights: { common: 50, uncommon: 27, rare: 15, epic: 6, legendary: 2 },
  rarity_points: { common: 10, uncommon: 30, rare: 80, epic: 200, legendary: 700 },
  daily_boxes: 3,
  min_msg_len: 7,
  msg_cooldown: 5,
  log_channel: null
};

let cache: Config | null = null;

export function loadConfig(db: DB): Config {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const c: Config = structuredClone(DEFAULTS);
  for (const r of rows) {
    if (r.key in DEFAULTS) {
      try {
        (c as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
      } catch {
        // giá trị hỏng thì giữ mặc định
      }
    }
  }
  cache = c;
  return c;
}

export function cfg(): Config {
  if (!cache) throw new Error('config chưa được nạp — gọi loadConfig trước');
  return cache;
}

export function setConfig<K extends keyof Config>(db: DB, key: K, value: Config[K]): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
  cfg()[key] = value;
}

export function setConfigMany(db: DB, patch: Partial<Config>): void {
  const entries = Object.entries(patch) as [keyof Config, Config[keyof Config]][];
  db.transaction(() => {
    for (const [key, value] of entries) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(key, JSON.stringify(value));
    }
  })();
  const c = cfg();
  for (const [key, value] of entries) (c as unknown as Record<string, unknown>)[key] = value;
}

export function isEventActive(c: Config, now = Math.floor(Date.now() / 1000)): boolean {
  if (!c.enabled) return false;
  if (c.event_start !== null && now < c.event_start) return false;
  if (c.event_end !== null && now > c.event_end) return false;
  return true;
}

export function todayVN(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}
