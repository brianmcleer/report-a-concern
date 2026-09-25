# RAC Submission Proxy

A small Flask application (served by waitress) that sits between the public
Report a Concern Experience Builder widget and the ArcGIS Enterprise
FeatureServer. The widget never talks to the FeatureServer directly: IIS
rewrites `/ReportAConcern/proxy/*` to this process on `localhost:5000`, the
proxy validates the request, then forwards it to the FeatureServer over
localhost. Every request, accepted or not, is logged to the
`Notification_Log` table.

## Endpoints

| Method | Path                    | Purpose                                              |
|--------|-------------------------|------------------------------------------------------|
| GET    | `/health`               | Liveness check, returns `{"status": "ok"}`           |
| POST   | `/applyEdits`           | Ticket submission, form-encoded `adds` array (one feature) |
| POST   | `/<oid>/addAttachment`  | Photo upload for the ticket with ObjectID `<oid>`    |

Both POST routes also answer `OPTIONS` for CORS preflight.

## Validation layer

- **Rate limit**: `RATE_LIMIT_MAX` submissions per client IP per
  `RATE_LIMIT_WINDOW_S` seconds, in-memory. Exceeding it returns 429 and logs
  `BLOCKED`.
- **Payload**: exactly one feature per request; geometry must be numeric and
  inside the `BBOX_*` extent; `category` must be in `VALID_CATEGORIES`;
  `description` required and capped at `MAX_DESCRIPTION_LEN`; `status` if
  present must be 1; name, email and phone are length and shape checked.
- **Attachments**: size capped at `MAX_ATTACHMENT_BYTES`; the first bytes are
  checked against PNG, JPEG, WebP and HEIC/HEIF magic numbers. The declared
  MIME type is ignored and replaced with the detected one before forwarding.
- **CORS**: only origins listed in `CORS_ORIGINS` receive
  `Access-Control-Allow-Origin`. Anything else gets no CORS headers and the
  browser blocks the response.

All settings live in `proxy_config.py`. Copy `proxy_config.example.py` to
`proxy_config.py` and edit it; the file is git-ignored.

## Install

The base ArcGIS Pro environment (`arcgispro-py3`) is read-only, so clone it
and install the dependencies into the clone.

1. Clone the environment. Program: **ArcGIS Pro conda prompt (Run as
   administrator)**.

   ```
   conda create --clone arcgispro-py3 --name arcgispro-py3-rac
   ```

2. Install the requirements into the clone using the clone's own
   `python.exe`. Program: **Command Prompt (regular)**.

   ```
   "C:\Users\<user>\AppData\Local\ESRI\conda\envs\arcgispro-py3-rac\python.exe" -m pip install -r requirements.txt
   ```

   The env path may differ (`C:\Program Files\ArcGIS\Pro\bin\Python\envs\...`
   on some installs); `conda env list` in the ArcGIS Pro conda prompt shows it.

3. Copy `proxy_config.example.py` to `proxy_config.py` and edit the values.

## Run manually

Program: **Command Prompt (regular)**, from the `proxy` folder, using the
clone's `python.exe`.

```
python rac_proxy.py
```

The process prints nothing on success; it is listening when the health check
answers.

## Health check

```
curl http://localhost:5000/health
```

Expected: `{"status":"ok"}`. Through IIS the same check is
`https://<public-host>/ReportAConcern/proxy/health`.

## Task Scheduler (run at startup)

Import `tasks/RAC_Proxy.xml` from the repo root into Task Scheduler. It runs
`rac_proxy.py` with the clone's `python.exe` at system startup, whether or not
a user is logged on. After importing, check the action's paths match this
server and set the run-as account to one that has INSERT on
`Notification_Log` and read access to the proxy folder.

## IIS setup

1. Install URL Rewrite 2.1 and Application Request Routing 3.0.
2. In IIS Manager, at the server node, open Application Request Routing
   Cache > Server Proxy Settings and tick **Enable proxy**.
3. Merge the rules in `web.config.example` into the **site-level**
   `web.config` (Default Web Site). Do not put them in the `/ReportAConcern`
   application; Experience Builder republishes overwrite that folder.
4. Set the widget's `writeEndpointUrl` to
   `https://<public-host>/ReportAConcern/proxy` (same host as the page).
5. Recycle the app pool and run the health check through IIS.

## Gotchas

- **ARR not installed or proxy not enabled**: the rewrite rule returns 404,
  not 502. Check Server Proxy Settings before anything else.
- **IIS HTML 500 page instead of JSON on `/proxy/...`**: the Flask process is
  not listening. Run `python rac_proxy.py` in a console to see the error, or
  check the scheduled task's last run result.
- **CORS**: every URL the widget calls must be the same origin (scheme + host
  + port) as the page it runs on, or the browser blocks the POST before it
  reaches the proxy. `CORS_ORIGINS` must list that origin exactly.
- **Firewall**: Windows Firewall can block port 5000 from other machines, so
  remote `curl` tests fail while loopback still works. IIS talks to the proxy
  over loopback, so this is normal and the port does not need to be opened.
- **Missing `proxy_config.py`**: the process exits immediately with a message
  saying to copy the example file.
