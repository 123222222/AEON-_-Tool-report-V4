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
            headers=headers, data=data
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


def _calc_downtime(start_time: str, start_date: str,
                   end_time: str, end_date: str):
    """
    Tinh tong phut tu start -> end, co tinh den ngay.
    - Neu qua ngay (overnight): overnight_min co gia tri, day/night_min = None
    - Neu cung ngay: tinh theo daytime/nighttime nhu cu
    Tra ve: (time_type, day_min, night_min, overnight_min)
    """
    if not start_time or not end_time:
        return "", None, None, None
    try:
        s_str = _normalize_time(start_time)
        e_str = _normalize_time(end_time)

        # Parse datetime day neu co
        fmt_dt = "%Y-%m-%d %H:%M"
        fmt_t  = "%H:%M"

        if start_date and end_date:
            s_dt = datetime.datetime.strptime(f"{start_date} {s_str}", fmt_dt)
            e_dt = datetime.datetime.strptime(f"{end_date} {e_str}", fmt_dt)
        else:
            s_dt = datetime.datetime.strptime(s_str, fmt_t)
            e_dt = datetime.datetime.strptime(e_str, fmt_t)

        # Neu end <= start va cung ngay -> thuc ra qua nua dem, cong 1 ngay cho end
        if e_dt <= s_dt:
            e_dt += datetime.timedelta(days=1)

        total_min = round((e_dt - s_dt).total_seconds() / 60, 2)

        # Overnight: tong thoi gian > 1440 phut (> 1 ngay)
        if total_min > 1440:
            _log(f"[EXCEL] -> Overnight, {total_min} phut")
            return "Overnight", None, None, total_min

        # Daytime: start tu 6:00 den 21:59
        # Nighttime: start tu 22:00 den 5:59
        if 6 <= s_dt.hour < 22:
            _log(f"[EXCEL] -> Daytime, {total_min} phut")
            return "Daytime", total_min, None, None
        else:
            _log(f"[EXCEL] -> Nighttime, {total_min} phut")
            return "Nighttime", None, total_min, None

    except Exception as ex:
        _log(f"[EXCEL] _calc_downtime error: {ex}")
        return "", None, None, None


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
    start_date:  str = "",
    end_time:    str = "",
    end_date:    str = "",
    status:      str = "",
    description: str = "",
    processing:  str = "",
    week:        str = "",
) -> dict:
    """
    Format cot:
      A  = STT
      B  = Ten bo phan
      C  = Week
      D  = Ngay bat dau (dd/mm/yyyy)
      E  = Ngay ket thuc (dd/mm/yyyy)
      F  = rong
      G  = Nguoi phu trach
      H  = Ten thiet bi
      I  = Mo ta (Reason)
      J  = rong
      K  = Alarm Type
      L  = Time Type (Daytime / Nighttime / Overnight)
      M  = Phut Daytime
      N  = Phut Nighttime
      O  = Phut Overnight (qua ngay)
      P  = Status
      Q  = Processing Results
      R  = Gio bat dau (HH:MM)
      S  = Gio ket thuc (HH:MM)
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
        no       = _get_next_no(ws)

        # Format ngay
        def fmt_date(d: str) -> str:
            if not d:
                return now.strftime("%d/%m/%Y")
            try:
                return datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%d/%m/%Y")
            except:
                return d

        start_date_fmt = fmt_date(start_date)
        end_date_fmt   = fmt_date(end_date) if end_date else start_date_fmt

        _log(f"[EXCEL] start={start_date} {start_time} end={end_date} {end_time}")
        time_type, day_min, night_min, overnight_min = _calc_downtime(
            start_time, start_date, end_time, end_date
        )

        start_norm = _normalize_time(start_time) if start_time else ""
        end_norm   = _normalize_time(end_time)   if end_time   else ""

        def fmt_min(v):
            return f"{int(v)} phut" if v is not None else None

        ws.cell(row=next_row, column=1).value  = no              # A: STT
        ws.cell(row=next_row, column=2).value  = site_name       # B: Ten bo phan
        ws.cell(row=next_row, column=3).value  = week            # C: Week
        ws.cell(row=next_row, column=4).value  = start_date_fmt  # D: Ngay bat dau
        ws.cell(row=next_row, column=5).value  = end_date_fmt    # E: Ngay ket thuc
        ws.cell(row=next_row, column=6).value  = pic             # F: Nguoi phu trach
        # G: rong (col 7)
        ws.cell(row=next_row, column=8).value  = device          # H: Ten thiet bi
        ws.cell(row=next_row, column=9).value  = description     # I: Mo ta
        # J: rong (col 10)
        ws.cell(row=next_row, column=11).value = alarm_type      # K: Alarm Type
        ws.cell(row=next_row, column=12).value = time_type       # L: Daytime/Nighttime/Overnight
        ws.cell(row=next_row, column=13).value = fmt_min(day_min)       # M: Phut Daytime
        ws.cell(row=next_row, column=14).value = fmt_min(night_min)     # N: Phut Nighttime
        ws.cell(row=next_row, column=15).value = fmt_min(overnight_min) # O: Phut Overnight
        ws.cell(row=next_row, column=16).value = status          # P: Status
        ws.cell(row=next_row, column=17).value = processing      # Q: Processing Results
        ws.cell(row=next_row, column=18).value = start_norm      # R: Gio bat dau
        ws.cell(row=next_row, column=19).value = end_norm        # S: Gio ket thuc

        wb.save(local_path)
        _log(f"[EXCEL] Saved row={next_row} no={no} | {time_type} | day={day_min} night={night_min} overnight={overnight_min}")

    finally:
        try:
            _upload_excel(drive_id, item_id, local_path)
            _log("[EXCEL] Upload thanh cong")
        finally:
            os.unlink(local_path)

    return {"row": next_row, "no": no}