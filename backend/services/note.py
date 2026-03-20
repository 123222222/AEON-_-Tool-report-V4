import os
import json
import datetime
import threading
import schedule
import time
from config import NOTE_ARCHIVE_DIR

# Danh sách các reminder đang hoạt động (pending notifications)
_pending_notifications = []
_notifications_lock    = threading.Lock()

# Schedule runner
_schedule_thread_started = False


def _start_schedule_runner():
    global _schedule_thread_started
    if _schedule_thread_started:
        return
    _schedule_thread_started = True

    def run():
        while True:
            schedule.run_pending()
            time.sleep(1)

    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------
def _get_next_stt() -> int:
    used = []
    for fname in os.listdir(NOTE_ARCHIVE_DIR):
        if fname.startswith("reminders") and fname.endswith(".json"):
            try:
                n = int(fname.replace("reminders", "").replace(".json", ""))
                used.append(n)
            except:
                pass
    n = 1
    while n in used:
        n += 1
    return n


def load_all_notes() -> list:
    """Đọc tất cả file remindersN.json trong NOTE_ARCHIVE_DIR."""
    result = []
    if not os.path.exists(NOTE_ARCHIVE_DIR):
        return result

    for fname in sorted(os.listdir(NOTE_ARCHIVE_DIR)):
        if not (fname.startswith("reminders") and fname.endswith(".json")):
            continue
        fpath = os.path.join(NOTE_ARCHIVE_DIR, fname)
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "keyword" in data:
                data["_file"] = fpath
                data["_stt"]  = int(fname.replace("reminders", "").replace(".json", ""))
                if "delete_mode" not in data:
                    data["delete_mode"] = "delete"
                if "done" not in data:
                    data["done"] = False
                result.append(data)
        except Exception as e:
            print(f"❌ Lỗi đọc {fname}: {e}")

    result.sort(key=lambda d: d.get("_stt", 0))
    return result


def create_note(keyword: str, content: str, times: list, days: list,
                months: list, mode: str, delete_mode: str = "delete") -> dict:
    """Tạo note mới, lưu file JSON, và lên lịch."""
    stt   = _get_next_stt()
    fpath = os.path.join(NOTE_ARCHIVE_DIR, f"reminders{stt}.json")

    data = {
        "keyword":     keyword,
        "content":     content,
        "times":       times,
        "days":        days,
        "months":      months,
        "mode":        mode,
        "delete_mode": delete_mode,
        "done":        False,
    }

    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

    data["_file"] = fpath
    data["_stt"]  = stt

    schedule_note(data)
    return data


def delete_note(file_path: str) -> bool:
    """Xóa file note."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            return True
    except Exception as e:
        print(f"❌ Xóa note lỗi: {e}")
    return False


def schedule_note(note: dict):
    """Lên lịch nhắc cho một note."""
    _start_schedule_runner()

    keyword     = note["keyword"]
    content     = note["content"]
    times       = note["times"]
    days        = note["days"]
    months      = note["months"]
    mode        = note["mode"]
    delete_mode = note.get("delete_mode", "delete")
    file_path   = note.get("_file")

    for t in times:
        def make_job(t=t):
            def job():
                now = datetime.datetime.now()
                if str(now.day) not in days or str(now.month) not in months:
                    return

                # Đẩy notification vào queue để frontend poll
                with _notifications_lock:
                    _pending_notifications.append({
                        "keyword": keyword,
                        "content": content,
                        "time":    t,
                    })

                if mode == "1 lần":
                    if file_path and os.path.exists(file_path):
                        try:
                            if delete_mode == "delete":
                                os.remove(file_path)
                            else:
                                with open(file_path, "r", encoding="utf-8") as f:
                                    d = json.load(f)
                                d["done"] = True
                                with open(file_path, "w", encoding="utf-8") as f:
                                    json.dump(d, f, ensure_ascii=False, indent=4)
                        except Exception as e:
                            print(f"❌ Xử lý file sau nhắc: {e}")
                    return schedule.CancelJob

            return job

        schedule.every().day.at(t).do(make_job())


def get_pending_notifications() -> list:
    """Frontend poll hàm này để nhận các thông báo đang chờ."""
    with _notifications_lock:
        result = _pending_notifications.copy()
        _pending_notifications.clear()
    return result


def reload_all_schedules():
    """Khởi động lại tất cả lịch nhắc từ file (gọi khi server start)."""
    schedule.clear()
    notes = load_all_notes()
    for note in notes:
        if not note.get("done", False):
            schedule_note(note)
    print(f"✅ Loaded {len(notes)} reminder(s) from disk")
