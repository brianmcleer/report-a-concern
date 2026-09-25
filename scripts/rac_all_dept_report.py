"""
rac_all_dept_report.py

Report a Concern monthly all-department summary.

Queries the Tickets feature class directly from the ReportAConcern enterprise
geodatabase and emails a summary of the previous full calendar month to the
configured recipient list. One email per recipient; each send is recorded in
Notification_Log.

Report contents:
  - Tickets submitted in the period
  - Tickets closed (Resolved or Closed) in the period
  - Top 5 categories by submission volume
  - Top 10 ticket types (subcategories) by submission volume
  - Total currently open tickets
  - Open tickets by category
  - 10 oldest open tickets

Schedule: run once a month, on the 1st, e.g. 9:00 AM, from the ArcGIS Pro
Python environment (arcpy is required).

Inputs:
  - cfg.TICKETS_FC (read only)
  - email-templates/email_template_monthly.html

Config keys used (config.py):
  SDE_CONNECTION, TICKETS_FC, NOTIF_LOG_SQL (via rac_common), TEMPLATE_DIR,
  MONTHLY_REPORT_RECIPIENTS, TESTING_MODE, TESTING_EMAIL, SMTP_HOST, SMTP_PORT,
  FROM_ADDR, FROM_NAME, LOCAL_TIMEZONE, ALERT_RECIPIENTS, ALERT_FROM

Testing mode:
  cfg.TESTING_MODE = True  -> every email is redirected to cfg.TESTING_EMAIL
  cfg.TESTING_MODE = False -> emails go to cfg.MONTHLY_REPORT_RECIPIENTS

Behavior notes:
  - Every failure in a run (missing path, SDE load, template, send,
    Notification_Log write, unhandled exception) is collected and emailed
    once at exit to ALERT_RECIPIENTS. Exit code is 1 when any failure was
    recorded so the scheduler's Last Run Result shows it.
  - Notification_Log rows are written with direct SQL (OBJECTID = MAX+1) via
    rac_common.notif_insert; the table is unregistered from versioning so it
    is outside Compress.
"""

import arcpy
import os
import sys
import uuid
from datetime import datetime, timedelta
from collections import Counter

from rac_common import (cfg, log, record_failure, run,
                        utc_naive_to_local_naive, render_template, template_path,
                        send_html_email, resolve_recipient, notif_insert,
                        NO_TICKET_GUID, set_script_name, script_name)
from categories import CATEGORY_LABELS, SUBCATEGORY_LABELS, subcategory_label

set_script_name("rac_all_dept_report.py")

# ── Timezone note ─────────────────────────────────────────────────────────────
# SDE returns naive UTC datetimes from cursors. The report buckets tickets by
# date range, so any TZ mismatch between created_date (UTC) and the locally-
# computed report period would bucket late-evening tickets into the wrong
# month. Convert at load time (utc_naive_to_local_naive) so all downstream
# comparisons share one TZ.

TEMPLATE_FILE = "email_template_monthly.html"

# ── Field Names ───────────────────────────────────────────────────────────────
F_OID         = "OBJECTID"
F_TICKET_NUM  = "ticket_number"
F_STATUS      = "status"
F_CREATED     = "created_date"
F_ASSIGNED_TO = "assigned_to"
F_CATEGORY    = "category"
F_SUBCATEGORY = "subcategory"
F_RESOLVED_DT = "resolved_date"

# Status coded values - match the SDE domain
STATUS_OPEN        = 1
STATUS_RECEIVED    = 2
STATUS_IN_PROGRESS = 3
STATUS_RESOLVED    = 4
STATUS_CLOSED      = 5

# Terminal statuses - tickets in either state are excluded from "open" counts
TERMINAL_STATUSES = {STATUS_RESOLVED, STATUS_CLOSED}

STATUS_LABELS = {
    STATUS_OPEN:        "Open",
    STATUS_RECEIVED:    "Received",
    STATUS_IN_PROGRESS: "In Progress",
    STATUS_RESOLVED:    "Resolved",
    STATUS_CLOSED:      "Closed",
}

