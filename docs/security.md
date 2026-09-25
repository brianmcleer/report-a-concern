# Security

Report a Concern accepts anonymous writes from the public internet into an enterprise geodatabase that staff also edit. Everything in this page exists to make that safe. The controls are layered so that no single misconfiguration exposes the database: the browser can only reach the proxy, the proxy only forwards what it has validated, the service only accepts creates and uploads, and the database enforces the business rules regardless of what reached it.

## Trust boundaries

| Boundary | Control |
|---|---|
| Internet to IIS | HTTPS only, HSTS, site-level headers, direct FeatureServer POSTs refused, request size limits |
| IIS to proxy | Loopback only; port 5000 blocked from every remote address by Windows Firewall |
| Proxy to Reporter service | Localhost; the proxy validates, normalizes and rate-limits before forwarding |
| Reporter service to geodatabase | Create and Uploads only; attribute rules validate every insert |
| Staff to Manager service | Portal token, group membership, internal server |
| Scripts to geodatabase | One domain service account with Windows authentication, no stored passwords |

## Proxy validation layer

The proxy (`proxy/rac_proxy.py`) is the only write path from the public. Every check below runs before the request is forwarded, and every refusal is written to `Notification_Log` with a `BLOCKED` status, the reason and the source IP, so abuse is visible in the same table as everything else.

| Check | What it does | Setting |
|---|---|---|
| Rate limit | Counts submissions per client IP in a rolling window and returns 429 above the limit. The IP comes from `X-Forwarded-For`, which ARR sets, falling back to the socket address. In memory, so a restart resets it. | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_S` |
| One feature per request | Refuses batches. A citizen submits one concern at a time. | fixed |
| Geometry | Must be numeric and inside a configured bounding box in the layer's projected coordinates. This is a cheap pre-filter; the authoritative geofence is the attribute rule. | `BBOX_*` |
| Category | Must be one of the configured codes. | `VALID_CATEGORIES` |
| Description | Required and capped in length. | `MAX_DESCRIPTION_LEN` |
| Status | If present must be the initial status. A citizen cannot submit a ticket as Resolved. | fixed |
| Contact fields | Name, email and phone are length and shape checked. | `MAX_NAME_LEN` |
| Attachments | Size capped. The first bytes are compared against JPEG, PNG, WebP and HEIC/HEIF signatures. The declared MIME type is discarded and replaced with the detected one before forwarding, so a renamed executable is refused with 415 and a mislabeled photo still works. | `MAX_ATTACHMENT_BYTES` |
| CORS | Only origins in the allow-list receive `Access-Control-Allow-Origin`. Anything else gets no CORS headers and the browser blocks the response. | `CORS_ORIGINS` |

The proxy never holds a Portal token and never talks to anything but the Reporter service and the log table. It runs from a cloned Python environment without `arcpy` and writes the log through a Windows-authenticated ODBC connection, so there are no credentials in its configuration file.

Client-side checks in the widget (file count, extension, profanity filter, email format) are for the citizen's benefit. Anything a browser enforces can be bypassed with request interception, so nothing security-relevant depends on the widget.

## IIS headers and rewrite rules

All of this lives on Default Web Site, in `applicationHost.config` or the site's root `web.config`, never inside the `ReportAConcern` application. Experience Builder republishes replace the application folder and delete any configuration placed there; the one incident in this system's history where public submissions broke after a publish was a rewrite rule that had drifted to the application level. [../proxy/web.config.example](../proxy/web.config.example) holds the exact XML.

| Item | Purpose |
|---|---|
| Rewrite rule `RAC Flask Proxy` | `^ReportAConcern/proxy/(.*)` rewritten to `http://localhost:5000/{R:1}`, stop processing. The only way public traffic reaches the proxy. |
| Rewrite rule `Block Direct FeatureServer POST` | Any `POST` to `arcgis/rest/services/*/FeatureServer/*` through the public site returns 403. Reads still work. This closes the path around the proxy for anyone who discovers the service URL. |
| Outbound rule on `.js` and `.json` | `Cache-Control: no-cache, no-store, must-revalidate` so a republished widget bundle takes effect immediately and users are never running a stale build with a fixed bug. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (add `preload` once every subdomain is HTTPS). |
| `X-Content-Type-Options: nosniff` | Stops browsers guessing content types on uploads and downloads. |
| `X-Frame-Options: SAMEORIGIN` | The submit form cannot be framed by another site. |
| `X-Powered-By` removed | From both IIS and ARR. |
| Request Filtering maximum content length | Set at the site level to a little above three attachments' worth so IIS, not the proxy, is never the surprising limit, but also so nothing larger reaches the proxy. |

