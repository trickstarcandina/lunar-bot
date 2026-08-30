# Bot Trung Thu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot Discord prefix-command chạy event Trung Thu — đếm tin nhắn (ở kênh được cấu hình) và thời gian voice (toàn server), quy đổi thành hộp bánh, mở hộp ra item có rarity, craft, xếp hạng, owner cấu hình ngay trong Discord.

**Architecture:** Sapphire framework trên discord.js v14, dữ liệu trong một file SQLite qua `better-sqlite3` (API đồng bộ, không cần await). Toàn bộ SQL gom trong `src/lib/db.ts`; listener và command chỉ gọi hàm của lib. Không build step — chạy TypeScript trực tiếp bằng `tsx`. Test là một file `src/selftest.ts` dùng `node:assert` với DB `:memory:`.

**Tech Stack:** TypeScript (ESM, Node 20+), `@sapphire/framework` v5, `discord.js` v14, `better-sqlite3` v11, `tsx`, `dotenv`.

**Spec:** `docs/superpowers/specs/2026-08-29-mid-autumn-bot-design.md`

## Global Constraints

- Node.js 20 trở lên. `"type": "module"` — mọi import nội bộ phải có đuôi `.js` (ví dụ `./lib/db.js`) dù file nguồn là `.ts`.
- Prefix only. Không đăng ký slash command ở bất kỳ task nào.
- Prefix mặc định `-`, lấy từ `process.env.PREFIX`.
- Intents bắt buộc: `Guilds`, `GuildMessages`, `MessageContent`, `GuildVoiceStates`. Client phải đặt `loadMessageCommandListeners: true`, nếu không prefix command không chạy.
- Mọi SQL nằm trong `src/lib/db.ts`. Command và listener không được viết SQL.
- Mọi thao tác ghi nhiều bước bọc trong `db.transaction(...)`.
- Quyền owner lấy từ env `OWNERS` (danh sách user id ngăn cách dấu phẩy), **không** dùng quyền Discord.
- Ngày dùng cho `-daily` tính theo `Asia/Ho_Chi_Minh`, định dạng `YYYY-MM-DD`.
- Text hiển thị cho người chơi viết tiếng Việt.
- Thông báo ephemeral dùng `flags: MessageFlags.Ephemeral` (không dùng `ephemeral: true`, đã deprecated ở discord.js 14.17+).
- Chạy test: `npm test`. Chạy một test: `npm test -- <chuỗi trong tên test>`.
- Mỗi task kết thúc bằng một commit.

## File Structure

| File | Trách nhiệm |
|---|---|
| `package.json`, `tsconfig.json`, `.gitignore`, `.env.example` | scaffold, script chạy và test |
| `src/lib/db.ts` | mở DB, schema, toàn bộ câu SQL, transaction |
| `src/lib/items.ts` | 14 item, rarity, nhóm, roll gacha, tính điểm craft |
| `src/lib/config.ts` | settings mặc định, nạp/ghi, kiểm tra event mở, ngày giờ VN |
| `src/lib/ui.ts` | embed builder, format thời lượng, collector cho button |
| `src/listeners/message.ts` | đếm tin nhắn |
| `src/listeners/voice.ts` | đếm thời gian voice |
| `src/commands/event.ts` | `-daily` `-box` `-open` `-inv` `-craft` `-top` |
| `src/commands/admin.ts` | `-cfg` `-addbox` |
| `src/index.ts` | boot client, nạp config, quét voice lúc khởi động, flush 60s |
| `src/selftest.ts` | self-check bằng assert |

Sapphire load được nhiều piece trong một file (`LoaderStrategy.load` duyệt mọi export là subclass của store constructor), nên 6 command nằm chung `event.ts` vẫn hoạt động.

---

### Task 1: Scaffold + lớp DB cơ bản

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
- Create: `src/lib/db.ts`
- Test: `src/selftest.ts`

