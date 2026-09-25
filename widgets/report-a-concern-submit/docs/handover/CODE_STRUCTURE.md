# Code structure

Line numbers are approximate anchors for the version this file was written against. Search
for the symbol name if a line has moved.

## Files

| Path | What it holds |
|---|---|
| `manifest.json` | Widget name, label, version, EB version, default size. |
| `config.json` | Default config values the builder starts from. |
| `src/config.ts` | The `Config` interface, `CriticalAlert`, and `defaultConfig`. |
| `src/runtime/widget.tsx` | The whole runtime: constants, file validation, theme, styles, the class component with its lifecycle, data calls, validation and every `render*` method. |
| `src/runtime/lib/validators.ts` | `isValidEmail`, `isReservedEmailDomain`, `PHONE_DIGITS_RE`, `stripPhoneDigits`. Pure. |
| `src/runtime/lib/profanity.ts` | `normalizeLeet`, `containsProfanity` and the pattern lists. Pure. |
| `src/runtime/lib/categoryBoundaries.ts` | `CATEGORY_BOUNDARY_MAP`, the fallback used when no lookup table is configured. Pure data. |
| `src/runtime/theme.ts` | `useTokens()`, the family's shared theme reader. Byte copy of the reference; do not edit. Not called by the class component itself (see below). |
| `src/runtime/esri.d.ts` | Open `__esri.X` interfaces for the editor type check. |
| `src/exb-editor-shims.d.ts` | Ambient declarations of react, jimu and esri modules for the editor (mode B). Copy of the master, do not rewrite. Not shipped in the zip. |
| `src/setting/setting.tsx` | Settings panel: every builder switch, the critical alert editor, XML import and export. Imports nothing from `esri/*`. |
| `src/shared/beacon.ts` | Shared telemetry module. |
| `tests/` | `transpile.js` and the node test files. `tests/build/` is generated and ignored. |
| `docs/handover/` | This folder. |

## Where is X (widget.tsx)

| I want to change... | Look at |
|---|---|
| The four step names | `STEP_LABELS`, about line 716 |
| Photo limits and compression | `MAX_PHOTOS`, `MAX_PHOTO_SIZE_MB`, `COMPRESS_*`, lines 714 to 733; `processPhotoFile`, about line 3643 |
| Allowed photo types and the magic byte check | `PHOTO_ALLOWED_EXTS`, `PHOTO_ALLOWED_MIMES`, `checkMagicBytes`, lines 770 to 990; `compressPhoto` (1033), `isobmffIsClean` (1170), `validateMediaFile` (1273) |
| Colors | `resolveTheme`, about line 1486 (reads the EB theme, same paths as `theme.ts`); `buildStyles`, about line 1538 |
| Phone numbers in messages becoming links | `linkifyPhones`, about line 1968 |
| Deep link handling (`?ticket_number=`) | `captureDeepLinkTicket`, `consumeDeepLinkTicket`, about lines 2007 to 2035; `componentDidMount`, about line 2187 |
| Wizard state kept across a phone rotation | `saveWizardState`, `loadWizardState`, `clearWizardState`, about lines 2069 to 2087; `componentDidUpdate`, about line 2263 |
| Map connection, layer and table discovery | `onViewReady`, about line 2350; `parseSubtypes`, about line 2518 |
| Status view data | `loadTicketStatus` (2553), `loadStatusPhotos` (2669), `loadTicketComments` (2764) |
| Step navigation, focus and announcements | `goToStep`, `focusStepHeading`, `announce`, about lines 2828 to 2846 |
| Field validation and error messages | `validateLocation`, `validateDetails`, `validateContact`, about lines 2866 to 2935 |
| Service boundary check | `checkGeofence`, about line 3011; `showCategoryBoundary` draws the outline, 3121 |
| Category filtering | `checkCategoryGeofence` (3233, fallback map), `queryLookupTable` (3305), `getFilteredCategories` (3358) |
| GPS and address search | `useGPS` (3409), `fetchSuggestions` (3510), `searchAddress` (3537) |
| Critical issue alerts (call instead) | `getCriticalAlert` (3794), `renderCriticalAlertBanner` (3902) |
| Submitting the ticket | `onSubmit` (4046), `submitViaREST` (4106), `submitViaLayer` (4146), `onSubmitSuccess` (4184), `uploadAttachmentREST` (4226) |
| The stepper at the top | `renderStepper`, about line 4358 |
| Step 1 Location | `renderStepLocation`, about line 4402 (also holds the per-step CSS block) |
| Step 2 Details | `renderStepDetails`, about line 4863 |
| Step 3 Contact | `renderStepContact`, about line 5201 |
| Step 4 Review | `renderStepReview`, about line 5308 |
| Success screen and copy link | `renderSuccess`, about line 5424; `copyTicketUrl`, 4320 |
| Ticket status view | `renderTicketStatus`, about line 5509 |
| Loading and submitting screens | `renderLoading` (5674), `renderSubmitting` (5711) |
| Header, live region, focus ring, reduced motion, portrait lock | `render`, about line 5813 |

