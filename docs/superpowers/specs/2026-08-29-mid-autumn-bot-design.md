# Bot Trung Thu — Thiết kế

Ngày: 2026-08-29
Trạng thái: đã chốt, chờ implementation plan

## 1. Mục tiêu

Bot Discord cho event Trung Thu, viết lại từ bộ custom command YAGPDB
(`trickstarcandina/yagpdb-cc/eventMidLunar2024`) sang một bot độc lập.

Khác biệt so với bản YAGPDB:

- Đếm cả **tin nhắn** lẫn **thời gian voice**, không chỉ tin nhắn.
- Tin nhắn chỉ tính ở các kênh owner cấu hình; voice tính toàn server.
- Phần thưởng đổi từ "16 mảnh tranh" sang **bộ sưu tập bánh / đèn / đồ chơi**
  có rarity, có điểm, craft được.
- Toàn bộ tương tác dùng embed + button + select menu.
- Owner chỉnh cấu hình ngay trong Discord, không phải sửa code.

## 2. Stack

| Thành phần | Lựa chọn |
|---|---|
| Ngôn ngữ | TypeScript (ESM, Node 20+) |
| Framework | `@sapphire/framework` v5 |
| Discord | `discord.js` v14 |
| Lưu trữ | `better-sqlite3`, file `data/event.db` |
| Lệnh | **Prefix only**, mặc định `-`, đổi qua env `PREFIX` |

Không dùng slash command. Không dùng ORM. SQL viết tay, gom hết trong `src/lib/db.ts`.

Intents: `Guilds`, `GuildMessages`, `MessageContent`, `GuildVoiceStates`.
Partials: không cần.

## 3. Cấu trúc file

```
src/index.ts              SapphireClient, intents, load env
src/lib/db.ts             schema + toàn bộ câu SQL
src/lib/config.ts         đọc/ghi settings, giá trị mặc định
src/lib/items.ts          loot table, rarity, điểm, nhóm, công thức craft
src/lib/ui.ts             embed + button/select builder dùng chung
src/listeners/message.ts  đếm tin nhắn
src/listeners/voice.ts    đếm thời gian voice + flush định kỳ
src/commands/event.ts     daily, box, open, inv, craft, top
src/commands/admin.ts     cfg, addbox
```

Chín file. Không thêm file cho tới khi có nhu cầu thật.

## 4. Cơ sở dữ liệu

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  msg_count  INTEGER NOT NULL DEFAULT 0,
  voice_sec  INTEGER NOT NULL DEFAULT 0,
  boxes      INTEGER NOT NULL DEFAULT 0,
  msg_tier   INTEGER NOT NULL DEFAULT 0,   -- số mốc chat đã nhận
  voice_tier INTEGER NOT NULL DEFAULT 0,   -- số mốc voice đã nhận
  points     INTEGER NOT NULL DEFAULT 0,
  crafts     INTEGER NOT NULL DEFAULT 0,
  last_daily TEXT                          -- 'YYYY-MM-DD' theo giờ VN
);

CREATE TABLE IF NOT EXISTS items (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL              -- JSON
);

CREATE TABLE IF NOT EXISTS voice_open (
  user_id   TEXT PRIMARY KEY,
  joined_at INTEGER NOT NULL       -- epoch giây
);

