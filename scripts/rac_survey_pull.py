"""
rac_survey_pull.py

Pulls completed Survey123 satisfaction-survey responses from ArcGIS Online
and writes the new ones into the Survey_Responses table in the enterprise
geodatabase. Responses already present are skipped, so the script is
idempotent and safe to run repeatedly.

Staff follow-up:
    When a response answers the "Would you like a staff member to follow up
    with you?" question with Yes, the script emails the staff member who
    resolved or closed the ticket. The resolver is identified from the most
    recent STATUS comment on the ticket and their address is looked up in
    Enterprise Portal (optional). If that lookup is not configured or fails,
    the follow-up goes to the assigned department's routing email. The Yes/No
    answer is also written to Survey_Responses.staff_followup (SHORT, YesNo
    domain) when that column exists.

Schedule:
    Run every 15-30 minutes from Task Scheduler, same cadence as
    rac_survey_mailer.py. Requires the ArcGIS Pro Python environment (arcpy)
    for versioned geodatabase writes.

Usage:
    python rac_survey_pull.py
    python rac_survey_pull.py --dev                     # route follow-ups to TESTING_EMAIL
    python rac_survey_pull.py --test-followup <ticket>  # print the follow-up recipient, send nothing

Inputs:
    ArcGIS Online: the Survey123 hosted feature layer (SURVEY_ITEM_ID).
    Geodatabase:   Tickets, Ticket_Comments, Ticket_Routing, Survey_Responses,
                   Notification_Log.

Config keys (config.py):
    SDE_CONNECTION, TICKETS_FC, COMMENTS_TABLE, ROUTING_TABLE,
    SURVEY_RESP_TABLE, NOTIF_LOG_TABLE, AGOL_PORTAL, AGOL_USERNAME,
    SURVEY_ITEM_ID, SURVEY_MAX_BATCH, PORTAL_URL, PORTAL_USERNAME,
    PORTAL_VERIFY_SSL, FOLLOWUP_FALLBACK_EMAIL, SURVEY_FOLLOWUP_FIELD_CANDIDATES,
    SURVEY_RATING_FIELD, SURVEY_COMMENTS_FIELD, TESTING_MODE, TESTING_EMAIL,
    ORG_NAME, PROGRAM_NAME.
Secrets (rac_secrets.py):
    GIS_SERVICE_PASSWORD (required), PORTAL_PASSWORD (optional).

Behavior notes:
    - The AGOL service-account password is read from rac_secrets.py and is
      never hardcoded. If it is empty, main() records a failure and stops
      before touching AGOL.
    - Every failure in a run (credentials, AGOL auth, survey query, geodatabase
      insert, follow-up send, Notification_Log write, unhandled exception) is
      collected and emailed once at exit; the exit code is 1 when any failure
      was recorded.
"""

import arcpy
import urllib.request
import urllib.parse
import urllib.error
import json
import uuid
import sys
import re
import ssl
import traceback
from datetime import datetime
from typing   import Optional

from rac_common import (cfg, log, err, record_failure, run, notif_insert,
                        UTC_TZ, set_script_name, script_name, secret,
                        send_html_email, SECRETS_IMPORT_ERROR)

set_script_name("rac_survey_pull.py")

# ── Configuration ────────────────────────────────────────────────────────────

# AGOL service-account password from rac_secrets.py. If the secrets file is
# missing or the value is empty, main() records the failure and stops before
# touching AGOL.
AGOL_PASSWORD = secret("GIS_SERVICE_PASSWORD")

# Max responses to pull per run.
MAX_BATCH = cfg.SURVEY_MAX_BATCH

# ── Enterprise Portal (staff directory) ────────────────────────────────────────
# Staff who resolve/close tickets sign in to the Manager app with Enterprise
# Portal accounts, and comment authorship records their Portal full name. To
# email the resolver individually, set PORTAL_USERNAME / PORTAL_PASSWORD to a
# Portal account that can see members' email addresses. When they are empty
# the Portal lookup is skipped and follow-ups route to the assigned
# department's routing email instead.
PORTAL_PASSWORD = secret("PORTAL_PASSWORD")

# Recipient resolution order for a follow-up: (1) the resolver's Portal email,
# (2) the ticket's assigned-department routing email, (3) FOLLOWUP_FALLBACK_EMAIL
# if set. The fallback ships EMPTY so production never silently routes a real
# follow-up to a developer. If both (1) and (2) fail, the run logs NO_RECIPIENT
# and skips rather than emailing anyone unintended. The --dev flag (and
# TESTING_MODE) still override every recipient to TESTING_EMAIL for testing.

