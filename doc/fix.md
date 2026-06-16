# 1. Calendar

### 1.1. Scroll đến ngày hiện tại

* Tính năng **tự động scroll đến ngày hôm nay** khi mở Calendar chưa hoạt động.
* Khi nhấn nút **"Hôm nay"**, Calendar chưa scroll để hiển thị đúng ngày hiện tại.

### 1.2. Sidebar Calendar

* Giảm padding của container trong sidebar Calendar xuống khoảng **50% so với hiện tại**.

### 1.3. Mở modal tạo Live/Trade

* Ẩn icon mở modal tạo Live/Trade.
* Chỉ cho phép mở modal tạo mới thông qua:

  * Command.
  * Action trong sidebar Calendar.

---

# 2. Trade

### 2.1. Sắp xếp danh sách

* Sắp xếp các item Trade theo thứ tự:

  * Item mới nhất hiển thị trước.

### 2.2. Điều hướng từ card

* Khi click vào card Trade:

  * Mở file tương ứng.
  * Scroll đến block chứa item đó trong file.

### 2.3. Giao diện card Trade

#### Accent Bar theo hướng giao dịch

* Long → Màu xanh lá.
* Short → Màu đỏ.

#### Màu sắc Result / RR

* WIN → Xanh lá.
* LOSS → Đỏ.
* BREAKEVEN → Xám.

---

# 3. Live Trade

### 3.1. Trạng thái đóng/mở lệnh

Bổ sung cơ chế xác định lệnh đang mở hay đã đóng:

#### Khi mở lệnh

* Có `opened_at`.
* Không tự động tạo `closed_at`.

#### Khi đóng lệnh

* Tự động set:

  ```text
  closed_at = thời điểm chuyển trạng thái sang đóng
  ```
* Người dùng vẫn có thể chỉnh sửa thủ công `closed_at`.

### 3.2. Hiển thị trạng thái trên UI

* Thêm indicator/badge trên card Live để thể hiện:

  * Lệnh đang mở (Open).
  * Lệnh đã đóng (Closed).

### 3.3. Chỉnh sửa Live Trade

* Thêm nút **Edit** trên card Live Trade.
* Khi click:

  * Mở modal Edit Live Trade.

---

# 4. Backtest

- giữ lại flow khi nhập `opened_at` thì set `closed_at`

### 4.2. Metadata trong Obsidian

* Bổ sung properties cho Backtest để lưu:

```yaml
backtest_start_date:
backtest_end_date:
```

Yêu cầu:

* Chỉ lưu ngày (date).
* Không lưu thời gian (time).
* Dùng để ghi nhận khoảng thời gian của dữ liệu trading được backtest.
* Người dùng thêm thủ công. chỉ thêm vào propertie để null value

---

# 5. Tổng hợp thay đổi dữ liệu (Data Model)

### Live Trade

* Thêm trạng thái mở/đóng lệnh.
* Quy tắc:

  * `opened_at` không tự sinh `closed_at`.
  * `closed_at` chỉ được set khi lệnh chuyển sang trạng thái đóng.
  * Cho phép chỉnh sửa thủ công `closed_at`.

### Backtest

* Giữ nguyên logic hiện tại của `closed_at`.
* Thêm:

  * `start_date`
  * `end_date`

để lưu phạm vi dữ liệu được backtest.