CREATE INDEX IF NOT EXISTS idx_points ON users(points DESC);
CREATE INDEX IF NOT EXISTS idx_msg    ON users(msg_count DESC);
CREATE INDEX IF NOT EXISTS idx_voice  ON users(voice_sec DESC);
CREATE INDEX IF NOT EXISTS idx_crafts ON users(crafts DESC);
```

Bật `PRAGMA journal_mode = WAL` để ghi liên tục không khoá đọc.

Bot phục vụ một server. Không có cột `guild_id`; nếu sau này cần nhiều server
thì thêm cột và đưa vào primary key — không thiết kế trước.

## 5. Cấu hình (bảng `settings`)

| key | mặc định | ý nghĩa |
|---|---|---|
| `channels` | `[]` | danh sách channel id được tính tin nhắn. Rỗng = không tính kênh nào |
| `event_start` | `null` | epoch giây, `null` = không giới hạn |
| `event_end` | `null` | epoch giây, `null` = không giới hạn |
| `enabled` | `true` | công tắc tổng |
| `msg_tiers` | `[15,30,60,120,200]` | mốc số tin nhắn, mỗi mốc +1 hộp |
| `voice_tiers` | `[30,60,120,240,480]` | mốc **phút** voice, mỗi mốc +1 hộp |
| `rarity_weights` | `{common:50,uncommon:27,rare:15,epic:6,legendary:2}` | tỉ lệ gacha |
| `rarity_points` | `{common:10,uncommon:30,rare:80,epic:200,legendary:700}` | điểm mỗi item |
| `daily_boxes` | `3` | số hộp `-daily` |
| `min_msg_len` | `7` | độ dài tối thiểu để tin nhắn được tính |
| `msg_cooldown` | `5` | giây, chống spam |
| `log_channel` | `null` | kênh log `-addbox` |

Đọc: cache trong RAM, nạp lúc khởi động, ghi thì cập nhật cả cache lẫn DB.

"Event đang mở" = `enabled` và (`event_start` null hoặc đã qua) và
(`event_end` null hoặc chưa tới).

## 6. Đếm tin nhắn

Listener `messageCreate`:

1. Bỏ qua bot, bỏ qua DM.
2. Event phải đang mở.
3. `channel.id` phải nằm trong `settings.channels`.
4. `message.content.length >= min_msg_len`.
5. Cooldown `msg_cooldown` giây mỗi user (Map trong RAM, không cần lưu DB).
6. `msg_count += 1`.

Không tự động phát hộp ở bước này. Người chơi tự gõ `-box` để nhận —
giữ đúng hành vi bản cũ, và tránh bot spam kênh chat.

## 7. Đếm voice

Listener `voiceStateUpdate`:

- Vào một voice channel hợp lệ → ghi `voice_open(user_id, now)`.
- Rời / chuyển sang trạng thái không hợp lệ → `voice_sec += now - joined_at`,
  xoá dòng `voice_open`.
- Chuyển kênh mà vẫn hợp lệ → giữ nguyên session, không cộng dồn.

Trạng thái **hợp lệ** (được tính giờ):

- Không `selfDeaf`, không `serverDeaf`.
- Kênh có từ 2 người trở lên (không tính bot).

Khi người thứ hai vào làm kênh đủ điều kiện, mở session cho tất cả thành viên
hợp lệ trong kênh đó. Khi kênh tụt xuống còn 1 người, đóng session của người
còn lại.

Chống mất dữ liệu khi bot restart:

- `setInterval` 60 giây: với mọi dòng `voice_open`, cộng phần thời gian đã
  trôi vào `voice_sec` rồi đặt lại `joined_at = now`.
- Lúc khởi động: xoá sạch `voice_open`, quét lại các voice channel và mở
  session cho những người đang hợp lệ.

Ghi chú `ponytail:` trong code: chống AFK chỉ ở mức deaf + số người. Muốn chặt
hơn (mute lâu, không camera) thì thêm điều kiện vào cùng một hàm kiểm tra.

## 8. Hộp bánh

Ba nguồn:

| Nguồn | Cách nhận |
|---|---|
| Mốc chat | `-box`, mỗi mốc trong `msg_tiers` đạt được +1 hộp, tối đa 5 |
| Mốc voice | `-box`, mỗi mốc trong `voice_tiers` đạt được +1 hộp, tối đa 5 |
| Điểm danh | `-daily`, `daily_boxes` hộp mỗi ngày |

`-box` tính số mốc đã đạt so với `msg_tier` / `voice_tier` đã lưu, cộng phần
chênh lệch vào `boxes`, rồi cập nhật lại hai cột tier. Gọi lại nhiều lần không
nhận trùng.

`-daily` so `last_daily` với ngày hiện tại theo `Asia/Ho_Chi_Minh`
(`toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })` cho ra
`YYYY-MM-DD`). Khác thì cộng hộp và ghi lại ngày.

## 9. Item

13 item, 5 bậc rarity, 3 nhóm dùng cho craft.

| id | Tên | Rarity | Nhóm |
|---|---|---|---|
| `banh_thap_cam` | Bánh nướng thập cẩm | common | banh |
| `banh_deo_sen` | Bánh dẻo hạt sen | common | banh |
| `tra_sen` | Trà sen | common | khac |
| `banh_trung_muoi` | Bánh trứng muối tan chảy | uncommon | banh |
| `den_ong_sao` | Đèn ông sao | uncommon | den |
| `mat_na` | Mặt nạ giấy bồi | uncommon | khac |
| `banh_sau_rieng` | Bánh dẻo lạnh sầu riêng | rare | banh |
| `den_keo_quan` | Đèn kéo quân | rare | den |
| `trong_boi` | Trống bỏi | rare | khac |
| `banh_vi_ca` | Bánh nướng vi cá 4 trứng | epic | banh |
| `dau_lan` | Đầu lân | epic | khac |
| `chi_hang` | Chị Hằng | legendary | khac |
| `chu_cuoi` | Chú Cuội | legendary | khac |
| `tho_ngoc` | Thỏ Ngọc | legendary | khac |

Nhóm `den` chỉ có 2 item — chấp nhận được, đèn là mắt xích hiếm nhất của công
thức craft, đúng ý đồ.

Emoji: dùng emoji Unicode sẵn có (🥮 🏮 🎭 🍵 🦁 🌕 …). Owner muốn thay bằng
custom emoji của server thì sửa một bảng hằng trong `src/lib/items.ts`.

## 10. Mở hộp

`-open`:

1. Event mở, `boxes > 0`.
2. `boxes -= 1`.
3. Roll rarity theo `rarity_weights`, rồi chọn ngẫu nhiên đều một item trong
   bậc đó.
4. `items.qty += 1`, `points += rarity_points[rarity]`.
5. Trả embed màu theo rarity + nút **Mở tiếp** và **Túi đồ**.

Nút chỉ người gọi lệnh bấm được (kiểm tra `interaction.user.id`); người khác
bấm thì báo ephemeral. Hết 5 phút thì disable nút.

Toàn bộ bước 2–4 nằm trong một transaction của better-sqlite3.

## 11. Craft

Công thức **Mâm cỗ Trung Thu**: 1 item nhóm `banh` + 1 item nhóm `den` +
1 item nhóm `khac`, rarity nào cũng được.

- Trừ mỗi item 1 cái.
- `points += 2 × (tổng điểm 3 item)`.
- `crafts += 1`.

Người chơi chọn item nào để craft: nút **Craft** trên `-inv` mở ra ba select
menu (một cho mỗi nhóm, chỉ liệt kê item đang có), bấm **Xác nhận** thì thực
hiện. Mặc định của select là item rẻ nhất trong nhóm, nên ai lười thì bấm
Craft rồi Xác nhận là xong.

`points` chỉ tăng, không tính lại từ túi đồ. Craft không hoàn lại điểm của
item bị tiêu.

## 12. Túi đồ

`-inv [@user]`:

Embed liệt kê item đang có, nhóm theo rarity từ cao xuống thấp, mỗi dòng
`emoji Tên xN`. Footer hiện tổng điểm, số hộp còn lại, số lần craft.

Nút: **◀ ▶** phân trang (10 dòng/trang), **Craft** (chỉ hiện khi đủ nguyên
liệu), **Mở hộp** (chỉ hiện khi `boxes > 0`).

Xem túi người khác thì không hiện nút hành động.

## 13. Bảng xếp hạng

`-top`: embed 10 dòng/trang, `LIMIT 10 OFFSET n` — không load toàn bộ user.

Select menu đổi giữa 4 bảng:

| Bảng | Sắp theo | Hiển thị |
|---|---|---|
| 🏆 Điểm | `points DESC` | `4,820 điểm` |
| 💬 Chat | `msg_count DESC` | `1,204 tin nhắn` |
| 🔊 Voice | `voice_sec DESC` | `12h 34m` |
| 🥮 Mâm cỗ | `crafts DESC` | `7 mâm` |

Chi tiết:

- Top 3 gắn 🥇🥈🥉.
- Footer luôn hiện hạng của người gọi lệnh, kể cả khi họ không ở trang đang xem:
  `SELECT COUNT(*) + 1 FROM users WHERE points > ?`.
- Tên hiển thị lấy từ cache của guild; user đã rời server thì hiện
  `Người dùng đã rời`.
- Nút và select chỉ người gọi bấm được, disable sau 5 phút.

## 14. Lệnh của owner

Quyền: chỉ user id nằm trong env `OWNERS` (danh sách ngăn cách bởi dấu phẩy).
Không dùng quyền Discord — owner event không nhất thiết là admin server.

### `-cfg`

Một lệnh duy nhất. Embed hiện toàn bộ cấu hình hiện tại, kèm select menu chọn
mục cần sửa:

| Mục | Cách nhập |
|---|---|
| Kênh count | Channel select menu, chọn nhiều kênh, thay thế danh sách cũ |
| Thời gian event | Modal, hai ô `YYYY-MM-DD HH:mm` (giờ VN), để trống = bỏ giới hạn |
| Bật/tắt event | Nút toggle |
| Mốc chat | Modal, chuỗi số ngăn cách bởi dấu phẩy |
| Mốc voice | Modal, chuỗi số (phút) ngăn cách bởi dấu phẩy |
| Tỉ lệ gacha | Modal, 5 ô, số nguyên |
| Điểm rarity | Modal, 5 ô, số nguyên |
| Hộp daily | Modal, 1 ô |
| Kênh log | Channel select menu |

Sau mỗi lần lưu, embed vẽ lại với giá trị mới. Giá trị nhập sai định dạng thì
báo ephemeral và không ghi gì.

### `-addbox @user <số>`

Cộng (hoặc trừ, nếu số âm) hộp cho user. `boxes` không xuống dưới 0. Gửi embed
log ra `log_channel` nếu đã cấu hình: ai cấp, cho ai, bao nhiêu, còn lại bao nhiêu.

## 15. Xử lý lỗi

- Mọi ghi DB nhiều bước bọc trong transaction.
- Lệnh chạy khi event đóng: trả embed báo event chưa mở / đã kết thúc, trừ
  `-inv`, `-top` và `-cfg` vẫn dùng được.
- Interaction quá hạn (`Unknown interaction`): bỏ qua, không log ầm ĩ.
- Bot mất kết nối giữa chừng: session voice được flush mỗi 60 giây nên mất
  tối đa 60 giây mỗi người.
- Lỗi không lường trước trong command: Sapphire bắt sẵn, thêm listener
  `commandError` để trả về embed lỗi ngắn gọn thay vì im lặng.

## 16. Kiểm thử

Không dùng test framework. Một file `src/selftest.ts` chạy bằng
`node --import tsx src/selftest.ts`, dùng `assert`, DB in-memory
(`new Database(':memory:')`), kiểm tra đúng phần logic dễ sai:

1. `-box` gọi hai lần liên tiếp không phát trùng hộp.
2. Vượt nhiều mốc cùng lúc thì nhận đúng số hộp còn thiếu.
3. Cộng dồn thời gian voice qua chuỗi join → flush → leave ra đúng số giây.
4. `-daily` lần hai trong cùng ngày (giờ VN) bị từ chối.
5. Roll gacha 100k lần cho phân bố rarity lệch dưới 2% so với trọng số.
6. Craft trừ đúng 3 item và cộng đúng `2 ×` tổng điểm.
7. `boxes` không xuống âm khi `-addbox` số âm quá lớn.

## 17. Biến môi trường

```
DISCORD_TOKEN=
PREFIX=-
OWNERS=123,456
DB_PATH=data/event.db
```

## 18. Phạm vi đã loại bỏ

| Không làm | Thêm khi nào |
|---|---|
| Slash command | Khi người chơi kêu prefix bất tiện |
| Nhiều server một bot | Khi thật sự cần dùng ở server thứ hai |
| Shop / mua bán item | Khi điểm cần thêm chỗ tiêu |
| Trade giữa người chơi | Khi có yêu cầu, kèm chống abuse |
| Tự phát role khi đủ bộ | Khi owner chốt phần thưởng cuối event |
| Dashboard web | Không bao giờ, `-cfg` là đủ |
