"""
rac_comments_mailer.py - Report a Concern comment mailer

Queries Ticket_Comments for rows where is_public=1 and email_sent=0, sends a
notification email to the ticket submitter containing the comment type and
comment text, marks email_sent=1 on success, and logs every attempt to
Notification_Log.

Schedule: run every 5-15 minutes (Windows Task Scheduler or cron) with the
ArcGIS Pro / Enterprise Python environment that provides arcpy.

Inputs:
    Tickets feature class        (cfg.TICKETS_FC)   - submitter email, name,
                                                      category, ticket_number,
                                                      status
    Ticket_Comments table        (cfg.COMMENTS_TABLE) - pending public comments
    Notification_Log table       (cfg.NOTIF_LOG_SQL)  - send history / dedupe
    comment_email_template.html  (cfg.TEMPLATE_DIR)   - branded HTML body

Config keys used:
    SDE_CONNECTION, TICKETS_FC, COMMENTS_TABLE, NOTIF_LOG_SQL, STATUS_URL_BASE,
    MAX_BATCH, TESTING_MODE, TESTING_EMAIL, TEMPLATE_DIR, ORG_NAME,
    ORG_ADDRESS, PROGRAM_NAME, SMTP_* and FROM_* (via rac_common),
    ALERT_* (via rac_common)

Read the DEFAULT version, not the base table. New comments added in the
Manager are versioned edits that land in the delta and do not reach the base
table until the next Compress, so a base-table read went blind to fresh
comments and mailed them only after Compress. The pending read and the
email_sent flag both go through the versioned layer (SearchCursor to read,
UpdateCursor to flag, per comment immediately after each successful send), so
new comments are seen at once and the flag is seen by the next read - a
versioned write persists and reads back on this table, confirmed. Per-comment
commits avoid the batch rollback that originally re-sent delivered comments.

The Notification_Log insert uses direct SQL with an explicit OBJECTID = MAX+1
(the table is non-versioned; see write_notification_log), so it does not
depend on the SDE row-id counter.

Usage:
    python rac_comments_mailer.py
    python rac_comments_mailer.py --dry-run

TESTING MODE
  cfg.TESTING_MODE = True  -> ALL emails route to cfg.TESTING_EMAIL (emails are
                              still sent; safe to run during development)
  cfg.TESTING_MODE = False -> emails route to real ticket submitters (go-live)
  --dry-run                -> simulate only; no email sent, no SDE writes

Behavior notes:
    - Failure alerts: every failure in a run (query, send, flag update,
      Notification_Log write, unhandled exception) is collected and emailed
      once at exit to ALERT_RECIPIENTS (see rac_common). Exit code is 1 when
      any failure was recorded. There is no log file; the failure email
      replaces it.
"""

import arcpy
import sys
import uuid
import traceback
from datetime import datetime
from typing   import Tuple

from rac_common import (cfg, log, err, record_failure, run,
                        utc_naive_to_local_naive, render_template,
                        send_html_email, resolve_recipient, notif_insert,
                        notif_scalar, set_script_name, script_name)
from categories import CATEGORY_LABELS, STATUS_LABELS, COMMENT_TYPE_LABELS

# Notification_Log rows and the dedupe query below are keyed on this exact
# script_name (singular "comment"); keep it so historical rows still match.
set_script_name("rac_comment_mailer.py")

# ── Configuration ────────────────────────────────────────────────────────────

# Public status page (submit widget) deep-link base. The citizen opens
# ?ticket=<ticket_number> to view status, staff comments, and any photos
# staff attached to public comments. Trailing slash required before ?.
STATUS_URL_BASE = cfg.STATUS_URL_BASE

# Maximum comments to process per run (prevents runaway on large backlogs)
MAX_BATCH = cfg.MAX_BATCH

# Set True to simulate without sending email or writing to SDE
DRY_RUN = "--dry-run" in sys.argv

TEMPLATE_FILE = "comment_email_template.html"

# ── Email body builder ───────────────────────────────────────────────────────

def label_for_type(code):
    """Return a human-readable label for a CommentType domain code."""
    if not code:
        return "Update"
    return COMMENT_TYPE_LABELS.get(code.upper(), code.title())


def _ticket_url(rec: dict) -> str:
    """Deep link to this ticket's public status page. Falls back to the
    bare status page if the number is somehow missing."""
    return (f"{STATUS_URL_BASE}?ticket={rec.get('ticket_number')}"
            if rec.get("ticket_number") else STATUS_URL_BASE)