**Interfaces:**
- Consumes: không
- Produces: `type DB = Database.Database`; `interface UserRow { user_id: string; msg_count: number; voice_sec: number; boxes: number; msg_tier: number; voice_tier: number; points: number; crafts: number; last_daily: string | null }`; `openDb(path: string): DB`; `ensureUser(db: DB, userId: string): UserRow`; `addMsg(db: DB, userId: string): void`

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "lunar-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node --import tsx src/index.ts",
    "test": "node --import tsx src/selftest.ts"
  },
  "dependencies": {
    "@sapphire/framework": "^5.3.0",
    "better-sqlite3": "^11.5.0",
    "discord.js": "^14.16.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Tạo `tsconfig.json`, `.gitignore`, `.env.example`**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`.gitignore`:

```
node_modules/
data/
.env
```

`.env.example`:

```
DISCORD_TOKEN=
PREFIX=-
OWNERS=
DB_PATH=data/event.db
```

- [ ] **Step 3: Cài dependency**

Run: `npm install`
Expected: cài xong, `node_modules/` tồn tại. `better-sqlite3` là native module, lần đầu có thể mất một phút để build.

- [ ] **Step 4: Viết test thất bại**

Tạo `src/selftest.ts`:

```ts
import assert from 'node:assert/strict';
import { openDb, ensureUser, addMsg } from './lib/db.js';

const filter = process.argv[2] ?? '';
const cases: Array<[string, () => void]> = [];
const t = (name: string, fn: () => void) => cases.push([name, fn]);
const mem = () => openDb(':memory:');

t('ensureUser tạo user với giá trị mặc định', () => {
  const db = mem();
  const u = ensureUser(db, 'u1');
  assert.equal(u.user_id, 'u1');
  assert.equal(u.msg_count, 0);
  assert.equal(u.boxes, 0);
  assert.equal(u.points, 0);
  assert.equal(u.last_daily, null);
});

t('ensureUser gọi hai lần không tạo trùng', () => {
  const db = mem();
  ensureUser(db, 'u1');
  ensureUser(db, 'u1');
  addMsg(db, 'u1');
  assert.equal(ensureUser(db, 'u1').msg_count, 1);
});

// --- runner --- (mọi test mới chèn PHÍA TRÊN dòng này)

let fail = 0;
for (const [name, fn] of cases) {
  if (filter && !name.includes(filter)) continue;
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}
console.log(fail ? `\n${fail} test hỏng` : '\ntất cả pass');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 5: Chạy test cho thất bại**

Run: `npm test`
Expected: FAIL — `Cannot find module './lib/db.js'`

- [ ] **Step 6: Viết `src/lib/db.ts`**

```ts
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
```

- [ ] **Step 7: Chạy test cho pass**

Run: `npm test`
Expected: PASS cả hai test, in `tất cả pass`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/
git commit -m "feat: scaffold dự án và lớp DB cơ bản"
```

---

### Task 2: Item, rarity và gacha

**Files:**
- Create: `src/lib/items.ts`
- Modify: `src/selftest.ts` (chèn test phía trên dòng `// --- runner ---`)

**Interfaces:**
- Consumes: không
- Produces: `type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'`; `type Group = 'banh' | 'den' | 'khac'`; `interface Item { id: string; name: string; rarity: Rarity; group: Group; emoji: string }`; `RARITIES: Rarity[]`; `ITEMS: Item[]`; `ITEM_MAP: Map<string, Item>`; `RARITY_LABEL: Record<Rarity, string>`; `RARITY_COLOR: Record<Rarity, number>`; `rollRarity(weights: Record<Rarity, number>, rnd?: () => number): Rarity`; `rollItem(weights: Record<Rarity, number>, rnd?: () => number): Item`; `craftGain(ids: string[], rarityPoints: Record<Rarity, number>): number`

- [ ] **Step 1: Viết test thất bại**

Chèn vào `src/selftest.ts` phía trên `// --- runner ---`:

```ts
import { ITEMS, ITEM_MAP, rollRarity, rollItem, craftGain, type Rarity } from './lib/items.js';

const W: Record<Rarity, number> = { common: 50, uncommon: 27, rare: 15, epic: 6, legendary: 2 };
const P: Record<Rarity, number> = { common: 10, uncommon: 30, rare: 80, epic: 200, legendary: 700 };

t('bảng item có đủ 14 item và 3 nhóm', () => {
  assert.equal(ITEMS.length, 14);
  assert.equal(ITEMS.filter((i) => i.group === 'banh').length, 5);
  assert.equal(ITEMS.filter((i) => i.group === 'den').length, 2);
  assert.equal(ITEMS.filter((i) => i.group === 'khac').length, 7);
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, 14);
});

t('rollRarity phân bố đúng trọng số', () => {
  const n = 100_000;
  const count: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const r = rollRarity(W);
    count[r] = (count[r] ?? 0) + 1;
  }
  const total = Object.values(W).reduce((a, b) => a + b, 0);
  for (const [r, w] of Object.entries(W)) {
    const expect = w / total;
    const got = (count[r] ?? 0) / n;
    assert.ok(Math.abs(got - expect) < 0.02, `${r}: mong ${expect}, được ${got}`);
  }
});

t('rollItem luôn trả item có thật', () => {
  for (let i = 0; i < 1000; i++) assert.ok(ITEM_MAP.has(rollItem(W).id));
});

t('craftGain bằng 2 lần tổng điểm', () => {
  assert.equal(craftGain(['banh_thap_cam', 'den_ong_sao', 'tra_sen'], P), 2 * (10 + 30 + 10));
  assert.equal(craftGain(['banh_vi_ca', 'den_keo_quan', 'tho_ngoc'], P), 2 * (200 + 80 + 700));
});
```

- [ ] **Step 2: Chạy test cho thất bại**

Run: `npm test`
Expected: FAIL — `Cannot find module './lib/items.js'`

- [ ] **Step 3: Viết `src/lib/items.ts`**

```ts
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Group = 'banh' | 'den' | 'khac';

export interface Item {
  id: string;
  name: string;
  rarity: Rarity;
  group: Group;
  emoji: string;
}

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '⚪ Thường',
  uncommon: '🟢 Hiếm',
  rare: '🔵 Quý',
  epic: '🟣 Cực quý',
  legendary: '🌕 Huyền thoại'
};

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x99aab5,
  uncommon: 0x57f287,
  rare: 0x3498db,
  epic: 0x9b59b6,
  legendary: 0xf1c40f
};

export const GROUP_LABEL: Record<Group, string> = {
  banh: 'Bánh',
  den: 'Đèn',
  khac: 'Đồ chơi & khác'
};

export const ITEMS: Item[] = [
  { id: 'banh_thap_cam',   name: 'Bánh nướng thập cẩm',      rarity: 'common',    group: 'banh', emoji: '🥮' },
  { id: 'banh_deo_sen',    name: 'Bánh dẻo hạt sen',         rarity: 'common',    group: 'banh', emoji: '🌸' },
  { id: 'tra_sen',         name: 'Trà sen',                  rarity: 'common',    group: 'khac', emoji: '🍵' },
  { id: 'banh_trung_muoi', name: 'Bánh trứng muối tan chảy', rarity: 'uncommon',  group: 'banh', emoji: '🥚' },
  { id: 'den_ong_sao',     name: 'Đèn ông sao',              rarity: 'uncommon',  group: 'den',  emoji: '⭐' },
  { id: 'mat_na',          name: 'Mặt nạ giấy bồi',          rarity: 'uncommon',  group: 'khac', emoji: '🎭' },
  { id: 'banh_sau_rieng',  name: 'Bánh dẻo lạnh sầu riêng',  rarity: 'rare',      group: 'banh', emoji: '🍡' },
  { id: 'den_keo_quan',    name: 'Đèn kéo quân',             rarity: 'rare',      group: 'den',  emoji: '🏮' },
  { id: 'trong_boi',       name: 'Trống bỏi',                rarity: 'rare',      group: 'khac', emoji: '🥁' },
  { id: 'banh_vi_ca',      name: 'Bánh nướng vi cá 4 trứng', rarity: 'epic',      group: 'banh', emoji: '🍱' },
  { id: 'dau_lan',         name: 'Đầu lân',                  rarity: 'epic',      group: 'khac', emoji: '🦁' },
  { id: 'chi_hang',        name: 'Chị Hằng',                 rarity: 'legendary', group: 'khac', emoji: '🧚' },
  { id: 'chu_cuoi',        name: 'Chú Cuội',                 rarity: 'legendary', group: 'khac', emoji: '🌳' },
  { id: 'tho_ngoc',        name: 'Thỏ Ngọc',                 rarity: 'legendary', group: 'khac', emoji: '🐇' }
];

export const ITEM_MAP = new Map(ITEMS.map((i) => [i.id, i]));

export function rollRarity(weights: Record<Rarity, number>, rnd: () => number = Math.random): Rarity {
  const total = RARITIES.reduce((s, r) => s + Math.max(0, weights[r] ?? 0), 0);
  if (total <= 0) return 'common';
  let x = rnd() * total;
  for (const r of RARITIES) {
    x -= Math.max(0, weights[r] ?? 0);
    if (x < 0) return r;
  }
  return 'common';
}

export function rollItem(weights: Record<Rarity, number>, rnd: () => number = Math.random): Item {
  const rarity = rollRarity(weights, rnd);
  const pool = ITEMS.filter((i) => i.rarity === rarity);
  return pool[Math.floor(rnd() * pool.length)]!;
}

export function craftGain(ids: string[], rarityPoints: Record<Rarity, number>): number {
  return 2 * ids.reduce((s, id) => s + rarityPoints[ITEM_MAP.get(id)!.rarity], 0);
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `npm test`
Expected: PASS cả 6 test.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: bảng item, rarity và gacha roll"
```

---

### Task 3: Cấu hình

**Files:**
- Create: `src/lib/config.ts`
- Modify: `src/selftest.ts`

**Interfaces:**
- Consumes: `DB` (Task 1), `Rarity` (Task 2)
- Produces: `interface Config { channels: string[]; event_start: number | null; event_end: number | null; enabled: boolean; msg_tiers: number[]; voice_tiers: number[]; rarity_weights: Record<Rarity, number>; rarity_points: Record<Rarity, number>; daily_boxes: number; min_msg_len: number; msg_cooldown: number; log_channel: string | null }`; `DEFAULTS: Config`; `loadConfig(db: DB): Config`; `cfg(): Config`; `setConfig<K extends keyof Config>(db: DB, key: K, value: Config[K]): void`; `isEventActive(c: Config, now?: number): boolean`; `todayVN(d?: Date): string`

- [ ] **Step 1: Viết test thất bại**

Chèn vào `src/selftest.ts` phía trên `// --- runner ---`:

```ts
import { DEFAULTS, loadConfig, cfg, setConfig, isEventActive, todayVN } from './lib/config.js';

t('loadConfig trả mặc định khi settings rỗng', () => {
  const db = mem();
  const c = loadConfig(db);
  assert.deepEqual(c.msg_tiers, [15, 30, 60, 120, 200]);
  assert.deepEqual(c.channels, []);
  assert.equal(c.daily_boxes, 3);
});

t('setConfig ghi xuống DB và nạp lại được', () => {
  const db = mem();
  loadConfig(db);
  setConfig(db, 'channels', ['111', '222']);
  assert.deepEqual(cfg().channels, ['111', '222']);
  assert.deepEqual(loadConfig(db).channels, ['111', '222']);
});

t('isEventActive theo cờ bật tắt và mốc thời gian', () => {
  const base = { ...DEFAULTS };
  assert.equal(isEventActive({ ...base }, 1000), true);
  assert.equal(isEventActive({ ...base, enabled: false }, 1000), false);
  assert.equal(isEventActive({ ...base, event_start: 2000 }, 1000), false);
  assert.equal(isEventActive({ ...base, event_start: 500 }, 1000), true);
  assert.equal(isEventActive({ ...base, event_end: 900 }, 1000), false);
  assert.equal(isEventActive({ ...base, event_end: 1100 }, 1000), true);
});

t('todayVN trả YYYY-MM-DD theo giờ Việt Nam', () => {
  // 2026-08-29 18:00 UTC = 2026-08-30 01:00 giờ VN
  assert.equal(todayVN(new Date('2026-08-29T18:00:00Z')), '2026-08-30');
  assert.equal(todayVN(new Date('2026-08-29T10:00:00Z')), '2026-08-29');
});
```

- [ ] **Step 2: Chạy test cho thất bại**

Run: `npm test`
Expected: FAIL — `Cannot find module './lib/config.js'`

- [ ] **Step 3: Viết `src/lib/config.ts`**

```ts
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
        (c as Record<string, unknown>)[r.key] = JSON.parse(r.value);
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

export function isEventActive(c: Config, now = Math.floor(Date.now() / 1000)): boolean {
  if (!c.enabled) return false;
  if (c.event_start !== null && now < c.event_start) return false;
  if (c.event_end !== null && now > c.event_end) return false;
  return true;
}

export function todayVN(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `npm test`
Expected: PASS cả 10 test.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: lớp cấu hình với giá trị mặc định và kiểm tra thời gian event"
```

---

### Task 4: Hộp bánh — mốc chat, mốc voice, điểm danh

**Files:**
- Modify: `src/lib/db.ts` (thêm hàm vào cuối file)
- Modify: `src/selftest.ts`

**Interfaces:**
- Consumes: `DB`, `ensureUser` (Task 1)
- Produces: `tiersReached(value: number, tiers: number[]): number`; `claimBoxes(db: DB, userId: string, msgTiers: number[], voiceTiers: number[]): { gained: number; boxes: number; msgCount: number; voiceSec: number }`; `claimDaily(db: DB, userId: string, today: string, amount: number): { ok: boolean; boxes: number }`; `addBoxes(db: DB, userId: string, delta: number): number`; `addVoiceSec(db: DB, userId: string, sec: number): void` (dùng trong test và Task 5)

- [ ] **Step 1: Viết test thất bại**

Chèn vào `src/selftest.ts` phía trên `// --- runner ---`:

```ts
import { claimBoxes, claimDaily, addBoxes, addVoiceSec, tiersReached } from './lib/db.js';

const MT = [15, 30, 60, 120, 200];
const VT = [30, 60, 120, 240, 480];

t('tiersReached đếm số mốc đã vượt', () => {
  assert.equal(tiersReached(0, MT), 0);
  assert.equal(tiersReached(14, MT), 0);
  assert.equal(tiersReached(15, MT), 1);
  assert.equal(tiersReached(119, MT), 3);
  assert.equal(tiersReached(9999, MT), 5);
});

t('claimBoxes gọi hai lần không phát trùng hộp', () => {
  const db = mem();
  for (let i = 0; i < 20; i++) addMsg(db, 'u1');
  const first = claimBoxes(db, 'u1', MT, VT);
  assert.equal(first.gained, 1);
  assert.equal(first.boxes, 1);
  const second = claimBoxes(db, 'u1', MT, VT);
  assert.equal(second.gained, 0);
  assert.equal(second.boxes, 1);
});

t('claimBoxes vượt nhiều mốc cùng lúc phát đủ hộp còn thiếu', () => {
  const db = mem();
  for (let i = 0; i < 125; i++) addMsg(db, 'u1');
  const r = claimBoxes(db, 'u1', MT, VT);
  assert.equal(r.gained, 4); // vượt 15, 30, 60, 120
  assert.equal(r.boxes, 4);
});

t('claimBoxes tính mốc voice theo phút, độc lập với mốc chat', () => {
  const db = mem();
  for (let i = 0; i < 20; i++) addMsg(db, 'u1');
  addVoiceSec(db, 'u1', 65 * 60); // 65 phút, vượt mốc 30 và 60
  const r = claimBoxes(db, 'u1', MT, VT);
  assert.equal(r.gained, 3); // 1 từ chat + 2 từ voice
  assert.equal(r.boxes, 3);
  addVoiceSec(db, 'u1', 60 * 60); // tổng 125 phút, vượt thêm mốc 120
  assert.equal(claimBoxes(db, 'u1', MT, VT).gained, 1);
});

t('claimDaily lần hai trong cùng ngày bị từ chối', () => {
  const db = mem();
  const first = claimDaily(db, 'u1', '2026-08-29', 3);
  assert.equal(first.ok, true);
  assert.equal(first.boxes, 3);
  const second = claimDaily(db, 'u1', '2026-08-29', 3);
  assert.equal(second.ok, false);
  assert.equal(second.boxes, 3);
  const nextDay = claimDaily(db, 'u1', '2026-08-30', 3);
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.boxes, 6);
});

t('addBoxes không cho hộp xuống dưới 0', () => {
  const db = mem();
  assert.equal(addBoxes(db, 'u1', 5), 5);
  assert.equal(addBoxes(db, 'u1', -100), 0);
  assert.equal(addBoxes(db, 'u1', 2), 2);
});
```

- [ ] **Step 2: Chạy test cho thất bại**

Run: `npm test -- claim`
Expected: FAIL — không import được `claimBoxes`.

- [ ] **Step 3: Thêm hàm vào cuối `src/lib/db.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test cho pass**

Run: `npm test`
Expected: PASS toàn bộ 16 test.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: quy đổi mốc chat và voice thành hộp bánh, điểm danh hằng ngày"
```

---

### Task 5: Kế toán thời gian voice

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/selftest.ts`

**Interfaces:**
- Consumes: `DB`, `ensureUser` (Task 1)
- Produces: `openVoice(db: DB, userId: string, now: number): void`; `closeVoice(db: DB, userId: string, now: number): void`; `flushVoice(db: DB, now: number): void`; `resetVoiceSessions(db: DB): void`; `openVoiceIds(db: DB): string[]`

- [ ] **Step 1: Viết test thất bại**

Chèn vào `src/selftest.ts` phía trên `// --- runner ---`:

```ts
import { openVoice, closeVoice, flushVoice, resetVoiceSessions, openVoiceIds } from './lib/db.js';

t('voice cộng đúng số giây qua chuỗi join, flush, leave', () => {
  const db = mem();
  openVoice(db, 'u1', 1000);
  flushVoice(db, 1060); // +60
  flushVoice(db, 1120); // +60
  closeVoice(db, 'u1', 1150); // +30
  assert.equal(ensureUser(db, 'u1').voice_sec, 150);
  assert.deepEqual(openVoiceIds(db), []);
});

t('voice join hai lần không tạo session trùng', () => {
  const db = mem();
  openVoice(db, 'u1', 1000);
  openVoice(db, 'u1', 1500); // bỏ qua, giữ mốc 1000
  closeVoice(db, 'u1', 1100);
  assert.equal(ensureUser(db, 'u1').voice_sec, 100);
});

t('closeVoice khi không có session mở thì không cộng gì', () => {
  const db = mem();
  ensureUser(db, 'u1');
  closeVoice(db, 'u1', 9999);
  assert.equal(ensureUser(db, 'u1').voice_sec, 0);
});

t('resetVoiceSessions xoá hết session đang mở', () => {
  const db = mem();
  openVoice(db, 'u1', 1000);
  openVoice(db, 'u2', 1000);
  assert.equal(openVoiceIds(db).length, 2);
  resetVoiceSessions(db);
  assert.deepEqual(openVoiceIds(db), []);
});

t('flushVoice cộng cho mọi session đang mở', () => {
  const db = mem();
  openVoice(db, 'u1', 1000);
  openVoice(db, 'u2', 1030);
  flushVoice(db, 1090);
  assert.equal(ensureUser(db, 'u1').voice_sec, 90);
  assert.equal(ensureUser(db, 'u2').voice_sec, 60);
});
```

- [ ] **Step 2: Chạy test cho thất bại**

Run: `npm test -- voice`
Expected: FAIL — không import được `openVoice`.

- [ ] **Step 3: Thêm hàm vào cuối `src/lib/db.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test cho pass**

Run: `npm test`
Expected: PASS toàn bộ 21 test.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: kế toán thời gian voice sống sót qua restart"
```

---

### Task 6: Mở hộp, craft và truy vấn xếp hạng

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/selftest.ts`

**Interfaces:**
- Consumes: `DB`, `ensureUser` (Task 1)
- Produces: `openBox(db: DB, userId: string, itemId: string, points: number): { boxes: number; points: number } | null`; `getItems(db: DB, userId: string): { item_id: string; qty: number }[]`; `craft(db: DB, userId: string, itemIds: string[], gain: number): boolean`; `type TopKey = 'points' | 'msg' | 'voice' | 'crafts'`; `topPage(db: DB, key: TopKey, offset: number, limit?: number): { user_id: string; value: number }[]`; `topCount(db: DB, key: TopKey): number`; `rankOf(db: DB, key: TopKey, userId: string): number` (0 nghĩa là chưa có hạng)

- [ ] **Step 1: Viết test thất bại**

Chèn vào `src/selftest.ts` phía trên `// --- runner ---`:

```ts
import { openBox, getItems, craft, topPage, topCount, rankOf } from './lib/db.js';

t('openBox trừ hộp, cộng điểm và cộng item', () => {
  const db = mem();
  addBoxes(db, 'u1', 2);
  const r1 = openBox(db, 'u1', 'banh_thap_cam', 10);
  assert.deepEqual(r1, { boxes: 1, points: 10 });
  const r2 = openBox(db, 'u1', 'banh_thap_cam', 10);
  assert.deepEqual(r2, { boxes: 0, points: 20 });
  assert.deepEqual(getItems(db, 'u1'), [{ item_id: 'banh_thap_cam', qty: 2 }]);
});

t('openBox trả null khi hết hộp và không đổi gì', () => {
  const db = mem();
  ensureUser(db, 'u1');
  assert.equal(openBox(db, 'u1', 'tra_sen', 10), null);
  assert.equal(ensureUser(db, 'u1').points, 0);
  assert.deepEqual(getItems(db, 'u1'), []);
});

t('craft trừ đúng 3 item, cộng điểm và tăng số lần craft', () => {
  const db = mem();
  addBoxes(db, 'u1', 3);
  openBox(db, 'u1', 'banh_thap_cam', 10);
  openBox(db, 'u1', 'den_ong_sao', 30);
  openBox(db, 'u1', 'tra_sen', 10);
  const ok = craft(db, 'u1', ['banh_thap_cam', 'den_ong_sao', 'tra_sen'], 100);
  assert.equal(ok, true);
  const u = ensureUser(db, 'u1');
  assert.equal(u.points, 150); // 50 từ mở hộp + 100 từ craft
  assert.equal(u.crafts, 1);
  assert.deepEqual(getItems(db, 'u1'), []);
});

t('craft thiếu nguyên liệu thì thất bại và không đổi gì', () => {
  const db = mem();
  addBoxes(db, 'u1', 2);
  openBox(db, 'u1', 'banh_thap_cam', 10);
  openBox(db, 'u1', 'den_ong_sao', 30);
  const ok = craft(db, 'u1', ['banh_thap_cam', 'den_ong_sao', 'tra_sen'], 100);
  assert.equal(ok, false);
  const u = ensureUser(db, 'u1');
  assert.equal(u.points, 40);
  assert.equal(u.crafts, 0);
  assert.equal(getItems(db, 'u1').length, 2);
});

t('xếp hạng sắp đúng thứ tự, đếm đúng và tính đúng hạng cá nhân', () => {
  const db = mem();
  addBoxes(db, 'a', 1);
  addBoxes(db, 'b', 1);
  addBoxes(db, 'c', 1);
  openBox(db, 'a', 'tho_ngoc', 700);
  openBox(db, 'b', 'den_keo_quan', 80);
  openBox(db, 'c', 'tra_sen', 10);
  ensureUser(db, 'd'); // 0 điểm, không lên bảng
  const page = topPage(db, 'points', 0, 10);
  assert.deepEqual(page.map((r) => r.user_id), ['a', 'b', 'c']);
  assert.equal(page[0]!.value, 700);
  assert.equal(topCount(db, 'points'), 3);
  assert.equal(rankOf(db, 'points', 'b'), 2);
  assert.equal(rankOf(db, 'points', 'd'), 0);
  assert.equal(rankOf(db, 'points', 'khong-ton-tai'), 0);
});

t('xếp hạng phân trang bằng offset', () => {
  const db = mem();
  for (let i = 0; i < 25; i++) {
    addBoxes(db, `u${i}`, 1);
    openBox(db, `u${i}`, 'tra_sen', i + 1);
  }
  assert.equal(topPage(db, 'points', 0, 10).length, 10);
  assert.equal(topPage(db, 'points', 20, 10).length, 5);
  assert.equal(topPage(db, 'points', 0, 10)[0]!.value, 25);
});
```

- [ ] **Step 2: Chạy test cho thất bại**

Run: `npm test -- openBox`
Expected: FAIL — không import được `openBox`.

- [ ] **Step 3: Thêm hàm vào cuối `src/lib/db.ts`**

```ts
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
```

Tên cột nội suy vào SQL lấy từ hằng `TOP_COLUMNS`, không phải từ input người dùng — không có đường SQL injection.

- [ ] **Step 4: Chạy test cho pass**

Run: `npm test`
Expected: PASS toàn bộ 27 test.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: mở hộp, craft mâm cỗ và truy vấn xếp hạng"
```

---

### Task 7: Boot client và tiện ích UI

**Files:**
- Create: `src/index.ts`, `src/lib/ui.ts`

**Interfaces:**
- Consumes: `openDb`, `resetVoiceSessions`, `flushVoice` (Task 1, 5), `loadConfig` (Task 3)
- Produces: mở rộng `Container` của Sapphire với `db: DB` và `owners: string[]`; `BRAND: number`; `embed(title: string, description?: string): EmbedBuilder`; `fmtDuration(sec: number): string`; `buttonRow(...c: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>`; `ownerCollector(msg: Message, userId: string, ms?: number): InteractionCollector<...>`; `isOwner(userId: string): boolean`

- [ ] **Step 1: Viết `src/lib/ui.ts`**

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
  type AnySelectMenuBuilder,
  type Message
} from 'discord.js';
import { container } from '@sapphire/framework';

export const BRAND = 0xf1c40f;

export function embed(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(BRAND).setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function buttonRow(...c: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...c);
}

export function selectRow(menu: AnySelectMenuBuilder): ActionRowBuilder<AnySelectMenuBuilder> {
  return new ActionRowBuilder<AnySelectMenuBuilder>().addComponents(menu);
}

/** Collector chỉ nhận tương tác của người gọi lệnh; hết giờ thì gỡ nút. */
export function ownerCollector(msg: Message, userId: string, ms = 300_000) {
  const collector = msg.createMessageComponentCollector({
    time: ms,
    filter: async (i) => {
      if (i.user.id === userId) return true;
      await i
        .reply({ content: 'Nút này không phải của bạn. Gõ lệnh để có bảng của riêng bạn nhé.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return false;
    }
  });
  collector.on('end', () => {
    msg.edit({ components: [] }).catch(() => {});
  });
  return collector;
}

export function isOwner(userId: string): boolean {
  return container.owners.includes(userId);
}
```

- [ ] **Step 2: Viết `src/index.ts`**

```ts
import 'dotenv/config';
import { SapphireClient, LogLevel, container } from '@sapphire/framework';
import { ChannelType, GatewayIntentBits } from 'discord.js';
import { openDb, resetVoiceSessions, flushVoice, type DB } from './lib/db.js';
import { loadConfig } from './lib/config.js';
import { syncVoiceChannel } from './listeners/voice.js';

declare module '@sapphire/pieces' {
  interface Container {
    db: DB;
    owners: string[];
  }
}

const db = openDb(process.env.DB_PATH ?? 'data/event.db');
loadConfig(db);
resetVoiceSessions(db);

container.db = db;
container.owners = (process.env.OWNERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const client = new SapphireClient({
  defaultPrefix: process.env.PREFIX ?? '-',
  caseInsensitiveCommands: true,
  loadMessageCommandListeners: true,
  logger: { level: LogLevel.Info },
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once('clientReady', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) continue;
    for (const ch of channels.values()) {
      if (ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)) {
        syncVoiceChannel(db, ch, now);
      }
    }
  }
  container.logger.info(`Sẵn sàng với ${container.owners.length} owner.`);
});

setInterval(() => flushVoice(db, Math.floor(Date.now() / 1000)), 60_000);

await client.login(process.env.DISCORD_TOKEN);
```

Lưu ý: `clientReady` là tên sự kiện của discord.js 14.16+; bản cũ hơn dùng `ready`. Nếu log cảnh báo deprecated thì đổi cho khớp bản đã cài.

- [ ] **Step 3: Kiểm tra TypeScript**

Run: `npx tsc --noEmit`
Expected: chỉ còn lỗi `Cannot find module './listeners/voice.js'` (Task 8 tạo file này). Mọi lỗi khác phải sửa ngay.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: boot Sapphire client và tiện ích embed dùng chung"
```

---

### Task 8: Listener đếm tin nhắn và thời gian voice

**Files:**
- Create: `src/listeners/message.ts`, `src/listeners/voice.ts`

**Interfaces:**
- Consumes: `addMsg`, `openVoice`, `closeVoice` (Task 1, 5), `cfg`, `isEventActive` (Task 3)
- Produces: `syncVoiceChannel(db: DB, channel: VoiceBasedChannel, now: number): void` — export từ `src/listeners/voice.ts`, `src/index.ts` gọi lúc khởi động

- [ ] **Step 1: Viết `src/listeners/message.ts`**

```ts
import { Listener } from '@sapphire/framework';
import { Events, type Message } from 'discord.js';
import { addMsg } from '../lib/db.js';
import { cfg, isEventActive } from '../lib/config.js';

const lastAt = new Map<string, number>();

export class MessageCounter extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate });
  }

  public override run(message: Message): void {
    if (message.author.bot || !message.inGuild()) return;
    const c = cfg();
    if (!isEventActive(c)) return;
    if (!c.channels.includes(message.channelId)) return;
    if (message.content.length < c.min_msg_len) return;

    const now = Date.now();
    const prev = lastAt.get(message.author.id) ?? 0;
    if (now - prev < c.msg_cooldown * 1000) return;
    lastAt.set(message.author.id, now);

    addMsg(this.container.db, message.author.id);
  }
}
```

Cooldown giữ trong RAM, mất khi restart — chấp nhận được, tệ nhất là người chơi được tính thêm một tin nhắn.

- [ ] **Step 2: Viết `src/listeners/voice.ts`**

```ts
import { Listener } from '@sapphire/framework';
import { Events, type VoiceBasedChannel, type VoiceState } from 'discord.js';
import { closeVoice, openVoice, type DB } from '../lib/db.js';

