# Deployment

This is the fresh-install runbook. It assumes you know ArcGIS Enterprise and Windows Server but have never seen this system. Work top to bottom; each step assumes the previous one is done. Every command names the program to run it in and whether it needs elevation.

Hostnames throughout are placeholders. Replace them with yours:

| Placeholder | Role |
|---|---|
| `gis.example.gov` | Public web server: IIS, ArcGIS Server (federated), the proxy, the scripts |
| `gis-internal.example.gov` | Internal ArcGIS Server hosting the Manager service and staff app |
| `portal.example.gov` | ArcGIS Enterprise Portal |
| `sql.example.gov` | SQL Server hosting the `ReportAConcern` database |
| `C:\Apps\RAC` | The folder on `gis.example.gov` where this repository is checked out |
| `<svc-account>` | The domain account that runs the scheduled tasks and owns the `.sde` connection |

If the public web server also runs a DNS alias (for example `reportaconcern.example.gov` pointing at `gis.example.gov`), put the alias in every citizen-facing URL and in the CORS list, and the real host name only in server-internal references (UNC paths, Admin REST). The next host move is then a DNS and CORS change only.

## Prerequisites

| Requirement | Notes |
|---|---|
| ArcGIS Enterprise 11.x or 12.x | Portal plus at least one federated ArcGIS Server site. The public and internal servers must be at the same version as Portal. Two server sites (public and internal) are recommended; one site works for a small deployment if you accept that the public site also hosts the Manager service. |
| SQL Server 2019 or later | One database, `ReportAConcern`, registered as an enterprise geodatabase. The `.sde` connection files use Windows authentication. |
| Windows Server 2022 or 2025 with IIS 10 | On the public server. Role services: Static Content, Default Document, Request Filtering, and whatever the ArcGIS Web Adaptor needs. |
| IIS URL Rewrite 2.1 and Application Request Routing 3.0 | Both installed on the public server. Without ARR the proxy rewrite rule returns 404. |
| ArcGIS Pro on the public server | Provides the `arcgispro-py3` Python environment with `arcpy`. The scripts need `arcpy`; the proxy does not. Pro must be licensed on that machine (Single Use or a named user signed in for the service account). |
| Experience Builder Developer Edition | On a workstation, for building and publishing the two widgets. |
| ArcGIS Online organization | Hosts the Survey123 satisfaction form. |
| SMTP relay | Reachable on port 25 from the public server, accepting mail from the `FROM_ADDR` sender without authentication. Delivery to outside domains usually needs the mail administrator to allow-list the server's outbound IP (a connector plus SPF for Exchange Online). Confirm external delivery works before go-live. |
| A domain service account | Log on as a batch job right on the public server, Modify on `C:\Apps\RAC`, a SQL login mapped to the geodatabase with INSERT on `Notification_Log`. |

## 1. Check out the repository

Program: **Command Prompt (regular)** on `gis.example.gov`.

```
cd /d C:\Apps
git clone <repository-url> RAC
```

Do not put the checkout inside OneDrive or any synced folder. See [troubleshooting.md](troubleshooting.md).

## 2. Create the database and the `.sde` connection

1. On `sql.example.gov`, create an empty database named `ReportAConcern` with the FULL recovery model. Program: **SQL Server Management Studio (regular)**.
2. In ArcGIS Pro on any workstation, run Create Enterprise Geodatabase against it (Database Platform SQL Server, instance `sql.example.gov`, database `ReportAConcern`, operating system authentication). Program: **ArcGIS Pro (regular)**.
3. Grant `<svc-account>` a login and map it to the database with data reader, data writer, and INSERT, UPDATE and DELETE on the tables. Program: **SQL Server Management Studio (regular)**.
4. Create two `.sde` connection files with operating system authentication: an administrative one on your workstation for schema work, and one at `C:\Apps\RAC\ReportAConcern.sde` on the public server that the scripts will use. Never commit either file. Program: **ArcGIS Pro (regular)**, Database Connection.

## 3. Build the schema

`schema/build_schema.py` creates the feature dataset, feature classes, tables, domains, subtypes, relationship classes, the `ticket_number` SQL sequence and the performance indexes, then registers the transactional tables as versioned with archiving. It is idempotent on an empty database and refuses to run on one that already has `Tickets`.

Program: **ArcGIS Pro conda prompt (regular)**, from your workstation, using the administrative connection.

```
cd /d C:\path\to\report-a-concern\schema
python build_schema.py --sde "C:\Connections\ReportAConcern_admin.sde"
```

