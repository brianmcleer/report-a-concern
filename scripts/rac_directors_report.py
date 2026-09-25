"""
rac_directors_report.py - Directors overdue ticket report

Reads the Tickets feature class straight from the Report a Concern
enterprise geodatabase and emails each configured director a report of
the overdue tickets in the categories they oversee. One email per
director; directors with nothing overdue are skipped (and the skip is
logged to Notification_Log).

Schedule: weekdays at noon (Task Scheduler or cron), ArcGIS Pro python.

Inputs
------
  cfg.TICKETS_FC        Tickets feature class (read only)
  cfg.NOTIF_LOG_TABLE   Notification_Log (one row per director per run)
  email_template_directors.html in cfg.TEMPLATE_DIR

Config keys
-----------
  DIRECTOR_DICT          recipient email -> list of category codes
  THRESHOLD_OPEN         still Open        past this age after creation
  THRESHOLD_RECEIVED     still Received    past this age after creation
  THRESHOLD_IN_PROGRESS  still In Progress past this age after creation
  MANAGER_URL            staff app; ticket IDs deep link to it
  TESTING_MODE / TESTING_EMAIL, SMTP_*, FROM_*, SDE_CONNECTION, TEMPLATE_DIR

Buckets
-------
  Open, Received, In Progress: still in that status past the threshold
  No Res Date: Resolved or Closed but resolved_date is NULL

Note: a "no resolution text" bucket previously checked internal_notes for
empty values, but staff record resolutions in Ticket_Comments
(comment_type='RESOLUTION') rather than internal_notes, so the check
produced false positives on every new ticket. Resolution-text quality is
reviewed in the Manager app instead of this report.

Testing mode
------------
  cfg.TESTING_MODE = True   every email routes to cfg.TESTING_EMAIL; the
                            subject is annotated with the intended director
  cfg.TESTING_MODE = False  emails go to the real director addresses

Behavior notes
--------------
  - Every failure in a run (missing path, geodatabase load, template, send,
    Notification_Log write, unhandled exception) is collected and emailed
    once at exit by rac_common. Exit code is 1 when any failure was recorded.
"""

import arcpy
import os
import sys
import uuid
from datetime import datetime

from rac_common import (cfg, log, record_failure, run,
    utc_naive_to_local_naive, render_template, template_path,
    send_html_email, resolve_recipient, notif_insert, NO_TICKET_GUID,
    set_script_name, script_name)
from categories import CATEGORY_LABELS, STATUS_LABELS

set_script_name("rac_directors_report.py")

TEMPLATE_FILE = "email_template_directors.html"

# ── Field Names ───────────────────────────────────────────────────────────────
# These match the schema defined during the geodatabase build-out.
# Update here if any field names change in the geodatabase - nowhere else.
F_OID         = "OBJECTID"
F_TICKET_NUM  = "ticket_number"     # human-readable ID shown in emails
F_STATUS      = "status"
F_SUBMITTED   = "created_date"      # pure data field (not editor tracking)
F_ASSIGNED_TO = "assigned_to"
F_CATEGORY    = "category"          # subtype integer; label resolved via CATEGORY_LABELS
F_SUBCATEGORY = "subcategory"
F_RESOLVED_DT = "resolved_date"

# Status coded values - match the geodatabase domain
STATUS_OPEN        = 1
STATUS_RECEIVED    = 2
STATUS_IN_PROGRESS = 3
STATUS_RESOLVED    = 4
STATUS_CLOSED      = 5

# Terminal statuses - tickets in either state are excluded from overdue age
# buckets but checked for a missing resolution date.
TERMINAL_STATUSES = {STATUS_RESOLVED, STATUS_CLOSED}

# ── Notification_Log writer ───────────────────────────────────────────────────

def write_notification_log(
    ticket_id:     str,
    recipient:     str,
    event_type:    str,
    send_status:   str,
    error_msg:     str = None,
):
    """
    Insert one row into Notification_Log.

    Field repurposing for director-report entries:
      recipient_email -> director email (the configured address, even when
                         TESTING_MODE redirected the actual delivery)
      email_subject   -> event type ('directors_report:SENT', etc.)
      send_status     -> SUCCESS / FAILED / SKIPPED
      ticket_id       -> sentinel NO_TICKET_GUID (report covers many tickets)

    Failures here are swallowed by notif_insert - we never want the report
    to fail because of a logging side-effect.
    """
    log_id      = f"{{{str(uuid.uuid4()).upper()}}}"
    sent_date   = datetime.now()
    error_trunc = error_msg[:500] if error_msg else None

    cols = [
        "log_id", "ticket_id", "script_name", "recipient_email",
        "email_subject", "send_status", "error_message", "sent_date",
        "retry_count",
    ]
    vals = [
        log_id, ticket_id, script_name(), recipient,
        event_type, send_status, error_trunc, sent_date,
        0,
    ]
    notif_insert(cols, vals)

# ── Data Layer ────────────────────────────────────────────────────────────────

