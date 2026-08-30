# 🌕 Lunar Bot — Bot event Trung Thu cho Discord

Bot Discord chạy event Trung Thu: đếm tin nhắn và thời gian voice của thành viên, quy đổi thành
**hộp bánh**, mở hộp ra **item** theo tỉ lệ gacha, ghép item thành **Mâm cỗ Trung Thu**, và xếp hạng.

Toàn bộ lệnh là **prefix command** (mặc định `-`), không dùng slash command. Mọi bảng đều có
nút bấm và menu chọn, chỉ người gõ lệnh mới bấm được.

- **Stack:** Node.js + TypeScript (chạy thẳng qua `tsx`, không cần build), [Sapphire](https://sapphirejs.dev) trên discord.js v14, SQLite qua `better-sqlite3`.
- **Múi giờ:** mọi mốc ngày/giờ tính theo giờ Việt Nam `Asia/Ho_Chi_Minh` (UTC+7).

---

## Mục lục

- [Cài đặt và chạy](#cài-đặt-và-chạy)
- [Bảng lệnh](#bảng-lệnh)
- [Phân quyền](#phân-quyền)
- [Tính năng chi tiết](#tính-năng-chi-tiết)
  - [Đếm tin nhắn](#1-đếm-tin-nhắn)
  - [Đếm giờ voice](#2-đếm-giờ-voice)
  - [Hộp bánh](#3-hộp-bánh)
  - [Mở hộp và gacha](#4-mở-hộp-và-gacha)
  - [Túi đồ](#5-túi-đồ)
  - [Craft Mâm cỗ](#6-craft-mâm-cỗ)
  - [Bảng xếp hạng](#7-bảng-xếp-hạng)
- [Danh sách item](#danh-sách-item)
- [Bảng cấu hình `-cfg`](#bảng-cấu-hình--cfg)
- [Biến môi trường](#biến-môi-trường)
- [Dữ liệu](#dữ-liệu)
- [Test](#test)
- [Sự cố thường gặp](#sự-cố-thường-gặp)

---

## Cài đặt và chạy

```bash
npm install
cp .env.example .env    # điền DISCORD_TOKEN và OWNERS
npm start               # chạy trực tiếp qua tsx, không cần build
```

### Bật intent trong Discord Developer Portal

Vào **Bot → Privileged Gateway Intents**, bật:

| Intent | Vì sao cần |
|---|---|
| **Guilds** | biết server, kênh, thành viên |
| **Guild Messages** | nhận sự kiện tin nhắn |
| **Message Content** *(privileged)* | đọc nội dung tin nhắn — bắt buộc, không có thì prefix command không chạy và không đếm được độ dài |
| **Guild Voice States** | biết ai vào/ra voice, ai đang deaf |

### Quyền cần cấp cho bot trong server

`View Channel`, `Send Messages`, `Embed Links`, `Read Message History` ở các kênh event và kênh log.

### Chạy thường trực

Bot lắng nghe `SIGINT`/`SIGTERM`: khi tắt sẽ **flush giờ voice đang mở** vào DB rồi mới đóng DB.
Dùng `systemd`, `pm2` hay Docker đều được — miễn là gửi tín hiệu dừng chuẩn, đừng `kill -9`,
kill cứng sẽ mất phần giờ voice của phiên đang mở (tối đa 1 phút, vì có tick flush mỗi 60 giây).

> ⚠️ Phải chạy bằng `npm start` (tức `tsx src/index.ts`). Chạy kiểu `node --import tsx src/index.ts`
> sẽ khiến Sapphire **không nhận diện được TypeScript** và nạp 0 lệnh, 0 listener — bot vào mạng
> nhưng câm. Chi tiết ở [Sự cố thường gặp](#sự-cố-thường-gặp).

---

## Bảng lệnh

Prefix mặc định `-`, đổi bằng biến `PREFIX`. Tên lệnh **không phân biệt hoa thường** (`-TOP` = `-top`).

| Lệnh | Alias | Quyền | Việc |
|---|---|---|---|
| `-daily` | `-diemdanh` | ai cũng dùng | Điểm danh mỗi ngày nhận hộp bánh |
| `-box` | `-hop`, `-nhan` | ai cũng dùng | Nhận hộp từ mốc chat và mốc voice đã đạt |
| `-open` | `-mo` | ai cũng dùng | Mở một hộp bánh, có nút **Mở tiếp** / **Túi đồ** |
| `-inv [@user]` | `-tui`, `-bag` | ai cũng dùng | Xem túi đồ, phân trang, nút **Craft** / **Mở hộp** |
| `-top` | `-rank`, `-bxh` | ai cũng dùng | Bảng xếp hạng 4 loại, phân trang, đổi bảng bằng menu |
| `-cfg` | `-config`, `-setting` | **owner** | Sửa toàn bộ cấu hình event bằng menu + modal |
| `-addbox @user <số>` | `-themhop` | **owner** | Cấp hoặc trừ hộp bánh cho một người |

Ví dụ `-addbox`:

```
-addbox @Thắng 5      # cấp 5 hộp
-addbox @Thắng -3     # trừ 3 hộp (không xuống dưới 0)
```

---

## Phân quyền

Bot có **hai mức quyền**, cố tình giữ đơn giản:

### 1. Owner — biến môi trường `OWNERS`

Owner là danh sách **Discord user ID**, cách nhau bởi dấu phẩy, đặt trong `.env`:

```env
OWNERS=123456789012345678,987654321098765432
```

- Chỉ owner mới dùng được `-cfg` và `-addbox`. Người khác gõ sẽ nhận embed **⛔ Không đủ quyền**.
- Quyền owner **không phụ thuộc** vai trò (role) hay quyền Administrator trong Discord. Muốn thêm
  người quản lý event thì phải sửa `.env` rồi khởi động lại bot. Đây là chủ ý: quyền chỉnh tỉ lệ
  gacha và phát hộp không nên rơi vào tay bất cứ ai vừa được gắn role admin.
- Không đặt `OWNERS` thì **không ai** dùng được lệnh owner. Lúc khởi động, log in ra số owner đã nạp.

### 2. Chủ tương tác — nút và menu

Mọi bảng có nút (`-open`, `-inv`, `-top`, `-cfg`) đều gắn collector lọc theo người gõ lệnh:

- Người khác bấm nút sẽ nhận trả lời riêng tư (ephemeral): *"Nút này không phải của bạn."*
- Hết thời gian chờ thì bot **gỡ hết nút** khỏi tin nhắn cho gọn.
- Thời gian chờ: **5 phút** cho lệnh thường, **10 phút** cho `-cfg`. Modal của `-cfg` chờ thêm 5 phút.

### 3. Xem túi người khác

`-inv @user` xem được túi của người khác nhưng ở chế độ **chỉ đọc** — không có nút phân trang,
không có nút Craft, không mở được hộp của người ta. Chỉ nhận mention thật (`parsedUsers`), nên
reply vào tin nhắn ai đó không vô tình bị hiểu là mention.

---

## Tính năng chi tiết

Toàn bộ tính năng dưới đây chỉ chạy khi **event đang mở** (`enabled = true`, và thời điểm hiện tại
nằm trong khoảng `event_start`–`event_end` nếu có đặt). Event đóng thì lệnh trả về embed
**🌙 Event chưa mở** và bộ đếm voice cũng ngừng.

### 1. Đếm tin nhắn

Một tin nhắn được tính khi thoả **tất cả**:

- Người gửi không phải bot, và tin nhắn gửi trong server (không tính DM).
- Kênh nằm trong danh sách **Kênh được tính chat** (đặt ở `-cfg`). **Chưa đặt kênh nào thì không tính gì cả.**
- Nội dung dài **từ `min_msg_len` ký tự** (mặc định 7) — chặn spam "hi", ":v".
- Người đó chưa gửi tin nào được tính trong **`msg_cooldown` giây** gần nhất (mặc định 5).

Cooldown lưu trong RAM nên khởi động lại bot là reset — chấp nhận được, mất mát tối đa là vài tin nhắn.

### 2. Đếm giờ voice

Tính trên **toàn bộ kênh voice và stage của server**, không giới hạn theo danh sách kênh chat.

Được tính giờ khi thoả **tất cả**:

- Không phải bot.
- Kênh đang có **từ 2 người thật trở lên** — ngồi một mình không tính.
- **Không tự deaf, không bị server deaf** (`selfDeaf` và `deaf` đều false). Mute thì vẫn tính.

Cách hoạt động:

- Mỗi lần có `voiceStateUpdate`, bot đồng bộ lại cả kênh cũ và kênh mới: ai đủ điều kiện thì mở
  phiên, ai không đủ thì đóng phiên và cộng dồn thời gian vào DB.
- Có **tick mỗi 60 giây** đối soát lại toàn bộ: mở phiên cho người đủ điều kiện mà chưa có phiên,
  đóng phiên cho người không còn đủ điều kiện, rồi flush thời gian đã tích vào DB. Tick này chống
  trôi trạng thái khi bot lỡ mất sự kiện gateway, và bảo đảm mất tối đa 1 phút nếu bot chết đột ngột.
- Khi bot khởi động, mọi phiên voice cũ trong DB bị xoá (tránh cộng khống khoảng thời gian bot offline),
  rồi quét lại tất cả kênh voice để mở phiên mới cho người đang ngồi.
- Event đóng giữa chừng thì tick sẽ xoá sạch phiên đang mở, không cộng tiếp.

### 3. Hộp bánh

Có **ba nguồn** hộp bánh:

| Nguồn | Lệnh | Chi tiết |
|---|---|---|
| Điểm danh | `-daily` | `daily_boxes` hộp (mặc định **3**) mỗi ngày, reset theo **ngày lịch giờ VN** |
| Mốc chat | `-box` | mỗi mốc chat đạt được cho **1 hộp** |
| Mốc voice | `-box` | mỗi mốc voice đạt được cho **1 hộp** |
| Owner cấp | `-addbox` | owner phát hoặc thu tay |

Mốc mặc định:

- **Chat:** `15, 30, 60, 120, 200` tin nhắn → tối đa **5 hộp**.
- **Voice:** `30, 60, 120, 240, 480` phút → tối đa **5 hộp**.

`-box` chỉ trả phần **chưa nhận**: bot lưu số mốc đã nhận của mỗi người và chỉ cấp phần chênh lệch.
Gõ `-box` mười lần không ra thêm hộp. Số mốc đã nhận **không bao giờ giảm** — owner có hạ mốc trong
`-cfg` thì cũng không ai bị đòi lại hộp, và cũng không tự dưng được cấp lại.

`-box` còn cho biết mốc kế tiếp còn thiếu bao nhiêu.

### 4. Mở hộp và gacha

`-open` tiêu **1 hộp** và:

1. Quay **độ hiếm** theo trọng số `rarity_weights` (quay theo tổng trọng số, không cần cộng đủ 100).
2. Chọn **ngẫu nhiên đều** một item trong nhóm độ hiếm vừa quay được.
3. Cộng điểm theo `rarity_points` của độ hiếm đó, và cộng item vào túi.

Embed kết quả đổi màu theo độ hiếm, chân embed hiện số hộp còn lại và tổng điểm.

Hai nút kèm theo:

- **🎁 Mở tiếp** — mở hộp tiếp ngay tại chỗ, tự khoá khi hết hộp.
- **🧺 Túi đồ** — xem nhanh túi của mình. Đây chỉ là lối tắt **xem tĩnh**, không có nút phân trang
  hay craft; muốn luồng đầy đủ thì gõ `-inv`.

Hết hộp mà gõ `-open` thì bot nhắc dùng `-box` hoặc `-daily`.

### 5. Túi đồ

`-inv` hiện toàn bộ item đang có, **10 món mỗi trang**, sắp xếp độ hiếm giảm dần rồi theo tên tiếng Việt.
Chân embed: tổng điểm · số hộp · số mâm cỗ đã craft · số trang.

Bốn nút: **◀ / ▶** phân trang, **🥮 Craft mâm cỗ** (khoá nếu chưa đủ cả ba nhóm), **🎁 Mở hộp** (khoá nếu hết hộp).

### 6. Craft Mâm cỗ

Một Mâm cỗ Trung Thu cần đúng **một item của mỗi nhóm**: **Bánh**, **Đèn**, **Đồ chơi & khác**.

- Bấm **Craft mâm cỗ** thì bot chọn sẵn item **rẻ nhất** (độ hiếm thấp nhất) của mỗi nhóm — đỡ phí đồ xịn.
- Ba menu để đổi lại từng nhóm. Mỗi menu hiện tối đa 25 món. Nhóm nào không có gì thì menu bị khoá.
- Bảng craft hiện trước số điểm sẽ nhận, bấm **✅ Xác nhận** mới thực sự tiêu nguyên liệu.
- **Điểm nhận được = 2 × tổng điểm rarity của ba item.** Ghép đồ xịn lời hơn ghép đồ thường.
- Craft thành công thì ba item bị trừ khỏi túi, cộng điểm, và số mâm cỗ `+1` (dùng cho bảng xếp hạng Mâm cỗ).
- Toàn bộ việc trừ đồ và cộng điểm nằm trong một transaction: thiếu nguyên liệu giữa chừng thì
  không mất gì cả. Event đóng ngay lúc bấm Xác nhận thì cũng không mất nguyên liệu.

> Lưu ý: nhóm **Đèn** chỉ có 2 item và không có item Thường, nên đèn là nút thắt cổ chai của craft —
> đây là chủ ý để mâm cỗ có giá trị. Muốn nới thì thêm item vào `src/lib/items.ts`.

### 7. Bảng xếp hạng

`-top` mở bảng **Điểm**, đổi sang bảng khác bằng menu **Chọn bảng**:

| Bảng | Xếp theo |
|---|---|
| 🏆 Điểm | tổng điểm (mở hộp + craft) |
| 💬 Chat | số tin nhắn được tính |
| 🔊 Voice | tổng thời gian voice |
| 🥮 Mâm cỗ | số lần craft thành công |

- 10 người mỗi trang, top 3 có huy chương 🥇🥈🥉.
- Chỉ hiện người có giá trị **> 0** trên bảng đó.
- Chân embed luôn hiện **thứ hạng của chính bạn**, kể cả khi bạn không nằm trong trang đang xem.
  Người cùng điểm nhận **cùng hạng** (kiểu xếp hạng thi đấu), dù thứ tự hiển thị được phá hoà theo user ID.
- Người đã rời server vẫn hiện, đề *"Người dùng đã rời"* nếu không lấy được tên.

---

## Danh sách item

14 item, 5 độ hiếm, 3 nhóm.

| Item | Độ hiếm | Nhóm |
|---|---|---|
| 🥮 Bánh nướng thập cẩm | ⚪ Thường | Bánh |
| 🌸 Bánh dẻo hạt sen | ⚪ Thường | Bánh |
| 🍵 Trà sen | ⚪ Thường | Đồ chơi & khác |
| 🥚 Bánh trứng muối tan chảy | 🟢 Hiếm | Bánh |
| ⭐ Đèn ông sao | 🟢 Hiếm | Đèn |
| 🎭 Mặt nạ giấy bồi | 🟢 Hiếm | Đồ chơi & khác |
| 🍡 Bánh dẻo lạnh sầu riêng | 🔵 Quý | Bánh |
| 🏮 Đèn kéo quân | 🔵 Quý | Đèn |
| 🥁 Trống bỏi | 🔵 Quý | Đồ chơi & khác |
| 🍱 Bánh nướng vi cá 4 trứng | 🟣 Cực quý | Bánh |
| 🦁 Đầu lân | 🟣 Cực quý | Đồ chơi & khác |
| 🧚 Chị Hằng | 🌕 Huyền thoại | Đồ chơi & khác |
| 🌳 Chú Cuội | 🌕 Huyền thoại | Đồ chơi & khác |
| 🐇 Thỏ Ngọc | 🌕 Huyền thoại | Đồ chơi & khác |

Tỉ lệ và điểm mặc định (sửa được bằng `-cfg`):

| Độ hiếm | Trọng số | Điểm mỗi item |
|---|---|---|
| ⚪ Thường | 50 | 10 |
| 🟢 Hiếm | 27 | 30 |
| 🔵 Quý | 15 | 80 |
| 🟣 Cực quý | 6 | 200 |
| 🌕 Huyền thoại | 2 | 700 |

---

## Bảng cấu hình `-cfg`

`-cfg` mở một bảng duy nhất hiện toàn bộ cấu hình hiện tại, kèm menu **Chọn mục cần sửa** và nút
bật/tắt event. Mọi thay đổi **lưu ngay vào DB** và có hiệu lực tức thì, không cần khởi động lại.

| Mục | Cách sửa | Khoá | Mặc định | Ghi chú |
|---|---|---|---|---|
| Bật/tắt event | nút | `enabled` | `true` | Tắt là dừng đếm chat, đếm voice và khoá mọi lệnh chơi |
| Kênh được tính chat | menu chọn kênh | `channels` | *(trống)* | Tối đa 25 kênh Text/Announcement. **Trống = không tính tin nhắn nào** |
| Kênh log | menu chọn kênh | `log_channel` | *(trống)* | Nơi ghi log `-addbox`. Bỏ chọn hết để xoá |
| Thời gian event | modal | `event_start`, `event_end` | *(không giới hạn)* | `YYYY-MM-DD HH:mm` giờ VN. Để trống = không giới hạn. Kết thúc phải sau bắt đầu |
| Mốc chat | modal | `msg_tiers` | `15, 30, 60, 120, 200` | Số nguyên dương, cách nhau dấu phẩy; tự khử trùng và sắp tăng dần |
| Mốc voice | modal | `voice_tiers` | `30, 60, 120, 240, 480` | Đơn vị **phút**, cùng luật như mốc chat |
| Tỉ lệ gacha | modal | `rarity_weights` | xem bảng trên | Số nguyên không âm; **không được đặt tất cả bằng 0** |
| Điểm rarity | modal | `rarity_points` | xem bảng trên | Số nguyên không âm |
| Hộp mỗi ngày | modal *(mục "Số & cooldown khác")* | `daily_boxes` | `3` | Số hộp `-daily` cho mỗi ngày |
| Độ dài tin nhắn tối thiểu | modal *(cùng mục)* | `min_msg_len` | `7` | Ký tự |
| Cooldown chat | modal *(cùng mục)* | `msg_cooldown` | `5` | Giây |

Ba giá trị trong mục **Số & cooldown khác** ghi cùng một transaction — sai một ô thì không ô nào bị ghi.
Thời gian bắt đầu/kết thúc cũng vậy.

Modal luôn được điền sẵn giá trị hiện tại, nên mở ra xem rồi đóng lại cũng không thay đổi gì.
Nhập sai định dạng thì bot báo lỗi riêng tư và **không ghi gì cả**.

---

## Biến môi trường

Chép `.env.example` thành `.env` rồi điền:

| Biến | Bắt buộc | Mặc định | Việc |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Token bot từ Developer Portal |
| `OWNERS` | ✅ trên thực tế | *(trống)* | Danh sách user ID owner, cách nhau dấu phẩy. Trống thì không ai dùng được `-cfg` / `-addbox` |
| `PREFIX` | | `-` | Prefix lệnh |
| `DB_PATH` | | `data/event.db` | Đường dẫn file SQLite; thư mục tự tạo |

Đừng commit `.env` — đã có trong `.gitignore`.

---

## Dữ liệu

SQLite ở `DB_PATH`, bật **WAL**. Bốn bảng:

| Bảng | Nội dung |
|---|---|
| `users` | mỗi người một dòng: `msg_count`, `voice_sec`, `boxes`, `msg_tier`, `voice_tier`, `points`, `crafts`, `last_daily` |
| `items` | túi đồ: `(user_id, item_id) → qty`, dòng về 0 thì bị xoá |
| `settings` | cấu hình dạng `key → JSON`; khoá lạ hoặc JSON hỏng bị bỏ qua và dùng mặc định |
| `voice_open` | phiên voice đang mở: `user_id → joined_at`. Xoá sạch mỗi lần bot khởi động |

Mọi thao tác đụng nhiều dòng (nhận hộp, mở hộp, craft, cấp hộp, ghi nhiều khoá cấu hình) đều nằm
trong transaction.

**Backup:** dừng bot rồi chép cả `event.db`, `event.db-wal`, `event.db-shm`. Chép mình file `.db`
lúc bot đang chạy có thể mất phần dữ liệu còn nằm trong WAL.

**Reset event:** xoá file DB rồi chạy lại — bảng sẽ tự tạo. Cấu hình cũng mất theo, nhớ đặt lại `-cfg`.

---

## Test

```bash
npm test              # chạy hết (32 test)
npm test -- craft     # lọc theo tên test
```

Tự viết, không framework: mỗi test là một cặp `[tên, hàm]` trong `src/selftest.ts`, dùng `node:assert`
và SQLite in-memory. Có cả một test tích hợp spawn bot thật để kiểm tra Sapphire nạp đủ 7 lệnh và
2 listener — test này bắt đúng lỗi "bot lên mạng nhưng câm" ở mục dưới.

Test mới chèn **phía trên** dòng `// --- runner ---` ở cuối file.

---

## Sự cố thường gặp

**Bot online nhưng không phản hồi lệnh nào.**
Gần như luôn là một trong hai: (1) chạy sai cách — phải là `npm start` / `npx tsx src/index.ts`,
vì `node --import tsx` khiến Sapphire không nhận diện TypeScript và nạp 0 piece; (2) thiếu trường
`"main": "src/index.ts"` trong `package.json`, làm Sapphire tính sai thư mục gốc để quét lệnh.
Cả hai đều được test #32 bắt lại — chạy `npm test` là biết.

**Bot phản hồi lệnh nhưng không đếm tin nhắn nào.**
Chưa bật **Message Content Intent**, hoặc chưa chọn kênh nào ở `-cfg`, hoặc tin nhắn ngắn hơn
`min_msg_len`, hoặc event đang tắt / ngoài khung thời gian.

**Giờ voice không lên.**
Cần **từ 2 người thật** trong kênh và bạn **không được deaf**. Kiểm tra lại intent **Guild Voice States**.

**Bấm nút không ăn.**
Nút chỉ nghe người gõ lệnh, và hết hạn sau 5 phút (10 phút với `-cfg`). Hết hạn thì nút biến mất —
gõ lại lệnh.

**Sửa `-cfg` xong mà không thấy đổi.**
Cấu hình có hiệu lực ngay. Nhưng số mốc đã nhận của mỗi người không bị tính lại — hạ mốc chat xuống
không cấp bù hộp cho người đã vượt mốc từ trước.
