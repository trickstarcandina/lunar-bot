import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ensureUser, addMsg, claimBoxes, claimDaily, addBoxes, addVoiceSec, tiersReached, openVoice, closeVoice, flushVoice, resetVoiceSessions, openVoiceIds, openBox, getItems, craft, topPage, topCount, rankOf, valueOf } from './lib/db.js';
import { ITEMS, ITEM_MAP, rollRarity, rollItem, craftGain, type Rarity } from './lib/items.js';
import { DEFAULTS, loadConfig, cfg, setConfig, setConfigMany, isEventActive, todayVN } from './lib/config.js';
import { craftConfirmPayload, openPayload } from './commands/event.js';

const filter = process.argv[2] ?? '';
const cases: Array<[string, () => void | Promise<void>]> = [];
const t = (name: string, fn: () => void | Promise<void>) => cases.push([name, fn]);
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

t('setConfigMany ghi nhiều khoá trong một transaction, cache và DB khớp nhau', () => {
  const db = mem();
  loadConfig(db);
  setConfigMany(db, { daily_boxes: 7, min_msg_len: 12, msg_cooldown: 30 });
  assert.equal(cfg().daily_boxes, 7);
  assert.equal(cfg().min_msg_len, 12);
  assert.equal(cfg().msg_cooldown, 30);
  const reloaded = loadConfig(db);
  assert.equal(reloaded.daily_boxes, 7);
  assert.equal(reloaded.min_msg_len, 12);
  assert.equal(reloaded.msg_cooldown, 30);
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

t('openPayload chặn khi event đóng, không tốn hộp', () => {
  const db = mem();
  loadConfig(db);
  addBoxes(db, 'u1', 3);

  setConfig(db, 'enabled', false);
  const closed = openPayload(db, 'u1');
  assert.equal(ensureUser(db, 'u1').boxes, 3);
  assert.equal(ensureUser(db, 'u1').points, 0);
  assert.deepEqual(closed.components, []);

  setConfig(db, 'enabled', true);
  openPayload(db, 'u1');
  assert.equal(ensureUser(db, 'u1').boxes, 2);
});

t('craftConfirmPayload chặn khi event đóng, không tốn nguyên liệu', () => {
  const db = mem();
  loadConfig(db);
  addBoxes(db, 'u1', 3);
  openBox(db, 'u1', 'banh_thap_cam', 10);
  openBox(db, 'u1', 'den_ong_sao', 30);
  openBox(db, 'u1', 'tra_sen', 10);
  const ids = ['banh_thap_cam', 'den_ong_sao', 'tra_sen'];

  setConfig(db, 'enabled', false);
  craftConfirmPayload(db, 'u1', ids);
  assert.deepEqual(
    getItems(db, 'u1').map((r) => r.item_id),
    ['banh_thap_cam', 'den_ong_sao', 'tra_sen']
  );
  assert.equal(ensureUser(db, 'u1').points, 50);
  assert.equal(ensureUser(db, 'u1').crafts, 0);

  setConfig(db, 'enabled', true);
  craftConfirmPayload(db, 'u1', ids);
  assert.deepEqual(getItems(db, 'u1'), []);
  assert.equal(ensureUser(db, 'u1').crafts, 1);
});

t('valueOf trả đúng giá trị người chơi bị hoà, bất kể user_id sắp ở đâu', () => {
  const db = mem();
  addBoxes(db, 'aaa', 1);
  addBoxes(db, 'zzz', 1);
  addBoxes(db, 'mmm', 1);
  openBox(db, 'aaa', 'tra_sen', 500);
  openBox(db, 'zzz', 'tra_sen', 500);
  openBox(db, 'mmm', 'tho_ngoc', 700);
  // aaa và zzz hoà điểm; topPage sắp aaa trước zzz theo user_id ASC nên offset
  // theo rankOf sẽ trỏ nhầm sang hàng của aaa nếu tra theo offset thay vì theo id.
  assert.equal(valueOf(db, 'points', 'zzz'), 500);
  assert.equal(valueOf(db, 'points', 'khong-ton-tai'), 0);
});

t('Sapphire nạp đủ 7 lệnh và 2 listener của bot (C1/C2 regression)', () => {
  // ponytail: `npm test` tự nó chạy dưới `node --import tsx`, cách này không bật
  // loader .ts của Sapphire (đúng là nguyên nhân C1) — còn production chạy qua CLI
  // `tsx`, cái *có* bật. Import `@sapphire/framework` ngay tại đây (kể cả dynamic)
  // là quá trễ: framework đã bị các module khác require từ đầu file, cờ env đọc
  // process._preload_modules chỉ tính một lần lúc module đó nạp lần đầu. Nên bài
  // test spawn đúng CLI `tsx` production dùng, một tiến trình con sạch, để soi
  // đường load piece thật — chứ không giả lập trong tiến trình test hiện tại.
  // Đặt trong repo (không phải /tmp) để probe resolve được node_modules bằng cách đi lên thư mục cha.
  // Cause 2 của C1 (node --import tsx không bật loader .ts của Sapphire) không đụng
  // tới thư mục src/, nên pin thẳng vào script start thay vì chỉ dựa vào cái probe
  // dùng tsx binary trực tiếp bên dưới.
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: { start: string } };
  assert.ok(pkg.scripts.start.startsWith('tsx '), `start script phải chạy qua tsx CLI, đang là: ${pkg.scripts.start}`);

  const dir = mkdtempSync(join(process.cwd(), '.sapphire-probe-'));
  const probe = join(dir, 'probe.ts');
  try {
    writeFileSync(
      probe,
      `
      import { SapphireClient } from '@sapphire/framework';
      (async () => {
        const client = new SapphireClient({ defaultPrefix: '-', intents: [] });
        client.stores.registerPath(client.options.baseUserDirectory);
        await client.stores.get('commands').loadAll();
        await client.stores.get('listeners').loadAll();
        console.log(JSON.stringify({
          commands: [...client.stores.get('commands').keys()],
          listeners: [...client.stores.get('listeners').keys()]
        }));
      })();
      `
    );
    const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsxBin, [probe], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, `probe thoát lỗi: ${result.stderr}`);
    const { commands, listeners } = JSON.parse(result.stdout.trim().split('\n').pop()!) as {
      commands: string[];
      listeners: string[];
    };
    for (const name of ['daily', 'box', 'open', 'inv', 'top', 'cfg', 'addbox']) {
      assert.ok(commands.includes(name), `thiếu lệnh ${name}`);
    }
    for (const name of ['message', 'commandError']) {
      assert.ok(listeners.includes(name), `thiếu listener ${name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- runner --- (mọi test mới chèn PHÍA TRÊN dòng này)

let fail = 0;
for (const [name, fn] of cases) {
  if (filter && !name.includes(filter)) continue;
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}
console.log(fail ? `\n${fail} test hỏng` : '\ntất cả pass');
process.exit(fail ? 1 : 0);
