import os
import time
import threading
import msal
from config import CLIENT_ID, AUTHORITY, GRAPH_SCOPES, CACHE_FILE


class GraphSession:
    """
    Quản lý phiên Azure AD.
    Hỗ trợ device flow (không cần browser popup như Tkinter).
    Frontend sẽ poll /api/auth/status để biết khi nào login xong.
    """

    def __init__(self):
        self.cache = msal.SerializableTokenCache()
        if os.path.exists(CACHE_FILE):
            self.cache.deserialize(open(CACHE_FILE, "r").read())

        self.app = msal.PublicClientApplication(
            CLIENT_ID, authority=AUTHORITY, token_cache=self.cache
        )
        self.account  = None
        self.token    = None

        # Device flow state (dùng cho frontend polling)
        self._flow             = None
        self._flow_result      = None
        self._flow_in_progress = False
        self._flow_lock        = threading.Lock()

    # ------------------------------------------------------------------
    def save_cache(self):
        if self.cache.has_state_changed:
            with open(CACHE_FILE, "w") as f:
                f.write(self.cache.serialize())

    # ------------------------------------------------------------------
    def get_valid_token(self):
        """Trả về access_token hợp lệ. Nếu hết hạn thì silent refresh."""
        if self.token and "access_token" in self.token:
            expires_at = self.token.get("expires_on")
            if expires_at and int(expires_at) > int(time.time()) + 60:
                return self.token["access_token"]

        accounts = self.app.get_accounts()
        if accounts:
            self.account = accounts[0]
            self.token   = self.app.acquire_token_silent(GRAPH_SCOPES, account=self.account)

        if self.token and "access_token" in self.token:
            self.save_cache()
            return self.token["access_token"]

        return None  # cần device flow

    # ------------------------------------------------------------------
    def start_device_flow(self):
        """
        Khởi động device flow. Trả về dict gồm:
          - user_code, verification_uri  (hiển thị lên frontend)
          - status: "pending"
        """
        with self._flow_lock:
            if self._flow_in_progress:
                return self._get_flow_status()

            flow = self.app.initiate_device_flow(scopes=GRAPH_SCOPES)
            if "user_code" not in flow:
                raise Exception("Không khởi tạo được Device Flow")

            self._flow             = flow
            self._flow_result      = None
            self._flow_in_progress = True

        # Chạy background thread chờ user login
        threading.Thread(target=self._wait_for_device_login, daemon=True).start()

        return {
            "status":           "pending",
            "user_code":        flow["user_code"],
            "verification_uri": flow["verification_uri"],
        }

    def _wait_for_device_login(self):
        result = self.app.acquire_token_by_device_flow(self._flow)
        with self._flow_lock:
            self._flow_result      = result
            self._flow_in_progress = False
            if result and "access_token" in result:
                self.token = result
                self.save_cache()

    def _get_flow_status(self):
        flow = self._flow
        return {
            "status":           "pending",
            "user_code":        flow["user_code"] if flow else "",
            "verification_uri": flow["verification_uri"] if flow else "",
        }

    # ------------------------------------------------------------------
    def check_device_flow_result(self):
        """
        Frontend gọi hàm này để poll trạng thái login.
        Returns:
            {"status": "pending"}
            {"status": "success"}
            {"status": "error", "message": "..."}
        """
        with self._flow_lock:
            if self._flow_in_progress:
                return {"status": "pending"}
            if self._flow_result is None:
                return {"status": "idle"}
            result = self._flow_result

        if "access_token" in result:
            return {"status": "success"}
        else:
            err = result.get("error_description", result.get("error", "Login thất bại"))
            return {"status": "error", "message": err}

    # ------------------------------------------------------------------
    def ensure_token(self):
        """
        Đảm bảo luôn có token hợp lệ.
        Raise Exception nếu chưa login.
        """
        token = self.get_valid_token()
        if not token:
            raise Exception("Chưa đăng nhập. Vui lòng đăng nhập qua /api/auth/device-flow")
        return token

    # ------------------------------------------------------------------
    @property
    def is_authenticated(self):
        return self.get_valid_token() is not None


# Singleton instance
graph_session = GraphSession()
