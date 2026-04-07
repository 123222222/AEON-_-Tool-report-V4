import threading
from flask import Blueprint, jsonify, request
from config import SITES_CONFIG, NVL_REPORT_FORM_PATH, TQB_REPORT_FORM_PATH
from config import BDNC_REPORT_FORM_PATH, VG_REPORT_FORM_PATH, MDR_REPORT_FORM_PATH
from config import LACASTA_REPORT_FORM_PATH, HOTLINES_AND_CONFIRM_FORM_PATH
from services import (sync_files_from_onedrive, get_report_text,
                      list_files_from_url, get_excel_data)
from datetime import datetime, date
import collections
import re

report_bp = Blueprint("report", __name__, url_prefix="/api")

# Cache danh sách files per site (load 1 lần sau sync)
_site_files_cache: dict = {}
_cache_lock = threading.Lock()


def _get_site_files(site_key: str) -> dict:
    """Lay va cache danh sach files cho mot site."""
    with _cache_lock:
        if site_key in _site_files_cache:
            return _site_files_cache[site_key]

    # Tim OneDrive path — thu ca ten day du lan ten viet tat
    onedrive_path = None
    for group in SITES_CONFIG.values():
        if site_key in group:
            onedrive_path = group[site_key]
            break
        # Thu uppercase
        for k, v in group.items():
            if k.upper() == site_key.upper():
                onedrive_path = v
                break
        if onedrive_path:
            break
    if not onedrive_path:
        return {}

    files  = list_files_from_url(onedrive_path)
    result = {}
    for f in files:
        label = f["name"].replace(".txt", "").replace(".TXT", "")
        result[label] = {"id": f["id"], "name": f["name"]}

    if result:
        with _cache_lock:
            _site_files_cache[site_key] = result

    return result


# -----------------------------------------------------------
@report_bp.get("/sites")
def get_sites():
    """Trả về cấu trúc AEONMALL / MAXVALUE và các site con."""
    return jsonify(SITES_CONFIG)


@report_bp.get("/sites/<path:site_key>/items")
def get_site_items(site_key: str):
    """Trả về danh sách file (label + id) của một site."""
    try:
        items = _get_site_files(site_key)  # giu nguyen ten day du, khong upper
        if not items:
            return jsonify([])
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


@report_bp.get("/charts/data")
def get_charts_data():
    """
    Trả về dữ liệu thống kê lỗi cho 5 site AEON:
    Số lỗi từng thiết bị theo từng tháng.
    """
    try:
        raw_data = get_excel_data()

        # 5 site can thong ke
        target_sites = [
            "AEON Nguyen Van Linh",
            "AEON Ta Quang Buu",
            "AEON Binh Duong NC",
            "AEON Van Giang",
            "AEON Midori"
        ]
        site_alias_map = {
            "AEON NGUYEN VAN LINH": "AEON Nguyen Van Linh",
            "ANVL": "AEON Nguyen Van Linh",
            "AEON TA QUANG BUU": "AEON Ta Quang Buu",
            "ATQB": "AEON Ta Quang Buu",
            "AEON BINH DUONG NC": "AEON Binh Duong NC",
            "ABDNC": "AEON Binh Duong NC",
            "AEON VAN GIANG": "AEON Van Giang",
            "AVG": "AEON Van Giang",
            "AEON MIDORI": "AEON Midori",
            "AMDR": "AEON Midori",
            # Bo sung alias tu anh chup thuc te
            "MIDORI": "AEON Midori",
            "ABNC": "AEON Binh Duong NC",
            "TQB": "AEON Ta Quang Buu",
        }

        def _norm_site(v):
            if v is None:
                return ""
            # Bo dau va chuan hoa
            def remove_accents(s):
                import unicodedata
                return ''.join(c for c in unicodedata.normalize('NFD', s)
                             if unicodedata.category(c) != 'Mn')
            
            s = str(v).strip().upper()
            s = remove_accents(s)
            s = re.sub(r"\s+", " ", s)
            
            # Kiem tra trong alias map
            if s in site_alias_map:
                return site_alias_map[s]
            
            # Fallback check tung tu khoa
            if "LINH" in s: return "AEON Nguyen Van Linh"
            if "BUU" in s: return "AEON Ta Quang Buu"
            if "BINH DUONG" in s or "ABNC" in s: return "AEON Binh Duong NC"
            if "GIANG" in s: return "AEON Van Giang"
            if "MIDORI" in s: return "AEON Midori"
            
            return ""

        def _parse_date(v):
            if not v:
                return None
            if isinstance(v, datetime):
                return v
            if isinstance(v, date):
                return datetime(v.year, v.month, v.day)

            raw = str(v).strip()
            for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
                try:
                    return datetime.strptime(raw, fmt)
                except Exception:
                    pass
            return None
        
        # Cau truc du lieu: site -> month -> device -> count
        stats = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(int)))
        
        for entry in raw_data:
            site = _norm_site(entry.get("site_name"))
            if not site:
                continue
            
            start_date_raw = entry.get("start_date")
            device = (entry.get("device") or "Unknown").strip()
            
            if not start_date_raw:
                continue
                
            dt = _parse_date(start_date_raw)
            if not dt:
                continue

            month_str = dt.strftime("%m/%Y") # vd: "04/2026"
            stats[site][month_str][device] += 1
        
        # Chuyen stats sang dang list de frontend de dung
        # { site: [ {month, devices: {device1: count, device2: count}} ] }
        result = {}
        for site in target_sites:
            site_months = []
            # Sap xep thang theo thoi gian
            sorted_months = sorted(stats[site].keys(), key=lambda x: datetime.strptime(x, "%m/%Y"))
            
            for month in sorted_months:
                site_months.append({
                    "month": month,
                    "devices": stats[site][month]
                })
            result[site] = site_months
            
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500