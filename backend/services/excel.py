"""
services/excel.py
Download file Excel tu OneDrive, append 1 hang moi, upload lai.
"""
import os
import sys
import datetime
import tempfile
import requests
import base64
import openpyxl

from auth import graph_session

EXCEL_SHARE_LINK = (
    "https://aeondelight-my.sharepoint.com/:x:/g/personal/dung_ho_aeondelight_biz"
    "/IQC4QAqLtp-mRqWCS_v596O8AXny2kJRSp6KVHCbb8knAb0?e=stWUfd"
)

_excel_cache: dict = {"drive_id": None, "item_id": None}


def _log(msg):
    print(msg, flush=True)
    sys.stdout.flush()


def _resolve_excel_item():
    if _excel_cache["drive_id"] and _excel_cache["item_id"]:
        return _excel_cache["drive_id"], _excel_cache["item_id"]

    token   = graph_session.ensure_token()
    headers = {"Authorization": f"Bearer {token}"}

    encoded = base64.b64encode(EXCEL_SHARE_LINK.encode("utf-8")).decode("utf-8")
    encoded = encoded.rstrip("=").replace("/", "_").replace("+", "-")

    r = requests.get(
        f"https://graph.microsoft.com/v1.0/shares/u!{encoded}/driveItem",
        headers=headers
    )
    if r.status_code != 200:
        raise Exception(f"Khong resolve duoc file Excel: {r.status_code} {r.text[:200]}")

    data = r.json()
    _excel_cache["drive_id"] = data["parentReference"]["driveId"]
    _excel_cache["item_id"]  = data["id"]
    return _excel_cache["drive_id"], _excel_cache["item_id"]


def _download_excel(drive_id: str, item_id: str) -> str:
    token   = graph_session.ensure_token()
    headers = {"Authorization": f"Bearer {token}"}

    r = requests.get(
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}",
        headers=headers
    )
    if r.status_code != 200:
        raise Exception(f"Khong lay duoc metadata Excel: {r.status_code}")

    download_url = r.json().get("@microsoft.graph.downloadUrl")
    if not download_url:
        raise Exception("Khong co downloadUrl cho file Excel")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
    r2  = requests.get(download_url, stream=True)
    for chunk in r2.iter_content(8192):
        tmp.write(chunk)
    tmp.close()
    return tmp.name


def _upload_excel(drive_id: str, item_id: str, local_path: str):
    token   = graph_session.ensure_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/octet-stream",
    }
    with open(local_path, "rb") as f:
        data = f.read()

    import time as _time
    for attempt in range(3):
        r = requests.put(
            f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}/content",
            headers=headers,
            data=data
        )
        if r.status_code in (200, 201):
            return
        if r.status_code == 423:
            _log(f"[EXCEL] File bi lock, thu lai lan {attempt+1}/3 sau 5 giay...")
            _time.sleep(5)
            continue
        raise Exception(f"Upload Excel that bai: {r.status_code} {r.text[:200]}")

    raise Exception("Upload that bai sau 3 lan: file van bi lock. Hay dong file Excel tren OneDrive.")


def _normalize_time(t: str) -> str:
    if not t:
        return ""
    t = t.strip()
    if "AM" in t.upper() or "PM" in t.upper():
        for fmt in ("%I:%M %p", "%I:%M:%S %p"):
            try:
                return datetime.datetime.strptime(t.upper(), fmt.upper()).strftime("%H:%M")
            except ValueError:
                pass
    parts = t.split(":")
    try:
        return f"{int(parts[0]):02d}:{parts[1][:2]}"
    except Exception:
        return t


def _calc_downtime(start_time: str, end_time: str):
    if not start_time or not end_time:
        return "", None, None
    try:
        s_str = _normalize_time(start_time)
        e_str = _normalize_time(end_time)
        _log(f"[EXCEL] Time input: '{start_time}'->'{s_str}'  '{end_time}'->'{e_str}'")

        fmt = "%H:%M"
        s = datetime.datetime.strptime(s_str, fmt)
        e = datetime.datetime.strptime(e_str, fmt)

        if e <= s:
            e += datetime.timedelta(days=1)

        total_min = round((e - s).total_seconds() / 60, 2)

        if 6 <= s.hour < 22:
            _log(f"[EXCEL] -> Daytime, {total_min} phut")
            return "Daytime", total_min, None
        else:
            _log(f"[EXCEL] -> Nighttime, {total_min} phut")
            return "Nighttime", None, total_min

    except Exception as ex:
        _log(f"[EXCEL] _calc_downtime error: {ex}")
        return "", None, None


