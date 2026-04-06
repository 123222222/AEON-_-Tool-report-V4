from flask import Blueprint, jsonify, redirect, request, url_for
import traceback
from config import PUBLIC_BASE_URL

from auth import (
    add_user_by_admin,
    approve_user,
    clear_session_user,
    delete_user,
    get_enabled_providers,
    get_oauth_client,
    get_session_user,
    graph_session,
    list_users,
    set_session_user,
    upsert_user_from_oauth,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _can_access(user: dict | None) -> bool:
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    return bool(user.get("approved", False))


@auth_bp.get("/providers")
def auth_providers():
    return jsonify({"providers": get_enabled_providers()})


@auth_bp.get("/me")
def me():
    user = get_session_user()
    return jsonify(
        {
            "logged_in": bool(user),
            "can_access": _can_access(user),
            "user": user,
            "providers": get_enabled_providers(),
            "graph_authenticated": graph_session.is_authenticated,
        }
    )


@auth_bp.get("/status")
def auth_status():
    """Backward-compatible status endpoint used by frontend auth bootstrap."""
    user = get_session_user()
    return jsonify(
        {
            "authenticated": _can_access(user),
            "logged_in": bool(user),
            "approved": bool(user.get("approved", False)) if user else False,
            "user": user,
        }
    )


@auth_bp.post("/logout")
def logout():
    clear_session_user()
    return jsonify({"ok": True})


@auth_bp.get("/login/<provider>")
def login(provider: str):
    provider = provider.lower().strip()
    client = get_oauth_client(provider)
    if not client:
        return jsonify({"error": f"Provider '{provider}' chưa được cấu hình"}), 400

    if PUBLIC_BASE_URL:
        redirect_uri = f"{PUBLIC_BASE_URL}/api/auth/callback/{provider}"
    else:
        redirect_uri = url_for("auth.auth_callback", provider=provider, _external=True)
    return client.authorize_redirect(redirect_uri)


@auth_bp.get("/callback/<provider>")
def auth_callback(provider: str):
    provider = provider.lower().strip()
    client = get_oauth_client(provider)
    if not client:
        return redirect("/?auth=provider_not_configured")

    try:
        token = client.authorize_access_token()
        user = upsert_user_from_oauth(provider, token, client)
        set_session_user(user)

        if user.get("role") == "admin" or user.get("approved"):
            return redirect("/?auth=success")
        return redirect("/?auth=pending")
    except Exception as e:
        print(f"[AUTH CALLBACK ERROR] provider={provider} error={e}", flush=True)
        print(traceback.format_exc(), flush=True)
        return redirect("/?auth=failed")


@auth_bp.get("/admin/users")
def admin_users():
    user = get_session_user()
    if not user or user.get("role") != "admin":
        return jsonify({"error": "Bạn không có quyền admin"}), 403
    return jsonify(list_users())


@auth_bp.post("/admin/users")
def admin_add_user():
    user = get_session_user()
    if not user or user.get("role") != "admin":
        return jsonify({"error": "Bạn không có quyền admin"}), 403

    body = request.json or {}
    email = body.get("email", "")
    name = body.get("name", "")
    approved = bool(body.get("approved", True))

    try:
        created = add_user_by_admin(email=email, name=name, approved=approved)
        return jsonify(created), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@auth_bp.post("/admin/users/<user_id>/approve")
def admin_approve_user(user_id: str):
    user = get_session_user()
    if not user or user.get("role") != "admin":
        return jsonify({"error": "Bạn không có quyền admin"}), 403

    try:
        approved_user = approve_user(user_id)
        return jsonify(approved_user)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@auth_bp.delete("/admin/users/<user_id>")
def admin_delete_user(user_id: str):
    user = get_session_user()
    if not user or user.get("role") != "admin":
        return jsonify({"error": "Bạn không có quyền admin"}), 403

    try:
        delete_user(user_id)
        return jsonify({"deleted": user_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@auth_bp.post("/graph/device-flow")
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


@auth_bp.get("/graph/device-flow/poll")
def poll_device_flow():
    """Frontend poll endpoint này để biết khi nào login hoàn tất."""
    result = graph_session.check_device_flow_result()
    return jsonify(result)


# Backward-compat aliases
@auth_bp.post("/device-flow")
def start_device_flow_compat():
    return start_device_flow()


@auth_bp.get("/device-flow/poll")
def poll_device_flow_compat():
    return poll_device_flow()
