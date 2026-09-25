# Troubleshooting

Symptom, likely cause, what to do. Messages are quoted as the widget shows them.

## Setup and build

| Symptom | Cause | Fix |
|---|---|---|
| Widget missing from the builder, or "report-a-concern-submit is duplicated" | A nested folder (`widgets\report-a-concern-submit\report-a-concern-submit`), a leftover copy, or a stale build under `client\dist\widgets`. | One folder with `manifest.json` directly inside it. Delete `dist\widgets\report-a-concern-submit` only (never all of `dist`) and restart `pnpm start`. |
| Settings panel is blank in the builder | Something under `src/setting/` imports an `esri/*` module, or the widget tsconfig was changed to classic `jsx: "react"`. | Settings must stay esri-free (`fetchMetadata` uses plain `fetch`). Keep `jsx: "react-jsx"` and `jsxImportSource: "@emotion/react"` in `tsconfig.json`. |
| "Cannot convert undefined or null to object at hasOwnProperty" after a full rebuild | The widget tsconfig emitted classic `React.createElement` calls. | Same fix as above; the tsconfig `jsx` setting must match the client. |
| Visual Studio shows thousands of errors from `jimu-core` files | A `paths` or `baseUrl` entry crept back into `tsconfig.json`. | Remove it; the widget is mode B, self-contained. Close VS, delete the widget's `.vs` folder, reopen. |
| `npx tsc -p .` reports TS2694 on `__esri.Something` | The interface is not declared in `src/runtime/esri.d.ts`. | Add an empty open interface for it there. |
| `npm test` fails with "Cannot find module 'typescript'" | Running outside the EB install. | `npm install --no-save typescript` in the widget folder, then run again. |

## In the form

| Symptom | Cause | Fix |
|---|---|---|
| "No map widget configured." | The widget has no Map widget selected. | Settings, Map Source, pick the map. |
| Form stays on the loading skeleton | `onViewReady` never finished: the map failed to load, or the Tickets layer index is wrong so subtypes could not be read. | Check the map loads on its own; check Layer Configuration indexes against the service. |
| "Could not verify service area." | The boundaries layer query failed (wrong index or URL, or the service needs a token the public does not have). | Set `boundariesLayerUrl` to a public layer, or fix the index. |
| Every point is "outside the service area" | Boundaries layer is right but the point and the polygons are in different spatial references and the server could not project, or the boundaries layer is empty. | Query the boundaries layer in the browser with `?f=json&where=1=1&returnCountOnly=true`. Check the `spatialRel` query works with a known inside point. |
| Category list is empty or shows every category everywhere | Category filtering is on but the lookup table URL or index is wrong. The widget then shows the unfiltered list with a yellow warning. | Fix `lookupTableUrl` or `lookupTableIndex`; or turn filtering off and rely on `CATEGORY_BOUNDARY_MAP`. |
| "This category is not available for the selected location." on a category that should work | The lookup table has `is_valid=0` for that category and boundary, or (no lookup table) `CATEGORY_BOUNDARY_MAP` requires a boundary type the point is not in. | Fix the lookup row, or the map in `src/runtime/lib/categoryBoundaries.ts`. |
| "Please remove any inappropriate language before submitting." on clean text | A profanity pattern matched an innocent word. | Reproduce with `containsProfanity` in `npm test` (add the phrase to the safe list in `tests/profanity.test.js`), then tighten the pattern in `src/runtime/lib/profanity.ts`. |
| "Please enter a valid email address." on a real address | The address uses a reserved test domain (`example.com`, `.test`, `.local`) or a form the strict validator rejects (quoted local part, IP literal). | Reserved domains are blocked on purpose (the mailer rejects them). For other cases, extend `EMAIL_RE` in `src/runtime/lib/validators.ts` and add a test. |
| Photo rejected: "File type not allowed." or "Could not verify file integrity." | The bytes do not match the extension or MIME (renamed file), the JPEG has data appended after its end marker, or an HEIC/AVIF container has an invalid box. | Ask for the original photo from the camera. This is the client-side upload security check working as designed. |
| Android photo picker shows no camera or Drive option | The `accept` attribute is an explicit MIME list. | Keep `accept="image/*"`; the JS allowlist does the real check. |
| Photos upload but never appear on the ticket | The attachment upload after `applyEdits` failed (token, size, or attachments not enabled on the layer). Upload failures are non-fatal by design. | Enable attachments on the write layer, check the size cap, check the browser network tab for the `addAttachment` response. |
| Submit fails with "Server error: ..." | The Create-only FeatureServer rejected the row: a required field, a domain value, or the attribute rule (geofence rule at insert time). | The message carries the server text. Compare the payload fields in `onSubmit` with the layer schema. |
| Location detected then form resets on a phone rotation | Wizard state restore did not run. | State is saved to `sessionStorage` under `rac_wizard_state_v1` in `componentDidUpdate` and restored in `componentDidMount`; check the browser allows session storage. |

## Status view (`?ticket_number=N`)

| Symptom | Cause | Fix |
|---|---|---|
| "Could not retrieve ticket #N." | `statusQueryUrl` is blank and the map layer has Query disabled (public Create-only site), or the URL points at a layer without the `ticket_number` field. | Set `statusQueryUrl` to a public Query-enabled layer that excludes personal fields. |
| Ticket shows but no "Staff Updates" | `commentsTableUrl` is blank and no table in the map matches `commentsTableName`, or the comments have `is_public=0`. | Set `commentsTableUrl`. Only public comments are shown. |
| Ticket shows but no staff photos | Attachments on the ticket do not start with `staff-`, or the status layer has no attachments enabled. | Photos come from the manager widget's public comments; internal note photos (`staffint-`) are never shown. |
| Link opens the form instead of the status view | EB rewrote the URL before the widget mounted. | The widget reads the parameter at module load and keeps it in `sessionStorage` (`rac_pending_ticket`); make sure the link uses `ticket_number=` (or `ticket=`) and the page URL is not being changed by another widget. |

## Accessibility

| Symptom | Cause | Fix |
|---|---|---|
| Screen reader does not announce the new step | The live region at the root of `render()` is missing or `goToStep` no longer sets `liveMessage`. | Both are in `widget.tsx`; keep `goToStep` as the single place that changes `step`. |
| Keyboard users cannot reach Add Photo | The file inputs were changed back to `display: none`. | They use the `VISUALLY_HIDDEN` style so they stay in the tab order. |
| Animations still run with reduced motion on | A new animated element sits outside `#rac-submit-root`. | Keep every element inside the root div; the reduced motion rule is scoped to it. |

Still stuck? Contact the GIS Division and mention the Report A Concern Submit widget and the app name.
