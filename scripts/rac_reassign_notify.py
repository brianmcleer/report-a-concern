"""
rac_reassign_notify.py
Report a Concern

Detects tickets that have been manually reassigned (assigned_to changed
after the initial routing notification) and sends a routing email to the
new assignee's department.

Detection logic (all on the Tickets feature class):
  - notification_sent = 1                  -> past initial notification (ignore brand-new tickets)
  - assigned_to IS NOT NULL / <> ''        -> ticket has an assignee
  - last_notified_assignee IS NOT NULL     -> initial notification was written
  - assigned_to <> last_notified_assignee  -> a reassignment occurred

On each matching ticket:
  1. Looks up the new assignee's email in the Ticket_Routing table
  2. Sends an internal reassignment email (rac_reassign_template.html)
  3. Updates last_notified_assignee = assigned_to (per-ticket commit)
  4. Writes a row to Notification_Log

Notes:
  - No email is sent to the old assignee (new assignee only).
  - Fires regardless of ticket status. Even Resolved/Closed tickets can be
    reassigned and will trigger a notification.
  - A ticket reassigned to UNKNOWN_ASSIGNEE routes to the triage mailbox.
    Any other assignee with no Ticket_Routing match falls back to
    NO_MATCH_FALLBACK.
  - In TESTING_MODE every email goes to TESTING_EMAIL and
    last_notified_assignee is NOT updated, so the same ticket keeps
    triggering on reruns (useful for testing).
  - Every failure in a run (query, template, send, flag update,
    Notification_Log write, unhandled exception) is collected and emailed
    once at exit; the exit code is 1 when any failure was recorded.

Inputs:
  - Tickets feature class (cfg.TICKETS_FC)
  - Ticket_Routing table  (cfg.ROUTING_TABLE)
  - Notification_Log      (written via direct SQL, see rac_common)
  - rac_reassign_template.html in cfg.TEMPLATE_DIR

Config keys used (config.py):
  SDE_CONNECTION, TICKETS_FC, ROUTING_TABLE, MANAGER_URL, TESTING_MODE,
  TESTING_EMAIL, UNKNOWN_ASSIGNEE, TRIAGE_EMAIL, NO_MATCH_FALLBACK,
  plus the SMTP / alert / template settings consumed by rac_common.

Schedule:  Every 5 minutes via Task Scheduler (same cadence as
           rac_notify_new_ticket.py). Run with the ArcGIS Pro Python
           environment (arcpy required).
"""

import arcpy
import uuid
import traceback
from datetime import datetime

from rac_common import (cfg, log, err, record_failure, run, to_local,
                        render_template, send_html_email, notif_insert,
                        set_script_name, script_name)

set_script_name("rac_reassign_notify.py")

# ── Email subject ─────────────────────────────────────────────────────────────
EMAIL_SUBJECT = f"{cfg.PROGRAM_NAME} Ticket Reassigned to Your Department"


# ── Notification_Log write ────────────────────────────────────────────────────
# Notification_Log is non-versioned and written with direct SQL and an explicit
# OBJECTID = MAX+1 (see rac_common.notif_insert). This script stores ticket_id
# WITHOUT braces, which differs from the shared write_notification_log, so a
# thin local wrapper is kept. Field names/formatting match the other scripts so
# rows filter/sort consistently across senders. Non-fatal: a logging failure
# must never stop the caller.
def write_notification_log(ticket_id, recipient, subject, status, error_msg=""):
    ticket_id_s = str(ticket_id).replace("{", "").replace("}", "") if ticket_id else None
    cols = ["log_id", "ticket_id", "script_name", "recipient_email",
            "email_subject", "send_status", "error_message", "sent_date", "retry_count"]
    vals = ["{" + str(uuid.uuid4()).upper() + "}", ticket_id_s, script_name(),
            recipient, subject, status, (error_msg[:500] if error_msg else None),
            datetime.now(), 0]
    notif_insert(cols, vals)


def build_category_lookup():
    """Return {code: label} for all subtypes on the Tickets feature class."""
    try:
        subtypes = arcpy.da.ListSubtypes(cfg.TICKETS_FC)
        return {code: info["Name"] for code, info in subtypes.items()}
    except Exception as exc:
        record_failure(f"Category lookup build failed: {exc}")
        return {}


def build_subcategory_lookup():
    """Return {category_code: {subcat_code: label}} from the subcategory domains."""
    result = {}
    try:
        subtypes = arcpy.da.ListSubtypes(cfg.TICKETS_FC)
        for code, info in subtypes.items():
            field_vals   = info.get("FieldValues", {})
            subcat_entry = field_vals.get("subcategory", (None, None))
            domain = subcat_entry[1] if subcat_entry and len(subcat_entry) > 1 else None
            if domain and hasattr(domain, "codedValues"):
                result[code] = domain.codedValues
            else:
                result[code] = {}
    except Exception as exc:
        record_failure(f"Subcategory lookup build failed: {exc}")
    return result


