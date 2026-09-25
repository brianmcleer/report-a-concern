# Maintenance

Routine tasks, each as a short recipe. Run `npx tsc -p .` and `npm test` from the widget folder after any of them.

## Bump the Experience Builder version

1. Install the new client and run its bootstrap (`pnpm install` in `client` on 1.21 and later).
2. Copy the widget folder into `client\your-extensions\widgets\`.
3. Set `exbVersion` in `manifest.json` to the new client version.
4. Replace `src/exb-editor-shims.d.ts` with the current master from `widgets\_vs` (copy, do not edit).
5. Check the tsconfig still says `"jsx": "react-jsx"` with `"jsxImportSource": "@emotion/react"`. Never switch it to classic `react`: ts-loader reads this file and classic emit crashes every settings panel after a full rebuild.
6. Start the client, open the app, and exercise the paths that touch the map view: select a ticket (highlight and zoom), hover a card (highlight), Map extent, a status change with a note, a comment with a photo, an export. A removed SDK property fails silently at click time, not at build time.
7. Add a Changed line to `CHANGELOG.md`, bump `manifest.json` and `package.json` together.

## Add a config key

1. Add the key and its default to `config.json`.
2. Add it to the `Config` interface in `src/setting/setting.tsx` and a field in `renderBody` (`TextInput` for text, `Switch` for a boolean; use `onChange` or `onToggle`).
3. Read it in `widget.tsx` through `this.props.config?.<key>`, with the same default as `config.json`. Compute any boolean once (see `helpEnabled`) and pass it down; render methods should not re-read config.
4. If the key turns a feature off, remove the feature everywhere: the UI control, any menu item, and the matching help line (add a flag to `HelpFeatures`, set it in `helpFeatures()`, gate the line in `helpSections.ts`).
5. Document it in `CODE_STRUCTURE.md` (Config keys table) and `CHANGELOG.md`.

## Add or change a help line

1. Add the string to `src/runtime/translations/default.ts` with a `help` prefix. Follow the writing rules: short sentences, common words, name buttons exactly as the interface shows them, no em dashes, none of the words instance, session, persist, sync, toggle, modal. A troubleshooting line is `Symptom: cause. What to do.`
2. Add `t('helpYourKey')` to the right section in `src/runtime/helpSections.ts`. Wrap it in `when(flag, 'helpYourKey')` if the feature can be off.
3. If the line names a new button, add the button's exact text as a `ctl*` entry in `default.ts`. The test then fails if the button is renamed without updating the guide.
4. Run `npm test`. `help.test.js` checks every rule above, the section order, and that the words for an off feature are absent.
5. Do not edit `HelpPopup.tsx` or `theme.ts`: they are copied between widgets unchanged, and the consistency suite hashes `theme.ts`.

## Add a category

Categories are coded values on the Tickets layer's `category` field (a subtype), so the schema changes first.

1. Add the subtype (with its subcategory domain, if any) to the Tickets layer and republish. The widget reads subcategory options from the layer at load time, so nothing in the code lists subcategories.
2. Add the code and label to `C` in `src/runtime/lib/labels.ts`. Keep it in step with the layer and with the public submit widget.
3. Add the code to `CAT_DEPT` in `widget.tsx` so the department suggestion and the routing check know which department handles it. A category with no entry falls back to "all departments" with a console warning.
4. If a department should accept any category, add its exact domain name to `UNRESTRICTED_DEPTS`.
5. Update `labels.test.js` (the category count) and the category list in the repository's `categories.py` so the scripts and the widget agree.
6. `CHANGELOG.md`: Added line with the new code.

## Change a status or priority color

`SC` and `PC` at the top of `widget.tsx` hold the chip colors. They are deliberate literals (no theme token fits); the chip text always carries the meaning, so a color change is cosmetic. The Excel export has its own ARGB values in `exportToExcel`.

## Regenerate the lockfiles

From the widget folder inside the EB install, PowerShell, regular user:

```
npm install --package-lock-only --no-audit --no-fund
pnpm install --lockfile-only
```

`package-lock.json` currently still says version 1.1.0; the first command brings it in line with `package.json`. Ship `pnpm-lock.yaml` beside it so pnpm-era installs are locked too.

## Release

1. `npx tsc -p .` prints nothing; `npm test` passes.
2. Bump `manifest.json` and `package.json` to the same version; turn the `Unreleased` heading in `CHANGELOG.md` into a dated one.
3. Run `publish.ps1` from the repository, which mirrors the EB widget folder over the repo and zips without the editor shims.
