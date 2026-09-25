# rac_proxy.py
# RAC Submission Proxy
# Sits between the public Experience Builder widget and the ArcGIS
# FeatureServer. Enforces rate limiting and payload validation before
# forwarding submissions to the FeatureServer via localhost.
#
# IIS reverse proxy routes /ReportAConcern/proxy/* to localhost:PORT
# Widget writeEndpointUrl: https://<public-host>/ReportAConcern/proxy
#
# Routes:
#   GET  /health               - health check
#   POST /applyEdits           - ticket submission (form-encoded, matches widget)
#   POST /<oid>/addAttachment  - photo upload (form-encoded, matches widget)
#
# Notification_Log usage:
#   All proxy events are written to the Notification_Log table.
#   Fields are repurposed as follows for proxy entries:
#     recipient_email -> client IP address
#     email_subject   -> event type  (e.g. "applyEdits:FORWARDED")
#     send_status     -> BLOCKED / REJECTED / SUCCESS / FAILED
#     ticket_id       -> sentinel {00000000-...} when no ticket exists yet
#
# All settings live in proxy_config.py (copy proxy_config.example.py).
# Runs as a Task Scheduler startup task.

import io
import json
import logging
import sys
import time
import uuid
from collections import defaultdict
from datetime import datetime

import pyodbc
import requests
import urllib3
from flask import Flask, jsonify, request, Response
from waitress import serve

try:
    import proxy_config as pc
except ImportError:
    sys.exit(
        "rac_proxy.py: proxy_config.py not found. "
        "Copy proxy_config.example.py to proxy_config.py in the same folder "
        "and edit it for this environment."
    )

if not pc.VERIFY_FEATURE_SERVER_TLS:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NO_TICKET_GUID = "{00000000-0000-0000-0000-000000000000}"

SCRIPT_NAME = "rac_proxy.py"

MAX_ATTACHMENT_MB = pc.MAX_ATTACHMENT_BYTES // (1024 * 1024)

# ---------------------------------------------------------------------------
# Logging - all events written to Notification_Log; no file logging
# ---------------------------------------------------------------------------

logging.basicConfig(handlers=[logging.NullHandler()])
log = logging.getLogger("rac_proxy")

# ---------------------------------------------------------------------------
# Notification_Log writer - pyodbc direct SQL
# ---------------------------------------------------------------------------

def write_notification_log(
    ticket_id: str,
    client_ip: str,
    event_type: str,
    send_status: str,
    error_msg: str = None,
):
    """
    Inserts one row into the Notification_Log table.

    ticket_id   - GUID string of the ticket, or NO_TICKET_GUID if none yet
    client_ip   - stored in recipient_email field
    event_type  - stored in email_subject field (e.g. 'applyEdits:FORWARDED')
    send_status - BLOCKED / REJECTED / SUCCESS / FAILED
    error_msg   - optional detail, truncated to 500 chars
    """
    log_id      = f"{{{str(uuid.uuid4()).upper()}}}"
    sent_date   = datetime.now()
    error_trunc = error_msg[:500] if error_msg else None

    sql = f"""
        INSERT INTO {pc.NOTIF_LOG_TABLE} (
            log_id, ticket_id, script_name, recipient_email,
            email_subject, send_status, error_message, sent_date, retry_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    """
    try:
        with pyodbc.connect(pc.DB_CONN_STR, timeout=5) as conn:
            conn.execute(sql, (
                log_id,
                ticket_id,
                SCRIPT_NAME,
                client_ip,
                event_type,
                send_status,
                error_trunc,
                sent_date,
            ))
            conn.commit()
    except Exception as exc:
        log.error("Notification_Log write failed: %s", exc)


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

_rate_store = defaultdict(list)

def is_rate_limited(ip: str) -> bool:
    now    = time.time()
    cutoff = now - pc.RATE_LIMIT_WINDOW_S
    timestamps = [t for t in _rate_store[ip] if t > cutoff]
    _rate_store[ip] = timestamps
    if len(timestamps) >= pc.RATE_LIMIT_MAX:
        return True
    _rate_store[ip].append(now)
    return False

# ---------------------------------------------------------------------------
# CORS helper
# ---------------------------------------------------------------------------

def cors_headers(origin: str) -> dict:
    if origin in pc.CORS_ORIGINS:
        return {
            "Access-Control-Allow-Origin":  origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age":       "86400",
            "Vary":                         "Origin",
        }
    return {}

def add_cors(response: Response) -> Response:
    origin = request.headers.get("Origin", "")
    for key, value in cors_headers(origin).items():
        response.headers[key] = value
    return response

# ---------------------------------------------------------------------------
# Attachment validation
# ---------------------------------------------------------------------------

