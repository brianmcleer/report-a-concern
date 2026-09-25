# Operations

Day-to-day upkeep of a running Report a Concern system. Read [deployment.md](deployment.md) first for the layout and the placeholders (`gis.example.gov`, `C:\Apps\RAC`, `<svc-account>`, `<clone-python>`). When something is broken, go to [troubleshooting.md](troubleshooting.md).

Keep a logbook. A shared spreadsheet with date, operator, change type, one-line description, affected component, how you verified it and how you would undo it is enough, and it pays for itself the first time something misbehaves three weeks after a change. Make an entry for every deploy, schema change, password rotation, certificate renewal, rate-limit change, attribute-rule edit and emergency intervention.

## Routine maintenance schedule

| Cadence | Time | Checks |
|---|---|---|
| Daily, weekdays | 5 minutes | Open `https://gis.example.gov/ReportAConcern/proxy/health` and expect `{"status":"ok"}` within a second. Query `Notification_Log` for the last 24 hours and look for `FAILED` rows or a gap in the five-minute notifier cadence. Open the Manager and confirm the list loads in a few seconds. Glance at Task Scheduler history for any RAC task with a non-zero last result. |
| Weekly, Monday | 15 minutes | Review `Notification_Log` volume by type for the past 7 days; a spike in rate-limit hits suggests spam and may warrant tuning. Check that no log file in `C:\Apps\RAC\logs` exceeds 50 MB. Send a test email through one mailer with `TESTING_MODE` or `--dry-run`. Count tickets Open more than 24 hours, Received more than 7 days, In Progress more than 30 days, and cross-check that the directors report ran Friday. Review last week's reassignments; a high rate points at routing-table gaps. |
| Monthly, first business day | 1 hour | Confirm the all-department report sent on the 1st. Run a geodatabase compress (below). Check SQL Server free space; `Tickets__ATTACH` grows fastest, and above 80 percent full schedule a file expansion. Compare `Service_Boundaries` with the authoritative limits layer after any annexation. Run the routing coverage query from [deployment.md](deployment.md#4-load-boundaries-and-routing-rows) to confirm every active category has a catch-all row per boundary. |
| Quarterly | Half a day | Rebuild SQL indexes on `Tickets`, `Ticket_Comments`, `Notification_Log` (rebuild above 30 percent fragmentation, reorganize between 10 and 30). Update statistics on the four routing tables. Rotate the service account password if policy requires it (below). Rebuild the composite locators so new addresses geocode. Run a web application scan against the public host and triage findings. Test a database restore to a non-production server. Back up the IIS configuration with `appcmd add backup`. Export the ArcGIS Online items (survey form, web maps) to JSON. |
| Annually | 1 to 2 days | Renew the TLS certificate 60 days before expiry; SANs must include every public host name and alias. Read the ArcGIS Enterprise release notes before any major upgrade and regression-test attribute rules, both widgets and the proxy on a staging server first. Refresh Experience Builder Developer Edition if a new release is out. Review `DIRECTOR_DICT` and `MONTHLY_REPORT_RECIPIENTS` in `config.py` for personnel changes. Archive `Notification_Log` rows older than 18 months to CSV and delete them from the live table. |

## Proxy lifecycle

The proxy is a long-running Task Scheduler job (`RAC\RAC_Proxy`) that starts at boot, runs as `<svc-account>`, and restarts itself 30 seconds after a crash. It listens on `localhost:5000`; IIS forwards `/ReportAConcern/proxy/*` to it.

| State | Task Scheduler shows | `netstat -ano \| findstr :5000` shows |
|---|---|---|
| Running | Last Run Result `0x41303` (still running) | `LISTENING` |
| Stopped cleanly | Last Run Result `0x0` | nothing |
| Crashed | Non-zero result; a retry is pending | nothing until the retry |

### Restarting the proxy

Preferred. Program: **Command Prompt (Run as administrator)** on `gis.example.gov`.

```
schtasks /End /TN "RAC\RAC_Proxy"
schtasks /Run /TN "RAC\RAC_Proxy"
netstat -ano | findstr :5000
curl -I https://gis.example.gov/ReportAConcern/proxy/health
```

Or in Task Scheduler (Run as administrator): Task Scheduler Library, RAC, right-click RAC_Proxy, End, then Run.

For debugging only, end the task, then run the process in the foreground so you can see import or binding errors. Program: **Command Prompt (regular)**.

```
cd /d C:\Apps\RAC\proxy
<clone-python> rac_proxy.py
```

Press Ctrl-C when done and start the scheduled task again. Never leave the foreground process running.

### Stopping the proxy safely

Before a reboot, a schema lock or a test-data wipe, stop the proxy cleanly so no citizen gets a 500 mid-submission. Tail `C:\Apps\RAC\logs\rac_proxy.log` for 30 seconds; no new lines means nothing is in flight. End the task, confirm port 5000 is free, do the maintenance, start the task. Optionally add a temporary site-level rewrite rule that returns a static maintenance page for `/ReportAConcern/proxy/*` during longer windows.

### After a server reboot

Wait two minutes for the startup trigger, check that 5000 is listening, run the health check through IIS, run `curl -I https://gis.example.gov/` and confirm the security headers are still present, then submit a test ticket.

### Rate-limit tuning

`RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_S` in `proxy_config.py` default to 20 submissions per IP per hour. Apartment buildings, hotels and mobile carriers share one address behind NAT, so watch the rate-limit rows in `Notification_Log` during an outage event before deciding the limit is too generous. The counters are in memory, so a restart resets them. Edit the file and restart the proxy; there is no hot reload.

### Service account password rotation

The service account owns every RAC task, the proxy task and the `.sde` connection. Update all of them in one window or the system goes quiet: change the account password on every task (Task Scheduler, Properties, Change User or Group), re-save the credential in each `.sde` file if it does not use operating system authentication, restart the proxy, then submit a test ticket and confirm both emails arrive.

## Widget redeploy rule

Experience Builder republishes replace the contents of the application folder (`C:\inetpub\wwwroot\ReportAConcern`). That is the entire reason the IIS rules live at the site level. Two rules follow:

1. **When you redeploy the public app, overwrite only `index.html`, `service-worker.js` and the `cdn` folder. Leave `web.config` alone.** If you publish from Builder rather than copying files, check afterward that no `web.config` appeared inside the application, and if one did, delete it (or confirm it contains nothing the site does not already provide). An application-level `web.config` that duplicates the site rules causes confusion at best and, on the next republish, silently disappears at worst.
2. **After every republish of the public app, run `patch_rac_upload_restrictions.py`** (the `RAC_UploadRestrictionsPatch` task) because publishing resets `allowedUploadFileTypes` and `maxUploadFileSize` on the Reporter service.

Then run the post-deploy checks: `curl -I` on the health endpoint shows 200 and the HSTS header; a test submission with a photo succeeds; the confirmation and routing emails arrive and are correctly themed; the status page renders; `Notification_Log` shows rows from the scripts that ran.

The Manager app has no IIS rules and no upload patch. Build, publish, then open a known ticket, change its status with a note, reassign it, add a public comment, save, and confirm an ASSIGN comment was written and the reassignment email fires on the next five-minute cycle.

Builder does not version published apps, so tag the widget repository before every publish. Rolling back means checking out the previous tag, rebuilding, republishing, and running the upload patch again. Never hand-edit files inside the application folder; the next publish discards them.

The internal dashboard pages are plain HTML with no build step: copy the changed files into their IIS folder, hard-reload the browser (Ctrl-F5) because the HTML is cached aggressively, and tag the repository.

## Schema modifications

The geodatabase is versioning-sensitive. Changing lookup rows is routine; changing structure (fields, subtypes, attribute rules, versioned lookup geometry) needs an exclusive lock and the sequence at the end of this section. Stop the proxy first so citizens do not hit a locked database.

### Adding a category

1. Pick the next unused subtype code. In ArcGIS Pro (administrative connection), open `Tickets`, Subtypes, and add the code and name.
2. Create a `Subcategory_<Name>` coded-value domain with the subcategory text values, and assign it to the `subcategory` field for the new subtype.
3. Add `Category_Boundary_Lookup` rows for the new code in every boundary where it is offered, `is_valid = 1`.
4. Add `Ticket_Routing` rows: a catch-all (NULL subcategory) per boundary, plus subcategory-specific rows where routing differs. See the row-id caveat below.
5. Update `RAC_BusinessLogic_Validate` so the accepted category range includes the new code, and `VALID_CATEGORIES` in `proxy_config.py` (restart the proxy). Editing the rule requires the unregister-versioning sequence.
6. Add the label to `scripts/categories.py` so the reports and emails show a name rather than a code.
7. No widget redeploy: both widgets read subtypes and domains at runtime.
8. Submit a test ticket in the new category.

### Adding a subcategory

Open the parent's `Subcategory_<Name>` domain in Pro and add the coded value. Add `Ticket_Routing` rows only if the subcategory routes somewhere other than the category catch-all. No rule edit, no widget redeploy. Test with a submission that selects it.

### Removing a category

Categories with tickets cannot be deleted. Set `is_active = 0` on its `Ticket_Routing` rows and `is_valid = 0` on its `Category_Boundary_Lookup` rows; the constraint rule then rejects new submissions and the Manager hides the inactive routing. Leave the subtype in place so history renders. Only once every ticket in the category has been closed or moved may the subtype be removed, and that needs the unregister-versioning sequence.

### Adding a service boundary

Add the polygon to `Service_Boundaries` with a unique `boundary_id`, `boundary_name`, `boundary_type` and `is_active = 1` (Pro, edit session; the class is not versioned so no lock is needed, but stop the proxy while you save). Add `Category_Boundary_Lookup` rows for every category offered there, `Ticket_Routing` catch-all rows for each, and a `Redirect_Contacts` row if the boundary needs its own citizen-facing message. Test with a point inside the new polygon.

### Updating boundary geometry

Load the new shape via Append or edit in Pro. Existing tickets keep their original `boundary_id`; only new submissions see the new geometry. If a change moves an area from one department to another, audit open tickets in that area by hand.

### Adding a department

Add the coded value to the `DepartmentAssignment` domain (the display value is what staff see in the Manager). Add `Ticket_Routing` rows for every `(category, subcategory, boundary)` it should own, with `assignee_email` set to a distribution list if several people should receive mail. If the department should be selectable across every category in the Manager's cascading dropdown, add it to the widget's `UNRESTRICTED_DEPTS` setting. Route a test ticket to it.

### Renaming a department

The domain code is stored as a string in `Ticket_Routing.default_assignee`, `Tickets.assigned_to` and `Tickets.last_notified_assignee`. Update `Ticket_Routing` first (so new tickets route under the new name), then `Tickets` and `Notification_Log` in a batch SQL update, then the domain value last. Changing only the domain leaves history with the old string and breaks the Manager's dropdown matching.

### Removing a department

Set `is_active = 0` on its routing rows, reassign its open tickets to a successor, and only then remove the domain value.

### Updating routing emails

Edit the `assignee_email` values in `Ticket_Routing` in Pro. Editing existing rows is safe through the versioned view; only inserts hit the caveat below. The scripts read the table on every cycle, so no restart is needed.

### Adding routing rows and the row-id caveat

`Ticket_Routing` is versioned. If rows were ever loaded by direct SQL (the usual bulk-load path), the geodatabase row-id counter did not advance and sits behind `MAX(OBJECTID)`. A later insert through a versioned cursor or the Pro editor is handed an OBJECTID that already exists in the base table; the insert appears to succeed, but the next Compress fails with a duplicate-key error on the row-id unique index and cannot trim states.

Until the counter is resynchronized, add rows to this table by direct SQL against the base table with an explicit `OBJECTID = MAX(OBJECTID) + 1`. Program: **SQL Server Management Studio (regular)**.

```sql
INSERT INTO dbo.Ticket_Routing (OBJECTID, category, subcategory, boundary_id, default_assignee, assignee_email, is_active)
SELECT MAX(OBJECTID) + 1, 7, NULL, 'CITY', 'Parks', 'parks@example.gov', 1
FROM dbo.Ticket_Routing;
```

If Compress has already failed on this table: unregister it as versioned with `NO_KEEP_EDIT` (this discards the conflicting delta row and leaves the base table untouched; skip `DisableArchiving`, the table is not archived), register it again, re-add the row by direct SQL as above, then Compress.

### The unregister-versioning sequence

Use this whenever a change needs an exclusive lock: adding or altering fields, altering attribute rules, removing a subtype, editing a versioned lookup. Run it as one script with the administrative connection so the `finally` block always executes. Program: **ArcGIS Pro conda prompt (regular)** on a workstation.

```python
import arcpy
sde = r"C:\Connections\ReportAConcern_admin.sde"
fc  = sde + r"\ReportAConcern.DBO.ReportAConcern_Data\ReportAConcern.DBO.Tickets"
try:
    arcpy.AcceptConnections(sde, False)          # refuse new connections
    arcpy.DisconnectUser(sde, "ALL")             # drop current ones
    try:
        arcpy.management.DisableArchiving(fc)    # attempt unconditionally
    except arcpy.ExecuteError:
        pass                                     # already off, or not archived
    arcpy.management.UnregisterAsVersioned(fc, "KEEP_EDIT", "NO_COMPRESS")
    # --- the change goes here, e.g. ---
    # arcpy.management.AlterAttributeRule(fc, "RAC_BusinessLogic_Validate", script_expression=new_arcade)
    arcpy.management.RegisterAsVersioned(fc, "NO_EDITS_TO_BASE")
    arcpy.management.EnableArchiving(fc)
finally:
    arcpy.AcceptConnections(sde, True)           # or nobody can connect
```

Notes that save time: `AcceptConnections` and `DisconnectUser` are top-level `arcpy` functions, not under `arcpy.management`. Do not pre-check `Describe().isArchived` before `DisableArchiving`; it is unreliable when archive state is damaged, so attempt the call and catch the error. `KEEP_EDIT` preserves pending edits; `NO_KEEP_EDIT` discards uncompressed delta edits and is the tool for dropping a phantom row. `NO_COMPRESS` avoids a cascade failure into any table whose archive is broken. If the script dies before the `finally`, run `arcpy.AcceptConnections(sde, True)` by hand or the database stays locked.

## Versioning and compress

The transactional tables are versioned with archiving. Every edit through the feature services lands in delta tables, and those grow until a Compress reconciles and posts the default version and trims them. Without a monthly compress, every query slows down, and the mailers that read through the versioned view start seeing stale data.

Monthly, off-hours: stop the proxy so submissions do not queue, run `arcpy.management.Compress` against the administrative connection from ArcGIS Pro or a conda prompt, watch for warnings about unposted versions (reconcile and post them from the Versioning toolbar), restart the proxy, and confirm the row count in `SDE.sde_state` dropped.

Compress only fully trims what the Manager service has posted. If staff leave the Manager open with unsaved edits across the compress, some states survive until the next run; that is normal.

### Repairing broken archive state

If a table's `_H` history table becomes malformed (it happens after an interrupted unregister), `DisableArchiving` fails and the versioned view can lag the base table. Repair: stop the scripts that write to the table, drop the `_H` table directly in SQL Server Management Studio (the geodatabase recreates it), run `DisableArchiving`, `RegisterAsVersioned` if needed, then `EnableArchiving`, and restart the scripts. Dropping a geodatabase-managed table by SQL is normally unsafe; `_H` tables are the exception because `EnableArchiving` rebuilds them.

## Notification_Log and direct SQL

`Notification_Log` is versioned. An `arcpy.da.InsertCursor` against a versioned table outside an edit session is silently discarded with no error. The scripts therefore write the log by direct SQL against the base table through `rac_common.notif_insert()`, and that has one consequence you will meet the first time you write your own insert:

**A direct SQL insert bypasses the geodatabase's ObjectID allocation, so `OBJECTID` arrives NULL and the NOT NULL constraint rejects the row.** The helper supplies `OBJECTID = MAX(OBJECTID) + 1` explicitly and retries a few times on a duplicate-key error, because several scripts insert into the same table and can collide in the same second. Any new script that writes to `Notification_Log` must go through the helper or copy that pattern.

Two related rules for reading through `ArcSDESQLExecute`: it cannot bind `uniqueidentifier` or long-text output columns and raises "ArcSDE Error -65" if you try, so `CAST` GUID columns to `varchar(50)` and `nvarchar(max)` columns to a bounded `varchar` in the SELECT. And keep a script's pending-read and its flag-write on the same layer (both base table, or both versioned view). The comments mailer once read pending comments through the versioned view and wrote `email_sent` through an edit session; on a table with a lagging archive the write was never seen by the next read and the same comment was emailed every run.

## Why the flag is committed before the email is sent

`rac_notify_new_ticket.py` sets `notification_sent = 1` (and `last_notified_assignee`) in its own small edit operation for each ticket, commits, and only then sends the two emails and writes the log rows. That looks backwards until you know the history.

The original version opened one edit session for the whole batch, sent every email inside it, and committed all the flags at the end. Committing at the end can fail: a version conflict is easy to trigger when a staff member has the same ticket open in the Manager, and a lock or a timeout does the same. When it failed, every flag in the batch rolled back after every email had already been delivered, and five minutes later the next run sent them all again. That was the cause of the duplicate-email reports.

Marking first makes each ticket at-most-once. If the flag commit fails, nothing was sent and the next run simply retries. If the send fails after the flag is committed, the failure is recorded in `Notification_Log` as `FAILED` and a person decides whether to resend, which is preferable to a citizen receiving the same confirmation three times. The one cost is that a confirmation lost during an SMTP outage is not retried automatically; resetting `notification_sent` to 0 would also re-fire the internal routing email that already succeeded, so a targeted manual resend is the right fix.

The other mailers use the opposite order, send-then-mark, but still one ticket per commit. For a reassignment or a survey, a failed send leaving the row unmarked is the desired alarm (it retries next run), and because each ticket commits on its own, a conflict on one ticket can only ever re-send that one ticket, never the batch. What is never acceptable is the pattern that caused the problem: send inside a shared session and commit everything at the end.

## Test data

`rac_wipe_tickets.py` deletes in dependency order (`Survey_Responses`, `Ticket_Photos_Meta`, `Notification_Log`, `Ticket_Comments`, `Tickets`) and clears the Survey123 responses. Stop the proxy first, run it from a workstation with administrative rights on the geodatabase, restart the proxy, and confirm every count is zero. The lookup tables are not touched. Decide deliberately whether to reset the `ticket_number` sequence; leaving it alone is safe because the sequence only moves forward. If the wipe is interrupted, it does not restore versioning state on its own; repair by hand with the sequence above.

## Backups

Keep `ReportAConcern` in the standard SQL Server Full plus Differential plus Log chain and test a restore quarterly. After any restore, run `AnalyzeDatasets` and `RebuildIndexes`, open Tickets in Pro and confirm the five attribute rules are still attached (there is no `arcpy` call to list them), confirm the lookup tables are populated, and submit a test ticket. Back up IIS with `appcmd add backup` quarterly and before any change. Export ArcGIS Online items to JSON quarterly. Tag the repository before every deploy.