/**
 * Đồng bộ trạng thái một voice channel: ai đủ điều kiện thì mở session,
 * ai không đủ thì đóng và cộng dồn thời gian.
 * Điều kiện: kênh có từ 2 người thật trở lên, bản thân không deaf.
 * ponytail: chống AFK ở mức này là đủ; muốn chặt hơn (mute lâu, không camera)
 * thì thêm điều kiện ngay trong hàm này, mọi nơi gọi đều hưởng.
 */
export function syncVoiceChannel(db: DB, channel: VoiceBasedChannel, now: number): void {
  const humans = channel.members.filter((m) => !m.user.bot);
  const enoughPeople = humans.size >= 2;
  for (const member of humans.values()) {
    const eligible = enoughPeople && !member.voice.selfDeaf && !member.voice.deaf;
    if (eligible) openVoice(db, member.id, now);
    else closeVoice(db, member.id, now);
  }
}

export class VoiceCounter extends Listener<typeof Events.VoiceStateUpdate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.VoiceStateUpdate });
  }

  public override run(oldState: VoiceState, newState: VoiceState): void {
    const db = this.container.db;
    const now = Math.floor(Date.now() / 1000);

    const member = newState.member ?? oldState.member;
    // Rời hẳn hoặc chuyển kênh: đóng session trước, syncVoiceChannel mở lại nếu vẫn hợp lệ.
    if (member && !member.user.bot && oldState.channelId && oldState.channelId !== newState.channelId) {
      closeVoice(db, member.id, now);
    }

    if (oldState.channel) syncVoiceChannel(db, oldState.channel, now);
    if (newState.channel) syncVoiceChannel(db, newState.channel, now);
  }
}
```

Không kiểm tra `isEventActive` ở đây: thời gian voice vẫn được ghi nhận liên tục, nhưng chỉ đổi thành hộp khi người chơi gõ `-box` lúc event đang mở.

- [ ] **Step 3: Thêm listener bắt lỗi lệnh vào cuối `src/listeners/message.ts`**

Spec mục 15 yêu cầu lệnh lỗi phải trả embed thay vì im lặng. Sapphire load nhiều piece
trong một file nên class này nằm chung `message.ts` được.

```ts
import { Listener as SapphireListener, Events as FrameworkEvents, type MessageCommandErrorPayload } from '@sapphire/framework';
import { embed } from '../lib/ui.js';

