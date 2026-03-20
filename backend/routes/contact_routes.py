import sys
import datetime
import threading
import traceback
from flask import Blueprint, jsonify, request
from config import HOTLINES_AND_CONFIRM_FORM_PATH, REPORT_FORM_DIR
from services import list_files_from_url, download_file
from services.report import (fill_contact_template, fill_status_template,
                              fill_notification_template)
from services.excel import append_status_to_excel

contact_bp = Blueprint("contact", __name__, url_prefix="/api")


def _load_template(keyword: str) -> str:
    files       = list_files_from_url(HOTLINES_AND_CONFIRM_FORM_PATH)
    target_file = next((f for f in files if keyword in f["name"]), None)
    if not target_file:
        raise FileNotFoundError(f"Khong tim thay template '{keyword}'")
    local_path = download_file(target_file, save_dir=REPORT_FORM_DIR)
    if not local_path:
        raise FileNotFoundError(f"Tai template '{keyword}' that bai")
    with open(local_path, "r", encoding="utf-8") as f:
        return f.read()


def _log(msg):
    print(msg, flush=True)
    sys.stdout.flush()


@contact_bp.post("/contact")
def contact():
    body      = request.json or {}
    confirmed = body.get("confirmed", True)
    if confirmed:
        return jsonify({"text": ""})
    dept   = body.get("dept", "")
    device = body.get("device", "")
    status = body.get("status", "")
    desc   = body.get("desc", "")
    try:
        template = _load_template("CONFIRM_FORM")
        text     = fill_contact_template(template, dept, device, status, desc)
        return jsonify({"text": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@contact_bp.post("/status")
def status_form():
    body        = request.json or {}
    confirmed   = body.get("confirmed", True)

    if confirmed:
        return jsonify({"text": "", "excel": None})

    dept        = body.get("dept", "")
    device      = body.get("device", "")
    pic         = body.get("pic", "")
    alarm_type  = body.get("alarm_type", "")
    status      = body.get("status", "")
    processing  = body.get("processing", "")
    week        = body.get("week", "")
    start_time  = body.get("start_time", "")
    end_time    = body.get("end_time", "")
    desc        = body.get("desc", "")

    _log(f"[STATUS] dept={dept} device={device} pic={pic} alarm={alarm_type} status={status}")

    # Tinh thoi gian xu ly
    time_process = ""
    if start_time and end_time:
        try:
            fmt      = "%H:%M"
            start_dt = datetime.datetime.strptime(start_time, fmt)
            end_dt   = datetime.datetime.strptime(end_time, fmt)
            delta    = end_dt - start_dt
            total_m  = int(delta.total_seconds() / 60)
            if total_m < 0:
                total_m += 1440
            h, m     = divmod(total_m, 60)
            time_process = f"{h} gio {m} phut" if h else f"{m} phut"
        except ValueError:
            time_process = ""

    # Fill template
    text = ""
    try:
        template = _load_template("CONFIRM_FORM")
        text     = fill_status_template(template, dept, device, status, time_process, desc)
    except Exception as e:
        text = f"[Loi template] {e}"

    # Ghi Excel — KHONG dung daemon thread de tranh bi kill
    def write_excel():
        _log("[EXCEL] Starting write...")
        try:
            result = append_status_to_excel(
                site_name   = dept,
                device      = device,
                pic         = pic,
                alarm_type  = alarm_type,
                reason      = f"{start_time} - {end_time}" if start_time else desc,
                start_time  = start_time,
                end_time    = end_time,
                status      = status,
                description = desc,
                processing  = processing,
                week        = week,
            )
            _log(f"[EXCEL] OK - row={result['row']} no={result['no']}")
        except Exception:
            _log(f"[EXCEL] ERROR:\n{traceback.format_exc()}")

    t = threading.Thread(target=write_excel, daemon=False)
    t.start()

    return jsonify({"text": text, "excel": "writing"})


@contact_bp.post("/notification")
def notification_form():
    body        = request.json or {}
    site        = body.get("site", "")
    description = body.get("description", "")
    start_time  = body.get("start_time", "")
    start_date  = body.get("start_date", "")
    end_time    = body.get("end_time", "")
    end_date    = body.get("end_date", "")
    devices     = body.get("devices", "")
    note        = body.get("note", "")
    try:
        template = _load_template("NOTIFICATION_FORM")
        text     = fill_notification_template(
            template, site, description,
            start_time, start_date,
            end_time, end_date,
            devices, note
        )
        return jsonify({"text": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500