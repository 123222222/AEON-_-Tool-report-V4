import os
from flask import Flask, send_from_directory
from flask_cors import CORS
from routes import auth_bp, report_bp, contact_bp, note_bp, image_bp, docs_bp, slack_bp
from services.note import reload_all_schedules


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder=os.path.join(os.path.dirname(__file__), "..", "frontend"),
        static_url_path="",
    )
    CORS(app)

    for bp in [auth_bp, report_bp, contact_bp, note_bp, image_bp, docs_bp, slack_bp]:
        app.register_blueprint(bp)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
        if path and os.path.exists(os.path.join(frontend_dir, path)):
            return send_from_directory(frontend_dir, path)
        return send_from_directory(frontend_dir, "index.html")

    return app


# Gunicorn entrypoint (Docker)
reload_all_schedules()
wsgi_app = create_app()

if __name__ == "__main__":
    print("RMC Assistant dang chay tai http://localhost:5000")
    wsgi_app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)