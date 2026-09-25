"""
rac_notify_new_ticket.py
Report a Concern - new ticket notifier

For every new Ticket with notification_sent = 0:
  1. Sends an external confirmation email to the submitter
  2. Sends an internal routing notification to the assigned department
  3. Marks notification_sent = 1 and last_notified_assignee = assigned_to on the ticket
  4. Logs both attempts to Notification_Log

Inputs:
  Tickets feature class        (cfg.TICKETS_FC)      - versioned, edited per ticket
  Ticket_Routing table         (cfg.ROUTING_TABLE)   - category/subcategory/boundary -> email
  Notification_Log table       (direct SQL via rac_common.notif_insert)
  rac_external_new_template.html   - citizen confirmation email (cfg.TEMPLATE_DIR)
  rac_internal_new_template.html   - staff routing email        (cfg.TEMPLATE_DIR)

Schedule: every 5 minutes (Windows Task Scheduler), ArcGIS Pro python environment.

Config keys used (config.py): SDE_CONNECTION, TICKETS_FC, ROUTING_TABLE,
  SUBMIT_APP_URL, MANAGER_URL, TESTING_MODE, TESTING_EMAIL, UNKNOWN_ASSIGNEE,
  TRIAGE_EMAIL, NO_MATCH_FALLBACK, MAX_BATCH, plus the SMTP / template / alert
  keys consumed by rac_common.

Behavior notes:
  - Every failure in a run (lookup build, query, template, send, flag commit,
    Notification_Log write, unhandled exception) is collected and emailed once
    at exit to ALERT_RECIPIENTS. Exit code is 1 when any failure was recorded.
  - The notification_sent flag is committed BEFORE any email is sent, so a
    delivered email can never be re-sent (see mark_notified and main).
"""

import arcpy
import traceback

from rac_common import (cfg, log, err, record_failure, run, to_local,
    render_template, send_html_email, write_notification_log,
    set_script_name)

set_script_name("rac_notify_new_ticket.py")

# ── Email subjects ────────────────────────────────────────────────────────────
EXTERNAL_SUBJECT = f"Your {cfg.PROGRAM_NAME} Request Has Been Received"
INTERNAL_SUBJECT = f"New {cfg.PROGRAM_NAME} Request"

# ── Routing fallbacks ─────────────────────────────────────────────────────────
# A ticket whose resolved department is cfg.UNKNOWN_ASSIGNEE (no real department
# owns it) routes to the triage mailbox (cfg.TRIAGE_EMAIL), regardless of
# category or subcategory. A genuine no-match in Ticket_Routing, e.g. the
# Nonsense / Possible Spam category, which has no routing row by design, still
# falls back to cfg.NO_MATCH_FALLBACK.


# ── Domain / subtype decoding ─────────────────────────────────────────────────

def build_category_lookup(fc):
    try:
        subtypes = arcpy.da.ListSubtypes(fc)
        return {code: info["Name"] for code, info in subtypes.items()}
    except Exception as exc:
        record_failure(f"Could not build category lookup: {exc}")
        return {}


def build_subcategory_lookup(fc):
    result = {}
    try:
        subtypes = arcpy.da.ListSubtypes(fc)
        for code, info in subtypes.items():
            field_vals   = info.get("FieldValues", {})
            subcat_entry = field_vals.get("subcategory", (None, None))
            domain = subcat_entry[1] if subcat_entry and len(subcat_entry) > 1 else None
            if domain and hasattr(domain, "codedValues"):
                result[code] = domain.codedValues
            else:
                result[code] = {}
    except Exception as exc:
        record_failure(f"Could not build subcategory lookup: {exc}")
    return result