export class CommandErrorLogger extends SapphireListener<typeof FrameworkEvents.MessageCommandError> {
  public constructor(context: SapphireListener.LoaderContext, options: SapphireListener.Options) {
    super(context, { ...options, event: FrameworkEvents.MessageCommandError });
  }

  public override async run(error: unknown, payload: MessageCommandErrorPayload): Promise<void> {
    this.container.logger.error(`Lỗi lệnh ${payload.command.name}:`, error);
    await payload.message
      .reply({ embeds: [embed('💥 Có lỗi xảy ra', 'Lệnh gặp sự cố. Thử lại sau, hoặc báo owner nhé.')] })
      .catch(() => {});
  }
}
```

Import `Events` ở đầu file đang lấy từ `discord.js` (cho `MessageCreate`), còn
`FrameworkEvents` lấy từ `@sapphire/framework` — hai enum khác nhau, đừng gộp.

- [ ] **Step 4: Kiểm tra TypeScript**

Run: `npx tsc --noEmit`
Expected: không còn lỗi nào (import trong `src/index.ts` từ Task 7 đã có đích).

- [ ] **Step 5: Chạy lại test cũ**

Run: `npm test`
Expected: PASS 27 test (listener chưa có test tự động — hành vi của nó được kiểm tra ở checklist smoke test Task 13).

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "feat: listener đếm tin nhắn, thời gian voice và bắt lỗi lệnh"
```