def validate_attachment_bytes(data: bytes) -> tuple[bool, str]:
    if len(data) < 12:
        return False, "File too small to be a valid image."

    header = data[:12]

    if header[:8] == b'\x89PNG\r\n\x1a\n':
        return True, "PNG"

    if header[:3] == b'\xff\xd8\xff':
        return True, "JPEG"

    if header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return True, "WebP"

    HEIC_BRANDS = {b'heic', b'heix', b'hevc', b'hevx',
                   b'heim', b'heis', b'hevm', b'hevs', b'mif1', b'msf1'}
    if header[4:8] == b'ftyp' and header[8:12] in HEIC_BRANDS:
        return True, "HEIC/HEIF"

    return False, (
        f"File content does not match any allowed image type. "
        f"First bytes: {header[:8].hex()}"
    )

# ---------------------------------------------------------------------------
# Payload validation
# ---------------------------------------------------------------------------

def validate_payload(adds: list) -> tuple[bool, str]:
    if not isinstance(adds, list) or len(adds) == 0:
        return False, "No features provided."

    if len(adds) > 1:
        return False, "Only one submission per request is allowed."

    feature = adds[0]

    geom = feature.get("geometry")
    if not geom:
        return False, "Missing geometry."

    x = geom.get("x")
    y = geom.get("y")

    if x is None or y is None:
        return False, "Geometry missing x/y coordinates."

    try:
        x = float(x)
        y = float(y)
    except (TypeError, ValueError):
        return False, "Geometry coordinates are not numeric."

    if not (pc.BBOX_X_MIN <= x <= pc.BBOX_X_MAX
            and pc.BBOX_Y_MIN <= y <= pc.BBOX_Y_MAX):
        return False, "Geometry is outside the service area."

    attrs = feature.get("attributes", {})

    category = attrs.get("category")
    if category is None:
        return False, "Missing category."
    try:
        if int(category) not in pc.VALID_CATEGORIES:
            return False, f"Invalid category value: {category}."
    except (TypeError, ValueError):
        return False, "Category must be an integer."

    description = attrs.get("description", "")
    if not description or not str(description).strip():
        return False, "Missing description."
    if len(str(description)) > pc.MAX_DESCRIPTION_LEN:
        return False, f"Description exceeds {pc.MAX_DESCRIPTION_LEN} characters."

    status = attrs.get("status")
    if status is not None and int(status) != 1:
        return False, "Invalid initial status value."

    name = attrs.get("submitted_by_name", "")
    if name and len(str(name)) > pc.MAX_NAME_LEN:
        return False, f"Name exceeds {pc.MAX_NAME_LEN} characters."

    email = attrs.get("submitted_by_email", "")
    if email and str(email).strip():
        if "@" not in str(email) or "." not in str(email):
            return False, "Invalid email format."

    phone = attrs.get("submitted_by_phone", "")
    if phone and str(phone).strip():
        digits = "".join(c for c in str(phone) if c.isdigit())
        if not (7 <= len(digits) <= 15):
            return False, "Invalid phone number."

    return True, ""

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__)

def get_client_ip() -> str:
    ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if ip and "," in ip:
        ip = ip.split(",")[0].strip()
    return ip


@app.after_request
def apply_cors(response: Response) -> Response:
    return add_cors(response)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


@app.route("/applyEdits", methods=["POST", "OPTIONS"])
def apply_edits():
    if request.method == "OPTIONS":
        return jsonify({}), 200

    ip = get_client_ip()

    # --- Rate limit ---
    if is_rate_limited(ip):
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type="applyEdits:RATE_LIMITED",
            send_status="BLOCKED",
            error_msg=f"Rate limit exceeded ({pc.RATE_LIMIT_MAX} per {pc.RATE_LIMIT_WINDOW_S}s)",
        )
        return jsonify({
            "error": {
                "code": 429,
                "message": "Too many submissions. Please try again later."
            }
        }), 429

    # --- Parse adds ---
    adds_raw = request.form.get("adds")
    if not adds_raw:
        body     = request.get_json(force=True, silent=True)
        adds_raw = body.get("adds") if body else None

    if not adds_raw:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type="applyEdits:MISSING_PAYLOAD",
            send_status="REJECTED",
            error_msg="Missing adds payload",
        )
        return jsonify({"error": {"code": 400, "message": "Missing adds payload."}}), 400

    if isinstance(adds_raw, str):
        try:
            adds = json.loads(adds_raw)
        except json.JSONDecodeError:
            write_notification_log(
                ticket_id=NO_TICKET_GUID,
                client_ip=ip,
                event_type="applyEdits:MALFORMED_PAYLOAD",
                send_status="REJECTED",
                error_msg="Malformed adds payload, JSON parse failed",
            )
            return jsonify({"error": {"code": 400, "message": "Malformed adds payload."}}), 400
    else:
        adds = adds_raw

    # --- Validate ---
    valid, reason = validate_payload(adds)
    if not valid:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type="applyEdits:VALIDATION_FAILED",
            send_status="REJECTED",
            error_msg=reason,
        )
        return jsonify({"error": {"code": 400, "message": reason}}), 400

    # --- Forward to FeatureServer ---
    try:
        fs_response = requests.post(
            f"{pc.FEATURE_SERVER_BASE}/applyEdits",
            data={
                "f":    "json",
                "adds": json.dumps(adds),
            },
            timeout=15,
            verify=pc.VERIFY_FEATURE_SERVER_TLS,
        )
        fs_response.raise_for_status()
    except requests.exceptions.Timeout:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type="applyEdits:TIMEOUT",
            send_status="FAILED",
            error_msg="FeatureServer did not respond within 15s",
        )
        return jsonify({"error": {"code": 504, "message": "Submission timed out. Please try again."}}), 504
    except requests.exceptions.RequestException as exc:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type="applyEdits:FORWARD_ERROR",
            send_status="FAILED",
            error_msg=str(exc),
        )
        return jsonify({"error": {"code": 502, "message": "Submission failed. Please try again."}}), 502

    result = fs_response.json()

    # Extract ticket_id GUID from FeatureServer response if available
    ticket_guid = NO_TICKET_GUID
    try:
        added = result.get("addResults", [{}])
        if added and added[0].get("success"):
            global_id = added[0].get("globalId", "")
            if global_id:
                ticket_guid = global_id
    except Exception:
        pass

    write_notification_log(
        ticket_id=ticket_guid,
        client_ip=ip,
        event_type="applyEdits:FORWARDED",
        send_status="SUCCESS",
    )

    return jsonify(result), fs_response.status_code