def load_all_tickets() -> list:
    """
    Pull all tickets from the geodatabase into a list of dicts. Only the
    fields required for overdue analysis are fetched.

    created_date and resolved_date come back from the geodatabase as naive
    UTC; both are converted to naive local datetimes here so all downstream
    comparisons use a single timezone.
    """
    fields = [
        F_OID, F_TICKET_NUM, F_STATUS, F_SUBMITTED, F_ASSIGNED_TO,
        F_CATEGORY, F_SUBCATEGORY, F_RESOLVED_DT
    ]
    rows = []
    with arcpy.da.SearchCursor(cfg.TICKETS_FC, fields) as cur:
        for row in cur:
            rows.append({
                "oid":         row[0],
                "ticket_num":  row[1],
                "status":      row[2],
                "submitted":   utc_naive_to_local_naive(row[3]),
                "assigned_to": row[4],
                "category":    row[5],   # raw SHORT integer; resolved to label at render time
                "subcategory": row[6],
                "resolved_dt": utc_naive_to_local_naive(row[7]),
            })
    log(f"Loaded {len(rows)} tickets from the geodatabase.")
    return rows


def hours_open(submitted_dt, now) -> int:
    """Return whole hours elapsed since submitted_dt, or 0 if None."""
    if submitted_dt is None:
        return 0
    delta = now - submitted_dt
    return max(int(delta.total_seconds() // 3600), 0)


def filter_overdue(rows: list, categories: list, now: datetime) -> dict:
    """
    Apply threshold filters and return four overdue bucket lists,
    filtered to the supplied category code list.
    """
    cat_set = set(categories)

    open_overdue       = []
    received_overdue   = []
    inprogress_overdue = []
    no_res_date        = []

    for r in rows:
        # Skip if ticket is not in one of the director's categories
        if r.get("category") not in cat_set:
            continue
        sub = r["submitted"]
        if sub is None:
            continue
        age = now - sub

        if r["status"] == STATUS_OPEN and age > cfg.THRESHOLD_OPEN:
            open_overdue.append(r)
        elif r["status"] == STATUS_RECEIVED and age > cfg.THRESHOLD_RECEIVED:
            received_overdue.append(r)
        elif r["status"] == STATUS_IN_PROGRESS and age > cfg.THRESHOLD_IN_PROGRESS:
            inprogress_overdue.append(r)
        elif r["status"] in TERMINAL_STATUSES:
            if r["resolved_dt"] is None:
                no_res_date.append(r)

    # Sort each bucket oldest first
    key = lambda x: x["submitted"] or datetime.min
    for lst in [open_overdue, received_overdue, inprogress_overdue, no_res_date]:
        lst.sort(key=key)

    return {
        "submitted":   open_overdue,
        "received":    received_overdue,
        "in_progress": inprogress_overdue,
        "no_res_date": no_res_date,
    }

# ── HTML Helpers ──────────────────────────────────────────────────────────────

def _ticket_row(r: dict, shade: bool, now: datetime) -> str:
    """Render one ticket as an HTML table row."""
    s        = ' class="reportshade"' if shade else ""
    status   = STATUS_LABELS.get(r["status"], str(r["status"]))
    cat_code = r.get("category")
    category = CATEGORY_LABELS.get(cat_code, str(cat_code) if cat_code is not None else "-")
    date     = r["submitted"].strftime("%x") if r["submitted"] else "-"

    # Display age in days if >= 24 hours, otherwise hours
    hrs = hours_open(r["submitted"], now)
    if hrs >= 24:
        age_label = f"{hrs // 24}d"
    else:
        age_label = f"{hrs}h"

    # Wrap the ticket number in a deep-link to the Manager app. The Manager
    # accepts ?ticket_number=N to auto-select and zoom to a ticket on load.
    # Styling MUST be inline because Outlook (the primary client for these
    # reports) strips <style> blocks and won't honor our .reportshade
    # selector for color. We keep the visual treatment minimal - underlined
    # text on the shaded row, or default link blue on the white row - so the
    # link is obvious without changing the report's overall look.
    ticket_num = r["ticket_num"]
    if ticket_num:
        link_color = "#ffffff" if shade else "#003a55"
        ticket_cell = (
            f'<a href="{cfg.MANAGER_URL}?ticket_number={ticket_num}" '
            f'target="_blank" '
            f'style="color:{link_color};text-decoration:underline;font-weight:600;">'
            f'{ticket_num}</a>'
        )
    else:
        ticket_cell = "-"

    return (
        f'  <tr>\n'
        f'    <td{s}>{ticket_cell}</td>\n'
        f'    <td{s}>{age_label}</td>\n'
        f'    <td{s}>{r.get("assigned_to") or "-"}</td>\n'
        f'    <td{s}>{category}</td>\n'
        f'    <td{s}>{status}</td>\n'
        f'    <td{s}>{date}</td>\n'
        f'  </tr>\n'
    )


def build_table(ticket_list: list, now: datetime) -> str:
    """Return a complete accessible HTML table for the supplied ticket list."""
    header = (
        '<table class="report" style="width:100%;">\n'
        '  <tr>\n'
        '    <th scope="col">ID</th>\n'
        '    <th scope="col">Age</th>\n'
        '    <th scope="col">Assigned To</th>\n'
        '    <th scope="col">Type</th>\n'
        '    <th scope="col">Status</th>\n'
        '    <th scope="col">Submitted Date</th>\n'
        '  </tr>\n'
    )
    rows = "".join(_ticket_row(r, i % 2 == 0, now) for i, r in enumerate(ticket_list))
    return header + rows + "</table>"


def build_email_html(categories_label: str, overdue: dict, date_str: str, now: datetime):
    """Render email_template_directors.html with all placeholders substituted.
    Returns None (failure already recorded) if the template cannot be read."""
    return render_template(TEMPLATE_FILE, {
        "{assigned_categories}":     categories_label,
        "{Date}":                    date_str,
        "{Year}":                    str(datetime.now().year),
        "{Submitted Overdue}":       build_table(overdue["submitted"],   now),
        "{Received Overdue}":        build_table(overdue["received"],    now),
        "{In Progress Overdue}":     build_table(overdue["in_progress"], now),
        "{Resolution Date Overdue}": build_table(overdue["no_res_date"], now),
    })

# ── Email Sending ─────────────────────────────────────────────────────────────

def send_email(real_recipient: str, subject: str, html_body: str) -> tuple:
    """
    Send an HTML email via the SMTP relay.

    In cfg.TESTING_MODE the message always delivers to cfg.TESTING_EMAIL.
    The real_recipient value is used only for the Subject line annotation
    so you can tell which director's report you're previewing.

    Returns (success: bool, error_message: str).
    """
    to_addr = resolve_recipient(real_recipient)
    if cfg.TESTING_MODE:
        subject = f"[TEST - intended for {real_recipient}] {subject}"
    return send_html_email(to_addr, subject, html_body)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log("=" * 60)
    mode_label = "TESTING MODE" if cfg.TESTING_MODE else "LIVE"
    log(f"Directors Overdue Report - {mode_label}")
    if cfg.TESTING_MODE:
        log(f"  All emails -> {cfg.TESTING_EMAIL}")

    if not cfg.DIRECTOR_DICT:
        log("No directors configured (cfg.DIRECTOR_DICT is empty), nothing to send")
        return

    # Validate paths before doing any work
    for p, label in [(cfg.SDE_CONNECTION, "SDE connection"),
                     (template_path(TEMPLATE_FILE), "HTML template")]:
        if not os.path.exists(p):
            record_failure(f"{label} not found: {p}")
            sys.exit(1)

    arcpy.env.workspace = cfg.SDE_CONNECTION

    # Single "now" reference used for all age calculations (matches the local
    # datetimes we converted UTC values into during load_all_tickets).
    now      = datetime.now()
    date_str = now.strftime("%A, %b %d %Y")
    subject  = f"{cfg.PROGRAM_NAME} Overdue Tickets - {date_str}"

    # Load all tickets once; filter per director in the loop below
    all_tickets = load_all_tickets()

    sent_count    = 0
    skipped_count = 0
    error_count   = 0

    for dir_email, categories in cfg.DIRECTOR_DICT.items():
        overdue = filter_overdue(all_tickets, categories, now)

        # Count total overdue across all buckets; skip if none
        total_overdue = sum(len(v) for v in overdue.values())
        if total_overdue == 0:
            log(f"  SKIP {dir_email} - no overdue tickets in assigned categories.")
            write_notification_log(
                ticket_id=NO_TICKET_GUID,
                recipient=dir_email,
                event_type="directors_report:SKIPPED",
                send_status="SKIPPED",
                error_msg="No overdue tickets in assigned categories",
            )
            skipped_count += 1
            continue

        # Build a human-readable label of category names for the email body
        categories_label = ", ".join(
            CATEGORY_LABELS.get(c, str(c)) for c in categories
        )
        html_body = build_email_html(categories_label, overdue, date_str, now)
        if html_body is None:
            success, error_msg = False, "template could not be rendered"
        else:
            success, error_msg = send_email(dir_email, subject, html_body)
        if success:
            dest = resolve_recipient(dir_email)
            log(f"  SENT -> {dest} ({total_overdue} overdue items for {dir_email})")
            write_notification_log(
                ticket_id=NO_TICKET_GUID,
                recipient=dir_email,
                event_type="directors_report:SENT",
                send_status="SUCCESS",
                error_msg=f"overdue_count={total_overdue}",
            )
            sent_count += 1
        else:
            record_failure(f"Send FAILED for {dir_email}: {error_msg}")
            write_notification_log(
                ticket_id=NO_TICKET_GUID,
                recipient=dir_email,
                event_type="directors_report:FAILED",
                send_status="FAILED",
                error_msg=error_msg,
            )
            error_count += 1

    log("-" * 60)
    log(f"Complete - sent: {sent_count}, skipped: {skipped_count}, errors: {error_count}")


if __name__ == "__main__":
    run(main)
