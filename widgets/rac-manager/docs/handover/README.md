# RAC Ticket Manager: handover

Start here if you are taking over the widget. The four files in this folder answer, in order: where do I start (this file), where is X (CODE_STRUCTURE.md), how do I do a routine task (MAINTENANCE.md), and what does a symptom mean (TROUBLESHOOTING.md).

## What it is

An ArcGIS Experience Builder custom widget for staff. It lists the tickets in the Tickets feature layer of the map it is linked to, lets staff change status, priority, department and category, add public or internal comments with a photo, view submitter photos and survey answers, and export the filtered list to Excel. The public side (the submit wizard) is a separate widget in the same repository.

## Requirements

| Item | Value |
|---|---|
| Experience Builder | Developer Edition 1.21 (React 19). 1.18 and earlier are not supported. |
| Map | A web map with the Tickets feature layer and the comments, photo metadata and survey response tables added as tables. |
| Sign in | Staff sign in to the portal through the app. Edits and photo uploads use that session's token. |
| Third-party code | None in `package.json`. ExcelJS is loaded from a CDN at export time. |

## Build and run

1. Copy the `rac-manager` folder to `client\your-extensions\widgets\rac-manager` so that `manifest.json` sits directly inside it.
2. In `client`, run `pnpm install` once (1.21 uses pnpm; `npm install` errors on purpose), then `pnpm start`.
3. Open the builder, add RAC Ticket Manager to an experience, and in its settings pick the map and check the layer and table names.

If you cloned the repository instead of using the release zip, delete `src/exb-editor-shims.d.ts` and `src/vendor-shims.d.ts` before building: their ambient module declarations apply to every widget in `your-extensions`.

## Checks before a release

Run from the widget folder, Command Prompt, regular user:

| Check | Command | Expect |
|---|---|---|
| Types | `npx tsc -p .` | prints nothing (TypeScript 6: add `--ignoreDeprecations 6.0`) |
| Tests | `npm test` | `syntax errors: 0` then every test `ok` |
| Build | `pnpm start` in `client`, open the app | widget renders, settings panel opens |

Then bump the version in `manifest.json` and `package.json` together, add a dated heading to `CHANGELOG.md`, and publish with the repository's `publish.ps1`.

## Release contents

The zip is the widget only. `publish.ps1` strips the two editor shim files and refuses to zip if any ambient `declare module` of react, jimu or esri survives. `tests/` and `tests/build/` are excluded through `.npmignore` and `.gitignore`.

## Where to go next

- `CODE_STRUCTURE.md`: file map, config keys, "where is X" table with line anchors.
- `MAINTENANCE.md`: bump the EB version, add a config key, add a help line, add a category.
- `TROUBLESHOOTING.md`: symptom, cause, fix.
- `../../AUDIT.md`: the playbook audit that produced the help guide, tokens and tests.