---

### Task 9: Lệnh `-daily`, `-box`, `-open`

**Files:**
- Create: `src/commands/event.ts`

**Interfaces:**
- Consumes: `claimBoxes`, `claimDaily`, `openBox`, `ensureUser` (Task 1, 4, 6), `cfg`, `isEventActive`, `todayVN` (Task 3), `rollItem`, `RARITY_COLOR`, `RARITY_LABEL` (Task 2), `embed`, `buttonRow`, `ownerCollector`, `fmtDuration` (Task 7)
- Produces: `closedEmbed(): EmbedBuilder` và `openPayload(db: DB, userId: string): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }` — Task 10 dùng lại

- [ ] **Step 1: Viết `src/commands/event.ts`**

```ts
import { Command } from '@sapphire/framework';
import { ButtonBuilder, ButtonStyle, EmbedBuilder, type ActionRowBuilder, type Message } from 'discord.js';
import { claimBoxes, claimDaily, ensureUser, openBox, type DB } from '../lib/db.js';
import { cfg, isEventActive, todayVN } from '../lib/config.js';
import { RARITY_COLOR, RARITY_LABEL, rollItem } from '../lib/items.js';
import { buttonRow, embed, fmtDuration, ownerCollector } from '../lib/ui.js';

export function closedEmbed(): EmbedBuilder {
  return embed('🌙 Event chưa mở', 'Event Trung Thu hiện không diễn ra. Hẹn gặp lại bạn nhé!');
}

export function openPayload(db: DB, userId: string) {
  const c = cfg();
  const item = rollItem(c.rarity_weights);
  const gain = c.rarity_points[item.rarity];
  const result = openBox(db, userId, item.id, gain);

  if (!result) {
    return {
      embeds: [
        embed(
          '🥮 Hết hộp rồi',
          'Bạn không còn hộp bánh nào.\nGõ `-box` để nhận hộp từ mốc chat và voice, hoặc `-daily` để điểm danh.'
        )
      ],
      components: [] as ActionRowBuilder<ButtonBuilder>[]
    };
  }

  const e = new EmbedBuilder()
    .setColor(RARITY_COLOR[item.rarity])
    .setTitle(`${item.emoji} ${item.name}`)
    .setDescription(`${RARITY_LABEL[item.rarity]} · **+${gain}** điểm`)
    .setFooter({ text: `Còn ${result.boxes} hộp · Tổng ${result.points} điểm` });

  const again = new ButtonBuilder()
    .setCustomId('open:again')
    .setLabel('Mở tiếp')
    .setEmoji('🎁')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(result.boxes <= 0);

  return { embeds: [e], components: [buttonRow(again)] };
}

export class DailyCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'daily', aliases: ['diemdanh'], description: 'Điểm danh nhận hộp bánh' });
  }

  public override async messageRun(message: Message) {
    const c = cfg();
    if (!isEventActive(c)) return message.reply({ embeds: [closedEmbed()] });

    const r = claimDaily(this.container.db, message.author.id, todayVN(), c.daily_boxes);
    const e = r.ok
      ? embed(
          '🏮 Điểm danh thành công',
          `Bạn nhận được **${c.daily_boxes}** hộp bánh, đang có **${r.boxes}** hộp.\nGõ \`-open\` để mở.`
        )
      : embed('🏮 Đã điểm danh', `Hôm nay bạn điểm danh rồi. Mai quay lại nhé!\nĐang có **${r.boxes}** hộp.`);

    return message.reply({ embeds: [e] });
  }
}

export class BoxCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'box', aliases: ['hop', 'nhan'], description: 'Nhận hộp bánh từ mốc chat và voice' });
  }

  public override async messageRun(message: Message) {
    const c = cfg();
    if (!isEventActive(c)) return message.reply({ embeds: [closedEmbed()] });

    const r = claimBoxes(this.container.db, message.author.id, c.msg_tiers, c.voice_tiers);
    const nextMsg = c.msg_tiers.find((x) => x > r.msgCount);
    const nextVoice = c.voice_tiers.find((x) => x > Math.floor(r.voiceSec / 60));

    const e = embed(
      r.gained > 0 ? `🎁 Nhận được ${r.gained} hộp bánh` : '🎁 Chưa có hộp mới',
      [
        `💬 Đã chat **${r.msgCount}** tin nhắn` + (nextMsg ? ` · mốc kế: **${nextMsg}**` : ' · đã đạt mốc cuối'),
        `🔊 Đã voice **${fmtDuration(r.voiceSec)}**` +
          (nextVoice ? ` · mốc kế: **${nextVoice} phút**` : ' · đã đạt mốc cuối'),
        '',
        `Đang có **${r.boxes}** hộp. Gõ \`-open\` để mở.`
      ].join('\n')
    );

    return message.reply({ embeds: [e] });
  }
}

export class OpenCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'open', aliases: ['mo'], description: 'Mở hộp bánh' });
  }

  public override async messageRun(message: Message) {
    if (!isEventActive(cfg())) return message.reply({ embeds: [closedEmbed()] });

    const db = this.container.db;
    const userId = message.author.id;
    ensureUser(db, userId);

    const reply = await message.reply(openPayload(db, userId));
    const collector = ownerCollector(reply, userId);

    collector.on('collect', async (i) => {
      if (!i.isButton() || i.customId !== 'open:again') return;
      await i.update(openPayload(db, userId)).catch(() => {});
    });

    return reply;
  }
}
```

- [ ] **Step 2: Kiểm tra TypeScript**

Run: `npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 3: Chạy test**

Run: `npm test`
Expected: PASS 27 test (không có test mới — logic đã được phủ ở Task 4 và 6, lớp command chỉ ghép nối).

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: lệnh daily, box và open kèm nút mở tiếp"
```

---

### Task 10: Lệnh `-inv` và luồng craft

**Files:**
- Modify: `src/commands/event.ts` (thêm vào cuối file, và sửa `openPayload` để có nút Túi đồ)

**Interfaces:**
- Consumes: `getItems`, `craft`, `ensureUser` (Task 1, 6), `ITEM_MAP`, `RARITIES`, `RARITY_LABEL`, `GROUP_LABEL`, `craftGain` (Task 2)
- Produces: `invPayload(db: DB, userId: string, name: string, page: number, self: boolean): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; page: number }`; `craftPickPayload(db: DB, userId: string, picked: Partial<Record<Group, string>>)`

- [ ] **Step 1: Thêm import và hàm dựng túi đồ vào `src/commands/event.ts`**

Bổ sung vào khối import ở đầu file:

```ts
import {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type AnySelectMenuBuilder
} from 'discord.js';
import { craft, getItems } from '../lib/db.js';
import { GROUP_LABEL, ITEM_MAP, RARITIES, craftGain, type Group, type Item } from '../lib/items.js';
import { selectRow } from '../lib/ui.js';
```

Thêm vào cuối file:

```ts
const PER_PAGE = 10;
const CRAFT_GROUPS: Group[] = ['banh', 'den', 'khac'];

interface Owned {
  item: Item;
  qty: number;
}

function ownedOf(db: DB, userId: string): Owned[] {
  return getItems(db, userId)
    .map((r) => ({ item: ITEM_MAP.get(r.item_id)!, qty: r.qty }))
    .filter((x) => x.item !== undefined)
    .sort(
      (a, b) =>
        RARITIES.indexOf(b.item.rarity) - RARITIES.indexOf(a.item.rarity) ||
        a.item.name.localeCompare(b.item.name, 'vi')
    );
}

/** Item rẻ nhất của mỗi nhóm mà người chơi đang có; undefined nếu nhóm đó trống. */
function cheapestByGroup(owned: Owned[]): Partial<Record<Group, string>> {
  const out: Partial<Record<Group, string>> = {};
  for (const g of CRAFT_GROUPS) {
    const pool = owned.filter((x) => x.item.group === g);
    if (!pool.length) continue;
    out[g] = pool.reduce((a, b) =>
      RARITIES.indexOf(a.item.rarity) <= RARITIES.indexOf(b.item.rarity) ? a : b
    ).item.id;
  }
  return out;
}

export function invPayload(db: DB, userId: string, name: string, page: number, self: boolean) {
  const owned = ownedOf(db, userId);
  const u = ensureUser(db, userId);
  const maxPage = Math.max(1, Math.ceil(owned.length / PER_PAGE));
  const p = Math.min(Math.max(0, page), maxPage - 1);
  const slice = owned.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

  const lines = slice.length
    ? slice
        .map((x) => `${RARITY_LABEL[x.item.rarity].split(' ')[0]} ${x.item.emoji} **${x.item.name}** ×${x.qty}`)
        .join('\n')
    : '_Túi trống. Gõ `-open` để mở hộp bánh._';

  const canCraft = CRAFT_GROUPS.every((g) => owned.some((x) => x.item.group === g));

  const e = embed(`🧺 Túi của ${name}`, lines).setFooter({
    text: `${u.points} điểm · ${u.boxes} hộp · ${u.crafts} mâm cỗ · Trang ${p + 1}/${maxPage}`
  });

  if (!self) return { embeds: [e], components: [] as ActionRowBuilder<ButtonBuilder>[], page: p };

  const buttons: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId('inv:prev').setEmoji('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder()
      .setCustomId('inv:next')
      .setEmoji('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= maxPage - 1),
    new ButtonBuilder()
      .setCustomId('inv:craft')
      .setLabel('Craft mâm cỗ')
      .setEmoji('🥮')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canCraft),
    new ButtonBuilder()
      .setCustomId('inv:open')
      .setLabel('Mở hộp')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(u.boxes <= 0)
  ];

  return { embeds: [e], components: [buttonRow(...buttons)], page: p };
}

