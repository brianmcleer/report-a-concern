# Report A Concern - Submit

ArcGIS Experience Builder custom widget. Multi-step public ticket submission form for a
Report a Concern (RAC) system. Submits to the Tickets feature layer
via `applyEdits`. Spatial queries enforce jurisdiction boundaries client-side, and attribute
rules handle additional validation server-side.

## Features

- Multi-step submission flow with inline validation
- Geofenced service boundary check (rejects locations outside city limits)
- Category and subcategory dropdowns driven by feature class subtypes and coded value domains
- Map click and GPS location selection, optional geocoder search
- Photo attachments with configurable size and count limits
- Configurable header (title, image, alignment, link) and message text via the settings panel
- No hardcoded service URLs; all endpoints set in the settings panel or `config.json`

## Requirements

- ArcGIS Experience Builder Developer Edition 1.21 (React 19).
  EB 1.18 and earlier run React 18 and are not supported.
- A published Tickets feature service and service boundary layer.

## Install

1. Copy the `report-a-concern-submit` folder into your Experience Builder install at:

   ```
   client/your-extensions/widgets/report-a-concern-submit/
   ```

   `manifest.json` must sit directly inside that folder. Do not nest it a second level
   deep (for example `widgets/report-a-concern-submit/report-a-concern-submit/`). Nesting
   is the usual cause of a widget not registering.

2. From the `client` folder, run:

   ```
   npm install
   ```

   Experience Builder installs the widget's dependencies automatically for widgets in
   `your-extensions`. There are no per-dependency install steps.

3. Restart the Experience Builder client. Drop the widget into an experience and configure
   it in the settings panel (map widget, layer indexes, endpoints, header, messages).

### The release zip and the editor shims

The zip is the widget only. The Visual Studio type shims in the repo (`report-a-concern-submit/src/exb-editor-shims.d.ts`) are left out on purpose: their ambient `declare module` blocks are not file-scoped and would rewrite the react, jimu and esri types for every other widget in your `your-extensions` folder.

If you clone the repository instead of using the zip, delete `report-a-concern-submit/src/exb-editor-shims.d.ts` before building; nothing else depends on it.

## Usage telemetry

This widget records anonymous usage counts and errors so the publishing organization can see which widgets and versions are in use and which errors users hit. It records the app id and title, widget name and version, the action name, a truncated error message, the site host name and browser family. It never records usernames, coordinates, addresses, attribute values or URLs with query strings. Where the data goes: on page load the widget asks the app's portal for a public item tagged `exb-beacon-sink` and posts to that table. If your portal has no such item, nothing is sent anywhere. To turn it off for an app, set `"telemetry": false` in the widget's config, or users can enable Do Not Track in their browser. The shared module is `src/shared/beacon.ts`.

## Troubleshooting: `report-a-concern-submit is duplicated`

Experience Builder registers each widget by the `name` value in its `manifest.json` and
throws this error when the same name is registered more than once. A single, correctly
placed copy cannot duplicate itself, so a second copy is present somewhere. Replacing just
the one folder does not fix it. Check in this order:

1. A nested folder: `widgets\report-a-concern-submit\report-a-concern-submit`. The manifest
   must sit directly inside the widget folder, not a second level deep. This is the usual
   culprit when a zip is extracted into a folder that already has the widget's name.
2. A leftover folder from an earlier build or version, including any `-copy` folder, or a
   folder under a previous name if the widget was renamed.
3. A stale compiled build in `client\dist\widgets`. Stop the client server, delete the
   matching folder under `dist\widgets` (or run a clean build), then start again.

If removing one copy makes the widget disappear from the Entrypoint list entirely, the copy
that remains is nested too deep. Move it so the manifest is directly inside the widget folder.

## Feedback

Open an issue on the [report-a-concern](https://github.com/brianmcleer/report-a-concern/issues) repository.

## License

Apache-2.0. Copyright 2026 Brian McLeer.
