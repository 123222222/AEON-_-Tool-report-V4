from flask import Blueprint, jsonify
from auth import graph_session

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.get("/status")
def auth_status():
    """Kiểm tra trạng thái đăng nhập."""
    if graph_session.is_authenticated:
        return jsonify({"authenticated": True})
    return jsonify({"authenticated": False})


@auth_bp.post("/device-flow")
def start_device_flow():
    """
    Khởi động device flow.
    Frontend dùng user_code và verification_uri để hiển thị cho user.
    """
    try:
        result = graph_session.start_device_flow()
        return jsonify(result)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@auth_bp.get("/device-flow/poll")
def poll_device_flow():
    """Frontend poll endpoint này để biết khi nào login hoàn tất."""
    result = graph_session.check_device_flow_result()
    return jsonify(result)
