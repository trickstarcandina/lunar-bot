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
