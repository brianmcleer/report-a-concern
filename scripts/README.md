# Scripts

Seven scheduled jobs plus the shared module they all use. Every script runs in a cloned ArcGIS Pro conda environment (arcpy is required for versioned edits) and is started by Windows Task Scheduler; see [../tasks](../tasks).

| Script | Schedule | What it does |
|--------|----------|--------------|
| `rac_notify_new_ticket.py` | every 5 min | For each ticket with `notification_sent = 0`: commits the flag, then emails the submitter a confirmation and the routed department a work notice. Logs both to `Notification_Log`. |
| `rac_reassign_notify.py` | every 5 min | Detects `assigned_to` changed since `last_notified_assignee`, emails the new department, updates the flag. |
| `rac_comments_mailer.py` | every 30 min | Emails public comments (`is_public = 1`, `email_sent = 0`) to the submitter, then marks them sent. |
| `rac_survey_mailer.py` | every 30 min | Emails a satisfaction survey link for tickets that reached Resolved or Closed with `survey_sent = 0`. |
| `rac_survey_pull.py` | every 30 min | Pulls new Survey123 responses from ArcGIS Online into `Survey_Responses`; emails the resolver when the respondent asked for a follow-up. |
| `rac_directors_report.py` | weekdays 12:00 | Per-director list of overdue tickets in the categories they oversee (`cfg.DIRECTOR_DICT`). |
| `rac_all_dept_report.py` | 1st of month 09:00 | Monthly summary of submitted, closed and open tickets by category. |

## Setup

1. Copy `config.example.py` to `config.py` and edit every value. `config.py` is git-ignored.
2. Copy `rac_secrets.example.py` to `rac_secrets.py` and fill in the ArcGIS Online password (survey pull only).
3. Put the `.sde` connection file for the ReportAConcern database where `SDE_CONNECTION` points. Never commit it.
4. Leave `TESTING_MODE = True` until a test ticket has gone all the way through. Every outbound email goes to `TESTING_EMAIL` while it is on.
5. Run one script by hand first (Program: **Command Prompt, regular user**):

   ```
   C:\envs\arcgispro-py3-rac\python.exe rac_notify_new_ticket.py
   ```

   Exit code 1 and a failure alert email mean something in the run failed; the console shows what.

## Shared module: rac_common.py

Everything the scripts have in common lives here, so a script is only its own logic.

| Function | Purpose |
|----------|---------|
| `cfg` | The imported `config.py`. |
| `log`, `err` | Timestamped console output (errors go to stderr). |
| `record_failure(msg)` | Log an error and queue it for the end-of-run alert. |
| `run(main)` | Entry point wrapper: catches unhandled exceptions, sends one alert email covering every failure, exits 1 if anything failed so Task Scheduler shows it. |
| `render_template(file, tokens)` | Reads an HTML template from `email-templates/` and substitutes `{token}` values. Organization tokens (`{org_name}`, `{org_website}`, `{org_logo_url}`, `{org_logo_alt}`, `{org_address}`, `{program_name}`, `{submit_app_url}`, `{manager_url}`, `{contact_name}`, `{contact_email}`) are always filled from config. |
| `send_html_email(to, subject, html, text_body=None, headers=None)` | Multipart HTML send through the relay. Returns `(ok, error)`. |
| `resolve_recipient(addr)` | Applies `TESTING_MODE`. |
| `write_notification_log(...)`, `notif_insert(cols, vals)`, `notif_scalar(sql)` | Audit table writes and reads by direct SQL. |
| `to_local`, `utc_naive_to_local_naive`, `local_now_naive` | Timezone helpers using `cfg.LOCAL_TIMEZONE`. |
| `private_value(name)` | Value from `rac_secrets.py`, empty string if the file is missing. |

## Design notes worth knowing

The notification flag is committed in its own short edit operation before any email is sent. If the commit fails (a version conflict because staff have the ticket open in the manager, a lock, a dropped connection) nothing is sent and the next run retries. If the commit succeeds and the send fails, the failure is logged and visible but the email is never re-sent. That ordering is what prevents duplicate emails.

`Notification_Log` is unregistered from versioning so it stays out of Compress. Every writer inserts with direct SQL and an explicit `OBJECTID = MAX(OBJECTID) + 1` with a short retry, never an insert cursor, so no write depends on the geodatabase row-id counter and no two scripts reuse an id.

Tickets and comments are read through the versioned feature class (the DEFAULT version), never the base table. A resolution made in the manager is in the DEFAULT delta at once, whereas the base table would not show it until the next Compress, which is how surveys once went out a full Compress cycle late.

Failure alerts try an optional shared `EmailService` module first (`cfg.SHARED_SCRIPTS_DIR`) and fall back to direct SMTP, so an alert never depends on a network share being reachable.

## Category labels

`categories.py` mirrors the Tickets subtypes and the per-subtype subcategory domains that `schema/build_schema.py` creates. The notify and reassign scripts read the domains live from the geodatabase; the report scripts use this file. Keep the two in step when categories change.