def build_email_body(rec: dict) -> str:
    """
    Load the HTML template and substitute comment/ticket field values.
    Falls back to plain text if the template file cannot be read.
    """
    def fmt_date(ts):
        """
        Format a comment timestamp for display.

        SDE returns naive UTC datetimes from cursors. Convert to local before
        formatting so citizens see the time their comment was actually posted,
        not the UTC value.
        """
        if not ts:
            return "-"
        try:
            if isinstance(ts, (int, float)):
                ts = datetime.fromtimestamp(ts / 1000)
            if isinstance(ts, datetime) and ts.tzinfo is None:
                ts = utc_naive_to_local_naive(ts)
            return ts.strftime("%B %d, %Y at %I:%M %p")
        except Exception:
            return str(ts)

    # For Status Update comments, include the new status in a prominent line
    comment_type_upper = str(rec.get("comment_type") or "").upper()
    if comment_type_upper == "STATUS":
        status_label = STATUS_LABELS.get(rec.get("status"), "-")
        status_line = f'<p style="font-size:14px;line-height:22px;"><strong>New Status:</strong> {status_label}</p>'
    else:
        status_line = ""

    subs = {
        "{Name_req}":            rec.get("name") or "Resident",
        # ticket_number is the human-readable integer field (e.g. 1042).
        # ticket_id GUID is never passed to the template.
        "{ticket_number}":       str(rec.get("ticket_number") or "-"),
        "{ticket_url}":          _ticket_url(rec),
        "{category_label}":      CATEGORY_LABELS.get(rec.get("category"), "Service Request"),
        "{comment_type_label}":  label_for_type(rec.get("comment_type")),
        "{comment_text}":        rec.get("comment_text") or "",
        "{comment_author}":      rec.get("author") or "Staff",
        "{comment_date}":        fmt_date(rec.get("created_date")),
        "{status_label}":        STATUS_LABELS.get(rec.get("status"), "-"),
        "{status_line}":         status_line,
    }

    html = render_template(TEMPLATE_FILE, subs)
    if html is None:
        # render_template already recorded the failure; degrade to plain text
        return build_text_fallback(rec)
    return html


def build_text_fallback(rec: dict) -> str:
    """Plain-text version included as multipart/alternative for non-HTML clients."""
    status_line = ""
    if (rec.get("comment_type") or "").upper() == "STATUS":
        status_line = f"New Status: {STATUS_LABELS.get(rec.get('status'), '-')}\n"

    return (
        f"You have a new update on your {cfg.ORG_NAME} service request.\n\n"
        f"Ticket Number: {rec.get('ticket_number', '-')}\n"
        f"Category: {CATEGORY_LABELS.get(rec.get('category'), 'Service Request')}\n"
        f"Update Type: {label_for_type(rec.get('comment_type'))}\n"
        f"{status_line}"
        f"From: {rec.get('author') or 'Staff'}\n\n"
        f"{rec.get('comment_text', '')}\n\n"
        f"View your request status: {_ticket_url(rec)}\n\n"
        f"This is an automated message from the {cfg.ORG_NAME} {cfg.PROGRAM_NAME} system.\n"
        "Please do not reply to this email.\n\n"
        f"{cfg.ORG_NAME}\n"
        f"{cfg.ORG_ADDRESS}"
    )

# ── Email send ───────────────────────────────────────────────────────────────

def send_email(rec: dict) -> Tuple[bool, str]:
    """
    Send the branded HTML comment notification through the SMTP relay.
    In TESTING_MODE all messages deliver to cfg.TESTING_EMAIL.
    Returns (success: bool, error_message: str).
    """
    to_addr = resolve_recipient(rec["email"])
    subject = f"Update on Your Service Request - Ticket #{rec.get('ticket_number', '')}"
    if cfg.TESTING_MODE:
        subject = f"[TEST - intended for {rec['email']}] {subject}"

    return send_html_email(to_addr, subject, build_email_body(rec),
                           text_body=build_text_fallback(rec))

# ── SDE helpers ───────────────────────────────────────────────────────────────

# Ticket_Comments is read (SearchCursor) and flagged (UpdateCursor) through the
# versioned DEFAULT layer so new delta comments are seen immediately.
COMMENTS_FC = cfg.COMMENTS_TABLE        # SearchCursor / UpdateCursor