What it produces:

| Object | Kind | Versioned | Archived |
|---|---|---|---|
| `Tickets` | Point feature class with subtypes per category and attachments | Yes | Yes |
| `Ticket_Comments` | Table, related to Tickets, cascade delete | Yes | Yes |
| `Ticket_Photos_Meta` | Table, related to Tickets | Yes | Yes |
| `Survey_Responses` | Table, related to Tickets | Yes | Yes |
| `Notification_Log` | Append-only audit table | Yes | Yes |
| `Service_Boundaries` | Polygon feature class | No | No |
| `Category_Boundary_Lookup` | Table | No | No |
| `Ticket_Routing` | Table | Yes | No |
| `Redirect_Contacts` | Table | No | No |
| `Ticket_Retention_Summary`, `_Control`, `_Audit` | Plain tables | No | No |

The `TicketStatus`, `DepartmentAssignment` and per-category `Subcategory_*` domains are created from `scripts/categories.py`, so edit that file first if your category list differs from the sample.

## 4. Load boundaries and routing rows

Load in this order because each table references the previous one.

1. Append your service-area polygons into `Service_Boundaries`. Populate `boundary_id` (unique text), `boundary_name`, `boundary_type` and `is_active = 1`. The spatial reference of the feature class is set by `build_schema.py`; project on the way in. Program: **ArcGIS Pro (regular)**, Append tool.
2. Populate `Category_Boundary_Lookup` with one row per category that is offered in each boundary, `is_valid = 1`. Add a `redirect_message` on any category and boundary pair that is not offered but that citizens will expect.
3. Populate `Redirect_Contacts` with the default out-of-area message and any boundary-specific ones.
4. Populate `Ticket_Routing`. At minimum add one catch-all row (NULL subcategory) per category per boundary with `default_assignee` (a value from the `DepartmentAssignment` domain) and `assignee_email`. Add subcategory-specific rows only where routing differs from the catch-all. Use distribution list addresses where several people should receive mail.