Verify after any IIS change and after every reboot: `curl -I https://gis.example.gov/` shows the three headers and no `X-Powered-By`; a `POST` to the FeatureServer returns 403; the health endpoint returns 200. Back up IIS with `appcmd add backup` before and after changes.

The ArcGIS Server administrative endpoints (6443 and 6080) should be reachable only from internal administrative subnets, with administrative access through the Web Adaptor turned off, and the Services Directory disabled on the public site once publishing is finished so the service list is not browsable.

## Service-layer hardening

| Setting | Value | Why |
|---|---|---|
| Reporter service capabilities | Create, Uploads | The public can insert a ticket and attach a photo. It cannot query, update or delete, so PII in existing tickets is unreachable through this service even if the proxy were bypassed. |
| Reporter_Display service capabilities | Query only, on a view without contact fields | The status page and the boundary preview read from here. Public comments are filtered to `is_public = 1`. |
| `allowedUploadFileTypes` | `jpg,jpeg,png,heic,avif` | Enforced by ArcGIS Server itself, independent of the proxy. Reset by every republish; reapplied by `patch_rac_upload_restrictions.py`. |
| `maxUploadFileSize` | Matches `MAX_ATTACHMENT_BYTES` | Same. |
| Anonymous access | Reporter and Reporter_Display only | The Manager service is on the internal server and shared to staff groups. |
| Attribute rules | Five rules on insert | Required fields, business invariants, geofence, routing and numbering are enforced in the database. A request that reaches the service by any route still cannot create an out-of-area or malformed ticket. |
| Editor tracking | On | `created_user`, `last_edited_user` and dates on every row for the audit trail and the survey follow-up. |

The hosted-attachment endpoint in ArcGIS Online requires a token even on a public item, which is why photos are enterprise attachments through the proxy and not a hosted layer; the alternative would have put a credential in the public widget.

## PII handling and retention

The system stores a submitter's name, email, phone, a free-text description and photos, and the point where they reported the problem. That is personal data and it is handled as follows.

| Concern | Handling |
|---|---|
| Who can read it | Staff with Portal access to the Manager service. The public Display service exposes no contact fields. Public comments are visible only on the status page for that ticket number. |
| Email content | The citizen's confirmation contains their own details. The internal routing email contains the citizen's contact details for the department that has to call them; it goes to a department address, and distribution lists are managed by the mail administrator. |
| Logging | `Notification_Log` records recipient, subject and outcome, not message bodies. The proxy logs sanitized request summaries, never photo bytes or full descriptions. |
| Survey responses | Ratings and free-text comments linked to the ticket. The dashboard shows aggregates. |
| Retention | Four years from the date the ticket was Resolved or Closed, then a true delete of the ticket and every related row: comments, photo metadata, attachments, survey responses and log rows. Open tickets are never purged. Deleted data lingers in routine SQL and IIS backups until those rotate. |
| What survives the purge | Three plain tables. `Ticket_Retention_Summary` is a permanent, de-identified ledger written before each purge: one row per closure month, submission month, category, subcategory, final status and department, holding ticket counts, total resolution days and the rating distribution as sums and counts. It contains no ticket IDs, names, contact details, addresses, free text or photos, and has no key back to a purged record. `Ticket_Retention_Control` tracks which months have been summarized and purged so a run is resumable and never double-counts. `Ticket_Retention_Audit` records every run: when, which months, how many rows deleted, and by which process. |

