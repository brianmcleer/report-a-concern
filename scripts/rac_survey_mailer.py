"""
rac_survey_mailer.py - Report a Concern satisfaction survey mailer

What it does
    Queries the Tickets feature class for resolved tickets that have not yet
    received a survey email (status IN (4,5), survey_sent=0), sends a
    satisfaction survey invitation to each submitter, marks survey_sent=1 on
    success, and logs every attempt to the Notification_Log table.

Schedule
    Run every 15-30 minutes from Task Scheduler (or cron) with the ArcGIS Pro
    Python environment (arcpy is required).

Inputs
    Tickets feature class (versioned, DEFAULT version): eligibility read and
    survey_sent flag write.
    Ticket_Comments table: latest RESOLUTION comment text for the email body.
    Notification_Log table: dedupe backstop and send audit trail.
    Template: survey_email_template.html in cfg.TEMPLATE_DIR.

Config keys (config.py)
    SDE_CONNECTION, TICKETS_FC, COMMENTS_TABLE, NOTIF_LOG_SQL,
    SURVEY_BASE_URL, MAX_BATCH, SMTP_HOST, SMTP_PORT, FROM_ADDR, FROM_NAME,
    ALERT_RECIPIENTS, ALERT_FROM, TEMPLATE_DIR, ORG_* branding tokens.

Why the versioned layer is read, not the base table
    Tickets is a healthy versioned feature class (versioning on, archiving
    off). When staff resolve a ticket in the Manager widget, that edit lands
    in the versioned delta tables for DEFAULT and does NOT reach the base
    business table until the next Compress. Reading the base table directly
    (ArcSDESQLExecute) therefore could not see a resolution until Compress
    ran, so surveys went out a full Compress cycle late. This mailer reads
    eligibility through a versioned SearchCursor and writes survey_sent
    through a versioned UpdateCursor, per ticket, immediately after each
    successful send, the same layer the notify and reassign scripts use.
    A versioned read sees the delta at once (no delay) and sees the flag this
    script just wrote (no re-send), and per-ticket commits avoid the batch
    rollback that would otherwise re-send an already-delivered survey.

    Notification_Log is inserted via direct SQL with an explicit
    OBJECTID = MAX+1 (the table is non-versioned; see rac_common.notif_insert).

Behavior notes
    - Every failure in a run (query, send, flag update, Notification_Log
      write, unhandled exception) is collected and emailed once at exit to
      ALERT_RECIPIENTS (see rac_common). Exit code is 1 when any failure was
      recorded. There is no log file; the failure email replaces it.

Usage:
    python rac_survey_mailer.py
    python rac_survey_mailer.py --dry-run
"""

import arcpy
import uuid
import sys
import traceback
from datetime import datetime
from typing   import Optional, Tuple

from rac_common import (cfg, log, err, record_failure, run,
                        utc_naive_to_local_naive, render_template,
                        send_html_email, resolve_recipient, notif_insert, notif_scalar,
                        set_script_name, script_name)
from categories import CATEGORY_LABELS

set_script_name("rac_survey_mailer.py")

# ── Configuration ────────────────────────────────────────────────────────────

EMAIL_SUBJECT = "How did we do? - Your Service Request Has Been Resolved"
TEMPLATE_FILE = "survey_email_template.html"

# Set True to simulate without sending email or writing to SDE
DRY_RUN = "--dry-run" in sys.argv

# ── Helpers ──────────────────────────────────────────────────────────────────