# Subcategory labels are nested by category code (categories.py) so the same
# subcategory string (e.g. WEEDS, OTHER) resolves to the right label depending
# on which category the ticket belongs to. subcategory_label() falls back to
# the raw code string when a pair is not in SUBCATEGORY_LABELS, which protects
# against domain drift without breaking the report. It returns "" for None;
# the report shows a hyphen in that case.
resolve_subcategory = lambda c, s: subcategory_label(c, s) or "-"


# ── Notification_Log ──────────────────────────────────────────────────────────

def write_notification_log(
    ticket_id:    str,
    recipient:    str,
    event_type:   str,
    send_status:  str,
    error_msg:    str = None,
):
    """
    Insert one row into Notification_Log.

    Field repurposing for monthly-report entries:
      recipient_email -> real recipient (not the testing redirect)
      email_subject   -> event type ('all_dept_report:SENT', etc.)
      send_status     -> SUCCESS / FAILED
      ticket_id       -> sentinel NO_TICKET_GUID (report covers many tickets)
      error_message   -> summary counts on success, error text on failure

    Failures here are swallowed by notif_insert (recorded, never raised); we
    never want a logging side-effect to break the report.
    """
    log_id      = "{" + str(uuid.uuid4()).upper() + "}"
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

# ── Date helpers ──────────────────────────────────────────────────────────────

def get_report_period():
    """
    Return (start, end) datetimes covering the full previous calendar month.
    Handles the January -> December year rollback correctly.
    """
    today            = datetime.now()
    first_this_month = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    if first_this_month.month == 1:
        first_last_month = first_this_month.replace(month=12, year=first_this_month.year - 1)
    else:
        first_last_month = first_this_month.replace(month=first_this_month.month - 1)

    last_last_month = first_this_month - timedelta(seconds=1)
    return first_last_month, last_last_month


def days_open(created_dt) -> int:
    """Return whole days elapsed since created_dt, or 0 if None."""
    if created_dt is None:
        return 0
    return max((datetime.now() - created_dt).days, 0)

# ── Data Layer ────────────────────────────────────────────────────────────────

def load_all_tickets() -> list:
    """
    Pull all tickets from the ReportAConcern geodatabase into a list of dicts
    containing only the fields needed for the monthly report.
    """
    fields = [
        F_OID, F_TICKET_NUM, F_STATUS, F_CREATED,
        F_ASSIGNED_TO, F_CATEGORY, F_SUBCATEGORY, F_RESOLVED_DT
    ]
    rows = []
    with arcpy.da.SearchCursor(cfg.TICKETS_FC, fields) as cur:
        for row in cur:
            rows.append({
                "oid":         row[0],
                "ticket_num":  row[1],
                "status":      row[2],
                "created":     utc_naive_to_local_naive(row[3]),
                "assigned_to": row[4],
                "category":    row[5],   # raw SHORT integer; resolved via CATEGORY_LABELS
                "subcategory": row[6],   # raw TEXT domain code; resolved via SUBCATEGORY_LABELS
                "resolved_dt": utc_naive_to_local_naive(row[7]),
            })
    log(f"Loaded {len(rows)} tickets from SDE.")
    return rows