export function craftPickPayload(db: DB, userId: string, picked: Partial<Record<Group, string>>) {
  const owned = ownedOf(db, userId);
  const rows: ActionRowBuilder<AnySelectMenuBuilder>[] = [];

  for (const g of CRAFT_GROUPS) {
    const pool = owned.filter((x) => x.item.group === g).slice(0, 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`craft:${g}`)
      .setPlaceholder(`Chọn ${GROUP_LABEL[g]}`)
      .addOptions(
        pool.map((x) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${x.item.name} ×${x.qty}`)
            .setDescription(RARITY_LABEL[x.item.rarity])
            .setEmoji(x.item.emoji)
            .setValue(x.item.id)
            .setDefault(picked[g] === x.item.id)
        )
      );
    rows.push(selectRow(menu));
  }

  const ids = CRAFT_GROUPS.map((g) => picked[g]).filter(Boolean) as string[];
  const ready = ids.length === CRAFT_GROUPS.length;
  const gain = ready ? craftGain(ids, cfg().rarity_points) : 0;

  const e = embed(
    '🥮 Craft Mâm cỗ Trung Thu',
    [
      'Chọn một món mỗi nhóm rồi bấm **Xác nhận**.',
      '',
      ...CRAFT_GROUPS.map((g) => {
        const id = picked[g];
        const item = id ? ITEM_MAP.get(id) : undefined;
        return `**${GROUP_LABEL[g]}:** ${item ? `${item.emoji} ${item.name}` : '_chưa chọn_'}`;
      }),
      '',
      ready ? `Nhận được **+${gain}** điểm.` : '_Chọn đủ ba nhóm để craft._'
    ].join('\n')
  );

  const confirmRow = buttonRow(
    new ButtonBuilder()
      .setCustomId('craft:go')
      .setLabel('Xác nhận')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!ready),
    new ButtonBuilder().setCustomId('craft:cancel').setLabel('Huỷ').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [e], components: [...rows, confirmRow] };
}

export class InvCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'inv', aliases: ['tui', 'bag'], description: 'Xem túi đồ' });
  }

  public override async messageRun(message: Message) {
    const db = this.container.db;
    const target = message.mentions.users.first() ?? message.author;
    const self = target.id === message.author.id;
    const name = message.guild?.members.cache.get(target.id)?.displayName ?? target.username;

    let page = 0;
    let picked: Partial<Record<Group, string>> = {};
    const reply = await message.reply(invPayload(db, target.id, name, page, self));
    if (!self) return reply;

    const collector = ownerCollector(reply, message.author.id);

    collector.on('collect', async (i) => {
      const userId = message.author.id;

      if (i.isButton() && i.customId === 'inv:prev') {
        page -= 1;
        return void (await i.update(invPayload(db, userId, name, page, true)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'inv:next') {
        page += 1;
        return void (await i.update(invPayload(db, userId, name, page, true)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'inv:open') {
        return void (await i.update(openPayload(db, userId)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'inv:craft') {
        picked = cheapestByGroup(ownedOf(db, userId));
        return void (await i.update(craftPickPayload(db, userId, picked)).catch(() => {}));
      }
      if (i.isStringSelectMenu() && i.customId.startsWith('craft:')) {
        const g = i.customId.slice('craft:'.length) as Group;
        picked[g] = i.values[0];
        return void (await i.update(craftPickPayload(db, userId, picked)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'craft:cancel') {
        return void (await i.update(invPayload(db, userId, name, page, true)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'craft:go') {
        const ids = CRAFT_GROUPS.map((g) => picked[g]).filter(Boolean) as string[];
        if (ids.length !== CRAFT_GROUPS.length) return;
        const gain = craftGain(ids, cfg().rarity_points);
        const ok = craft(db, userId, ids, gain);
        picked = {};
        const e = ok
          ? embed(
              '🥮 Craft thành công',
              `Bạn bày được một **Mâm cỗ Trung Thu** và nhận **+${gain}** điểm!\nTổng điểm: **${ensureUser(db, userId).points}**`
            )
          : embed('🥮 Craft thất bại', 'Nguyên liệu không còn đủ. Mở thêm hộp rồi thử lại nhé.');
        return void (await i.update({ embeds: [e], components: [] }).catch(() => {}));
      }
    });

    return reply;
  }
}
```

Discord cho tối đa 5 action row: 3 select + 1 hàng nút = 4, vẫn trong giới hạn.

- [ ] **Step 2: Thêm nút Túi đồ vào `openPayload`**

Trong `openPayload`, sau khi tạo nút `again`, thêm nút thứ hai và trả cả hai:

```ts
  const toInv = new ButtonBuilder()
    .setCustomId('open:inv')
    .setLabel('Túi đồ')
    .setEmoji('🧺')
    .setStyle(ButtonStyle.Secondary);

  return { embeds: [e], components: [buttonRow(again, toInv)] };
```

Và trong collector của `OpenCommand`, xử lý nút mới:

```ts
    collector.on('collect', async (i) => {
      if (!i.isButton()) return;
      if (i.customId === 'open:again') {
        await i.update(openPayload(db, userId)).catch(() => {});
      } else if (i.customId === 'open:inv') {
        const name = message.guild?.members.cache.get(userId)?.displayName ?? message.author.username;
        const payload = invPayload(db, userId, name, 0, true);
        await i.update({ embeds: payload.embeds, components: payload.components }).catch(() => {});
      }
    });
```

Nút phân trang và craft trên embed vừa `update` sang vẫn do collector này bắt, vì collector gắn với message chứ không gắn với nội dung — nhưng `OpenCommand` không xử lý `inv:*`, nên sau khi bấm Túi đồ từ `-open` thì các nút đó không phản hồi. Chấp nhận được: đây là lối tắt xem nhanh, người chơi gõ `-inv` để có bảng đầy đủ. Ghi chú `ponytail:` ngay tại chỗ.

- [ ] **Step 3: Kiểm tra TypeScript**

Run: `npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 4: Chạy test**

Run: `npm test`
Expected: PASS 27 test.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: túi đồ phân trang và luồng craft mâm cỗ"
```

---

### Task 11: Lệnh `-top`

**Files:**
- Modify: `src/commands/event.ts`

**Interfaces:**
- Consumes: `topPage`, `topCount`, `rankOf`, `type TopKey` (Task 6), `fmtDuration` (Task 7)
- Produces: không có gì cho task sau

- [ ] **Step 1: Thêm vào cuối `src/commands/event.ts`**

Bổ sung import: `import { rankOf, topCount, topPage, type TopKey } from '../lib/db.js';`

```ts
const TOP_META: Record<TopKey, { label: string; emoji: string; fmt: (v: number) => string }> = {
  points: { label: 'Điểm', emoji: '🏆', fmt: (v) => `${v.toLocaleString('vi-VN')} điểm` },
  msg: { label: 'Chat', emoji: '💬', fmt: (v) => `${v.toLocaleString('vi-VN')} tin nhắn` },
  voice: { label: 'Voice', emoji: '🔊', fmt: (v) => fmtDuration(v) },
  crafts: { label: 'Mâm cỗ', emoji: '🥮', fmt: (v) => `${v} mâm` }
};

const MEDALS = ['🥇', '🥈', '🥉'];

async function displayName(message: Message, id: string): Promise<string> {
  const cached = message.guild?.members.cache.get(id);
  if (cached) return cached.displayName;
  const user = await message.client.users.fetch(id).catch(() => null);
  return user ? user.username : 'Người dùng đã rời';
}

async function topPayload(db: DB, message: Message, key: TopKey, page: number) {
  const meta = TOP_META[key];
  const total = topCount(db, key);
  const maxPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const p = Math.min(Math.max(0, page), maxPage - 1);
  const rows = topPage(db, key, p * PER_PAGE, PER_PAGE);

  const lines: string[] = [];
  for (const [idx, row] of rows.entries()) {
    const rank = p * PER_PAGE + idx + 1;
    const badge = rank <= 3 ? MEDALS[rank - 1] : `**${rank}.**`;
    lines.push(`${badge} ${await displayName(message, row.user_id)} · ${meta.fmt(row.value)}`);
  }

  const myRank = rankOf(db, key, message.author.id);
  const myValue = topPage(db, key, Math.max(0, myRank - 1), 1).find((r) => r.user_id === message.author.id);
  const footer =
    myRank > 0
      ? `Bạn: #${myRank} · ${meta.fmt(myValue?.value ?? 0)}   |   Trang ${p + 1}/${maxPage}`
      : `Bạn chưa có trên bảng này   |   Trang ${p + 1}/${maxPage}`;

  const e = embed(
    `${meta.emoji} Bảng xếp hạng · ${meta.label}`,
    lines.length ? lines.join('\n') : '_Chưa có ai trên bảng này._'
  ).setFooter({ text: footer });

  const nav = buttonRow(
    new ButtonBuilder().setCustomId('top:prev').setEmoji('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder()
      .setCustomId('top:next')
      .setEmoji('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= maxPage - 1)
  );

  const picker = selectRow(
    new StringSelectMenuBuilder()
      .setCustomId('top:board')
      .setPlaceholder('Chọn bảng')
      .addOptions(
        (Object.keys(TOP_META) as TopKey[]).map((k) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(TOP_META[k].label)
            .setEmoji(TOP_META[k].emoji)
            .setValue(k)
            .setDefault(k === key)
        )
      )
  );

  return { embeds: [e], components: [nav, picker] };
}

export class TopCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'top', aliases: ['rank', 'bxh'], description: 'Bảng xếp hạng event' });
  }

  public override async messageRun(message: Message) {
    const db = this.container.db;
    let key: TopKey = 'points';
    let page = 0;

    const reply = await message.reply(await topPayload(db, message, key, page));
    const collector = ownerCollector(reply, message.author.id);

    collector.on('collect', async (i) => {
      if (i.isButton() && i.customId === 'top:prev') page -= 1;
      else if (i.isButton() && i.customId === 'top:next') page += 1;
      else if (i.isStringSelectMenu() && i.customId === 'top:board') {
        key = i.values[0] as TopKey;
        page = 0;
      } else return;

      await i.update(await topPayload(db, message, key, page)).catch(() => {});
    });

    return reply;
  }
}
```

`myValue` lấy bằng một truy vấn trang một dòng tại đúng offset của hạng người gọi — không phải quét toàn bảng.

- [ ] **Step 2: Kiểm tra TypeScript**

Run: `npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 3: Chạy test**

Run: `npm test`
Expected: PASS 27 test (truy vấn xếp hạng đã có test ở Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: bảng xếp hạng bốn loại kèm phân trang"
```

---

### Task 12: Lệnh của owner — `-cfg` và `-addbox`

**Files:**
- Create: `src/commands/admin.ts`

**Interfaces:**
- Consumes: `setConfig`, `cfg`, `DEFAULTS` (Task 3), `addBoxes`, `ensureUser` (Task 1, 4), `isOwner`, `embed`, `buttonRow`, `selectRow`, `ownerCollector` (Task 7), `RARITIES` (Task 2)
- Produces: không

- [ ] **Step 1: Viết `src/commands/admin.ts`**

```ts
import { Command } from '@sapphire/framework';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AnySelectMenuBuilder,
  type Message,
  type MessageComponentInteraction,
  type TextBasedChannel
} from 'discord.js';
import { addBoxes, ensureUser } from '../lib/db.js';
import { cfg, setConfig, type Config } from '../lib/config.js';
import { RARITIES, type Rarity } from '../lib/items.js';
import { buttonRow, embed, isOwner, ownerCollector, selectRow } from '../lib/ui.js';

function parseIntList(s: string): number[] | null {
  const nums = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);
  if (!nums.length || nums.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

function parsePositive(s: string): number | null {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 'YYYY-MM-DD HH:mm' giờ Việt Nam (UTC+7, không có DST) → epoch giây. Chuỗi rỗng → null. */
function parseVNTime(s: string): number | null | 'invalid' {
  const v = s.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v);
  if (!m) return 'invalid';
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+07:00`);
  return Number.isNaN(ms) ? 'invalid' : Math.floor(ms / 1000);
}

function fmtTime(epoch: number | null): string {
  if (epoch === null) return 'không giới hạn';
  return new Date(epoch * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function cfgPayload() {
  const c = cfg();
  const e = embed('⚙️ Cấu hình event Trung Thu')
    .addFields(
      { name: 'Trạng thái', value: c.enabled ? '🟢 Đang bật' : '🔴 Đang tắt', inline: true },
      { name: 'Hộp mỗi ngày', value: String(c.daily_boxes), inline: true },
      { name: 'Độ dài tin nhắn tối thiểu', value: `${c.min_msg_len} ký tự`, inline: true },
      { name: 'Bắt đầu', value: fmtTime(c.event_start), inline: true },
      { name: 'Kết thúc', value: fmtTime(c.event_end), inline: true },
      { name: 'Cooldown chat', value: `${c.msg_cooldown}s`, inline: true },
      {
        name: 'Kênh được tính chat',
        value: c.channels.length ? c.channels.map((id) => `<#${id}>`).join(' ') : '_chưa đặt — không kênh nào được tính_'
      },
      { name: 'Mốc chat', value: c.msg_tiers.join(', '), inline: true },
      { name: 'Mốc voice (phút)', value: c.voice_tiers.join(', '), inline: true },
      { name: 'Kênh log', value: c.log_channel ? `<#${c.log_channel}>` : '_chưa đặt_', inline: true },
      { name: 'Tỉ lệ gacha', value: RARITIES.map((r) => `${r}: ${c.rarity_weights[r]}`).join(' · ') },
      { name: 'Điểm rarity', value: RARITIES.map((r) => `${r}: ${c.rarity_points[r]}`).join(' · ') }
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('cfg:pick')
    .setPlaceholder('Chọn mục cần sửa')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Kênh được tính chat').setValue('channels').setEmoji('💬'),
      new StringSelectMenuOptionBuilder().setLabel('Kênh log').setValue('log_channel').setEmoji('📋'),
      new StringSelectMenuOptionBuilder().setLabel('Thời gian event').setValue('time').setEmoji('🕒'),
      new StringSelectMenuOptionBuilder().setLabel('Mốc chat').setValue('msg_tiers').setEmoji('📈'),
      new StringSelectMenuOptionBuilder().setLabel('Mốc voice').setValue('voice_tiers').setEmoji('🔊'),
      new StringSelectMenuOptionBuilder().setLabel('Tỉ lệ gacha').setValue('rarity_weights').setEmoji('🎲'),
      new StringSelectMenuOptionBuilder().setLabel('Điểm rarity').setValue('rarity_points').setEmoji('💎'),
      new StringSelectMenuOptionBuilder().setLabel('Số & cooldown khác').setValue('numbers').setEmoji('🔢')
    );

  const toggle = buttonRow(
    new ButtonBuilder()
      .setCustomId('cfg:toggle')
      .setLabel(cfg().enabled ? 'Tắt event' : 'Bật event')
      .setStyle(cfg().enabled ? ButtonStyle.Danger : ButtonStyle.Success)
  );

  return { embeds: [e], components: [selectRow(menu), toggle] };
}

