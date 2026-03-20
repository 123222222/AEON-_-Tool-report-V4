# RMC Report Assistant — Web Version

## Cấu trúc dự án

```
rmc-assistant/
├── backend/
│   ├── app.py              ← Flask entry point
│   ├── config.py           ← Cấu hình toàn bộ hằng số
│   ├── auth/
│   │   └── azure_auth.py   ← Azure AD / MSAL
│   ├── services/
│   │   ├── onedrive.py     ← OneDrive API
│   │   ├── metadata.py     ← Đồng bộ metadata
│   │   ├── report.py       ← Fill template, đọc report
│   │   └── note.py         ← CRUD Note/Reminder
│   ├── routes/
│   │   ├── auth_routes.py
│   │   ├── report_routes.py
│   │   ├── contact_routes.py
│   │   ├── note_routes.py
│   │   ├── image_routes.py
│   │   └── docs_routes.py
│   └── requirements.txt
│
└── frontend/
    ├── index.html
    └── assets/
        ├── style.css
        └── app.js
```

## Cài đặt

### 1. Tạo môi trường Python

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Cấu hình (tuỳ chọn)

Tạo file `.env` trong thư mục `backend/`:

```env
# Azure AD (mặc định đã có trong config.py)
AZURE_CLIENT_ID=ac4edccf-a8ee-41aa-bcc4-6603c4bebae1
AZURE_TENANT_ID=5983a1d2-f46b-492d-a9b3-7e2f3609d20b

# OneDrive share link gốc
BASE_SHARE_LINK=https://aeondelight-my.sharepoint.com/...

# Thư mục lưu trữ local (mặc định D:\RMC_Assistant_ver1.1)
RMC_BASE_DIR=D:\RMC_Assistant_ver1.1
```

### 3. Chạy backend

```bash
cd backend
python app.py
```

Backend sẽ chạy tại: **http://localhost:5000**

### 4. Mở frontend

Mở trình duyệt và truy cập: **http://localhost:5000**

Hoặc mở trực tiếp file `frontend/index.html` (cần CORS cho dev mode).

---

## API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET  | `/api/auth/status` | Kiểm tra đăng nhập |
| POST | `/api/auth/device-flow` | Bắt đầu device flow |
| GET  | `/api/auth/device-flow/poll` | Poll trạng thái đăng nhập |
| GET  | `/api/sites` | Danh sách sites |
| GET  | `/api/sites/{key}/items` | Items của một site |
| POST | `/api/report/text` | Đọc nội dung report |
| POST | `/api/sync` | Đồng bộ OneDrive |
| POST | `/api/contact` | Fill template Contact |
| POST | `/api/status` | Fill template Status |
| POST | `/api/notification` | Fill template Notification |
| GET  | `/api/notes` | Danh sách notes |
| POST | `/api/notes` | Tạo note mới |
| DELETE | `/api/notes/{stt}` | Xóa note |
| GET  | `/api/notes/pending` | Notifications chờ xử lý |
| GET  | `/api/images/categories` | Danh mục ảnh DAVITEQ |
| GET  | `/api/images/{cat}/{site}` | Danh sách ảnh |
| GET  | `/api/images/file/{cat}/{site}/{name}` | Serve ảnh |
| GET  | `/api/docs` | Danh sách tài liệu |
| POST | `/api/docs/download/{id}` | Tải tài liệu |
| GET  | `/api/docs/file/{id}` | Serve tài liệu |
| POST | `/api/docs/refresh` | Làm mới danh sách |

---

## Lưu ý quan trọng

- **Token cache**: File `token_cache.bin` lưu ở `CACHE_DIR`. Lần đầu cần đăng nhập, các lần sau tự động refresh.
- **Reminder notifications**: Backend chạy schedule. Frontend poll `/api/notes/pending` mỗi 30 giây. Browser sẽ yêu cầu quyền `Notification` khi khởi động.
- **CORS**: Đã cấu hình `flask-cors`. Nếu serve frontend từ domain khác cần cập nhật `origins` trong `app.py`.
- **Tkinter đã bỏ hoàn toàn**: Không cần `tkinter`, `tkcalendar`, `pyperclip`, `PIL` nữa.