def get_resolution_text(ticket_id: str) -> Optional[str]:
    """
    Return the most recent RESOLUTION comment text for a ticket, or None.

    Per project schema, staff record resolutions in Ticket_Comments with
    comment_type='RESOLUTION' rather than in the Tickets.internal_notes
    field, so this is where the citizen-facing resolution text lives.

    Wrapped in try/except - a lookup failure should never block the survey
    send, just fall back to internal_notes or "-" in the template.
    """
    if not ticket_id:
        return None
    # SDE stores GUIDs with curly braces; match the same format in WHERE.
    tid = str(ticket_id).strip("{}").upper()
    # Build a where clause that matches with or without braces and any case.
    where = (
        "comment_type = 'RESOLUTION' "
        f"AND UPPER(REPLACE(REPLACE(CAST(ticket_id AS VARCHAR(50)), '{{', ''), '}}', '')) = '{tid}'"
    )
    latest_text = None
    latest_dt   = None
    try:
        with arcpy.da.SearchCursor(
            cfg.COMMENTS_TABLE,
            ["comment_text", "created_date"],
            where_clause=where,
        ) as cur:
            for text, dt in cur:
                if latest_dt is None or (dt and dt > latest_dt):
                    latest_text = text
                    latest_dt   = dt
    except Exception as exc:
        err(f"  Resolution lookup failed for {ticket_id}: {exc}")
    return latest_text

# ── Email body builder ───────────────────────────────────────────────────────

def build_email_body(rec: dict, survey_link: str) -> str:
    """
    Load the HTML template and substitute ticket field values.
    Falls back to plain text if the template file cannot be read.
    """
    def fmt_date(ts):
        """Format a date for citizen-facing display in local time."""
        if not ts:
            return "-"
        try:
            if isinstance(ts, (int, float)):
                ts = datetime.fromtimestamp(ts / 1000)
            if isinstance(ts, datetime):
                # SDE returns naive UTC datetimes from cursors. Convert to
                # local before display so created/resolved dates near
                # midnight don't appear to roll over to the next day.
                if ts.tzinfo is None:
                    ts = utc_naive_to_local_naive(ts)
                return ts.strftime("%B %d, %Y")
            return str(ts)
        except Exception:
            return str(ts)

    # Resolution text: prefer the latest RESOLUTION comment from Ticket_Comments
    # (where staff actually record citizen-facing resolutions per project schema).
    # Fall back to internal_notes for legacy/migrated tickets that may have it
    # populated there, and finally to a dash if neither is available.
    resolution_text = (
        rec.get("resolution_text")
        or rec.get("internal_notes")
        or "-"
    )

    subs = {
        "submitted_by_name": rec.get("submitted_by_name") or "Resident",
        # ticket_number is the human-readable display integer (e.g. 1042).
        # ticket_id GUID is never passed to the template - it flows only to
        # the survey_link URL parameter.
        "ticket_number":     str(rec.get("ticket_number") or "-"),
        "category":          CATEGORY_LABELS.get(rec.get("category"), "General"),
        "description":       rec.get("description") or "-",
        "created_date":      fmt_date(rec.get("created_date")),
        "resolved_date":     fmt_date(rec.get("resolved_date")),
        "resolution":        resolution_text,
        "survey_link":       survey_link,
    }

    # Organization tokens ({org_name}, {org_address}, ...) are injected by
    # rac_common.render_template.
    html = render_template(TEMPLATE_FILE, subs)
    if html is None:
        # render_template already recorded the failure.
        return build_text_fallback(rec, survey_link)
    return html


def build_text_fallback(rec: dict, survey_link: str) -> str:
    """Plain-text version included as multipart/alternative for non-HTML clients."""
    name = (rec.get("submitted_by_name") or "Resident").split()[0]
    return (
        f"Hi {name},\n\n"
        "Your service request has been resolved.\n\n"
        "We'd appreciate a moment of your time to rate your experience:\n"
        f"{survey_link}\n\n"
        "Thank you,\n"
        f"{cfg.ORG_NAME}\n"
        f"{cfg.ORG_ADDRESS}"
    )

# ── Email send ───────────────────────────────────────────────────────────────

def send_email(rec: dict, survey_link: str) -> Tuple[bool, str]:
    """
    Send the branded HTML survey invitation through the SMTP relay.
    Returns (success: bool, error_message: str).
    """
    # TESTING_MODE redirects the citizen-facing invitation to TESTING_EMAIL.
    return send_html_email(
        resolve_recipient(rec["email"]),
        EMAIL_SUBJECT,
        build_email_body(rec, survey_link),
        text_body=build_text_fallback(rec, survey_link),
    )

