"""
rac_common.py

Shared plumbing for every Report a Concern script:

  - config loading (config.py, rac_secrets.py)
  - console logging
  - failure collection and one-email-per-run failure alerts
  - timezone helpers
  - HTML email template rendering (with organization tokens injected)
  - SMTP send
  - Notification_Log writes via direct SQL (non-versioned table)
  - a run() wrapper that turns collected failures into exit code 1

Import what you need:

    from rac_common import cfg, log, err, record_failure, run, ...

Nothing in the alert or Notification_Log paths ever raises; a logging
failure must never stop the caller.
"""

import os
import smtplib
import socket
import sys
import traceback
import uuid
from datetime import datetime
from email.message import EmailMessage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

# ── Config ────────────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    import config as cfg
except ImportError as _exc:
    sys.stderr.write(
        "config.py not found. Copy config.example.py to config.py next to the "
        f"scripts and edit it. ({_exc})\n"
    )
    sys.exit(2)

try:
    import rac_secrets as secrets_cfg
    OPTIONAL_CONFIG_IMPORT_ERROR = ""
except Exception as _exc:          # missing file or syntax error
    secrets_cfg = None
    OPTIONAL_CONFIG_IMPORT_ERROR = str(_exc)


def private_value(name, default=""):
    """Return a value from rac_secrets.py, or default if the file is missing."""
    return getattr(secrets_cfg, name, default) if secrets_cfg else default


# ── Timezones ─────────────────────────────────────────────────────────────────
UTC_TZ   = ZoneInfo("UTC")
LOCAL_TZ = ZoneInfo(cfg.LOCAL_TIMEZONE)

NO_TICKET_GUID = "{00000000-0000-0000-0000-000000000000}"


def to_local(dt):
    """Naive UTC datetime (as SDE returns) -> aware local datetime."""
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC_TZ).astimezone(LOCAL_TZ)


def utc_naive_to_local_naive(dt):
    """Naive UTC datetime -> naive local datetime (for arithmetic/display)."""
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC_TZ).astimezone(LOCAL_TZ).replace(tzinfo=None)


def local_now_naive():
    return datetime.now(LOCAL_TZ).replace(tzinfo=None)


# ── Logging ───────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}")


def err(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] ERROR: {msg}", file=sys.stderr)


# ── Failure alerts ────────────────────────────────────────────────────────────
# Failures are collected during the run and sent as ONE email at exit.
# Delivery: the optional shared EmailService module first, direct SMTP second.
if cfg.SHARED_SCRIPTS_DIR and cfg.SHARED_SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, cfg.SHARED_SCRIPTS_DIR)
try:
    if cfg.SHARED_SCRIPTS_DIR:
        from EmailService import EmailService
        _EMAILSERVICE_IMPORT_ERROR = ""
    else:
        EmailService = None
        _EMAILSERVICE_IMPORT_ERROR = "SHARED_SCRIPTS_DIR not set"
except Exception as _exc:
    EmailService = None
    _EMAILSERVICE_IMPORT_ERROR = str(_exc)

_RUN_FAILURES = []
_SCRIPT_NAME = os.path.basename(sys.argv[0]) if sys.argv and sys.argv[0] else "rac_script"


def set_script_name(name):
    global _SCRIPT_NAME
    _SCRIPT_NAME = name


def script_name():
    return _SCRIPT_NAME


def record_failure(msg):
    """Log an error and queue it for the end-of-run failure alert email."""
    err(msg)
    _RUN_FAILURES.append(msg)


def failures():
    return list(_RUN_FAILURES)


def _alert_direct(subject, body):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = cfg.ALERT_FROM
    msg["To"]      = ", ".join(cfg.ALERT_RECIPIENTS)
    msg.set_content(body)
    with smtplib.SMTP(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=30) as smtp:
        smtp.ehlo()
        smtp.send_message(msg)