def already_commented(comment_id: str) -> bool:
    """
    True if a SUCCESS row already exists in Notification_Log for THIS comment
    (matched on comment_id - not ticket, since a ticket legitimately has many
    comments). No schema change: on a SUCCESS row the comment id is stashed in
    the otherwise-empty error_message as 'CID:<guid>', and matched here with a
    LIKE. Notification_Log is the non-versioned source of truth for what went
    out, so this gate prevents a duplicate even when the versioned email_sent
    flag is slow to persist. Fails open on error so a lookup problem never
    blocks a legitimate first send.
    """
    cid = str(comment_id).strip("{}").upper() if comment_id else ""
    if not cid:
        return False
    sql = (
        f"SELECT COUNT(*) FROM {cfg.NOTIF_LOG_SQL} "
        f"WHERE script_name = '{script_name()}' AND send_status = 'SUCCESS' "
        f"AND CAST(error_message AS VARCHAR(600)) LIKE 'CID:{cid}%'"
    )
    try:
        v = notif_scalar(sql)
        return bool(v and int(v) > 0)
    except Exception as exc:
        err(f"  comment dedup check failed for {comment_id} (not blocking send): {exc}")
        return False


def write_notification_log(ticket_id: str, recipient: str, subject: str,
                           status: str, error_msg: str = "", comment_id: str = None) -> None:
    """Insert a row into Notification_Log via direct SQL (OBJECTID=MAX+1).
    The table is non-versioned; see rac_common.notif_insert. No schema change
    for the dedup guard: on SUCCESS the comment id is tagged into error_message
    as 'CID:<guid>' (that field is otherwise empty on success); on FAILED the
    real error text is kept as normal. Non-fatal."""
    if status == "SUCCESS":
        cid = str(comment_id).strip("{}").upper() if comment_id else ""
        err_val = f"CID:{cid}" if cid else None
    else:
        err_val = error_msg[:500] if error_msg else None
    cols = ["log_id", "ticket_id", "script_name", "recipient_email",
            "email_subject", "send_status", "error_message", "sent_date", "retry_count"]
    vals = ["{" + str(uuid.uuid4()).upper() + "}", ticket_id, script_name(), recipient,
            subject, status, err_val, datetime.now(), 0]
    notif_insert(cols, vals)