function textInput(id: string, label: string, value: string, required = false) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setValue(value)
  );
}

/** Mở modal, chờ người dùng submit tối đa 5 phút. Trả về map giá trị, hoặc null nếu bỏ qua. */
async function askModal(
  i: MessageComponentInteraction,
  id: string,
  title: string,
  rows: ActionRowBuilder<TextInputBuilder>[]
) {
  const modal = new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...rows);
  await i.showModal(modal);
  const submit = await i
    .awaitModalSubmit({ time: 300_000, filter: (m) => m.customId === id && m.user.id === i.user.id })
    .catch(() => null);
  return submit;
}

export class CfgCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'cfg', aliases: ['config', 'setting'], description: 'Cấu hình event (owner)' });
  }

  public override async messageRun(message: Message) {
    if (!isOwner(message.author.id)) {
      return message.reply({ embeds: [embed('⛔ Không đủ quyền', 'Lệnh này chỉ dành cho owner của event.')] });
    }

    const db = this.container.db;
    const reply = await message.reply(cfgPayload());
    const collector = ownerCollector(reply, message.author.id, 600_000);

    collector.on('collect', async (i) => {
      const c = cfg();

      if (i.isButton() && i.customId === 'cfg:toggle') {
        setConfig(db, 'enabled', !c.enabled);
        return void (await i.update(cfgPayload()).catch(() => {}));
      }

      if (i.isChannelSelectMenu() && i.customId === 'cfg:channels') {
        setConfig(db, 'channels', [...i.values]);
        return void (await i.update(cfgPayload()).catch(() => {}));
      }

      if (i.isChannelSelectMenu() && i.customId === 'cfg:log') {
        setConfig(db, 'log_channel', i.values[0] ?? null);
        return void (await i.update(cfgPayload()).catch(() => {}));
      }

      if (!i.isStringSelectMenu() || i.customId !== 'cfg:pick') return;
      const choice = i.values[0]!;

      if (choice === 'channels' || choice === 'log_channel') {
        const menu = new ChannelSelectMenuBuilder()
          .setCustomId(choice === 'channels' ? 'cfg:channels' : 'cfg:log')
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setPlaceholder(choice === 'channels' ? 'Chọn các kênh được tính chat' : 'Chọn kênh log')
          .setMinValues(choice === 'channels' ? 0 : 1)
          .setMaxValues(choice === 'channels' ? 25 : 1);
        return void (await i
          .update({
            embeds: [
              embed(
                choice === 'channels' ? '💬 Chọn kênh được tính chat' : '📋 Chọn kênh log',
                'Chọn xong là lưu ngay, danh sách cũ bị thay thế.'
              )
            ],
            components: [selectRow(menu as unknown as AnySelectMenuBuilder)]
          })
          .catch(() => {}));
      }

      if (choice === 'time') {
        const submit = await askModal(i, 'cfg:modal:time', 'Thời gian event (giờ VN)', [
          textInput('start', 'Bắt đầu — YYYY-MM-DD HH:mm (trống = bỏ)', c.event_start ? fmtTime(c.event_start) : ''),
          textInput('end', 'Kết thúc — YYYY-MM-DD HH:mm (trống = bỏ)', c.event_end ? fmtTime(c.event_end) : '')
        ]);
        if (!submit) return;
        const start = parseVNTime(submit.fields.getTextInputValue('start'));
        const end = parseVNTime(submit.fields.getTextInputValue('end'));
        if (start === 'invalid' || end === 'invalid') {
          return void (await submit.reply({ content: 'Sai định dạng. Dùng `YYYY-MM-DD HH:mm`.', flags: MessageFlags.Ephemeral }));
        }
        if (start !== null && end !== null && end <= start) {
          return void (await submit.reply({ content: 'Thời gian kết thúc phải sau thời gian bắt đầu.', flags: MessageFlags.Ephemeral }));
        }
        setConfig(db, 'event_start', start);
        setConfig(db, 'event_end', end);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }

      if (choice === 'msg_tiers' || choice === 'voice_tiers') {
        const key = choice as 'msg_tiers' | 'voice_tiers';
        const submit = await askModal(i, `cfg:modal:${key}`, key === 'msg_tiers' ? 'Mốc chat' : 'Mốc voice (phút)', [
          textInput('v', 'Các số cách nhau bởi dấu phẩy', c[key].join(', '), true)
        ]);
        if (!submit) return;
        const list = parseIntList(submit.fields.getTextInputValue('v'));
        if (!list) {
          return void (await submit.reply({ content: 'Chỉ nhận số nguyên dương, cách nhau bởi dấu phẩy.', flags: MessageFlags.Ephemeral }));
        }
        setConfig(db, key, list);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }

      if (choice === 'rarity_weights' || choice === 'rarity_points') {
        const key = choice as 'rarity_weights' | 'rarity_points';
        const submit = await askModal(
          i,
          `cfg:modal:${key}`,
          key === 'rarity_weights' ? 'Tỉ lệ gacha' : 'Điểm mỗi rarity',
          RARITIES.map((r) => textInput(r, r, String(c[key][r]), true))
        );
        if (!submit) return;
        const next = {} as Record<Rarity, number>;
        for (const r of RARITIES) {
          const n = parsePositive(submit.fields.getTextInputValue(r));
          if (n === null) {
            return void (await submit.reply({ content: `Giá trị của \`${r}\` phải là số nguyên không âm.`, flags: MessageFlags.Ephemeral }));
          }
          next[r] = n;
        }
        if (key === 'rarity_weights' && RARITIES.every((r) => next[r] === 0)) {
          return void (await submit.reply({ content: 'Không thể đặt toàn bộ tỉ lệ bằng 0.', flags: MessageFlags.Ephemeral }));
        }
        setConfig(db, key, next);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }

      if (choice === 'numbers') {
        const submit = await askModal(i, 'cfg:modal:numbers', 'Các số khác', [
          textInput('daily_boxes', 'Hộp mỗi ngày', String(c.daily_boxes), true),
          textInput('min_msg_len', 'Độ dài tin nhắn tối thiểu', String(c.min_msg_len), true),
          textInput('msg_cooldown', 'Cooldown chat (giây)', String(c.msg_cooldown), true)
        ]);
        if (!submit) return;
        const fields: (keyof Config)[] = ['daily_boxes', 'min_msg_len', 'msg_cooldown'];
        const values: number[] = [];
        for (const f of fields) {
          const n = parsePositive(submit.fields.getTextInputValue(f));
          if (n === null) {
            return void (await submit.reply({ content: `Giá trị của \`${f}\` phải là số nguyên không âm.`, flags: MessageFlags.Ephemeral }));
          }
          values.push(n);
        }
        setConfig(db, 'daily_boxes', values[0]!);
        setConfig(db, 'min_msg_len', values[1]!);
        setConfig(db, 'msg_cooldown', values[2]!);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }
    });

    return reply;
  }
}