def send_failure_alert(summary, detail=""):
    host    = socket.gethostname()
    subject = f"{_SCRIPT_NAME} failure on {host}"
    body = (
        f"Script:  {_SCRIPT_NAME}\n"
        f"Server:  {host}\n"
        f"Path:    {os.path.abspath(sys.argv[0]) if sys.argv else ''}\n"
        f"Time:    {datetime.now():%Y-%m-%d %H:%M:%S}\n\n"
        f"{summary}"
    )
    if detail:
        body += f"\n\n{detail}"
    try:
        if EmailService is not None:
            EmailService().sendEmail(", ".join(cfg.ALERT_RECIPIENTS), subject=subject, body=body)
            log(f"Failure alert sent via EmailService to {', '.join(cfg.ALERT_RECIPIENTS)}")
            return
        err(f"EmailService unavailable ({_EMAILSERVICE_IMPORT_ERROR}); sending alert directly")
    except Exception as exc:
        err(f"EmailService alert failed ({exc}); sending alert directly")
    try:
        _alert_direct(subject, body)
        log(f"Failure alert sent directly to {', '.join(cfg.ALERT_RECIPIENTS)}")
    except Exception as exc:
        err(f"Failure alert could not be sent: {exc}")


def flush_failure_alert():
    if not _RUN_FAILURES:
        return
    send_failure_alert(
        f"{len(_RUN_FAILURES)} failure(s) during this run:",
        "\n\n".join(f"[{i}] {m}" for i, m in enumerate(_RUN_FAILURES, 1)),
    )


def run(main_func):
    """
    Standard entry point. Runs main_func(), records unhandled exceptions,
    flushes the failure alert, and exits 1 if anything failed so Task
    Scheduler's Last Run Result shows it.
    """
    exit_code = 0
    try:
        main_func()
    except SystemExit as exc:
        exit_code = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
        if exit_code and not _RUN_FAILURES:
            record_failure(f"Script exited with code {exit_code}")
    except Exception as exc:
        exit_code = 1
        record_failure(f"Unhandled exception: {exc}\n{traceback.format_exc()}")
    finally:
        if _RUN_FAILURES and exit_code == 0:
            exit_code = 1
        flush_failure_alert()
    sys.exit(exit_code)


# ── Templates ─────────────────────────────────────────────────────────────────

ORG_TOKENS = {
    "{org_name}":     cfg.ORG_NAME,
    "{org_website}":  cfg.ORG_WEBSITE,
    "{org_logo_url}": cfg.ORG_LOGO_URL,
    "{org_logo_alt}": cfg.ORG_LOGO_ALT,
    "{org_address}":  cfg.ORG_ADDRESS,
    "{program_name}": cfg.PROGRAM_NAME,
    "{submit_app_url}": cfg.SUBMIT_APP_URL,
    "{manager_url}":  cfg.MANAGER_URL,
    "{contact_name}": cfg.CONTACT_NAME,
    "{contact_email}": cfg.CONTACT_EMAIL,
}


def template_path(filename):
    return os.path.join(cfg.TEMPLATE_DIR, filename)


def render_template(filename, tokens):
    """
    Read an HTML template from TEMPLATE_DIR and substitute {token} placeholders.
    Organization tokens are always available; script tokens override them.
    Returns None (and records a failure) if the template cannot be read.
    """
    merged = dict(ORG_TOKENS)
    for key, value in (tokens or {}).items():
        # Accept "ticket_number" or "{ticket_number}"; templates use the braced form.
        merged[key if key.startswith("{") else "{" + key + "}"] = value
    p = template_path(filename)
    try:
        with open(p, "r", encoding="utf-8") as f:
            html = f.read()
        for token, value in merged.items():
            html = html.replace(token, str(value) if value is not None else "")
        return html
    except Exception as exc:
        record_failure(f"Failed to read template '{p}': {exc}")
        return None


# ── Email send ────────────────────────────────────────────────────────────────