def _get_next_no(ws) -> int:
    max_no = 0
    for row in range(9, ws.max_row + 1):
        val = ws.cell(row=row, column=1).value
        try:
            n = int(val)
            if n > max_no:
                max_no = n
        except (TypeError, ValueError):
            pass
    return max_no + 1


def append_status_to_excel(
    site_name:   str,
    device:      str,
    pic:         str,
    alarm_type:  str,
    reason:      str,
    start_time:  str,
    end_time:    str,
    status:      str,
    description: str,
    processing:  str = "",
    week:        str = "",
) -> dict:
    """
    Format cot:
      A  = STT
      B  = Ten bo phan
      C  = Week (Week 1 ~ Week 5, do nguoi dung chon)
      D  = Ngay thang nam (dd/mm/yyyy)
      E  = Nguoi phu trach
      F  = rong
      G  = Ten thiet bi
      H  = Mo ta (Reason)
      I  = rong
      J  = Alarm Type
      K  = Time Type (Daytime / Nighttime)
      L  = Tong phut Daytime
      M  = Tong phut Nighttime
      N  = Status (Done / Not Yet)
      O  = Processing Results
      P  = Thoi gian bat dau (24h HH:MM)
      Q  = Thoi gian ket thuc (24h HH:MM)
    """
    drive_id, item_id = _resolve_excel_item()
    local_path        = _download_excel(drive_id, item_id)

    try:
        wb = openpyxl.load_workbook(local_path)
        ws = wb["Sheet1"]

        next_row = max(9, ws.max_row + 1)
        if ws.max_row >= 9:
            if ws.cell(row=ws.max_row, column=1).value is None:
                next_row = ws.max_row

        now      = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
        date_str = now.strftime("%d/%m/%Y")
        no       = _get_next_no(ws)

        time_type, day_min, night_min = _calc_downtime(start_time, end_time)

        start_norm = _normalize_time(start_time) if start_time else ""
        end_norm   = _normalize_time(end_time)   if end_time   else ""

        ws.cell(row=next_row, column=1).value  = no           # A: STT
        ws.cell(row=next_row, column=2).value  = site_name    # B: Ten bo phan
        ws.cell(row=next_row, column=3).value  = week         # C: Week (do nguoi dung chon)
        ws.cell(row=next_row, column=4).value  = date_str     # D: Ngay
        ws.cell(row=next_row, column=5).value  = pic          # E: Nguoi phu trach
        # F: rong (col 6)
        ws.cell(row=next_row, column=7).value  = device       # G: Ten thiet bi
        ws.cell(row=next_row, column=8).value  = description  # H: Mo ta
        # I: rong (col 9)
        ws.cell(row=next_row, column=10).value = alarm_type   # J: Alarm Type
        ws.cell(row=next_row, column=11).value = time_type    # K: Daytime / Nighttime
        ws.cell(row=next_row, column=12).value = f"{int(day_min)} phut"   if day_min   is not None else None  # L
        ws.cell(row=next_row, column=13).value = f"{int(night_min)} phut" if night_min is not None else None  # M
        ws.cell(row=next_row, column=14).value = status       # N: Status
        ws.cell(row=next_row, column=15).value = processing   # O: Processing Results
        ws.cell(row=next_row, column=16).value = start_norm   # P: Gio bat dau
        ws.cell(row=next_row, column=17).value = end_norm     # Q: Gio ket thuc

        wb.save(local_path)
        _log(f"[EXCEL] Saved row={next_row} no={no} week={week} | {time_type} | {start_norm}-{end_norm}")

    finally:
        try:
            _upload_excel(drive_id, item_id, local_path)
            _log("[EXCEL] Upload thanh cong")
        finally:
            os.unlink(local_path)

    return {"row": next_row, "no": no}