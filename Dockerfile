FROM python:3.11-slim

WORKDIR /app

# Cài dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Tạo thư mục data mặc định (bị mount đè khi chạy thật)
RUN mkdir -p /data/Cache \
             /data/Report_Form_Cache \
             /data/NOTE \
             /data/IMAGE/LAYOUT \
             /data/IMAGE/GATEWAY \
             /data/IMAGE/SENSOR \
             /data/IMAGE/ALARMPOINT \
             /data/DOCUMENTARY \
             /data/METADATA

EXPOSE 5000

WORKDIR /app/backend

# Dùng gunicorn thay flask dev server
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "120", "app:wsgi_app"]