def send_html_email(to_addr, subject, html_body, text_body=None, timeout=15, headers=None):
    """
    Send a multipart/alternative HTML email through the relay.
    Returns (True, "") or (False, error_string). Never raises.
    """
    try:
        msg            = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{cfg.FROM_NAME} <{cfg.FROM_ADDR}>"
        msg["To"]      = to_addr
        for k, v in (headers or {}).items():
            msg[k] = v
        if text_body:
            msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
        with smtplib.SMTP(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=timeout) as smtp:
            smtp.ehlo()
            smtp.send_message(msg)
        return True, ""
    except Exception as exc:
        return False, str(exc)


def resolve_recipient(real_recipient):
    """Apply TESTING_MODE: every outbound email goes to TESTING_EMAIL."""
    return cfg.TESTING_EMAIL if cfg.TESTING_MODE else real_recipient


# ── Notification_Log (direct SQL, non-versioned table) ────────────────────────
# Notification_Log is unregistered from versioning so it is outside Compress.
# Every writer inserts with direct SQL and an explicit OBJECTID = MAX+1 rather
# than an InsertCursor, so no write depends on the SDE row-id counter and no
# two writers reuse an id. A short retry absorbs two scripts computing the
# same MAX+1 at once.
_NOTIF_CONN = None


def _arcpy():
    import arcpy   # imported lazily so rac_common can be used without arcpy
    return arcpy


def notif_conn():
    global _NOTIF_CONN
    if _NOTIF_CONN is None:
        _NOTIF_CONN = _arcpy().ArcSDESQLExecute(cfg.SDE_CONNECTION)
    return _NOTIF_CONN


def _notif_next_oid(conn):
    v = conn.execute(f"SELECT MAX(OBJECTID) FROM {cfg.NOTIF_LOG_SQL}")
    while isinstance(v, (list, tuple)):
        v = v[0] if v else None
    return (int(v) + 1) if v is not None else 1


def sql_val(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return "'" + v.strftime("%Y-%m-%d %H:%M:%S") + "'"
    return "'" + str(v).replace("'", "''") + "'"


def notif_insert(cols, vals):
    """Insert one Notification_Log row (OBJECTID = MAX+1 with retry)."""
    last = None
    try:
        conn = notif_conn()
        for _ in range(4):
            oid     = _notif_next_oid(conn)
            collist = "OBJECTID, " + ", ".join(cols)
            vallist = str(oid) + ", " + ", ".join(sql_val(x) for x in vals)
            try:
                conn.execute(f"INSERT INTO {cfg.NOTIF_LOG_SQL} ({collist}) VALUES ({vallist})")
                return True
            except Exception as exc:
                last = exc
    except Exception as exc:
        last = exc
    record_failure(f"Could not write Notification_Log: {last}")
    return False


def write_notification_log(ticket_id, recipient, subject, status, error_msg=None):
    """
    Standard Notification_Log row. ticket_id is a GUID string (with braces) or
    NO_TICKET_GUID. status is SUCCESS / FAILED / SKIPPED etc. Non-fatal.
    """
    cols = ["log_id", "ticket_id", "script_name", "recipient_email",
            "email_subject", "send_status", "error_message", "sent_date", "retry_count"]
    vals = ["{" + str(uuid.uuid4()).upper() + "}", ticket_id, _SCRIPT_NAME, recipient,
            subject, status, (error_msg[:500] if error_msg else None), datetime.now(), 0]
    return notif_insert(cols, vals)


def notif_scalar(sql):
    """Run a scalar SELECT against the geodatabase and return the value."""
    v = notif_conn().execute(sql)
    while isinstance(v, (list, tuple)):
        v = v[0] if v else None
    return v


def guid_braced(value):
    """Normalize a GUID string to {UPPER} form."""
    if value is None:
        return None
    return "{" + str(value).strip("{}").upper() + "}"


def guid_bare(value):
    if value is None:
        return None
    return str(value).strip("{}").upper()