## Where is X (setting.tsx)

| I want to change... | Look at |
|---|---|
| Panel colors | `panelColors`, near the top, same reads as `theme.ts` |
| Category and subcategory pickers for the alert editor | `fetchMetadata`, about line 87 (plain `fetch` of `?f=json`, never an esri import) |
| Writing a config key | `setConfig`, about line 145 |
| Critical alert rows and the phones array | lines 171 to 260 |
| XML export and import | `exportConfigAsXML` (332), `handleConfigImport` (405), `parseAndApplyConfigXML` (431) |
| A settings section | `render`, from line 583; sections in order: Import/Export, Map Source, Layer Configuration, Geofencing, Category Filtering, Ticket Boundary Field, Write Endpoint, Public Comments, Address Search, Display Options, Labels and Header, Critical Issue Alerts |

## Theme and the class component

`src/runtime/theme.ts` is the family's token reader and is a hook, so a class component cannot
call it. `resolveTheme()` in `widget.tsx` and `panelColors()` in `setting.tsx` read the same
paths from the theme object EB passes in `props.theme` (`sys.color.primary.main`,
`sys.color.surface.paper`, `surface.background`, `surface.paperText`, `surface.paperHint`,
`divider.secondary`, `error.main`) with the same fallback order. Keep the three in step when
the reference `theme.ts` changes. `textLight` and `textMuted` stay literal on purpose: they are
the AA contrast greys and a theme's hint color is not guaranteed to pass.

## Config keys

| Key | Type | Default | Used for |
|---|---|---|---|
| `useMapWidgetIds` | string[] | [] | The Map widget the form uses. |
| `ticketsLayerIndex` | number | 0 | Sublayer index of the Tickets layer in the map service. |
| `boundariesLayerIndex` | number | 1 | Sublayer index of the service boundaries polygons. |
| `boundariesLayerUrl` | string | "" | Standalone REST URL for the boundaries; overrides the index. |
| `boundaryIdField` | string | boundary_id | Field on the boundaries that identifies each one. |
| `enableCategoryFiltering` | boolean | true | Filter categories by the boundary the point falls in. |
| `lookupTableIndex` | number | 2 | Index of the category to boundary lookup table. |
| `lookupTableUrl` | string | "" | Standalone REST URL for the lookup table. |
| `invalidCategoryBehavior` | hide or show_message | show_message | What to do with categories that are not valid here. |
| `populateBoundaryId` | boolean | true | Write the matched boundary id onto the ticket. |
| `ticketBoundaryIdField` | string | boundary_id | Field on Tickets that receives it. |
| `writeEndpointUrl` | string | "" | Create-only FeatureServer layer for writes. Blank falls back to the map layer. |
| `enableGeocoder` | boolean | true | Show the address search. |
| `geocoderUrl` | string | "" | Geocoder REST URL; blank uses the World geocoder. |
| `submitButtonLabel` | string | Submit Report | Text of the submit button. |
| `successMessage` | string | (see config.ts) | Text on the success screen. |
| `headerTitle` | string | Report A Concern | Header text. |
| `outsideBoundaryMessage` | string | (see config.ts) | Text when the point is outside every boundary. |
| `headerImageUrl`, `headerImageAlt`, `headerImageLink` | string | "" | Optional logo, its alt text and link. |
| `headerTitleAlign` | left, center, right | left | Title position in the header. |
| `headerTitleSize` | number | 20 | Title font size in px. |
| `maxPhotoSizeMB` | number | 15 | Client-side size cap per photo. |
| `maxPhotos` | number | 3 | Photo slots shown. |
| `mobileMode` | boolean | false | Hide the map pin button and lead with GPS and address search. |
| `criticalAlerts` | CriticalAlert[] | [] | Category and subcategory pairs that show a "call instead" banner. |
| `criticalAlertDefaultMessage` | string | (see config.ts) | Banner text when an alert has none of its own. |
| `categoryMetadataUrl` | string | "" | Layer URL the settings panel reads subtypes from. |
| `statusQueryUrl` | string | "" | Public Query-enabled layer for the status view. |
| `commentsTableUrl` | string | "" | Explicit comments table URL. |
| `commentsTableName` | string | Ticket Comments | Table name to match in the web map. |
| `commentsTableIndex` | number | 6 | Table index fallback on the tickets service. |
| `telemetry` | boolean | (unset, on) | `false` turns the beacon off for this app. Read by `beacon.ts`, not declared in `config.ts`. |
