# Code structure

Line numbers are anchors as of the audit; they drift, so search for the symbol name when they do.

## Files

| Path | What it is |
|---|---|
| `manifest.json` | Widget name, label, version, EB version, default size. Version is bumped with `package.json`. |
| `config.json` | Default config (see Config keys). |
| `package.json` | Name, version, keywords, license, `scripts.test`, `scripts.typecheck`. No dependencies. |
| `tsconfig.json` | Mode B editor type check (self-contained, `jsx: react-jsx`). ts-loader reads it too, so never change `jsx`. |
| `src/runtime/widget.tsx` | The whole runtime: constants, photo pipeline, the `Widget` class (data, edits, export, render). |
| `src/runtime/lib/format.ts` | Pure date formatters and the table name matcher. Tested. |
| `src/runtime/lib/labels.ts` | Status, priority, category and comment type labels, `toggleVal`. Tested. |
| `src/runtime/theme.ts` | Shared `useTokens()` hook. Byte copy across widgets; do not edit. |
| `src/runtime/components/HelpPopup.tsx` | Generic help guide (modal, search, accordion). Copied verbatim; do not edit. |
| `src/runtime/components/FirstRunHint.tsx` | The "New here?" banner. |
| `src/runtime/helpSections.ts` | Help guide content for this widget, gated by feature flags. The one help file you edit. |
| `src/runtime/translations/default.ts` | Help strings, first-run strings, and the `ctl*` control names the tests check. |
| `src/setting/setting.tsx` | Builder settings panel. Must never import `esri/*`. |
| `src/shared/beacon.ts` | Anonymous usage telemetry (shared module). |
| `src/exb-editor-shims.d.ts` | Master editor shim from `widgets\_vs`. Copy, never edit. |
| `src/vendor-shims.d.ts` | This widget's own editor declarations (`jimu-for-builder` shape, `calcite-components`). |
| `tests/transpile.js` | Compiles every source file to `tests/build/` and reports syntax errors. |
| `tests/*.test.js` | node --test suites (help guide, format, labels). |
| `docs/handover/` | These files. |

## Config keys

| Key | Default | Read at | Effect |
|---|---|---|---|
| `useMapWidgetIds` | `[]` | `renderRoot`, `helpFeatures` | The map the widget follows. Without it the list says "Connecting to map..." forever. |
| `ticketsLayerTitle` | `Tickets` | `onView` | Exact title of the Tickets feature layer in the web map. |
| `commentsTableName` | `Ticket_Comments` | `onView` | Token match against table titles (underscores and spaces are the same, case folded). |
| `photosTableName` | `Ticket_Photos_Meta` | `onView` | Same match. Photos themselves are attachments on the Tickets layer since 1.1.0. |
| `surveyTableName` | `Survey_Responses` | `onView` | Same match. |
| `orgName` | `GIS Division` | `exportToExcel` | Workbook author and summary subtitle. |
| `showHelp` | `true` | `helpEnabled` | Help button, guide and first-run hint. `false` hides all three. |
| `telemetry` | unset (on) | `beacon.init` | `false` turns the beacon off for the app. |

## Where is X