@app.route("/<int:oid>/addAttachment", methods=["POST", "OPTIONS"])
def add_attachment(oid: int):
    if request.method == "OPTIONS":
        return jsonify({}), 200

    ip = get_client_ip()

    if "attachment" not in request.files:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type=f"addAttachment:{oid}:MISSING_FILE",
            send_status="REJECTED",
            error_msg="No attachment field in request",
        )
        return jsonify({"error": {"code": 400, "message": "No attachment provided."}}), 400

    uploaded_file = request.files["attachment"]
    file_bytes    = uploaded_file.read()

    # --- Size cap ---
    if len(file_bytes) > pc.MAX_ATTACHMENT_BYTES:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type=f"addAttachment:{oid}:SIZE_EXCEEDED",
            send_status="REJECTED",
            error_msg=f"File size {len(file_bytes)} bytes exceeds {pc.MAX_ATTACHMENT_BYTES} byte limit",
        )
        return jsonify({"error": {"code": 400, "message": f"Attachment exceeds {MAX_ATTACHMENT_MB} MB limit."}}), 400

    # --- Magic byte validation ---
    valid, label_or_reason = validate_attachment_bytes(file_bytes)
    if not valid:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type=f"addAttachment:{oid}:MAGIC_BYTE_REJECTED",
            send_status="REJECTED",
            error_msg=(
                f"filename={uploaded_file.filename!r} "
                f"declared_type={uploaded_file.content_type!r} "
                f"reason={label_or_reason}"
            ),
        )
        return jsonify({"error": {"code": 400, "message": "Invalid attachment. Only JPEG, PNG, WebP, and HEIC images are accepted."}}), 400

    # --- Forward validated bytes to FeatureServer ---
    content_type_map = {
        "PNG":       "image/png",
        "JPEG":      "image/jpeg",
        "WebP":      "image/webp",
        "HEIC/HEIF": "image/heic",
    }
    safe_content_type = content_type_map.get(label_or_reason, "application/octet-stream")

    try:
        fs_response = requests.post(
            f"{pc.FEATURE_SERVER_BASE}/{oid}/addAttachment",
            data={"f": "json"},
            files={
                "attachment": (
                    uploaded_file.filename,
                    io.BytesIO(file_bytes),
                    safe_content_type,
                )
            },
            timeout=30,
            verify=pc.VERIFY_FEATURE_SERVER_TLS,
        )
        fs_response.raise_for_status()
    except requests.exceptions.Timeout:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type=f"addAttachment:{oid}:TIMEOUT",
            send_status="FAILED",
            error_msg="FeatureServer did not respond within 30s",
        )
        return jsonify({"error": {"code": 504, "message": "Attachment upload timed out."}}), 504
    except requests.exceptions.RequestException as exc:
        write_notification_log(
            ticket_id=NO_TICKET_GUID,
            client_ip=ip,
            event_type=f"addAttachment:{oid}:FORWARD_ERROR",
            send_status="FAILED",
            error_msg=str(exc),
        )
        return jsonify({"error": {"code": 502, "message": "Attachment upload failed."}}), 502

    result = fs_response.json()

    write_notification_log(
        ticket_id=NO_TICKET_GUID,
        client_ip=ip,
        event_type=f"addAttachment:{oid}:FORWARDED",
        send_status="SUCCESS",
        error_msg=f"type={label_or_reason} size={len(file_bytes)}b filename={uploaded_file.filename!r}",
    )

    return jsonify(result), fs_response.status_code


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    serve(app, host="0.0.0.0", port=pc.PORT)