The purge job (`rac_retention_purge.py`) runs monthly under Task Scheduler with a `DRY_RUN` flag that is left on until the dry-run log has been reviewed. It summarizes and stamps a month in one transaction, then deletes, then stamps again, so a crash between the two steps resumes at the delete without re-aggregating. Adjust the retention period and the migration cutoff in the script's `CONFIG` block to match your own records policy before the first live run.

## Secrets handling

| Secret | Where it lives | Never |
|---|---|---|
| Service account password | Task Scheduler's credential store; the `.sde` file uses Windows authentication so no password is saved there | In any file in the repository |
| `.sde` connection files | On the server next to the scripts and on the administrator's workstation | Committed. `*.sde` is git-ignored. Even with Windows authentication the file names the server and database, and with database authentication it contains the password. |
| ArcGIS Online service account password (Survey123 pull) | `scripts/rac_secrets.py`, git-ignored, readable only by the service account | In `config.py`, in the script, or in the repository history |
| Portal password (optional per-person survey follow-up) | `scripts/rac_secrets.py` | Same |
| Proxy configuration | `proxy/proxy_config.py`, git-ignored. Contains no passwords; the log connection uses Windows authentication. | Committed with a real bounding box or host if you consider those sensitive |
| Environment configuration | `scripts/config.py`, git-ignored. Hostnames, addresses, item IDs. | Committed |
| TLS private key | Windows certificate store on the public server | Exported to disk except for a controlled renewal |

`rac_secrets.py` is named that way rather than `secrets.py` so it never shadows the Python standard library module of that name. `rac_common.secret()` reads it and returns an empty string when a value is missing, so a missing secret produces a clear authentication failure rather than a crash at import.

If a credential was ever committed, treat it as compromised: rotate it, then remove it from the repository history before the repository is made public. Rotating is the part that matters; rewriting history is hygiene.

The service account should hold only what the jobs need: a login on the geodatabase with read and write on the ticket tables and INSERT on `Notification_Log`, SELECT and DELETE on the ticket tables plus INSERT and UPDATE on the retention tables for the purge, Modify on the scripts folder, Log on as a batch job, and nothing administrative on ArcGIS Server or Portal. The upload-restrictions patch is the one script that needs an ArcGIS Server administrator token; run it on demand from an administrator's session rather than storing that credential on the server.

## Open items

These are known gaps in the shipped configuration. Each deployment should decide how to close them.

| Item | Risk | Suggested direction |
|---|---|---|
| Services Directory enabled on the public ArcGIS Server site | Reveals every service name to anyone browsing `/arcgis/rest/services` | Disable after publishing; re-enable temporarily when troubleshooting |
| Administrative REST endpoint reachable from the internet | Brute-force surface on the server administrator account | Restrict 6443 and 6080 to internal subnets at the firewall; disable administrative access through the Web Adaptor |
| No scheduled web application scan | Regressions go unnoticed | Run a baseline scan (OWASP ZAP or similar) quarterly against the public host and after each major change |
| Rate limiter is per-process and in-memory | Resets on restart; a second server would not share it | Acceptable for a single server. Move to a shared store if the proxy is ever scaled out |
| Rate limiter keys on the client IP | Shared NAT addresses (apartments, carriers) can be throttled together | Tune the window; consider a per-email secondary limit |
| Survey pull de-duplicates on `ticket_id` | A second legitimate response for the same ticket is dropped | Key on the Survey123 response GUID instead |
| A failed survey follow-up email is not retried | The response is already imported, so the flag that would drive a retry does not exist | Log a `FAILED` row (already done) and review weekly, or add a `followup_sent` column |
| Confirmation email is at-most-once | A confirmation lost during an SMTP outage is not resent automatically | Query `Notification_Log` for `FAILED` confirmations after any relay outage and resend by hand |
| Test-data wipe does not restore versioning state on interrupt | An interrupted wipe can leave a table unregistered | Wrap the script in the same try/finally pattern as the schema scripts |
| Reopen does not clear `resolved_date` | The retention clock can start from the first closure of a reopened ticket; the purge guards with a modified-date check | Maintain `resolved_date` on reopen in the Manager, then simplify the guard |
| `Notification_Log` grows without bound | Query performance | Archive rows older than 18 months to CSV annually |