# ── Notification_Log helpers (direct SQL, non-versioned table) ───────────────
# Notification_Log is unregistered from versioning, so it is out of Compress
# entirely. Every writer inserts with direct SQL and an explicit
# OBJECTID = MAX(OBJECTID)+1, never an InsertCursor, so no write depends on
# the SDE row-id counter and no two writers reuse an id (see rac_common).

def already_surveyed(ticket_id: str) -> bool:
    """
    True if a SUCCESS survey row already exists in Notification_Log for this
    ticket. Notification_Log is the non-versioned source of truth for what was
    actually sent, so this gate prevents a duplicate survey even when the
    versioned survey_sent flag is slow or unreliable to persist. Matches the
    GUID braced or unbraced. Fails open (returns False) on error so a transient
    lookup problem never blocks a legitimate first send; the survey_sent flag
    remains the primary stop and this is the backstop.
    """
    tid = str(ticket_id).strip("{}").upper() if ticket_id else ""
    if not tid:
        return False
    sql = (
        f"SELECT COUNT(*) FROM {cfg.NOTIF_LOG_SQL} "
        f"WHERE script_name = '{script_name()}' AND send_status = 'SUCCESS' "
        "AND UPPER(REPLACE(REPLACE(CAST(ticket_id AS VARCHAR(50)), '{', ''), '}', '')) = "
        f"'{tid}'"
    )
    try:
        v = notif_scalar(sql)
        return bool(v and int(v) > 0)
    except Exception as exc:
        err(f"  survey dedup check failed for {ticket_id} (not blocking send): {exc}")
        return False


def write_notification_log(ticket_id: str, recipient: str, status: str,
                           error_msg: str = "") -> None:
    """Insert a row into Notification_Log via direct SQL (OBJECTID=MAX+1).
    The table is non-versioned; see rac_common.notif_insert. Non-fatal."""
    cols = ["log_id", "ticket_id", "script_name", "recipient_email",
            "email_subject", "send_status", "error_message", "sent_date", "retry_count"]
    vals = ["{" + str(uuid.uuid4()).upper() + "}", ticket_id, script_name(), recipient,
            EMAIL_SUBJECT, status, (error_msg[:500] if error_msg else None),
            datetime.now(), 0]
    notif_insert(cols, vals)


def mark_survey_sent(oid: int) -> bool:
    """
    Set survey_sent = 1 on a single ticket OBJECTID through a short versioned
    edit session. Written to the DEFAULT version (same layer the eligibility
    read uses), so the next run's read sees it and the ticket is not re-sent.
    Called per ticket immediately after a successful send, in its own commit,
    so a failure on one ticket can never roll back or re-send another. Returns
    True on success; on failure the ticket stays survey_sent = 0 and is retried
    next run.
    """
    editor = None
    try:
        editor = arcpy.da.Editor(cfg.SDE_CONNECTION)
        editor.startEditing(False, True)
        editor.startOperation()
        with arcpy.da.UpdateCursor(cfg.TICKETS_FC, ["survey_sent"],
                                   where_clause=f"OBJECTID = {int(oid)}") as cur:
            for row in cur:
                row[0] = 1
                cur.updateRow(row)
        editor.stopOperation()
        editor.stopEditing(True)
        return True
    except Exception as exc:
        try:
            if editor:
                editor.stopOperation()
                editor.stopEditing(False)
        except Exception:
            pass
        record_failure(f"survey_sent UPDATE failed on OID {oid}: {exc}")
        return False
    finally:
        if editor:
            del editor

# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    log("=" * 60)
    log(f"Survey Mailer - {'DRY RUN' if DRY_RUN else 'LIVE'}")

    arcpy.env.workspace = cfg.SDE_CONNECTION

    # ── 1. Find resolved tickets awaiting survey (versioned SearchCursor) ──
    # Reading the versioned feature class (DEFAULT version) instead of the base
    # table is what removes the Compress-cycle delay: a Manager-widget
    # resolution lands in the DEFAULT delta immediately and is visible here at
    # once, whereas the base table would not show it until the next Compress.
    # ticket_number: human-readable display integer shown in the email body.
    # ticket_id:     GUID used for the survey_link URL param and the
    #                Notification_Log foreign key - never displayed to the public.
    fields = [
        "OBJECTID", "ticket_id", "ticket_number",
        "submitted_by_name", "submitted_by_email",
        "category", "description", "created_date", "resolved_date", "internal_notes",
    ]
    where = (
        "status IN (4, 5) AND survey_sent = 0 "
        "AND submitted_by_email IS NOT NULL AND submitted_by_email <> ''"
    )

    candidates = []
    try:
        with arcpy.da.SearchCursor(cfg.TICKETS_FC, fields, where_clause=where) as cur:
            for oid, tid, tnum, name, email, cat, desc, created, resolved, notes in cur:
                candidates.append({
                    "oid":               oid,
                    "ticket_id":         tid,       # GUID - internal use only
                    "ticket_number":     tnum,      # display integer shown in email
                    "name":              name or "",
                    "email":             email,
                    "category":          cat,
                    "description":       desc,
                    "created_date":      created,
                    "resolved_date":     resolved,
                    "internal_notes":    notes,
                    "submitted_by_name": name or "",
                })
                if len(candidates) >= cfg.MAX_BATCH:
                    break
    except Exception as exc:
        record_failure(f"Query failed: {exc}\n{traceback.format_exc()}")
        return

    log(f"Found {len(candidates)} eligible tickets (batch limit: {cfg.MAX_BATCH})")
    batch = candidates

    if not batch:
        log("Nothing to do.")
        return

    sent   = 0
    failed = 0

    # ── 2. Send, then flag each ticket individually ───────────────────────
    for rec in batch:
        oid       = rec["oid"]
        ticket_id = rec["ticket_id"]
        to_email  = rec["email"]

        # Latest RESOLUTION comment text for the email body (non-critical read).
        rec["resolution_text"] = get_resolution_text(ticket_id)

        # Strip SDE curly braces from GUID so the URL is clean.
        # Survey123 web forms use ?field:fieldname=value syntax.
        clean_guid  = str(ticket_id).strip("{}").upper()
        survey_link = f"{cfg.SURVEY_BASE_URL}?field:ticket_id={clean_guid}"

        log(f"  Ticket OID {oid:>6}  (Ticket #{rec['ticket_number']})  ->  {to_email}")

        if DRY_RUN:
            log(f"    [DRY RUN] Would send to {to_email}  link: {survey_link}")
            continue

        # Duplicate guard: Notification_Log is the non-versioned record of what
        # actually went out. The versioned survey_sent flag can persist slowly
        # or unreliably on this geodatabase, which let a few surveys re-send on
        # a later cycle. Gating the send on a prior SUCCESS row here makes a
        # repeat impossible regardless of the flag, and we heal the flag so the
        # ticket drops out of future reads.
        if already_surveyed(ticket_id):
            log("    Already surveyed (Notification_Log SUCCESS) - skipping; healing survey_sent")
            mark_survey_sent(oid)
            continue

        success, error_msg = send_email(rec, survey_link)
        status = "SUCCESS" if success else "FAILED"

        if success:
            # Flag immediately, in its own commit. This is the primary stop; the
            # Notification_Log guard above is the backstop when it doesn't stick.
            if not mark_survey_sent(oid):
                record_failure(f"Sent but could not set survey_sent on OID {oid} - guard will catch any re-send")
            write_notification_log(ticket_id, to_email, status, error_msg)
            sent += 1
            log("    Sent OK")
        else:
            write_notification_log(ticket_id, to_email, status, error_msg)
            failed += 1
            record_failure(f"Send failed for Ticket #{rec['ticket_number']} (OID {oid}) to {to_email}: {error_msg}")

    log(f"Done - sent: {sent}, failed: {failed}")
    log("=" * 60)


if __name__ == "__main__":
    run(main)