def build_routing_lookup():
    """
    Reads Ticket_Routing and builds two dicts:

    subcategory_lookup  - keyed by (category, subcategory, boundary_id)
                          for subcategory-specific overrides
    catchall_lookup     - keyed by (category, boundary_id)
                          for rows where subcategory IS NULL (default routing)

    get_routing_email() tries subcategory_lookup first, then catchall_lookup.
    """
    subcategory_lookup = {}
    catchall_lookup    = {}

    fields = ["category", "subcategory", "boundary_id", "assignee_email", "default_assignee", "is_active"]
    try:
        with arcpy.da.SearchCursor(
            cfg.ROUTING_TABLE,
            fields,
            where_clause="is_active = 1"
        ) as cur:
            for row in cur:
                cat, subcat, bid, email, assignee, _ = row
                entry = {
                    "email":    str(email).strip()    if email    else None,
                    "assignee": str(assignee).strip() if assignee else cfg.UNKNOWN_ASSIGNEE,
                }
                if subcat:
                    # Subcategory-specific override row
                    subcategory_lookup[(int(cat), str(subcat), str(bid))] = entry
                else:
                    # Category-level catch-all row (subcategory IS NULL)
                    catchall_lookup[(int(cat), str(bid))] = entry

        log(f"  {len(catchall_lookup)} category-level route(s), "
            f"{len(subcategory_lookup)} subcategory override(s) loaded from Ticket_Routing")
    except Exception as exc:
        record_failure(f"Could not build routing lookup: {exc}")

    return subcategory_lookup, catchall_lookup


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


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_routing_email(category, subcategory, boundary_id, subcategory_lookup, catchall_lookup):
    """
    Return the staff recipient email for a ticket.

    Lookup priority:
      1. Subcategory-specific: (category, subcategory, boundary_id)
      2. Category catch-all:   (category, boundary_id)

    TESTING_MODE overrides everything and routes to TESTING_EMAIL.
    If the matched routing row's department is UNKNOWN_ASSIGNEE, routes to the
    triage mailbox. Falls back to NO_MATCH_FALLBACK only when no routing row
    matches at all (e.g. the Nonsense / Possible Spam category).
    """
    if cfg.TESTING_MODE:
        return cfg.TESTING_EMAIL

    cat = int(category) if category is not None else None
    bid = str(boundary_id) if boundary_id else None

    def resolve(entry):
        # Department "Unknown" -> triage mailbox, even if the row carries an email.
        if (entry.get("assignee") or "").strip().lower() == cfg.UNKNOWN_ASSIGNEE.lower():
            return cfg.TRIAGE_EMAIL
        if entry.get("email"):
            return entry["email"]
        return None

    # Priority 1: subcategory-specific override
    if subcategory and cat is not None and bid:
        entry = subcategory_lookup.get((cat, str(subcategory), bid))
        if entry:
            resolved = resolve(entry)
            if resolved:
                return resolved

    # Priority 2: category-level catch-all
    if cat is not None and bid:
        entry = catchall_lookup.get((cat, bid))
        if entry:
            resolved = resolve(entry)
            if resolved:
                return resolved

    err(f"No assignee_email found in Ticket_Routing for "
        f"category={category}, subcategory={subcategory}, boundary_id={boundary_id} - using fallback")
    return cfg.NO_MATCH_FALLBACK


# ── Flag write ────────────────────────────────────────────────────────────────