def decode_category(raw_value, category_lookup):
    if raw_value is None:
        return ""
    try:
        return category_lookup.get(int(raw_value), str(raw_value))
    except (ValueError, TypeError):
        return str(raw_value)


def decode_subcategory(raw_value, raw_category, subcategory_lookup):
    if raw_value is None:
        return ""
    try:
        cat_code   = int(raw_category)
        domain_map = subcategory_lookup.get(cat_code, {})
        return domain_map.get(raw_value, str(raw_value))
    except (ValueError, TypeError):
        return str(raw_value)


def build_routing_lookup():
    """Return {default_assignee: assignee_email} from the Ticket_Routing table."""
    lookup = {}
    try:
        fields = ["default_assignee", "assignee_email"]
        where  = "assignee_email IS NOT NULL AND assignee_email <> ''"
        with arcpy.da.SearchCursor(cfg.ROUTING_TABLE, fields, where_clause=where) as cur:
            for row in cur:
                assignee, email = row
                if assignee and assignee not in lookup:
                    lookup[assignee] = email
    except Exception as exc:
        record_failure(f"Routing lookup build failed: {exc}")
    return lookup


def get_routing_email(assigned_to, routing_lookup):
    """Resolve assigned_to value -> email address.

    Department UNKNOWN_ASSIGNEE routes to the triage mailbox. Any other
    assignee with no Ticket_Routing match falls back to NO_MATCH_FALLBACK.
    In TESTING_MODE everything goes to TESTING_EMAIL.
    """
    if cfg.TESTING_MODE:
        return cfg.TESTING_EMAIL
    if not assigned_to:
        return cfg.NO_MATCH_FALLBACK
    if assigned_to.strip().lower() == cfg.UNKNOWN_ASSIGNEE.lower():
        return cfg.TRIAGE_EMAIL
    email = routing_lookup.get(assigned_to)
    if not email:
        err(f"No routing email for assigned_to='{assigned_to}', falling back to {cfg.NO_MATCH_FALLBACK}")
        return cfg.NO_MATCH_FALLBACK
    return email


def build_status_label(status_code):
    """Return a human-readable status label from the integer code."""
    return {1: "Open", 2: "Received", 3: "In Progress", 4: "Resolved", 5: "Closed"}.get(status_code, str(status_code))


