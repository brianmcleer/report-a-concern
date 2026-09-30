# RAC Dashboard

Internal, read-only dashboard for the Report a Concern system. Four static HTML pages with no build step: drop the folder on a web server, fill in one `CONFIG` block per page, sign in with Portal.

| Page | What it shows |
|---|---|
| `index.html` | Live dashboard: open, in-progress, resolved and year-to-date KPIs with sparklines, ticket map (points, clusters, heat), tickets created over 90 days, by category, by department, recent tickets, satisfaction by department, citizen satisfaction and comment themes. Every chart, slice and KPI tile filters the rest of the page. |
| `survey-responses.html` | Every survey response with rating, follow-up, comments and response time. Filter, sort and export to Excel. |
| `routing-lookup.html` | The category and subcategory to department routing table, searchable. |
| `historical-trends.html` | Long-term history from the retention ledger (monthly aggregates of tickets purged after the retention window). Reads a published layer or a static `retention_ledger.json`. |
| `oauth-callback.html` | Portal sign-in callback. Must sit in the same folder. |

## Requirements

- ArcGIS Enterprise Portal and the Manager, Routing Lookup and (optional) Retention map services from `docs/deployment.md`.
- Any static web server on the same network as those services (IIS works). No server-side code.
- The pages load the ArcGIS Maps SDK for JavaScript 4.34 and Chart.js 4.4 from their public CDNs, so the browser needs to reach `js.arcgis.com` and `cdn.jsdelivr.net`.

## Configure

1. **Register an OAuth app in Portal.** Portal, Content, New item, Application, Other application. Under Settings, Registered info, add a redirect URI for wherever the folder will live, ending in `oauth-callback.html`, for example `https://gis-internal.example.gov/reportaconcerndashboard/oauth-callback.html`. Copy the Client ID.
2. **Edit the `CONFIG` block** near the top of the script in each page (any text editor):

   | Key | Pages | Value |
   |---|---|---|
   | `oauthAppId` | all four | The Client ID from step 1 |
   | `portalUrl` | all four | `https://<your portal>/portal` |
   | `serviceUrl` | index, survey-responses | The Manager MapServer (tickets layer 0, survey table 5 by default; change `layers` / `surveyLayer` / `ticketsLayer` if yours differ) |
   | `serviceUrl` | routing-lookup | The Routing Lookup layer |
   | `ledger.serviceUrl` or `ledger.jsonUrl` | historical-trends | The Retention layer, or set `ledger.mode` to `"json"` and put a ledger export next to the page |
   | `managerUrl` | survey-responses | The Manager app URL (ticket links) |
   | `categoryLabels` | index | Your category code to label list |

3. **Fix the links.** Search each page for `example.gov` and replace the footer links (Open Manager, Public Submit) and the ticket deep link in `index.html` with your app URLs.
4. **Swap in your logo.** In `index.html`, replace the `<span class="logo logo-text">` placeholder in the header with an `<img class="logo">` (the comment above it shows the tag). Replace `icon.png` with your own favicon.

## Deploy

Copy the **whole folder, including `fonts/`**, to the web server (for IIS, a folder under Default Web Site on the internal server, next to the Manager app). Without `fonts/` the pages fall back to Arial.

Browse to `index.html`, sign in, and check that the KPIs fill in. If the sign-in pop-up opens and closes with an error, the redirect URI in step 1 does not match the page's URL exactly.

## Look and feel

- **Light and dark mode are automatic.** The pages follow the operating system or browser setting. There is no toggle.
- **Colors are tokens.** All colors live in the `:root` block at the top of each page's `<style>`. The dark values are mixed from the same palette with `color-mix()`, and the charts and map renderers read the tokens at draw time, so changing the palette block in all four pages rebrands everything, charts included. Keep text pairs at 4.5:1 or better in both modes.
- **Fonts:** Open Sans for body text and Montserrat for headings, self-hosted in `fonts/` (SIL Open Font License, see the license files in that folder).
- **Accessibility:** skip link, keyboard focus rings, underlined links, reduced-motion support, 24px minimum touch targets on touch screens.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "CONFIG.oauthAppId is empty, running anonymous" in the console, then 499 or "Token Required" | `oauthAppId` not set, or still the placeholder |
| Sign-in pop-up shows "Invalid redirect_uri" | Redirect URI on the OAuth app does not match the page URL (host, path and case) |
| Page in Arial | `fonts/` folder not copied next to the pages |
| Map or charts blank, console shows `require is not defined` | The browser cannot reach `js.arcgis.com` |
| Historical Trends says the ledger is missing | `ledger.serviceUrl` points at a layer that is not published yet; publish it or switch to `json` mode |

## License

Apache-2.0. Copyright 2026 City of Grand Junction, CO. See [LICENSE](../LICENSE). Fonts: SIL Open Font License 1.1.