def mark_notified(oid, assignee):
    """
    Set notification_sent = 1 and last_notified_assignee on a single ticket,
    committed in its own short edit operation. Returns True only if the commit
    succeeds.

    Email must be sent ONLY after this returns True. That ordering makes a
    failed commit (version conflict while the ticket is being edited in the
    manager, lock, dropped SDE connection) result in no email and a safe retry
    on the next run, instead of a delivered email whose flag rolled back and
    re-sends. This is what eliminates the duplicate sends.
    """
    editor = arcpy.da.Editor(cfg.SDE_CONNECTION)
    try:
        editor.startEditing(False, True)   # with_undo=False, multiuser_mode=True (versioned)
        editor.startOperation()
        updated = False
        with arcpy.da.UpdateCursor(
            cfg.TICKETS_FC,
            ["notification_sent", "last_notified_assignee"],
            where_clause=f"OBJECTID = {oid}",
        ) as ucur:
            for row in ucur:
                row[0] = 1
                row[1] = assignee
                ucur.updateRow(row)
                updated = True
        editor.stopOperation()
        editor.stopEditing(True)           # commit
        return updated
    except Exception as exc:
        record_failure(f"Could not mark notification_sent for OID {oid}: {exc}")
        try:
            editor.stopEditing(False)      # discard uncommitted edits
        except Exception:
            pass
        return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log("=" * 60)
    log(f"RAC New Ticket Notifier - {'TESTING MODE (all email -> ' + cfg.TESTING_EMAIL + ')' if cfg.TESTING_MODE else 'PRODUCTION'}")

    arcpy.env.workspace = cfg.SDE_CONNECTION

    # ── 1. Build lookup tables once before querying ───────────────────────
    log("Building domain lookups...")
    category_lookup              = build_category_lookup(cfg.TICKETS_FC)
    subcategory_domain_lookup    = build_subcategory_lookup(cfg.TICKETS_FC)
    subcategory_routing, catchall_routing = build_routing_lookup()
    log(f"  {len(category_lookup)} category subtypes, "
        f"{sum(len(v) for v in subcategory_domain_lookup.values())} subcategory values loaded")

    # ── 2. Query tickets pending notification ─────────────────────────────
    ticket_fields = [
        "OBJECTID", "ticket_id", "ticket_number",
        "submitted_by_name", "submitted_by_email", "submitted_by_phone",
        "category", "subcategory", "description",
        "created_date", "assigned_to", "address_submitted",
        "boundary_id",
    ]
    where = (
        "notification_sent = 0 "
        "AND submitted_by_email IS NOT NULL "
        "AND submitted_by_email <> ''"
    )

    candidates = []
    try:
        with arcpy.da.SearchCursor(cfg.TICKETS_FC, ticket_fields, where_clause=where) as cur:
            for row in cur:
                candidates.append(dict(zip(ticket_fields, row)))
    except Exception as exc:
        record_failure(f"Query failed: {exc}\n{traceback.format_exc()}")
        return

    log(f"Found {len(candidates)} ticket(s) pending notification (batch limit: {cfg.MAX_BATCH})")
    batch = candidates[:cfg.MAX_BATCH]

    if not batch:
        log("Nothing to do.")
        return

    # ── 3. Process each ticket ─────────────────────────────────────────────
    # Each ticket is handled independently. The notification_sent flag is
    # committed in its own edit operation (mark_notified) BEFORE any email is
    # sent. Email send and Notification_Log writes happen outside that edit
    # session. Ordering guarantees:
    #   - Flag commit fails (version conflict / lock)  -> no email, retry next run
    #   - Flag commits, then email fails               -> no email, no retry,
    #                                                     logged FAILED (visible)
    # Either way a delivered email can never be re-sent, which is what was
    # producing the duplicates: the old code sent inside one batch-wide edit
    # session and rolled back notification_sent for every ticket if the single
    # commit failed, after the emails had already gone out.
    processed = 0

    for ticket in batch:
        oid = ticket["OBJECTID"]
        try:
            sub_date   = to_local(ticket["created_date"])
            raw_cat    = ticket["category"]
            raw_subcat = ticket["subcategory"]

            cat_label    = decode_category(raw_cat, category_lookup)
            subcat_label = decode_subcategory(raw_subcat, raw_cat, subcategory_domain_lookup)

            staff_email = get_routing_email(
                raw_cat,
                raw_subcat,
                ticket["boundary_id"],
                subcategory_routing,
                catchall_routing,
            )

            tokens = {
                "{ticket_number}":       str(ticket["ticket_number"]),
                "{submitted_by_name}":   ticket["submitted_by_name"]  or "Valued Resident",
                "{submitted_by_email}":  ticket["submitted_by_email"],
                "{submitted_by_phone}":  ticket["submitted_by_phone"] or "Not provided",
                "{category}":            cat_label,
                "{subcategory}":         subcat_label,
                "{description}":         ticket["description"]        or "",
                "{assigned_to}":         ticket["assigned_to"]        or "Unassigned",
                "{address_submitted}":   ticket["address_submitted"]  or "Not provided",
                "{submitted_date}":      sub_date.strftime("%B %d, %Y %I:%M %p %Z") if sub_date else "Unknown",
                "{ticket_url}":          f"{cfg.SUBMIT_APP_URL}?ticket_number={ticket['ticket_number']}",
                "{rac_app_url}":         cfg.SUBMIT_APP_URL,   # legacy token name; {submit_app_url} is injected by rac_common
                "{manager_ticket_url}":  f"{cfg.MANAGER_URL}?ticket_number={ticket['ticket_number']}",
            }

            log(f"  OID {oid} (Ticket #{ticket['ticket_number']}) - "
                f"external -> {tokens['{submitted_by_email}']}, internal -> {staff_email}")

            # ── 3a. Mark notification_sent FIRST (own commit) ──────────────
            # No email is sent unless this commit succeeds. A failed commit
            # (e.g. the ticket is being edited in the manager right now) skips
            # the send and lets the next run pick it up - no duplicate.
            if not mark_notified(oid, ticket["assigned_to"] or ""):
                log(f"    Skipped OID {oid}: flag not committed, will retry next run")
                continue

            # ── 3b. External confirmation to submitter ─────────────────────
            # In TESTING_MODE, redirect the citizen-facing email to TESTING_EMAIL
            # so future test runs cannot accidentally email real residents.
            citizen_email = tokens["{submitted_by_email}"]
            ext_to        = cfg.TESTING_EMAIL if cfg.TESTING_MODE else citizen_email
            ext_body      = render_template("rac_external_new_template.html", tokens)
            if ext_body:
                success, error_msg = send_html_email(ext_to, EXTERNAL_SUBJECT, ext_body)
                if success:
                    log(f"    External sent to {ext_to}")
                    write_notification_log(ticket["ticket_id"], ext_to, EXTERNAL_SUBJECT, "SUCCESS")
                else:
                    record_failure(f"External send failed for Ticket #{ticket['ticket_number']} (OID {oid}) to {ext_to}: {error_msg}")
                    write_notification_log(ticket["ticket_id"], ext_to, EXTERNAL_SUBJECT, "FAILED", error_msg)
            else:
                write_notification_log(ticket["ticket_id"], ext_to, EXTERNAL_SUBJECT, "FAILED", "Template render failed")

            # ── 3c. Internal routing to staff ──────────────────────────────
            int_subj = f"{INTERNAL_SUBJECT} - Ticket #{tokens['{ticket_number}']}"
            int_body = render_template("rac_internal_new_template.html", tokens)
            if int_body:
                success, error_msg = send_html_email(staff_email, int_subj, int_body)
                if success:
                    log(f"    Internal sent to {staff_email}")
                    write_notification_log(ticket["ticket_id"], staff_email, int_subj, "SUCCESS")
                else:
                    record_failure(f"Internal send failed for Ticket #{ticket['ticket_number']} (OID {oid}) to {staff_email}: {error_msg}")
                    write_notification_log(ticket["ticket_id"], staff_email, int_subj, "FAILED", error_msg)
            else:
                write_notification_log(ticket["ticket_id"], staff_email, int_subj, "FAILED", "Template render failed")

            processed += 1

        except Exception as exc:
            # One ticket failing must never abort the rest of the batch.
            record_failure(f"Unhandled error on OID {oid}: {exc}\n{traceback.format_exc()}")
            continue

    log(f"Done - processed {processed} of {len(batch)} ticket(s)")
    log("=" * 60)


if __name__ == "__main__":
    run(main)