def build_report_data(rows: list, period_start: datetime, period_end: datetime) -> dict:
    """
    Derive all metrics needed for the monthly report from the full ticket list.
    Returns a dict of computed values and pre-sorted lists.
    """
    # ── Report period buckets ─────────────────────────────────────────────────
    period_submitted = [
        r for r in rows
        if r["created"] and period_start <= r["created"] <= period_end
    ]

    # Both Resolved and Closed count as completed work for the period.
    period_closed = [
        r for r in rows
        if r["resolved_dt"] and period_start <= r["resolved_dt"] <= period_end
        and r["status"] in TERMINAL_STATUSES
    ]

    # ── All-time open tickets - excludes both Resolved and Closed ─────────────
    open_tickets = [r for r in rows if r["status"] not in TERMINAL_STATUSES]

    # ── Top 5 categories by submission volume in period ──────────────────────
    # Group by category code and resolve to a human-readable label so the
    # report displays "Roads & Pavement: 47" rather than a raw code.
    cat_counter = Counter(
        CATEGORY_LABELS.get(r["category"], f"Category {r['category']}")
        for r in period_submitted
        if r["category"] is not None
    )
    top_cats = cat_counter.most_common(5)

    # ── Top 10 ticket types by submission volume in period ───────────────────
    # Resolve domain codes to labels before counting so the table displays
    # human-readable names rather than raw coded values.
    type_counter = Counter(
        resolve_subcategory(r["category"], r["subcategory"])
        for r in period_submitted
        if r["subcategory"]
    )
    top_types = type_counter.most_common(10)

    # ── Open tickets by category ─────────────────────────────────────────────
    open_cat_counter = Counter(
        CATEGORY_LABELS.get(r["category"], f"Category {r['category']}")
        for r in open_tickets
        if r["category"] is not None
    )
    open_by_cat = open_cat_counter.most_common()

    # ── 10 oldest open tickets ────────────────────────────────────────────────
    oldest_open = sorted(
        open_tickets,
        key=lambda x: x["created"] or datetime.max
    )[:10]

    return {
        "submitted_count": len(period_submitted),
        "closed_count":    len(period_closed),
        "open_count":      len(open_tickets),
        "top_cats":        top_cats,
        "top_types":       top_types,
        "open_by_cat":     open_by_cat,
        "oldest_open":     oldest_open,
    }

# ── HTML Helpers ──────────────────────────────────────────────────────────────

def _two_col_table(data: list, header1: str, header2: str) -> str:
    """Build a two-column summary table from a list of (label, count) tuples."""
    html = (
        f'<table class="report" style="width:50%;margin:0 auto;">\n'
        f'  <tr>\n'
        f'    <th scope="col">{header1}</th>\n'
        f'    <th scope="col">{header2}</th>\n'
        f'  </tr>\n'
    )
    for i, (label, count) in enumerate(data):
        shade = ' class="reportshade"' if i % 2 == 0 else ""
        html += (
            f'  <tr>\n'
            f'    <td{shade}>{label}</td>\n'
            f'    <td{shade}>{count}</td>\n'
            f'  </tr>\n'
        )
    html += '</table>'
    return html


def _oldest_open_table(ticket_list: list) -> str:
    """Build the oldest-open-tickets detail table."""
    html = (
        '<table class="report" style="width:100%;">\n'
        '  <tr>\n'
        '    <th scope="col">ID</th>\n'
        '    <th scope="col">Open Days</th>\n'
        '    <th scope="col">Assigned To</th>\n'
        '    <th scope="col">Type</th>\n'
        '    <th scope="col">Status</th>\n'
        '    <th scope="col">Submitted Date</th>\n'
        '  </tr>\n'
    )
    for i, r in enumerate(ticket_list):
        shade  = ' class="reportshade"' if i % 2 == 0 else ""
        status = STATUS_LABELS.get(r["status"], str(r["status"]))
        subcat = resolve_subcategory(r.get("category"), r.get("subcategory"))
        date   = r["created"].strftime("%x") if r["created"] else "-"
        html += (
            f'  <tr>\n'
            f'    <td{shade}>{r["ticket_num"]}</td>\n'
            f'    <td{shade}>{days_open(r["created"])}</td>\n'
            f'    <td{shade}>{r.get("assigned_to") or "-"}</td>\n'
            f'    <td{shade}>{subcat}</td>\n'
            f'    <td{shade}>{status}</td>\n'
            f'    <td{shade}>{date}</td>\n'
            f'  </tr>\n'
        )
    html += '</table>'
    return html