export class AddBoxCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'addbox', aliases: ['themhop'], description: 'Cấp hoặc trừ hộp bánh (owner)' });
  }

  public override async messageRun(message: Message, args: Command.Args) {
    if (!isOwner(message.author.id)) {
      return message.reply({ embeds: [embed('⛔ Không đủ quyền', 'Lệnh này chỉ dành cho owner của event.')] });
    }

    const target = await args.pick('user').catch(() => null);
    const amount = await args.pick('integer').catch(() => null);
    if (!target || amount === null || amount === 0) {
      return message.reply({
        embeds: [embed('Cách dùng', '`-addbox @user <số>`\nSố âm để trừ. Ví dụ: `-addbox @Thắng 5`')]
      });
    }

    const db = this.container.db;
    const boxes = addBoxes(db, target.id, amount);
    const points = ensureUser(db, target.id).points;

    const e = embed(
      '🎁 Đã cập nhật hộp bánh',
      `${amount > 0 ? 'Cấp' : 'Trừ'} **${Math.abs(amount)}** hộp cho ${target}.\nHiện có **${boxes}** hộp · **${points}** điểm.`
    );
    await message.reply({ embeds: [e] });

    const logId = cfg().log_channel;
    if (logId) {
      const ch = await message.client.channels.fetch(logId).catch(() => null);
      if (ch?.isTextBased() && 'send' in ch) {
        await (ch as TextBasedChannel & { send: Function })
          .send({
            embeds: [
              embed(
                '📋 Log cấp hộp',
                `${message.author} → ${target}\nSố lượng: **${amount > 0 ? '+' : ''}${amount}**\nCòn lại: **${boxes}** hộp`
              )
            ]
          })
          .catch(() => {});
      }
    }

    return;
  }
}
```

- [ ] **Step 2: Kiểm tra TypeScript**

Run: `npx tsc --noEmit`
Expected: không lỗi. Nếu `ChannelSelectMenuBuilder` báo lỗi kiểu khi đưa vào `selectRow`, giữ nguyên ép kiểu `as unknown as AnySelectMenuBuilder` như trên.

- [ ] **Step 3: Chạy test**

Run: `npm test`
Expected: PASS 27 test.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: lệnh cfg dạng menu và addbox cho owner"
```

---

### Task 13: README và smoke test trên server thật

**Files:**
- Modify: `README.md` (repo đang có sẵn một dòng, ghi đè hết)

**Interfaces:**
- Consumes: toàn bộ
- Produces: không

- [ ] **Step 1: Viết `README.md`**

````markdown
# Bot Trung Thu

Bot Discord chạy event Trung Thu: đếm tin nhắn và thời gian voice, quy đổi thành hộp bánh,
mở hộp ra item, craft mâm cỗ, xếp hạng.

## Chạy

```bash
npm install
cp .env.example .env    # điền DISCORD_TOKEN và OWNERS
npm start
```

Bật **Message Content Intent** và **Server Members Intent** không bắt buộc, nhưng
**Message Content Intent** thì bắt buộc, trong Discord Developer Portal.

## Lệnh

| Lệnh | Việc |
|---|---|
| `-daily` | điểm danh nhận hộp bánh |
| `-box` | nhận hộp từ mốc chat và mốc voice |
| `-open` | mở một hộp, có nút Mở tiếp |
| `-inv [@user]` | xem túi đồ, phân trang, nút Craft |
| `-top` | bảng xếp hạng: Điểm / Chat / Voice / Mâm cỗ |
| `-cfg` | owner: sửa toàn bộ cấu hình bằng menu |
| `-addbox @user <số>` | owner: cấp hoặc trừ hộp |

## Cách tính

- Tin nhắn chỉ tính ở các kênh đặt trong `-cfg`, dài từ 7 ký tự, cooldown 5 giây mỗi người.
- Voice tính toàn server, chỉ khi kênh có từ 2 người thật và bản thân không deaf.
- Mốc chat mặc định `15, 30, 60, 120, 200` tin nhắn; mốc voice `30, 60, 120, 240, 480` phút.
  Mỗi mốc đạt được cho 1 hộp, tối đa 5 hộp mỗi bên.

## Test

```bash
npm test           # chạy hết
npm test -- craft  # lọc theo tên test
```
````

- [ ] **Step 2: Chạy toàn bộ test lần cuối**

Run: `npm test`
Expected: PASS 27 test, in `tất cả pass`.

- [ ] **Step 3: Kiểm tra TypeScript lần cuối**

Run: `npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 4: Smoke test trên một server thật**

Cần token bot và một server test. Đặt `OWNERS` là id của chính mình. Chạy `npm start` rồi
làm lần lượt, đánh dấu từng dòng:

- [ ] `-cfg` hiện embed cấu hình, select menu và nút bật/tắt
- [ ] Chọn "Kênh được tính chat", chọn một kênh, embed vẽ lại có tên kênh đó
- [ ] Chat 15 tin nhắn dài hơn 7 ký tự trong kênh đó (chờ 5 giây giữa các tin), `-box` cho 1 hộp
- [ ] Chat trong kênh **không** được chọn, `-box` không tăng thêm
- [ ] Hai người vào chung một voice channel, chờ 2 phút, `-box` hiện thời gian voice tăng
- [ ] Một người tự deaf, chờ 1 phút, thời gian của người đó không tăng thêm
- [ ] Một người rời voice, chỉ còn một người, thời gian người còn lại ngừng tăng
- [ ] `-daily` cho 3 hộp, gọi lần hai bị từ chối
- [ ] `-open` ra item, bấm **Mở tiếp** mở tiếp được cho tới khi hết hộp thì nút mờ đi
- [ ] `-inv` hiện túi, nút **Craft mâm cỗ** sáng khi có đủ 3 nhóm
- [ ] Bấm Craft, chọn ba món, **Xác nhận** — điểm tăng đúng gấp đôi, item bị trừ
- [ ] `-top` đổi được cả bốn bảng, phân trang chạy, footer hiện đúng hạng của mình
- [ ] Người khác bấm nút của mình thì nhận thông báo ephemeral, không đổi được embed
- [ ] `-addbox @user 5` cấp hộp và gửi log ra kênh log đã đặt
- [ ] Tắt bot giữa lúc đang ngồi voice, bật lại, `-box` cho thấy thời gian không mất quá 1 phút
- [ ] `-cfg` tắt event, `-daily` và `-open` báo event chưa mở, `-inv` và `-top` vẫn dùng được

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: hướng dẫn chạy và bảng lệnh"
```
