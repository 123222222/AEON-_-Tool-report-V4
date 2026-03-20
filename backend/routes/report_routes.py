import threading
from flask import Blueprint, jsonify, request
from config import SITES_CONFIG, NVL_REPORT_FORM_PATH, TQB_REPORT_FORM_PATH
from config import BDNC_REPORT_FORM_PATH, VG_REPORT_FORM_PATH, MDR_REPORT_FORM_PATH
from config import LACASTA_REPORT_FORM_PATH, HOTLINES_AND_CONFIRM_FORM_PATH
from services import (sync_files_from_onedrive, get_report_text,
                      list_files_from_url)

report_bp = Blueprint("report", __name__, url_prefix="/api")

# Cache danh sách files per site (load 1 lần sau sync)
_site_files_cache: dict = {}
_cache_lock = threading.Lock()


def _get_site_files(site_key: str) -> dict:
    """Lấy và cache danh sách files cho một site. Trả về {label: file_id}."""
    with _cache_lock:
        if site_key in _site_files_cache:
            return _site_files_cache[site_key]

    # Tìm OneDrive path
    onedrive_path = None
    for group in SITES_CONFIG.values():
        if site_key in group:
            onedrive_path = group[site_key]
            break
    if not onedrive_path:
        return {}

    files  = list_files_from_url(onedrive_path)
    result = {}
    for f in files:
        label = f["name"].replace(".txt", "").replace(".TXT", "")
        result[label] = {"id": f["id"], "name": f["name"]}

    with _cache_lock:
        _site_files_cache[site_key] = result

    return result


# -----------------------------------------------------------
@report_bp.get("/sites")
def get_sites():
    """Trả về cấu trúc AEONMALL / MAXVALUE và các site con."""
    return jsonify(SITES_CONFIG)


@report_bp.get("/sites/<site_key>/items")
def get_site_items(site_key: str):
    """Trả về danh sách file (label + id) của một site."""
    try:
        items = _get_site_files(site_key.upper())
        if not items:
            return jsonify({"error": f"Site '{site_key}' không tồn tại hoặc chưa có dữ liệu"}), 404
        # Trả về list: [{label, file_id, file_name}]
        result = [
            {"label": label, "file_id": meta["id"], "file_name": meta["name"]}
            for label, meta in items.items()
        ]
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@report_bp.post("/report/text")
def get_report():
    """
    Đọc nội dung file report.
    Body: {file_id, file_name, is_no_error (optional, default false)}
    """
    body       = request.json or {}
    file_id    = body.get("file_id", "")
    file_name  = body.get("file_name", "")
    is_no_error = body.get("is_no_error", False)

    if not file_id or not file_name:
        return jsonify({"error": "Thiếu file_id hoặc file_name"}), 400

    try:
        text = get_report_text(file_id, file_name, is_no_error)
        return jsonify({"text": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@report_bp.post("/sync")
def trigger_sync():
    """
    Trigger đồng bộ toàn bộ files từ OneDrive.
    Chạy background thread, trả về ngay lập tức.
    """
    def do_sync():
        paths = [
            NVL_REPORT_FORM_PATH, TQB_REPORT_FORM_PATH,
            BDNC_REPORT_FORM_PATH, VG_REPORT_FORM_PATH,
            MDR_REPORT_FORM_PATH, LACASTA_REPORT_FORM_PATH,
            HOTLINES_AND_CONFIRM_FORM_PATH,
        ]
        for path in paths:
            try:
                sync_files_from_onedrive(path)
            except Exception as e:
                print(f"❌ Sync lỗi [{path}]: {e}")

        # Clear site cache sau khi sync
        with _cache_lock:
            _site_files_cache.clear()

    threading.Thread(target=do_sync, daemon=True).start()
    return jsonify({"message": "Đang đồng bộ ở background..."})
