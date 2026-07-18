# EnviroGuard Home v8

Bản thiết kế lại theo yêu cầu:

- 2 sensor node độc lập:
  - Node nhiệt độ & độ ẩm.
  - Node bụi mịn.
- Chu kỳ gửi mặc định 1 phút/lần.
- Cảnh báo được gửi ngay khi vượt ngưỡng, không chờ mốc cố định.
- Cấu hình được ghi lên Firebase tại `/IoT_Based_Environmental/config`.
- Mốc cố định không giới hạn số lượng, nhưng phải có ít nhất 1 mốc và cách nhau ít nhất 10 phút.
- Chuông có preset 30 giây, 5, 10, 30, 60 phút và thời gian tùy chỉnh trong khoảng 30 giây–60 phút.
- Có 3 thiết lập an toàn cho chuông.
- Trang thiết bị đánh giá riêng 2 node theo heartbeat và phát hiện giá trị có khả năng bị treo.
- Lịch sử và cảnh báo dùng giao diện card, màu theo trạng thái.
- Responsive mobile và bottom navigation.
- PWA + Firebase Cloud Messaging.

## Chạy local

Dùng VS Code Live Server. Không mở trực tiếp bằng `file://`.

## Firebase paths

- `/IoT_Based_Environmental/history`
- `/IoT_Based_Environmental/config`
- `/IoT_Based_Environmental/devices`
- `/IoT_Based_Environmental/alerts`
- `/IoT_Based_Environmental/commands`
- `/IoT_Based_Environmental/snooze`
- `/IoT_Based_Environmental/notificationTokens`

## Device node gợi ý

```json
{
  "devices": {
    "climate_node": {
      "name": "Node nhiệt độ & độ ẩm",
      "status": "online",
      "last_seen": 1784300000000,
      "wifi_rssi": -60,
      "firmware": "1.0.0",
      "uptime": 86000
    },
    "dust_node": {
      "name": "Node bụi mịn",
      "status": "online",
      "last_seen": 1784300000000,
      "lora_rssi": -78,
      "firmware": "1.0.0",
      "uptime": 86000
    }
  }
}
```

## Push notification thật

Tạo Web Push certificate trong Firebase Console > Project Settings > Cloud Messaging.
Dán Public VAPID key vào `firebase-config.js`:

```js
window.FCM_VAPID_KEY = "YOUR_PUBLIC_VAPID_KEY";
```

Deploy web bằng HTTPS/Firebase Hosting và deploy thư mục `functions`.


## Các chỉnh sửa trong bản fixed

- Dựa trực tiếp trên bộ file v8 được cung cấp.
- Chỉ thay phần lịch gửi thành các mốc giờ bản tin cố định.
- Chu kỳ cảm biến giữ cố định 1 phút/lần.
- Sửa nút tắt chuông tạm thời để cập nhật đúng cả:
  - `/IoT_Based_Environmental/control`
  - `/IoT_Based_Environmental/snooze`
  - `/IoT_Based_Environmental/commands`
- Log chi tiết cũ hơn 7 ngày được tổng hợp vào:
  - `/IoT_Based_Environmental/dailyAverages/YYYY-MM-DD`
  Sau đó log chi tiết tương ứng mới bị xóa.