# Candidate names for the editor-tracking "last editor" field on Tickets.
# Esri's default field name is sometimes "last_edited_user" and sometimes
# "last_edited_by". The real name is resolved via ListFields.
EDITOR_FIELD_CANDIDATES = ["last_edited_by", "last_edited_user", "editor", "last_editor"]

DEV_MODE = "--dev" in sys.argv


def _arg_value(flag):
    """Return the value following a CLI flag, or None."""
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


# --test-followup <ticket_number>: resolve and PRINT the recipient for one
# ticket without importing or sending anything. Use it to confirm the Portal
# lookup works before trusting the live run.
TEST_FOLLOWUP_TN = _arg_value("--test-followup")


# ── AGOL REST helpers ─────────────────────────────────────────────────────────

def get_token() -> str:
    """
    Authenticate to ArcGIS Online and return a short-lived token.
    """
    url    = f"{cfg.AGOL_PORTAL}/sharing/rest/generateToken"
    params = urllib.parse.urlencode({
        "username":   cfg.AGOL_USERNAME,
        "password":   AGOL_PASSWORD,
        "referer":    cfg.AGOL_PORTAL,
        "expiration": 60,           # minutes
        "f":          "json",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=params, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    if "token" not in data:
        raise RuntimeError(f"Token request failed: {data.get('error', data)}")

    return data["token"]


# ── Enterprise Portal staff-email resolution ───────────────────────────────────

_PORTAL_TOKEN = None


def _portal_get(url: str) -> dict:
    """GET a Portal REST URL and return parsed JSON, honoring PORTAL_VERIFY_SSL."""
    ctx = ssl.create_default_context()
    if not cfg.PORTAL_VERIFY_SSL:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        return json.loads(resp.read())


def get_portal_token() -> Optional[str]:
    """Authenticate to Enterprise Portal and return a token. Cached per run."""
    global _PORTAL_TOKEN
    if _PORTAL_TOKEN is not None:
        return _PORTAL_TOKEN or None
    if not cfg.PORTAL_USERNAME or not PORTAL_PASSWORD:
        log("Portal credentials not set - using department routing for follow-ups.")
        _PORTAL_TOKEN = ""
        return None
    try:
        url = f"{cfg.PORTAL_URL}/sharing/rest/generateToken"
        params = urllib.parse.urlencode({
            "username":   cfg.PORTAL_USERNAME,
            "password":   PORTAL_PASSWORD,
            "referer":    cfg.PORTAL_URL,
            "expiration": 60,
            "f":          "json",
        }).encode("utf-8")
        ctx = ssl.create_default_context()
        if not cfg.PORTAL_VERIFY_SSL:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, data=params, method="POST")
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            data = json.loads(resp.read())
        if "token" in data:
            _PORTAL_TOKEN = data["token"]
            return _PORTAL_TOKEN
        err(f"Portal token request failed: {data.get('error', data)}")
    except Exception as exc:
        err(f"Portal token request error: {exc}")
    _PORTAL_TOKEN = ""
    return None


def resolve_staff_email(full_name: str) -> Optional[str]:
    """
    Resolve a staff member's display name to their organization email via
    Enterprise Portal. Returns the email only on an unambiguous exact
    full-name match with a readable address; otherwise None (caller falls
    back to the department).
    """
    if not full_name or not full_name.strip():
        return None
    token = get_portal_token()
    if not token:
        return None
    name = full_name.strip()
    url = (f"{cfg.PORTAL_URL}/sharing/rest/community/users"
           f"?f=json&num=50&token={urllib.parse.quote(token)}"
           f"&q={urllib.parse.quote(chr(34) + name + chr(34))}")
    try:
        data = _portal_get(url)
    except Exception as exc:
        err(f"  Portal user search failed for '{name}': {exc}")
        return None

    results = data.get("results") or []
    exact = [u for u in results if (u.get("fullName") or "").strip().lower() == name.lower()]
    if len(exact) == 1:
        email = (exact[0].get("email") or "").strip()
        if is_valid_email(email):
            return email
        err(f"  Resolver '{name}' matched Portal user '{exact[0].get('username')}' "
            f"but no readable email - check the service account's email-visibility permission.")
        return None
    if not exact:
        err(f"  No Portal user with full name '{name}' (searched {len(results)} candidate(s)).")
    else:
        err(f"  Ambiguous: {len(exact)} Portal users named '{name}' - cannot choose one.")
    return None


def get_resolver_name(ticket_id_guid: str) -> Optional[str]:
    """
    Return the author of the most recent STATUS comment on a ticket, the staff
    member who set it to Resolved or Closed. Display name, immune to the later
    service-account edits that overwrite the editor-tracking field.
    """
    clean = ticket_id_guid.strip("{}").upper()
    where = f"ticket_id = '{{{clean}}}' AND comment_type = 'STATUS'"
    best_author, best_dt = None, None
    try:
        with arcpy.da.SearchCursor(cfg.COMMENTS_TABLE, ["author", "created_date"], where_clause=where) as cur:
            for author, cdate in cur:
                if author and cdate is not None and (best_dt is None or cdate > best_dt):
                    best_author, best_dt = author, cdate
    except Exception as exc:
        err(f"  Could not read STATUS comments for {clean}: {exc}")
    return best_author


def get_department_email(assigned_to: str) -> Optional[str]:
    """Return the routing email for the ticket's assigned department, or None."""
    if not assigned_to:
        return None
    dept = assigned_to.replace("'", "''")
    where = f"default_assignee = '{dept}'"
    try:
        flds = {f.name.lower() for f in arcpy.ListFields(cfg.ROUTING_TABLE)}
        if "is_active" in flds:
            where += " AND is_active = 1"
        with arcpy.da.SearchCursor(cfg.ROUTING_TABLE, ["assignee_email"], where_clause=where) as cur:
            for (email,) in cur:
                if is_valid_email(email):
                    return email
    except Exception as exc:
        err(f"  Department email lookup failed for '{assigned_to}': {exc}")
    return None


def get_feature_service_url(token: str) -> str:
    """
    Resolve the feature service REST URL from the survey item ID.
    Survey123 feature layers are always at layer index 0.
    """
    url = f"{cfg.AGOL_PORTAL}/sharing/rest/content/items/{cfg.SURVEY_ITEM_ID}?f=json&token={token}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    svc_url = data.get("url")
    if not svc_url:
        raise RuntimeError(f"Could not resolve service URL for item {cfg.SURVEY_ITEM_ID}")

    return svc_url.rstrip("/") + "/0"   # layer 0 = survey responses


def query_survey_responses(svc_url: str, token: str) -> list:
    """
    Return all survey responses from the hosted feature layer.
    Fields expected: ticket_id, SURVEY_RATING_FIELD, SURVEY_COMMENTS_FIELD,
    one of SURVEY_FOLLOWUP_FIELD_CANDIDATES, CreationDate.
    """
    url    = svc_url + "/query"
    params = urllib.parse.urlencode({
        "where":          "1=1",
        "outFields":      "*",
        "returnGeometry": "false",
        "f":              "json",
        "token":          token,
    }).encode("utf-8")

    req = urllib.request.Request(url, data=params, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    if "error" in data:
        raise RuntimeError(f"Feature layer query failed: {data['error']}")

    return data.get("features", [])


# ── Follow-up helpers ──────────────────────────────────────────────────────────

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_valid_email(value) -> bool:
    """True if value looks like a real email address (excludes ARCSDE, blanks)."""
    if not value:
        return False
    return bool(EMAIL_RE.match(str(value).strip()))


def map_followup(v):
    """Map a Survey123 dropdown value to the YesNo domain code (1=Yes, 0=No)."""
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("yes", "y", "1", "true"):
        return 1
    if s in ("no", "n", "0", "false"):
        return 0
    return None


def read_followup(attrs: dict):
    """
    Read the follow-up answer from a Survey123 response. Tries each candidate
    field name (Survey123 truncates long question names, so the first match on
    the response wins) and returns (field_name_used, mapped_value) where
    mapped_value is 1 (Yes), 0 (No), or None (unanswered / unrecognized).
    """
    for name in cfg.SURVEY_FOLLOWUP_FIELD_CANDIDATES:
        if name in attrs:
            return name, map_followup(attrs.get(name))
    return None, None


_EDITOR_FIELD_CACHE = None


def get_editor_field() -> Optional[str]:
    """
    Resolve the real name of the 'last editor' field on the Tickets FC,
    handling last_edited_by vs last_edited_user. Cached after first call.
    """
    global _EDITOR_FIELD_CACHE
    if _EDITOR_FIELD_CACHE is not None:
        return _EDITOR_FIELD_CACHE or None
    try:
        names = {f.name.lower(): f.name for f in arcpy.ListFields(cfg.TICKETS_FC)}
        for cand in EDITOR_FIELD_CANDIDATES:
            if cand in names:
                _EDITOR_FIELD_CACHE = names[cand]
                log(f"Editor field resolved to: {_EDITOR_FIELD_CACHE}")
                return _EDITOR_FIELD_CACHE
    except Exception as exc:
        err(f"Could not list Tickets fields to resolve editor field: {exc}")
    _EDITOR_FIELD_CACHE = ""        # sentinel: looked up, not found
    err("Could not resolve an editor field on Tickets - follow-up emails will use the fallback address.")
    return None


_SURVEY_RESP_HAS_FOLLOWUP = None


def survey_resp_has_followup_col() -> bool:
    """True if Survey_Responses has the staff_followup column. Cached."""
    global _SURVEY_RESP_HAS_FOLLOWUP
    if _SURVEY_RESP_HAS_FOLLOWUP is not None:
        return _SURVEY_RESP_HAS_FOLLOWUP
    try:
        names = {f.name.lower() for f in arcpy.ListFields(cfg.SURVEY_RESP_TABLE)}
        _SURVEY_RESP_HAS_FOLLOWUP = "staff_followup" in names
    except Exception as exc:
        err(f"Could not inspect Survey_Responses fields: {exc}")
        _SURVEY_RESP_HAS_FOLLOWUP = False
    if not _SURVEY_RESP_HAS_FOLLOWUP:
        err("Survey_Responses has no 'staff_followup' column - the answer will not be stored.")
    return _SURVEY_RESP_HAS_FOLLOWUP


def get_ticket_details(ticket_id_guid: str) -> Optional[dict]:
    """
    Look up the staff editor email and submitter contact info for a ticket.
    Returns a dict with keys: editor, ticket_number, name, email, phone,
    description, assigned_to (any missing field is None). None if not found.
    """
    clean = ticket_id_guid.strip("{}").upper()
    where = f"ticket_id = '{{{clean}}}'"
    editor_field = get_editor_field()

    try:
        avail = {f.name.lower(): f.name for f in arcpy.ListFields(cfg.TICKETS_FC)}
    except Exception as exc:
        err(f"Could not list Tickets fields: {exc}")
        return None

    # Build the cursor field list from columns that actually exist.
    wanted = {
        "editor":        editor_field,
        "ticket_number": avail.get("ticket_number"),
        "name":          avail.get("submitted_by_name"),
        "email":         avail.get("submitted_by_email"),
        "phone":         avail.get("submitted_by_phone"),
        "description":   avail.get("description"),
        "assigned_to":   avail.get("assigned_to"),
    }
    field_list = [fn for fn in wanted.values() if fn]
    if not field_list:
        return None

    try:
        with arcpy.da.SearchCursor(cfg.TICKETS_FC, field_list, where_clause=where) as cur:
            for row in cur:
                rowmap = dict(zip(field_list, row))
                return {key: (rowmap.get(fn) if fn else None) for key, fn in wanted.items()}
    except Exception as exc:
        err(f"Ticket lookup failed for {clean}: {exc}")
    return None


def build_followup_email(detail: dict, rating, comments) -> tuple:
    """Return (subject, html_body) for the staff follow-up notification."""
    tnum   = detail.get("ticket_number")
    tlabel = f"#{tnum}" if tnum is not None else "(unknown number)"
    name   = detail.get("name") or "Not provided"
    cemail = detail.get("email") or "Not provided"
    phone  = detail.get("phone") or "Not provided"
    desc   = detail.get("description") or ""
    rating_txt   = f"{rating} of 5" if rating not in (None, "") else "Not provided"
    comments_txt = comments if comments not in (None, "") else "None"

    subject = f"Follow-up requested for {cfg.PROGRAM_NAME} ticket {tlabel}"

    def esc(v):
        return (str(v)
                .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    html = f"""<html><body style="font-family:Arial,sans-serif;color:#222;font-size:14px;">
<div style="background:#003a55;color:#fff;padding:12px 16px;font-size:16px;font-weight:bold;">
{esc(cfg.ORG_NAME)} - {esc(cfg.PROGRAM_NAME)}
</div>
<div style="padding:16px;">
<p>Hello,</p>
<p>A resident asked for a follow-up after completing the satisfaction survey
for a {esc(cfg.PROGRAM_NAME)} ticket you resolved or closed. The details are below so you
can reach out.</p>
<table cellpadding="4" style="border-collapse:collapse;font-size:14px;">
<tr><td style="color:#1f5f7c;font-weight:bold;">Ticket</td><td>{esc(tlabel)}</td></tr>
<tr><td style="color:#1f5f7c;font-weight:bold;">Resident</td><td>{esc(name)}</td></tr>
<tr><td style="color:#1f5f7c;font-weight:bold;">Email</td><td>{esc(cemail)}</td></tr>
<tr><td style="color:#1f5f7c;font-weight:bold;">Phone</td><td>{esc(phone)}</td></tr>
<tr><td style="color:#1f5f7c;font-weight:bold;">Satisfaction</td><td>{esc(rating_txt)}</td></tr>
<tr><td style="color:#1f5f7c;font-weight:bold;vertical-align:top;">Survey comments</td><td>{esc(comments_txt)}</td></tr>
<tr><td style="color:#1f5f7c;font-weight:bold;vertical-align:top;">Original concern</td><td>{esc(desc)}</td></tr>
</table>
<p>Please contact the resident at your earliest convenience.</p>
<p style="color:#888;font-size:12px;">This is an automated message from the {esc(cfg.PROGRAM_NAME)} system. Do not reply to this address.</p>
</div></body></html>"""
    return subject, html


def send_followup_email(recipient: str, subject: str, html_body: str) -> None:
    """Send one follow-up email through the SMTP relay. Raises on failure."""
    ok, error = send_html_email(
        recipient, subject, html_body,
        text_body="This message requires an HTML-capable email client.",
        timeout=30,
    )
    if not ok:
        raise RuntimeError(error)


# ── Notification_Log write (direct SQL, non-versioned table) ──────────────
# Notification_Log has been unregistered from versioning (see
# rac_unversion_notification_log.py), so it is out of Compress entirely. Every
# writer inserts with direct SQL and an explicit OBJECTID = MAX(OBJECTID)+1,
# never an InsertCursor, so no write depends on the SDE row-id counter (which
# the geodatabase does not keep synced) and no two writers reuse an id. A short
# retry absorbs two scripts computing the same MAX+1 at once. Non-fatal: a
# logging failure must never stop the caller. The insert itself lives in
# rac_common.notif_insert(); this wrapper only maps columns.

def log_notification(ticket_id_guid: str, recipient: str, subject: str,
                     status: str, error_msg: str = "") -> None:
    """
    Best-effort audit write to Notification_Log. Introspects the table so it
    only writes to columns that exist, and never raises: a logging failure
    must not block the import or the email. Confirm the column mapping matches
    your Notification_Log schema; adjust SEMANTIC_MAP below if needed.
    """
    clean = ticket_id_guid.strip("{}").upper() if ticket_id_guid else ""
    now_utc = datetime.now(tz=UTC_TZ).replace(tzinfo=None)

    # semantic key -> (candidate column names [first present wins], value)
    SEMANTIC_MAP = {
        "id":        (["notification_id", "log_id", "id"], f"{{{str(uuid.uuid4()).upper()}}}"),
        "ticket":    (["ticket_id"], f"{{{clean}}}" if clean else None),
        "script":    (["script_name", "source", "source_script"], script_name()),
        "recipient": (["recipient_email", "recipient", "to_email", "email"], recipient),
        "type":      (["notification_type", "type", "category"], "FOLLOWUP"),
        "subject":   (["subject", "title"], subject[:255]),
        "message":   (["message", "message_body", "body", "notes"], "Staff follow-up requested via satisfaction survey."),
        "status":    (["send_status", "status"], status),
        "error":     (["error_message", "error", "error_detail"], (error_msg or "")[:500]),
        "date":      (["sent_date", "created_date", "log_date", "timestamp", "notified_date"], now_utc),
    }

    try:
        avail = {f.name.lower(): f.name for f in arcpy.ListFields(cfg.NOTIF_LOG_TABLE)}
    except Exception as exc:
        err(f"Notification_Log not available - skipping audit write: {exc}")
        return

    fields, values = [], []
    for cands, val in SEMANTIC_MAP.values():
        for c in cands:
            if c in avail:
                fields.append(avail[c])
                values.append(val)
                break

    if not fields:
        err("Notification_Log column mapping matched nothing - skipping audit write.")
        return

    notif_insert(fields, values)


def process_followup(rec: dict) -> None:
    """
    For an imported response that answered Yes, find the staff editor email
    and send the follow-up notification. Never raises; failures are logged.
    """
    ticket_id = rec.get("ticket_id", "")
    rating    = rec.get(cfg.SURVEY_RATING_FIELD)
    comments  = rec.get(cfg.SURVEY_COMMENTS_FIELD)

    detail = get_ticket_details(ticket_id)
    if not detail:
        record_failure(f"Follow-up: ticket {ticket_id} not found - cannot notify.")
        log_notification(ticket_id, "", f"Follow-up for ticket {ticket_id}",
                         "TICKET_NOT_FOUND", "Ticket GUID not present in Tickets FC.")
        return

    cleanid = ticket_id.strip("{}").upper()

    # 1. Identify the resolver from the resolve/close STATUS comment, then look
    #    up their email in Enterprise Portal. The editor-tracking field is NOT
    #    used here: automated edits (e.g. survey_sent) overwrite it with a
    #    system value such as ARCSDE after the staff member resolves the ticket.
    recipient = None
    source = ""
    resolver = get_resolver_name(ticket_id)
    if resolver:
        email = resolve_staff_email(resolver)
        if email:
            recipient, source = email, f"resolver {resolver}"
        else:
            err(f"  Could not resolve a Portal email for resolver '{resolver}' on ticket {cleanid}.")
    else:
        err(f"  No STATUS comment found for ticket {cleanid} - cannot identify the resolver.")

    # 2. Fall back to the assigned department's routing email, never the dev.
    if not recipient:
        dept_email = get_department_email(detail.get("assigned_to"))
        if dept_email:
            recipient = dept_email
            source = f"department {detail.get('assigned_to')}"
            log(f"  Resolver email unavailable - falling back to department email for ticket {cleanid}.")

    # 3. Optional configured last resort (empty by default).
    if not recipient and cfg.FOLLOWUP_FALLBACK_EMAIL:
        recipient, source = cfg.FOLLOWUP_FALLBACK_EMAIL, "configured fallback"

    if not recipient:
        record_failure(f"No follow-up recipient for ticket {cleanid} - skipping (will not route to the developer).")
        log_notification(ticket_id, "", f"Follow-up for ticket {cleanid}", "NO_RECIPIENT",
                         "No resolver email and no department routing email.")
        return

    redirect = DEV_MODE or cfg.TESTING_MODE
    actual_recipient = cfg.TESTING_EMAIL if redirect else recipient
    subject, html = build_followup_email(detail, rating, comments)

    try:
        send_followup_email(actual_recipient, subject, html)
        log(f"  Follow-up email sent to {actual_recipient} "
            f"(intended {recipient} via {source}{' [DEV]' if redirect else ''}) for ticket {cleanid}")
        log_notification(ticket_id, actual_recipient, subject, "SUCCESS")
    except Exception as exc:
        record_failure(f"Follow-up email FAILED to {actual_recipient} for ticket {ticket_id}: {exc}")
        log_notification(ticket_id, actual_recipient, subject, "FAILED", str(exc))


# ── SDE helpers ───────────────────────────────────────────────────────────────

def get_existing_ticket_ids() -> set:
    """
    Return the set of ticket_id GUIDs already in Survey_Responses.
    Used to skip duplicates on every run (idempotent).
    """
    existing = set()
    try:
        with arcpy.da.SearchCursor(cfg.SURVEY_RESP_TABLE, ["ticket_id"]) as cur:
            for row in cur:
                if row[0]:
                    existing.add(str(row[0]).strip("{}").upper())
    except Exception as exc:
        err(f"Could not read existing survey responses: {exc}")
    return existing


def get_ticket_objectid(ticket_id_guid: str) -> Optional[int]:
    """
    Look up the OBJECTID of a Ticket by its ticket_id GUID.
    Returns None if not found.
    """
    clean = ticket_id_guid.strip("{}").upper()
    where = f"ticket_id = '{{{clean}}}'"
    try:
        with arcpy.da.SearchCursor(cfg.TICKETS_FC, ["OBJECTID"], where_clause=where) as cur:
            for row in cur:
                return row[0]
    except Exception:
        pass
    return None


def insert_survey_response(rec: dict) -> None:
    """
    Write a single survey response into Survey_Responses.
    Must be called inside an active edit session.

    submitted_date is stored as UTC so the FeatureServer returns the correct
    epoch ms, which the Manager widget then converts to local time for
    display using toLocaleString(..., { timeZone: LOCAL_TIMEZONE }).

    A naive datetime whose numeric value is UTC is exactly what SDE expects
    for DATE fields. Using the local-time variant (datetime.fromtimestamp
    without tz) would silently offset the stored value by the server's UTC
    offset, causing the widget to display the wrong time regardless of any
    client-side timezone conversion.
    """
    fields = [
        "response_id",
        "ticket_id",
        "satisfaction_rating",
        "comments",
        "submitted_date",
        "survey_id",          # populated from AGOL globalid so the Manager can display it
    ]

    # AGOL returns CreationDate as epoch milliseconds (UTC).
    # We need a naive UTC datetime so SDE stores the correct UTC timestamp.
    # datetime.fromtimestamp(..., tz=UTC).replace(tzinfo=None) keeps the value
    # in UTC numerically, the same effect as the deprecated utcfromtimestamp().
    # Do NOT use bare fromtimestamp(): that converts to local time first
    # and corrupts the stored value by the local UTC offset.
    raw_date = rec.get("CreationDate")
    if raw_date:
        submitted_date = datetime.fromtimestamp(raw_date / 1000, tz=UTC_TZ).replace(tzinfo=None)
    else:
        submitted_date = datetime.now(tz=UTC_TZ).replace(tzinfo=None)

    clean_guid = rec["ticket_id"].strip("{}").upper()

    # survey_id: prefer the AGOL globalid (a GUID string); fall back to the
    # integer OBJECTID cast to string. AGOL returns the field name with varying
    # case depending on the service version, so we check both.
    survey_id = (
        rec.get("globalid")
        or rec.get("GlobalID")
        or (str(rec["objectid"]) if rec.get("objectid") is not None else None)
        or (str(rec["OBJECTID"]) if rec.get("OBJECTID") is not None else None)
    )

    row = [
        f"{{{str(uuid.uuid4()).upper()}}}",                     # response_id
        f"{{{clean_guid}}}",                                    # ticket_id
        rec.get(cfg.SURVEY_RATING_FIELD),                       # satisfaction_rating (SHORT 1-5)
        rec.get(cfg.SURVEY_COMMENTS_FIELD),                     # comments
        submitted_date,
        survey_id,                                              # survey_id
    ]

    # staff_followup (SHORT, YesNo domain): only written if the column exists.
    # rec carries the pre-computed value under the reserved key "_followup".
    if survey_resp_has_followup_col():
        fields.append("staff_followup")
        row.append(rec.get("_followup"))

    with arcpy.da.InsertCursor(cfg.SURVEY_RESP_TABLE, fields) as cur:
        cur.insertRow(row)


def test_followup(ticket_number) -> None:
    """Read-only: show who a follow-up for this ticket would go to. No email."""
    log(f"TEST follow-up resolution for ticket #{ticket_number} - no email will be sent")
    tid, assigned = None, None
    try:
        with arcpy.da.SearchCursor(cfg.TICKETS_FC, ["ticket_id", "assigned_to"],
                                   f"ticket_number = {int(ticket_number)}") as cur:
            for r in cur:
                tid, assigned = r[0], r[1]
    except Exception as exc:
        err(f"Ticket lookup failed: {exc}")
        return
    if not tid:
        err(f"Ticket #{ticket_number} not found.")
        return

    resolver = get_resolver_name(tid)
    log(f"  Resolver (latest STATUS comment author): {resolver!r}")
    email = resolve_staff_email(resolver) if resolver else None
    log(f"  Resolved Portal email: {email!r}")
    dept = get_department_email(assigned)
    log(f"  Department fallback ({assigned!r}): {dept!r}")
    chosen = email or dept or (cfg.FOLLOWUP_FALLBACK_EMAIL or None)
    if DEV_MODE or cfg.TESTING_MODE:
        log(f"  Would send to: {cfg.TESTING_EMAIL!r} (DEV/TESTING override; intended {chosen!r})")
    else:
        log(f"  Would send to: {chosen!r}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    log("=" * 60)
    mode = "LIVE"
    if DEV_MODE or cfg.TESTING_MODE:
        mode += " + DEV (follow-up emails routed to " + cfg.TESTING_EMAIL + ")"
    log(f"{cfg.PROGRAM_NAME} Survey Pull - {mode}")

    # Read-only resolution test for a single ticket; imports/sends nothing.
    if TEST_FOLLOWUP_TN:
        test_followup(TEST_FOLLOWUP_TN)
        log("=" * 60)
        return

    # ── 0. Credentials ─────────────────────────────────────────────────────
    if not AGOL_PASSWORD:
        record_failure(
            f"AGOL password unavailable: GIS_SERVICE_PASSWORD is empty or "
            f"rac_secrets.py could not be imported"
            + (f" ({SECRETS_IMPORT_ERROR})" if SECRETS_IMPORT_ERROR else "")
        )
        return

    # ── 1. Authenticate and resolve service URL ────────────────────────────
    try:
        log("Authenticating to ArcGIS Online...")
        token   = get_token()
        svc_url = get_feature_service_url(token)
        log(f"Feature service URL: {svc_url}")
    except Exception as exc:
        record_failure(f"AGOL auth/URL resolution failed: {exc}\n{traceback.format_exc()}")
        return

    # ── 2. Pull responses from Survey123 ──────────────────────────────────
    try:
        log("Querying Survey123 responses...")
        features = query_survey_responses(svc_url, token)
        log(f"Found {len(features)} total responses in Survey123")
    except Exception as exc:
        record_failure(f"Survey query failed: {exc}\n{traceback.format_exc()}")
        return

    if not features:
        log("No responses to process.")
        return

    # ── 3. Filter out already-imported responses ───────────────────────────
    existing = get_existing_ticket_ids()
    log(f"Already in SDE: {len(existing)} responses")

    new_features = []
    for f in features:
        attrs     = f.get("attributes", {})
        ticket_id = attrs.get("ticket_id") or ""
        clean     = ticket_id.strip("{}").upper()

        # Skip responses with no ticket_id or the literal placeholder from
        # an old web designer default value before it was cleared
        if not ticket_id or clean == "${TICKET_ID}" or ticket_id == "${ticket_id}":
            log(f"  Skipping response with invalid ticket_id: '{ticket_id}'")
            continue
        if clean in existing:
            log(f"  Already imported: {clean}")
            continue

        attrs["ticket_id"] = ticket_id

        # Resolve the follow-up answer once, here, and stash it on the record
        # under reserved keys the insert and follow-up steps both read.
        fu_field, fu_val = read_followup(attrs)
        attrs["_followup"] = fu_val
        attrs["_followup_field"] = fu_field

        new_features.append(attrs)

    log(f"New responses to import: {len(new_features)}")

    if not new_features:
        log("Nothing to do.")
        return

    # ── 4. Write new responses to SDE ─────────────────────────────────────
    arcpy.env.workspace = cfg.SDE_CONNECTION
    editor = arcpy.da.Editor(cfg.SDE_CONNECTION)
    editor.startEditing(False, True)
    editor.startOperation()

    imported = 0
    failed   = 0
    imported_recs = []      # records that committed successfully

    try:
        for rec in new_features:
            ticket_id = rec.get("ticket_id", "")
            try:
                insert_survey_response(rec)
                imported += 1
                imported_recs.append(rec)
                log(f"  Imported ticket_id={ticket_id.strip('{}').upper()}  "
                    f"rating={rec.get(cfg.SURVEY_RATING_FIELD)}  "
                    f"follow_up={ {1:'Yes', 0:'No'}.get(rec.get('_followup'), '-') }  "
                    f"survey_id={rec.get('globalid') or rec.get('GlobalID') or rec.get('OBJECTID')}")
            except Exception as exc:
                failed += 1
                record_failure(f"Failed to insert survey response for ticket_id={ticket_id}: {exc}")

        editor.stopOperation()
        editor.stopEditing(True)

    except Exception as exc:
        try:
            editor.stopOperation()
            editor.stopEditing(False)
        except Exception:
            pass
        record_failure(f"Unexpected error - survey import rolled back: {exc}\n{traceback.format_exc()}")
        imported_recs = []      # nothing committed, do not send emails
    finally:
        del editor

    log(f"Done - imported: {imported}, failed: {failed}")

    # ── 5. Send staff follow-up emails for committed Yes responses ─────────
    # Done AFTER the edit session commits so an SMTP failure never rolls back
    # an import, and so we only notify for responses actually written to SDE.
    followups = [r for r in imported_recs if r.get("_followup") == 1]
    if followups:
        log(f"Processing {len(followups)} staff follow-up request(s)...")
        for rec in followups:
            process_followup(rec)
    else:
        log("No staff follow-up requests in this batch.")

    log("=" * 60)


if __name__ == "__main__":
    run(main)