`Ticket_Routing` is versioned. Loading it by direct SQL before it has ever been edited through the geodatabase is fine and is the fastest way to bulk load, but be aware of the row-id caveat in [operations.md](operations.md#adding-routing-rows-and-the-row-id-caveat) for every insert after that.

Verify coverage before moving on. Program: **SQL Server Management Studio (regular)**.

```sql
SELECT category, boundary_id
FROM dbo.Category_Boundary_Lookup l
WHERE is_valid = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.Ticket_Routing r
                  WHERE r.category = l.category AND r.boundary_id = l.boundary_id
                    AND r.subcategory IS NULL AND r.is_active = 1);
```

Zero rows means every offered category has a catch-all.

## 5. Publish the feature services

Three services are published from the same geodatabase. Register `C:\Apps\RAC\ReportAConcern.sde` (public server) and the administrative connection (internal server) as data stores on each ArcGIS Server site first, or publishing will copy the data to the server.

| Service | Server | Layers | Capabilities | Sharing |
|---|---|---|---|---|
| `RAC/ReportAConcern_Reporter` | Public | `Tickets` (layer 0, attachments enabled), `Ticket_Comments` | Feature Access: **Create and Uploads only**. No Query, Update, Delete or Sync. | Everyone (anonymous). The federated server must also allow anonymous access to the service. |
| `RAC/ReportAConcern_Reporter_Display` | Public | `Tickets` (a read-only view without PII fields), `Ticket_Comments` filtered to public rows, `Service_Boundaries` | Map and Feature Access: **Query only** | Everyone |
| `RAC/ReportAConcern_Manager` | Internal | `Tickets`, `Ticket_Comments`, `Ticket_Photos_Meta`, `Survey_Responses`, `Ticket_Routing`, `Service_Boundaries` | Feature Access: Create, Query, Update, Delete, Uploads | Staff groups only |

Publish each from an ArcGIS Pro map (Share As Web Layer, reference registered data). Program: **ArcGIS Pro (regular)**. After publishing, open `https://gis.example.gov/arcgis/rest/services/RAC/ReportAConcern_Reporter/FeatureServer/0?f=json` in a browser and confirm the fields, subtypes and attribute rules appear under the layer's editing info.

Then apply the upload restrictions to the Reporter service. This must be repeated after every Experience Builder republish, because publishing resets it. Program: **ArcGIS Pro conda prompt (regular)** on the public server.

```
cd /d C:\Apps\RAC\scripts
python patch_rac_upload_restrictions.py
```

Confirm through Server Manager or the Admin REST endpoint that `allowedUploadFileTypes` reads `jpg,jpeg,png,heic,avif` and `maxUploadFileSize` matches `MAX_ATTACHMENT_BYTES` in the proxy configuration.

## 6. Attribute rules

Five Arcade attribute rules on `Tickets` do the server-side validation and routing. **The Arcade expressions are not included in this repository** because they reference your boundary layers, domain values and redirect wording. Write them in ArcGIS Pro (Tickets, Design, Attribute Rules) against the administrative connection before publishing the services, or, if the services are already published, follow the unregister-versioning sequence in [operations.md](operations.md#the-unregister-versioning-sequence) because rules cannot be altered while the class is versioned.

| Rule | Type | Trigger | Field | What it must do |
|---|---|---|---|---|
| `RAC_FieldPresence_Validate` | Constraint | Insert | none | Reject the insert unless `description`, `category`, `submitted_by_email` and a geometry are present. Return a plain-language error the widget can show. |
| `RAC_BusinessLogic_Validate` | Constraint | Insert | none | Reject a `category` outside the configured code range (the sample uses 1 to 13), a `status` other than the initial one, and any other invariant you need. Update the range when you add a category. |
| `RAC_Geofence_Validate` | Constraint | Insert | none | Intersect the point with `Service_Boundaries` where `is_active = 1`. If no polygon matches, reject with the default message from `Redirect_Contacts`. If a polygon matches but `Category_Boundary_Lookup` has no `is_valid = 1` row for the category in that boundary, reject with that pair's redirect message. |
| `RAC_Geofence_Route` | Calculation | Insert | `boundary_id` | Repeat the intersection, take the first boundary with a valid category row, and return a dictionary that sets `boundary_id` and also `assigned_to`. Look up `Ticket_Routing` for `(category, subcategory, boundary_id, is_active = 1)`; if no row, retry with subcategory NULL; if still no row, leave `assigned_to` null. |
| `RAC_TicketNumber_Sequence` | Calculation | Insert | `ticket_number` | Return `NextSequenceValue("rac_ticket_number")`. `build_schema.py` creates the sequence starting at 10000. |

Keep the constraint rules ordered before the calculation rules. Use `FeatureSetByName` with the lookup tables and `First()` on the filtered result; the composite indexes created by `build_schema.py` are there to make those filters fast. Test each rule by inserting a row in Pro before publishing.

## 7. Deploy the widgets

Both widgets live in this repository under `widgets/`, each with its own README, CHANGELOG and install notes. Release zips for each widget are attached to every GitHub release.

| Widget | Repository | App |
|---|---|---|
| Public submit wizard | [widgets/report-a-concern-submit](../widgets/report-a-concern-submit) | Experience Builder app published to `C:\inetpub\wwwroot\ReportAConcern` on `gis.example.gov`, anonymous |
| Staff manager | [widgets/rac-manager](../widgets/rac-manager) | Experience Builder app on `gis-internal.example.gov`, behind Portal sign-in |

For each: copy the widget folder into `client/your-extensions/widgets/` of Experience Builder Developer Edition so `manifest.json` sits directly inside `widgets/<name>/`, run `pnpm install` in the `client` folder (Program: **Command Prompt (regular)** on the workstation), start the client, add the widget to the app, configure it, and publish.

Submit widget settings that must be same-origin with the page:

| Setting | Value |
|---|---|
| `writeEndpointUrl` (proxy base) | `https://gis.example.gov/ReportAConcern/proxy` |
| `featureServiceUrl` (public read layer) | `https://gis.example.gov/arcgis/rest/services/RAC/ReportAConcern_Reporter_Display/FeatureServer/0` |
| `commentsTableUrl`, `statusQueryUrl`, `boundariesLayerUrl` | Layers of the same Display service |
| `geocoderUrl` | Your locator on `gis.example.gov`, with the ArcGIS World Geocoder as fallback |

If the page is served from an alias, every one of these must use the alias too. A widget URL on a different host than the page is a CORS failure in the browser before the request ever reaches IIS.

Publish the submit app to a folder under Default Web Site and make it an IIS application named `ReportAConcern`. Program: **IIS Manager (Run as administrator)**. Do not add any URL Rewrite rule or header inside that application; the next publish wipes it.

## 8. IIS site-level rules

The rewrite rules, the direct-POST block, the no-cache outbound rule and the security headers all live on **Default Web Site**, never on the `ReportAConcern` application. See [../proxy/web.config.example](../proxy/web.config.example) for the exact XML.

1. Enable the ARR proxy: IIS Manager, server node, Application Request Routing Cache, Server Proxy Settings, tick Enable proxy. Leave "Reverse rewrite host in response headers" unchecked. Program: **IIS Manager (Run as administrator)**.
2. Merge the `<rewrite>` and `<httpProtocol>` sections from `web.config.example` into the site's `web.config` (`C:\inetpub\wwwroot\web.config`), or recreate the rules by hand in the URL Rewrite feature at the site level. Program: **Notepad (Run as administrator)** or IIS Manager.
3. Raise Request Filtering, Maximum allowed content length, at the site level to at least three times `MAX_ATTACHMENT_BYTES` plus overhead so a three-photo submission is not rejected before it reaches the proxy.
4. Bind HTTPS on 443 with a certificate whose subject alternative names include the host and any alias.
5. Back up the IIS configuration. Program: **Command Prompt (Run as administrator)**.

```
%windir%\system32\inetsrv\appcmd add backup "RAC-initial"
```

Verify from any machine. Program: **Command Prompt (regular)** or PowerShell.

```
curl -I https://gis.example.gov/
```

Expect `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and no `X-Powered-By`.

## 9. The proxy

Full detail is in [../proxy/README.md](../proxy/README.md). The short version:

1. The base `arcgispro-py3` environment is read-only on current ArcGIS Pro installs, so clone it. Program: **ArcGIS Pro conda prompt (Run as administrator)** on `gis.example.gov`.

   ```
   conda create --clone arcgispro-py3 --name arcgispro-py3-rac
   ```

   `conda env list` shows where the clone landed. Call that interpreter `<clone-python>` below (typically `C:\Users\<user>\AppData\Local\ESRI\conda\envs\arcgispro-py3-rac\python.exe`). Grant `<svc-account>` read and execute on the clone folder.

2. Install the proxy's dependencies into the clone. Program: **Command Prompt (regular)**.

   ```
   cd /d C:\Apps\RAC\proxy
   <clone-python> -m pip install -r requirements.txt
   ```

3. Copy `proxy_config.example.py` to `proxy_config.py` and edit: `FEATURE_SERVER_BASE` (the Reporter layer on localhost port 6443), `CORS_ORIGINS` (exactly the origin of the public page), the bounding box in the layer's projected coordinates, `VALID_CATEGORIES`, and `DB_CONN_STR` pointing at `sql.example.gov`.

4. Run it once in the foreground to see any error. Program: **Command Prompt (regular)**.

   ```
   cd /d C:\Apps\RAC\proxy
   <clone-python> rac_proxy.py
   ```

   In a second window: `curl http://localhost:5000/health` returns `{"status":"ok"}`. Stop it with Ctrl-C.

5. Add a Windows Firewall inbound rule that blocks TCP 5000 from every remote address. IIS reaches the proxy over loopback, and nothing else should. Program: **PowerShell (Run as administrator)**.

   ```powershell
   New-NetFirewallRule -DisplayName "RAC proxy loopback only" -Direction Inbound -Protocol TCP -LocalPort 5000 -RemoteAddress Any -Action Block
   ```

## 10. Script configuration

1. Copy `scripts/config.example.py` to `scripts/config.py` and fill in every section: organization branding for the templates, SMTP relay, alert recipients, `SDE_CONNECTION` (`C:\Apps\RAC\ReportAConcern.sde`), the three application URLs, the routing fallback addresses, Survey123 item IDs, Portal URL, director and monthly report recipients. Leave `TESTING_MODE = True` for now.
2. Copy `scripts/rac_secrets.example.py` to `scripts/rac_secrets.py` and fill in the ArcGIS Online service account password (and the Portal password if you use the per-person survey follow-up). Both files are git-ignored. Nothing else in `scripts/` needs editing between deployments.
3. Prove that `arcpy` and the connection work as the service account. Program: **Command Prompt (Run as administrator)**, using `runas` so the test runs under `<svc-account>`.

   ```
   runas /user:DOMAIN\<svc-account> "\"C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe\" -c \"import arcpy, config; print(arcpy.Describe(config.TICKETS_FC).name)\""
   ```

4. Dry-run each mailer once with `TESTING_MODE = True` so all mail goes to `TESTING_EMAIL`. Program: **ArcGIS Pro conda prompt (regular)**.

   ```
   cd /d C:\Apps\RAC\scripts
   python rac_notify_new_ticket.py
   python rac_reassign_notify.py
   python rac_comments_mailer.py
   python rac_survey_mailer.py --dry-run
   python rac_survey_pull.py --dev
   ```

   Each should end without a failure alert and write a `Notification_Log` row (or report nothing to do).

## 11. Task Scheduler

The [../tasks/](../tasks/) folder holds one XML export per job. Import them all, then fix the two things an export cannot carry: the account and the paths.

Program: **Command Prompt (Run as administrator)** on `gis.example.gov`.

```
for %f in (C:\Apps\RAC\tasks\*.xml) do schtasks /Create /TN "RAC\%~nf" /XML "%f" /RU DOMAIN\<svc-account> /RP *
```

Then open each task in Task Scheduler (Program: **Task Scheduler (Run as administrator)**) and confirm:

| Task | Trigger | Action |
|---|---|---|
| RAC_Proxy | At system startup, restart every 30 seconds on failure | `<clone-python> C:\Apps\RAC\proxy\rac_proxy.py`, Start in `C:\Apps\RAC\proxy` |
| RAC_NotifyNewTicket | Every 5 minutes | `arcgispro-py3 python.exe C:\Apps\RAC\scripts\rac_notify_new_ticket.py`, Start in `C:\Apps\RAC\scripts` |
| RAC_ReassignNotify | Every 5 minutes | same pattern |
| RAC_CommentsMailer | Every 30 minutes | same pattern |
| RAC_SurveyMailer | Every 30 minutes, **no `--dry-run` argument** | same pattern |
| RAC_SurveyPull | Every 30 minutes | same pattern |
| RAC_DirectorsReport | Weekdays at 12:00 | same pattern |
| RAC_AllDeptReport | First of the month at 09:00 | same pattern |
| RAC_UploadRestrictionsPatch | On demand | `patch_rac_upload_restrictions.py` |
| RAC_RetentionPurge | Monthly, off-hours | `rac_retention_purge.py` |

All tasks: "Run whether user is logged on or not". Only the proxy task uses the cloned interpreter; the others need `arcpy` and use the base one. Start the proxy task and confirm it is listening. Program: **Command Prompt (regular)**.

```
schtasks /Run /TN "RAC\RAC_Proxy"
netstat -ano | findstr :5000
curl -I https://gis.example.gov/ReportAConcern/proxy/health
```

Expect `LISTENING` and an HTTP 200 with the HSTS header.

## 12. Go-live checklist

| Check | How |
|---|---|
| `TESTING_MODE = False` in `scripts/config.py` | Open the file; confirm the timestamp. No restart is needed, each task starts a fresh interpreter. |
| Survey mailer task has no `--dry-run` | Task Scheduler, RAC_SurveyMailer, Actions tab |
| Every Portal item the public app loads is shared with Everyone | Reporter service, Reporter_Display service, basemap, locators, and the app item itself. A private item shows "Item does not exist or is inaccessible" to anonymous users. |
| Reporter service allows anonymous access on the server | Server Manager, service, Security. A public item on a service that requires a token returns HTTP 499 "Token Required" on `applyEdits`. |
| Every widget URL is same-origin with the page | Browser DevTools, Network tab, during a test submission: every request goes to the page's host. |
| Site-level IIS rules present and no app-level duplicates | `curl -I` shows the headers; IIS Manager, ReportAConcern application, URL Rewrite is empty |
| Direct POST to the FeatureServer is refused | `curl -X POST https://gis.example.gov/arcgis/rest/services/RAC/ReportAConcern_Reporter/FeatureServer/0/applyEdits` returns 403; a GET on the Display service returns JSON |
| Upload restrictions patched since the last publish | Admin REST shows `allowedUploadFileTypes` |
| Real department emails in `Ticket_Routing` | Query the table; no test addresses remain |
| Test data wiped | `rac_wipe_tickets.py` run once, then `SELECT COUNT(*)` on Tickets is 0. Decide deliberately whether to reset the sequence. |
| End-to-end test through the public app | Submit with a photo; confirmation email in 5 minutes with a working status link; routing email at the department; ticket in the Manager with `boundary_id` and `assigned_to`; reassignment and comment emails on their next cycles; survey email after Resolved |
| External email delivery | The confirmation to a non-organization address arrives (proves the relay allow-list or connector) |
| Proxy survives a reboot | Reboot, wait two minutes, run the health check |
| IIS configuration backed up | `appcmd add backup "RAC-golive"` |
| Tag the repository | `git tag golive-YYYY-MM-DD` |
