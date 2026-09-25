# Handover: Report A Concern, Submit widget

Start here if you are picking this widget up for the first time. The other files in this
folder go deeper: `CODE_STRUCTURE.md` (where things are), `MAINTENANCE.md` (routine
changes) and `TROUBLESHOOTING.md` (symptom, cause, fix).

## What it is

An ArcGIS Experience Builder 1.21 widget. The public fills in a four-step form (Location,
Details, Contact, Review) and the widget writes one row to the Tickets feature layer with
`applyEdits`, then uploads up to three photos as attachments. A `?ticket_number=N` link on
the same page shows a read-only status view of that ticket with any public staff updates.

The widget is one file for the runtime (`src/runtime/widget.tsx`, a class component), one
file for the settings panel (`src/setting/setting.tsx`), and a few small pure modules under
`src/runtime/lib/` that the tests cover.

## Why there is no in-widget help guide

The playbook's help guide (Section 10) is added "only where it makes sense". This widget is a
public wizard: every step has a heading that says what to do ("Where is the concern?"), each
field has a label and a hint, the primary button names the next step, and errors are inline
next to the field. A Help button and a searchable guide would add a second place to read the
same instructions, for a user who is on the page once. The staff-facing RAC Manager widget is
the one that gets the guide. If the form ever grows a feature that needs explaining outside
the step it lives in, add the guide then by copying the pattern from the Time Machine widget.

## How to build

1. Copy the widget folder to `client\your-extensions\widgets\report-a-concern-submit\` in
   the Experience Builder install. `manifest.json` sits directly inside that folder.
2. In `client`, run `pnpm start` (EB 1.21 uses pnpm; `npm install` errors out by design).
3. Open the builder, add the widget to a page with a Map widget, and configure it in the
   settings panel (map widget, layer indexes, write endpoint, header, messages).

There are no widget-level dependencies. `package.json` has an empty `dependencies` block and
must stay that way: jimu, React and the Maps SDK all come from Experience Builder.

## Developer checks

From the widget folder, Command Prompt, regular user:

| Command | What it does | Must show |
|---|---|---|
| `npx tsc -p .` | Type check with the widget's own tsconfig (mode B, self-contained). | Nothing. |
| `npm test` | `node tests/transpile.js` (every source file transpiles) then `node --test tests/*.test.js`. | `syntax errors: 0`, then all tests pass. |

The tests need Node 20 or later and the `typescript` package on the path. In the EB install
it is there after `pnpm install` in `client`; anywhere else, `npm install --no-save typescript`
in the widget folder first.

## How to release

1. Update `CHANGELOG.md`: move the "Unreleased" items under a new version heading.
2. Bump the version in `manifest.json` and `package.json` together.
3. Run the developer checks above and `pnpm start` once to confirm the build.
4. `publish.ps1` in the mono-repo mirrors the widget, checks for banned strings and builds
   the zip. The zip leaves out `src/exb-editor-shims.d.ts` on purpose (see the README).

## Where the data goes

| Thing | Where |
|---|---|
| The ticket row | The Tickets layer at `writeEndpointUrl` (Create-only FeatureServer), or the map widget's layer when that is blank. |
| Photos | Attachments on the same feature, uploaded after the row is created. Upload failures do not fail the submission. |
| Status view reads | `statusQueryUrl` (a public, Query-enabled layer with no personal fields), else the map layer. |
| Public comments | `commentsTableUrl`, else a table in the web map whose name matches `commentsTableName`, else the tickets service plus `commentsTableIndex`. |
| Wizard state across a phone rotation | `sessionStorage` key `rac_wizard_state_v1`, cleared on submit. |
| Deep link ticket number | Read from the URL at module load and kept in `sessionStorage` key `rac_pending_ticket` because EB rewrites the URL before mount. |
| Usage telemetry | `src/shared/beacon.ts`; sends nothing unless the portal has a public item tagged `exb-beacon-sink`. |