| Looking for | File and anchor |
|---|---|
| Status, priority, category labels | `src/runtime/lib/labels.ts` (`S`, `P`, `C`, `CT`) |
| Status and priority chip colors | `widget.tsx:23` (`SC`, `PC`) |
| Page size (50) | `widget.tsx:25` (`PG`) |
| Internal notes length cap (500) | `widget.tsx:29` (`INTERNAL_NOTES_MAXLEN`) |
| Table column widths and floors | `widget.tsx:40` (`COL_DEFAULT_WIDTH`, `COL_FLOOR_WIDTH`) |
| Sort options in the toolbar | `widget.tsx:75` (`SORT_OPTS`) |
| Saved filters (localStorage key, shape, load, save) | `widget.tsx:89` (`FILTER_STORAGE_KEY`, `SavedFilters`, `loadSavedFilters`, `saveFilters`) |
| Sidebar width memory | `widget.tsx:97` constants, `setupSidebarWidthTracking` at `widget.tsx:1441` |
| Category to department map, unrestricted departments | `widget.tsx:162` (`CAT_DEPT`, `UNRESTRICTED_DEPTS`, `validCatsForDept`) |
| Routing integrity check (amber banner, blocks save) | `widget.tsx:208` (`integrityWarning`) |
| Theme tokens for the class component | `widget.tsx:239` (`Themed`, `DEFAULT_TOKENS`), used as `this.tk` |
| Help strings lookup and hint storage key | `widget.tsx:257` (`t`, `HELP_HINT_KEY`) |
| Reduced motion rule | `widget.tsx:274` (`ROOT_CLASS`), injected in `componentDidMount` |
| Photo validation and metadata strip | `widget.tsx:340` to `1050` (`validateMediaFile`, `compressPhoto`, `getSafeUploadName`) |
| Portal token for REST calls | `widget.tsx:320` (`getAgolToken`) |
| State shape | `widget.tsx:1074` (`interface St`) |
| Mount: saved filters, deep link, styles, sidebar | `widget.tsx:1215` (`componentDidMount`) |
| Column filter changes trigger reloads | `widget.tsx:1286` (`componentDidUpdate`) |
| Help open, close, flags, first-run dismissal | `widget.tsx:1605` (`openHelp`, `helpFeatures`, `helpEnabled`) |
| Photo viewer open and close with focus return | `widget.tsx:1622` (`openLightbox`, `closeLightbox`) |
| Has Comments / Has Survey / Has Photos server filter | `widget.tsx:1669` (`refreshBadgeFilter`) |
| Map connection, layer and table discovery, domains | `widget.tsx:1793` (`onView`) |
| WHERE clause from every filter | `widget.tsx:1924` (`buildWhere`) |
| Page load and badge counts | `widget.tsx:2038` (`load`), `widget.tsx:2084` (`loadBadges`) |
| Opening a ticket, zoom to it | `widget.tsx:2261` (`select`) |
| Saving edits, required note, audit comments | `widget.tsx:2413` (`save`) |
| Comment with photo attachment | `widget.tsx:2559` to `2685` (`processAttachment`, `uploadCommentPhoto`, `addComment`) |
| Excel export (CDN load, sheets, download) | `widget.tsx:2686` (`exportToExcel`) |
| Error and success banners | `widget.tsx:3346` (`renderMsg`) |
| Toolbar filter buttons | `widget.tsx:3355`, `widget.tsx:3449` |
| Column resize (mouse and keyboard) | `widget.tsx:3550` (`startColResize`), `widget.tsx:3645` (`nudgeColWidth`) |
| Column filter popovers | `widget.tsx:3669` (`renderColFilterPopover`) |
| Table view | `widget.tsx:3960` (`renderTicketTable`) |
| List view: search, filters, cards, pagination | `widget.tsx:4508` (`renderList`) |
| Detail view: tabs, edit rows, comments, photos, survey | `widget.tsx:4952` (`renderDetail`) |
| Photo viewer (portal to body) | `widget.tsx:5357` |
| Help button, root render, live region, HelpPopup | `widget.tsx:5539` to end |
| Help guide content and flags | `src/runtime/helpSections.ts` |
| Help text | `src/runtime/translations/default.ts` |
| Settings panel fields | `src/setting/setting.tsx` (`renderBody`) |

## Data flow in one paragraph

`onView` waits for the map, finds the Tickets layer by title and the three tables by token match, reads the department and subcategory domains, then calls `load`. `load` builds a WHERE clause from the toolbar filters, column filters, date range, search and (when a badge filter is on) the ticket id set from `refreshBadgeFilter`, queries one page of 50, sets the layer's `definitionExpression` to the same clause so the map matches the list, and loads badge counts per ticket. `select` opens a ticket, loads its comments, photos and survey, highlights and zooms. `save` validates routing, requires a note on a status change, writes the ticket, then writes STATUS, ASSIGN and audit comments. `exportToExcel` re-queries everything matching the filters and builds the workbook in the browser.
