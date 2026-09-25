# Maintenance: routine tasks

Each task lists the files to touch and the check to run afterwards. Run the developer checks
(`npx tsc -p .` and `npm test`, see `README.md` in this folder) after every change, and
`pnpm start` in `client` before a release.

## Bump the Experience Builder version

1. Read the Maps SDK release notes for the version EB ships (EB 1.21 runs Maps SDK 5.1).
   Anything under "removed" that the widget touches breaks silently at click time, not at
   build time.
2. Grep `src/runtime/widget.tsx` for `.popup.`, `highlightOptions`, `.watch(` and any
   `esri/` module path. This widget calls `view.openPopup`, `view.closePopup?.()` and
   `layerView.highlight()` only, and loads esri modules through `window.require` at call
   time, so an import path change shows up as a null check falling through, not a bundle
   failure. Test the status view (`?ticket_number=`) by hand: it is the one path that
   zooms, highlights and opens a popup.
3. Set `exbVersion` in `manifest.json`. Do not touch `jsx` or `jsxImportSource` in
   `tsconfig.json`: they must stay `react-jsx` and `@emotion/react` to match the client.
4. If the master editor shim at `client\your-extensions\widgets\_vs\exb-editor-shims.d.ts`
   changed, copy it over `src/exb-editor-shims.d.ts`. Never edit the copy by hand.
5. Build, open the widget in a fresh app, run one submission end to end with a photo, then
   open the status link the success screen shows.

## Add a config key

1. `src/config.ts`: add the property to `Config` with a doc comment, and a default to
   `defaultConfig`.
2. `config.json`: add the same default so new widget instances start with it.
3. `src/setting/setting.tsx`: add a `SettingRow` in the right `SettingSection`, writing the
   value with `this.setConfig("<key>", value)`. Do not import anything from `esri/*` here.
   If the key should travel with the XML export, add it to `EXPORT_SCALAR_TYPES`.
4. `src/runtime/widget.tsx`: read it as `this.props.config?.<key>` and compute any boolean
   once near the top of the render method that needs it. A key that turns a feature off must
   remove that feature everywhere it appears (control, hint text, validation).
5. `docs/handover/CODE_STRUCTURE.md`: add a row to the config keys table.
6. `CHANGELOG.md`: note it under Unreleased.

## Add a category

Categories come from the Tickets layer's subtypes, so the list itself is data, not code.
Two things in code care about a new subtype code:

1. `src/runtime/lib/categoryBoundaries.ts`: add the code to `CATEGORY_BOUNDARY_MAP` with the
   boundary type it must fall inside (`CITY_LIMITS`, `WATER_DIST`, `SEWER_DIST`) or `null`
   for no restriction. This map is the fallback used when no lookup table is configured; if
   the lookup table is configured, add the row there too.
2. `tests/categoryBoundaries.test.js`: add the code to the list in the second test and update
   the count in the third.

If the category should show a "call instead" banner, add it in the settings panel under
Critical Issue Alerts; no code change.

## Add or change a validation message

Messages live next to the check in `validateLocation`, `validateDetails` and
`validateContact` in `widget.tsx`. Keep them one sentence, say what to do, and set
`liveMessage` only for results the whole screen needs to hear (submit outcome); field errors
already announce through `role="alert"` next to the field.

## Add a word to the profanity filter

1. `src/runtime/lib/profanity.ts`: add a pattern to `PROFANITY_PATTERNS`. Anchor it with `\b`
   unless no innocent word can contain the root. Remember `normalizeLeet` runs first: text is
   lowercased, accents are stripped and `v` becomes `u`, so write the pattern against the
   normalized form.
2. If the word should also be caught inside long concatenated runs, add the plain root to
   `PROFANITY_ROOTS_EMBEDDED`.
3. `tests/profanity.test.js`: add the word to a blocked list and add any innocent word that
   contains it to the safe list. Run `npm test`.

## Add a help line

There is no help guide in this widget (see `README.md` in this folder for why). Guidance for
the user goes in the step itself: the heading, the field hint under the input, or the
placeholder. Keep hints to one line and name buttons exactly as they appear.

## Change a color

Do not add a hex literal. Use a field of `ThemeColors` from `resolveTheme()` in `widget.tsx`
(`brand`, `brandText`, `inputBg`, `pageBg`, `text`, `textMuted`, `textLight`, `divider`,
`border`, `error`, `success`, `warning` and their `Bg` and `Border` tints) or of
`panelColors()` in `setting.tsx`. If a new token is needed, add it to `resolveTheme()` reading
the same theme path `src/runtime/theme.ts` uses, with a fallback.

## Release

1. Move the Unreleased items in `CHANGELOG.md` under the new version and date.
2. Bump `manifest.json` and `package.json` together.
3. Developer checks, then `pnpm start` and one end to end submission.
4. `publish.ps1` from the mono-repo builds the zip and refuses to run if a banned string or a
   secret is in the tree.
