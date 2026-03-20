import os
import base64
import datetime
import requests
from auth import graph_session
from config import BASE_SHARE_LINK, REPORT_FORM_DIR

# Cache driveId và rootItemId để không gọi lại mỗi lần
_drive_cache = {"drive_id": None, "root_item_id": None}


def _resolve_base_share_link():
    """Lấy driveId và itemId của folder ROOT từ BASE_SHARE_LINK."""
    if _drive_cache["drive_id"] and _drive_cache["root_item_id"]:
        return _drive_cache["drive_id"], _drive_cache["root_item_id"]

    token   = graph_session.ensure_token()
    headers = {"Authorization": f"Bearer {token}"}

    encoded = base64.b64encode(BASE_SHARE_LINK.encode("utf-8")).decode("utf-8")
    encoded = encoded.rstrip("=").replace("/", "_").replace("+", "-")

    r = requests.get(
        f"https://graph.microsoft.com/v1.0/shares/u!{encoded}/driveItem",
        headers=headers
    )

    if r.status_code != 200:
        print(f"❌ Không resolve được BASE_SHARE_LINK: {r.status_code}")
        return None, None

    data          = r.json()
    drive_id      = data["parentReference"]["driveId"]
    root_item_id  = data["id"]

    _drive_cache["drive_id"]     = drive_id
    _drive_cache["root_item_id"] = root_item_id
    return drive_id, root_item_id


def list_files_from_url(subfolder_path: str) -> list:
    """
    Lấy danh sách file trong subfolder của OneDrive.
    subfolder_path: đường dẫn tương đối từ ROOT, vd "REPORT FORM/NVL REPORT FORM"
    """
    try:
        if not subfolder_path or not subfolder_path.strip():
            return []

        token   = graph_session.ensure_token()
        headers = {"Authorization": f"Bearer {token}"}

        drive_id, root_item_id = _resolve_base_share_link()
        if not drive_id:
            return []

        api_url = (
            f"https://graph.microsoft.com/v1.0/drives/{drive_id}"
            f"/items/{root_item_id}:/{subfolder_path}:/children"
        )

        r = requests.get(api_url, headers=headers)

        if r.status_code == 200:
            items = r.json().get("value", [])
            return [
                {
                    "id":           item["id"],
                    "name":         item["name"],
                    "downloadUrl":  item.get("@microsoft.graph.downloadUrl"),
                    "lastModified": item.get("lastModifiedDateTime"),
                }
                for item in items if "file" in item
            ]
        else:
            print(f"❌ API ERROR {r.status_code} | path: {subfolder_path}")
            return []

    except Exception as e:
        print(f"❌ list_files ERROR: {e}")
        return []


def download_file(file_dict: dict, save_dir: str = None) -> str | None:
    """
    Tải file từ OneDrive về local.
    file_dict: {"id", "name", "downloadUrl", "lastModified"}
    save_dir: thư mục đích (mặc định REPORT_FORM_DIR)
    Returns: local path hoặc None nếu lỗi.
    """
    try:
        if save_dir is None:
            save_dir = REPORT_FORM_DIR
        os.makedirs(save_dir, exist_ok=True)

        fname        = os.path.basename(file_dict["name"])
        download_url = file_dict.get("downloadUrl")
        remote_time  = file_dict.get("lastModified")

        if not download_url:
            # Lấy lại downloadUrl qua Graph API
            token   = graph_session.ensure_token()
            headers = {"Authorization": f"Bearer {token}"}
            drive_id, _ = _resolve_base_share_link()
            meta = requests.get(
                f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{file_dict['id']}",
                headers=headers
            ).json()
            download_url = meta.get("@microsoft.graph.downloadUrl")
            remote_time  = meta.get("lastModifiedDateTime")

        if not download_url:
            return None

        path = os.path.join(save_dir, fname)

        # Skip nếu file local vẫn còn mới hơn
        if os.path.exists(path) and remote_time:
            local_time = datetime.datetime.fromtimestamp(os.path.getmtime(path))
            remote_dt  = datetime.datetime.fromisoformat(
                remote_time.replace("Z", "+00:00")
            ).replace(tzinfo=None)
            if local_time >= remote_dt:
                return path

        r = requests.get(download_url, stream=True)
        if r.status_code == 200:
            with open(path, "wb") as f:
                for chunk in r.iter_content(1024):
                    f.write(chunk)
            return path
        return None

    except Exception as e:
        print(f"❌ download_file ERROR: {e}")
        return None
