# Bot Trung Thu

Bot Discord chạy event Trung Thu: đếm tin nhắn và thời gian voice, quy đổi thành hộp bánh,
mở hộp ra item, craft mâm cỗ, xếp hạng.

## Chạy

```bash
npm install
cp .env.example .env    # điền DISCORD_TOKEN và OWNERS
npm start
```

Trong Discord Developer Portal, bật các intent sau: **Guilds**, **Guild Messages**, **Guild Voice States**.
**Message Content Intent** là bắt buộc để đọc nội dung tin nhắn.

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