def mark_email_sent(oid: int) -> bool:
    """
    Set email_sent = 1 on a single comment OBJECTID through a short versioned
    edit session (DEFAULT - the same layer the pending read uses, so the next
    read sees the flag and the comment is not re-sent). Called per comment
    immediately after a successful send, in its own commit, so a failure on one
    comment can never roll back or re-send another. Returns True on success; on
    failure the comment stays unset and is retried next run.
    """
    editor = None
    try:
        editor = arcpy.da.Editor(cfg.SDE_CONNECTION)
        editor.startEditing(False, True)
        editor.startOperation()
        with arcpy.da.UpdateCursor(COMMENTS_FC, ["email_sent"],
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
        record_failure(f"email_sent UPDATE failed on OID {oid}: {exc}")
        return False
    finally:
        if editor:
            del editor

# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    log("=" * 60)
    if DRY_RUN:
        log("Comment Mailer - DRY RUN")
    elif cfg.TESTING_MODE:
        log(f"Comment Mailer - TESTING MODE (all email -> {cfg.TESTING_EMAIL})")
    else:
        log("Comment Mailer - LIVE")

    arcpy.env.workspace = cfg.SDE_CONNECTION

    # ── 1. Build ticket lookup (email, category, display number) ──────────
    # ticket_number is the human-readable integer field on Tickets.
    # ticket_id GUID is the foreign key used for all SDE/log operations.
    log("Loading ticket lookup...")
    ticket_lookup = {}
    try:
        fields = ["ticket_id", "submitted_by_email", "submitted_by_name",
                  "category", "ticket_number", "status"]
        with arcpy.da.SearchCursor(cfg.TICKETS_FC, fields) as cur:
            for ticket_id, email, name, category, ticket_number, status in cur:
                if ticket_id:
                    key = str(ticket_id).upper().strip("{}")
                    ticket_lookup[key] = {
                        "email":         email,
                        "name":          name,
                        "category":      category,
                        "ticket_number": ticket_number,
                        "status":        status,
                    }
        log(f"  Loaded {len(ticket_lookup)} tickets.")
    except Exception as exc:
        record_failure(f"Ticket lookup failed: {exc}\n{traceback.format_exc()}")
        return

    # ── 2. Find pending public comments (versioned SearchCursor) ──────────
    # Reading the versioned feature class (DEFAULT) rather than the base table
    # is what removes the Compress delay: a comment added in the Manager lands
    # in the DEFAULT delta and is visible here at once, whereas the base table
    # would not show it until the next Compress. SearchCursor binds
    # uniqueidentifier and long-text columns natively (no CAST, no ArcSDE -65).
    comment_fields = ["OBJECTID", "comment_id", "ticket_id",
                      "comment_text", "comment_type", "author", "created_date"]
    where = "is_public = 1 AND (email_sent = 0 OR email_sent IS NULL)"
    candidates = []
    try:
        with arcpy.da.SearchCursor(COMMENTS_FC, comment_fields,
                                   where_clause=where) as cur:
            for oid, cid, tid, text, ctype, author, cdate in cur:
                candidates.append({
                    "oid":          oid,
                    "comment_id":   str(cid).upper().strip("{}") if cid else None,
                    "ticket_id":    str(tid).upper().strip("{}") if tid else None,
                    "comment_text": text,
                    "comment_type": ctype,
                    "author":       author,
                    "created_date": cdate,
                })
                if len(candidates) >= MAX_BATCH:
                    break
    except Exception as exc:
        record_failure(f"Query failed: {exc}\n{traceback.format_exc()}")
        return

    log(f"Found {len(candidates)} pending comment(s) (batch limit: {MAX_BATCH})")
    batch = candidates

    if not batch:
        log("Nothing to do.")
        return

    sent   = 0
    failed = 0

    # ── 3. Send, then flag each comment individually ──────────────────────
    for comment in batch:
        oid        = comment["oid"]
        ticket_key = comment["ticket_id"]

        # Look up parent ticket info
        ticket_info = ticket_lookup.get(ticket_key) if ticket_key else None
        if not ticket_info:
            record_failure(f"Comment OID {oid}: No matching ticket for ticket_id {ticket_key} - skipping.")
            failed += 1
            continue

        to_email = ticket_info["email"]
        if not to_email:
            log(f"  OID {oid}: Ticket #{ticket_info['ticket_number']} has no submitter email - skipping.")
            failed += 1
            continue

        # Merge ticket info into the comment record for template substitution.
        # ticket_number is the display value; ticket_id GUID flows through for
        # internal logging only and is never passed to the HTML template.
        rec = {
            **comment,
            "email":         to_email,
            "name":          ticket_info.get("name") or "Resident",
            "ticket_number": ticket_info["ticket_number"],
            "category":      ticket_info["category"],
            "status":        ticket_info["status"],
        }

        subject = f"Update on Your Service Request - Ticket #{ticket_info['ticket_number']}"
        log(f"  Comment OID {oid:>6}  (Ticket #{ticket_info['ticket_number']})  ->  {to_email}  [{label_for_type(comment['comment_type'])}]")

        if DRY_RUN:
            log(f"    [DRY RUN] Would send to {to_email}")
            continue

        # Duplicate guard: Notification_Log is the non-versioned record of what
        # actually went out. If this specific comment already succeeded, do not
        # send again even if the versioned email_sent flag failed to persist.
        # Keyed on comment_id, so other comments on the same ticket still send.
        if already_commented(comment["comment_id"]):
            log(f"    Already sent (Notification_Log) - skipping; healing email_sent")
            mark_email_sent(oid)
            continue

        success, error_msg = send_email(rec)
        status = "SUCCESS" if success else "FAILED"

        if success:
            # Flag immediately, in its own commit. This is the primary stop; the
            # Notification_Log guard above is the backstop when it doesn't stick.
            if not mark_email_sent(oid):
                record_failure(f"Sent but could not set email_sent on OID {oid} - guard will catch any re-send")
            write_notification_log(ticket_key, to_email, subject, status, error_msg,
                                   comment_id=comment["comment_id"])
            sent += 1
            log(f"    Sent OK")
        else:
            write_notification_log(ticket_key, to_email, subject, status, error_msg,
                                   comment_id=comment["comment_id"])
            failed += 1
            record_failure(f"Send failed for comment OID {oid} (Ticket #{ticket_info['ticket_number']}) to {to_email}: {error_msg}")

    log(f"Done - sent: {sent}, failed: {failed}")
    log("=" * 60)


if __name__ == "__main__":
    run(main)