def build_email_html(data: dict, month_label: str,
                     period_start: datetime) -> str:
    """
    Render email_template_monthly.html with all placeholders substituted.
    Organization tokens ({org_name}, {org_logo_url}, ...) are injected by
    rac_common.render_template. Returns None if the template cannot be read
    (the failure is already recorded).
    """
    tokens = {
        "{month}":           month_label,
        "{year}":            str(period_start.year),
        "{Year}":            str(datetime.now().year),
        "{submitted_count}": str(data["submitted_count"]),
        "{closed_count}":    str(data["closed_count"]),
        "{open_count}":      str(data["open_count"]),
        # The {top_depts_table} and {open_by_dept_table} placeholders are kept
        # as-is for backward compatibility with the existing email template;
        # their contents are category-based rather than department-based.
        "{top_depts_table}":    _two_col_table(data["top_cats"],    "Category", "Count"),
        "{top_types_table}":    _two_col_table(data["top_types"],   "Ticket Type", "Count"),
        "{open_by_dept_table}": _two_col_table(data["open_by_cat"], "Category", "Count"),
        "{oldest_open_table}":  _oldest_open_table(data["oldest_open"]),
    }
    return render_template(TEMPLATE_FILE, tokens)

# ── Email Sending ─────────────────────────────────────────────────────────────

def send_email(recipient: str, subject: str, html_body: str) -> tuple:
    """
    Send an HTML email via the SMTP relay.
    In cfg.TESTING_MODE all messages deliver to cfg.TESTING_EMAIL and the
    subject is prefixed with the intended recipient.
    Returns (success: bool, error_message: str).
    """
    to_addr = resolve_recipient(recipient)
    if cfg.TESTING_MODE:
        subject = f"[TEST - intended for {recipient}] {subject}"
    return send_html_email(to_addr, subject, html_body)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log("=" * 60)
    mode_label = "TESTING MODE" if cfg.TESTING_MODE else "LIVE"
    log(f"Report a Concern Monthly All-Department Report - {mode_label}")
    if cfg.TESTING_MODE:
        log(f"  All emails -> {cfg.TESTING_EMAIL}")

    recipients = list(cfg.MONTHLY_REPORT_RECIPIENTS or [])
    if not recipients:
        log("No recipients configured (cfg.MONTHLY_REPORT_RECIPIENTS is empty), nothing to send")
        return

    # Validate paths before doing any work
    for p, label in [(cfg.SDE_CONNECTION, "SDE connection"),
                     (template_path(TEMPLATE_FILE), "HTML template")]:
        if not os.path.exists(p):
            record_failure(f"{label} not found: {p}")
            sys.exit(1)

    arcpy.env.workspace = cfg.SDE_CONNECTION

    period_start, period_end = get_report_period()
    month_label = period_start.strftime("%B")
    year_label  = period_start.strftime("%Y")
    subject     = f"{cfg.PROGRAM_NAME} Monthly Report - {month_label} {year_label}"

    log(f"Report period: {period_start:%Y-%m-%d} -> {period_end:%Y-%m-%d}")

    all_tickets = load_all_tickets()
    data        = build_report_data(all_tickets, period_start, period_end)

    log(f"  Submitted in period : {data['submitted_count']}")
    log(f"  Closed in period    : {data['closed_count']}")
    log(f"  Currently open      : {data['open_count']}")

    html_body = build_email_html(data, month_label, period_start)
    if html_body is None:
        sys.exit(1)

    sent_count  = 0
    error_count = 0

    for recipient in recipients:
        success, error_msg = send_email(recipient, subject, html_body)
        if success:
            dest = resolve_recipient(recipient)
            log(f"  SENT -> {dest} (for {recipient})")
            write_notification_log(
                ticket_id=NO_TICKET_GUID,
                recipient=recipient,
                event_type="all_dept_report:SENT",
                send_status="SUCCESS",
                error_msg=(
                    f"submitted={data['submitted_count']}, "
                    f"closed={data['closed_count']}, "
                    f"open={data['open_count']}"
                ),
            )
            sent_count += 1
        else:
            record_failure(f"Send FAILED for {recipient}: {error_msg}")
            write_notification_log(
                ticket_id=NO_TICKET_GUID,
                recipient=recipient,
                event_type="all_dept_report:FAILED",
                send_status="FAILED",
                error_msg=error_msg,
            )
            error_count += 1

    log("-" * 60)
    log(f"Complete - sent: {sent_count}, errors: {error_count}")


if __name__ == "__main__":
    run(main)