def mark_reassigned(oid, assignee):
    """
    Set last_notified_assignee = assignee on a single ticket, committed in its
    own edit operation. Returns True on commit.

    Called only AFTER a confirmed send. Keeping the update per-ticket means a
    commit failure (version conflict while the ticket is being edited in the
    manager, lock, dropped connection) re-notifies just this one ticket on the
    next run, instead of rolling back the whole batch and re-sending every
    ticket in it, which was the original duplicate risk.
    """
    editor = arcpy.da.Editor(cfg.SDE_CONNECTION)
    try:
        editor.startEditing(False, True)
        editor.startOperation()
        updated = False
        with arcpy.da.UpdateCursor(
            cfg.TICKETS_FC,
            ["last_notified_assignee"],
            where_clause=f"OBJECTID = {oid}",
        ) as ucur:
            for row in ucur:
                row[0] = assignee
                ucur.updateRow(row)
                updated = True
        editor.stopOperation()
        editor.stopEditing(True)
        return updated
    except Exception as exc:
        record_failure(f"last_notified_assignee update failed for OID {oid}: {exc}")
        try:
            editor.stopEditing(False)
        except Exception:
            pass
        return False


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    log("=" * 60)
    log("rac_reassign_notify - starting")
    if cfg.TESTING_MODE:
        log(f"TESTING_MODE = True - all emails -> {cfg.TESTING_EMAIL}")
        log("NOTE: last_notified_assignee will NOT be updated in testing mode")
    log("=" * 60)

    category_lookup    = build_category_lookup()
    subcategory_lookup = build_subcategory_lookup()
    routing_lookup     = build_routing_lookup()

    # ── Query: tickets where assigned_to has changed since last notification ──
    # notification_sent = 1  -> already past initial routing (skip brand-new tickets)
    # last_notified_assignee IS NOT NULL -> initial notification was written
    # assigned_to <> last_notified_assignee -> a reassignment occurred
    ticket_fields = [
        "OBJECTID", "ticket_id", "ticket_number",
        "category", "subcategory",
        "submitted_by_name", "address_submitted", "description",
        "assigned_to", "last_notified_assignee",
        "status", "created_date", "modified_date"
    ]

    where = (
        "notification_sent = 1 "
        "AND assigned_to IS NOT NULL "
        "AND assigned_to <> '' "
        "AND last_notified_assignee IS NOT NULL "
        "AND assigned_to <> last_notified_assignee"
    )

    tickets = []
    try:
        with arcpy.da.SearchCursor(cfg.TICKETS_FC, ticket_fields, where_clause=where) as cur:
            for row in cur:
                tickets.append(dict(zip(ticket_fields, row)))
    except Exception as exc:
        record_failure(f"Ticket query failed: {exc}\n{traceback.format_exc()}")
        return

    log(f"Found {len(tickets)} reassigned ticket(s) needing notification")

    if not tickets:
        log("Nothing to process - exiting")
        log("=" * 60)
        return

    # ── Process each ticket independently ───────────────────────────────────────
    # Send first, then mark last_notified_assignee in its own per-ticket commit.
    # Ordering and per-ticket isolation give:
    #   - Send fails              -> not marked, next run retries (alarm signal)
    #   - Send ok, mark commits   -> done
    #   - Send ok, mark fails     -> only THIS ticket may re-notify next run,
    #                                rather than the whole batch rolling back
    # Notification_Log writes are self-contained (own session), so no shared
    # batch edit session is needed.
    processed = 0

    for ticket in tickets:
        oid = ticket["OBJECTID"]
        try:
            ticket_id     = ticket["ticket_id"]
            ticket_number = ticket["ticket_number"]
            assigned_to   = ticket["assigned_to"]
            last_notified = ticket["last_notified_assignee"]
            category_code = ticket["category"]
            status_code   = ticket["status"]
            created_dt    = to_local(ticket["created_date"])
            modified_dt   = to_local(ticket["modified_date"])

            category_label = decode_category(category_code, category_lookup)
            status_label   = build_status_label(status_code)
            submitted_date = created_dt.strftime("%B %d, %Y %I:%M %p %Z") if created_dt else "Unknown"
            modified_date  = modified_dt.strftime("%B %d, %Y %I:%M %p %Z") if modified_dt else "Unknown"
            manager_link   = f"{cfg.MANAGER_URL}?ticket_number={ticket_number}"
            staff_email    = get_routing_email(assigned_to, routing_lookup)

            log(f"  Ticket #{ticket_number} (OID {oid}) - '{last_notified}' -> '{assigned_to}'")

            # {manager_url} deliberately overrides the org-level token injected
            # by rac_common so the link opens this specific ticket.
            tokens = {
                "{ticket_number}":        str(ticket_number),
                "{ticket_id}":            str(ticket_id).replace("{", "").replace("}", ""),
                "{manager_url}":          manager_link,
                "{category}":             category_label,
                "{subcategory}":          decode_subcategory(ticket["subcategory"], category_code, subcategory_lookup) or "",
                "{address}":              ticket["address_submitted"] or "Not provided",
                "{description}":          ticket["description"] or "",
                "{submitter_name}":       ticket["submitted_by_name"] or "Resident",
                "{submitted_date}":       submitted_date,
                "{modified_date}":        modified_date,
                "{assigned_to}":          assigned_to,
                "{previously_assigned}":  last_notified or "Unassigned",
                "{status}":               status_label,
            }

            subject   = f"{EMAIL_SUBJECT} - Ticket #{ticket_number}"
            html_body = render_template("rac_reassign_template.html", tokens)

            # Template render failure is a code/config bug, not transient. Log it
            # FAILED and, in production, still mark so we don't retry forever.
            if not html_body:
                write_notification_log(ticket_id, staff_email, subject, "FAILED", "Template render failed")
                if not cfg.TESTING_MODE:
                    mark_reassigned(oid, assigned_to)
                continue

            success, error_msg = send_html_email(staff_email, subject, html_body)

            if not success:
                # Do NOT mark on send failure. The next 5-min run will retry,
                # and repeated FAILED rows are the desired outage alarm.
                record_failure(f"Send failed for Ticket #{ticket_number} (OID {oid}) to {staff_email}: {error_msg}")
                write_notification_log(ticket_id, staff_email, subject, "FAILED", error_msg)
                continue

            log(f"    Sent to {staff_email}")
            write_notification_log(ticket_id, staff_email, subject, "SUCCESS")

            if cfg.TESTING_MODE:
                log("    TESTING_MODE: not updating last_notified_assignee (will re-trigger next run)")
            elif mark_reassigned(oid, assigned_to):
                processed += 1
            else:
                record_failure(f"Sent but could not update last_notified_assignee for OID {oid}; "
                               f"it may re-notify on the next run")

        except Exception as exc:
            # One ticket failing must never abort the rest of the batch.
            record_failure(f"Unhandled error on OID {oid}: {exc}\n{traceback.format_exc()}")
            continue

    log(f"Done - processed {processed} of {len(tickets)} ticket(s)")
    log("=" * 60)


if __name__ == "__main__":
    run(main)
