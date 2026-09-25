# Playbook audit: rac-manager (RAC Ticket Manager 1.1.4)

Audited against the widget handoff playbook sections supplied with the audit (4, 10, 11, 12 items 3/13/14, 14, 15). Sections 2, 3 and 19 were not in the bundle; Section 2 is audited from what Sections 10 and 15 say about it, Sections 3 and 19 are listed for Brian. Everything marked Fixed was changed in place in this folder; the test run and the grep at the bottom are the evidence for the final checks.

Status meanings: **Pass** already met, **Fixed** changed here, **Needs Brian** cannot be done in this environment (command, program and elevation given).

Counts: Pass 23, Fixed 26, Needs Brian 7.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 2.1 | Standard files: README, CHANGELOG, LICENSE, manifest, package.json, config, icon, .gitignore, .npmignore | Pass | all present at the widget root; `README.md`, `CHANGELOG.md`, `LICENSE`, `manifest.json`, `icon.svg` |
| 2.2 | `package.json` keeps keywords, author, license; no jimu, calcite or esri packages in dependencies | Pass | `package.json:5-13`, `"dependencies": {}` at `package.json:17` |
| 2.3 | README covers install, requirements, the shim note, feedback, license | Pass | `README.md` sections Install, Requirements, "The release zip and the editor shims" |
| 2.4 | README lists the help guide under Features and has a Developer checks section | Fixed | `README.md` Features (help guide line) and "Developer checks" (`npx tsc -p .`, `npm test`) |
| 3 | Section 3 (text not supplied) | Needs Brian | Re-run this row against Section 3 once the text is in the bundle. No command. |
| 4.1 | `package-lock.json` generated in the real EB environment | Needs Brian | `package-lock.json:3` still says version `1.1.0` while `package.json` is `1.1.4`. Command: `npm install --package-lock-only --no-audit --no-fund` in `client\your-extensions\widgets\rac-manager` (PowerShell, regular user, `Set-ExecutionPolicy -Scope Process Bypass -Force` first if the npm shim is blocked) |
| 4.2 | `pnpm-lock.yaml` shipped beside it for EB 1.21+ | Needs Brian | no `pnpm-lock.yaml` in the folder. Command: `pnpm install --lockfile-only` in the same folder (PowerShell, regular user); if it reports up to date but the file is missing, delete and rerun |
| 4.3 | `overrides` and `pnpm.overrides` for transitive CVEs | Pass | no dependencies, so nothing to pin |
| 10.2 | Files: `theme.ts`, `components/HelpPopup.tsx`, `helpSections.ts`, `translations/default.ts` | Fixed | `src/runtime/theme.ts` (byte copy of `ref/time-machine/theme.ts`, asserted by `tests/help.test.js` "theme.ts is a byte copy"), `src/runtime/components/HelpPopup.tsx`, `src/runtime/helpSections.ts`, `src/runtime/translations/default.ts` |
| 10.3 | `HelpPopup.tsx` copied verbatim from the playbook | Fixed | `diff` of `PB_s10_help.md:67-212` against the file: identical. Strings and sections are props |
| 10.4 | Visual spec: no hex color, no inline svg in the guide | Fixed | `tests/help.test.js` "no hex color and no inline svg in the help files" passes for `HelpPopup.tsx`, `FirstRunHint.tsx`, `helpSections.ts` |
| 10.4 | Shared translation keys with the shared wording (`helpTitle` = Help, `close`, `helpNoMatches`, placeholder shape, `firstRun*`) | Fixed | `src/runtime/translations/default.ts:9-19`; asserted in `tests/help.test.js` "writing rules" |
| 10.5 | Help button: icon only, `size="sm" type="tertiary" icon`, `title` and `aria-label`, top right of the widget | Fixed | `widget.tsx:5539-5546` (`renderHelpButton`), placed at the right end of the search row (`widget.tsx` search row) and of the detail header (Back row) |
| 10.5 | Modal wired with sections built from feature flags | Fixed | `widget.tsx:5567-5577` (`<HelpPopup ... sections={buildHelpSections(t, this.helpFeatures())}`) |
| 10.5 | First-run hint with the banner recipe, dismissed once, stored per browser and per widget id, try/catch around storage, opening the guide dismisses it | Fixed | `src/runtime/components/FirstRunHint.tsx`; `widget.tsx:264-266` (`racManager.helpHintDismissed.<id>`, try/catch), `widget.tsx:1217` (read on mount), `widget.tsx:1605-1610` (`openHelp` writes the dismissal), `widget.tsx:4862` (banner on the list until dismissed) |
| 10.5 | Config flag `showHelp` default true, settings toggle | Fixed | `config.json` (`"showHelp": true`), `setting.tsx:22,111-114` (`Switch`), `widget.tsx:1619` (`helpEnabled`), gate at `widget.tsx:5540,5566` |
| 10.6 | `helpSections.ts` exports `buildHelpSections(t, features)` with `when` and `listOf`; flags computed from the same checks the UI uses | Fixed | `src/runtime/helpSections.ts`; flags at `widget.tsx:1613-1618`: `mapConnected` from `config.useMapWidgetIds[0]` (same read as `renderRoot`), `comments`/`survey` from `state.commentsTable`/`surveyTable` (same test as the badge row and sort options), `sidebar` from `_sidebarEl` |
| 10.7 | Standard section set and order: `start` first and ordered, own sections between, `trouble` then `tips` last, distinct icons | Fixed | keys `start, find, views, edit, comments, photos, survey, export, keep, trouble, tips`; asserted in `tests/help.test.js` "section order" |
| 10.8 | Writing rules: plain words, exact button names, `Symptom: cause. What to do.`, no em dashes, contact line last, one-sentence intro | Fixed | `tests/help.test.js` "writing rules" and "control names in the guide match the interface exactly" (every `ctl*` name must appear in both the guide and `widget.tsx`) |
| 10.9 | Content test over `buildHelpSections`: strings resolve, gating both directions, `listOf` shapes, order, search words, writing rules, control names | Fixed | `tests/help.test.js` (10 tests). No cross-widget consistency suite exists in this folder; the `theme.ts` byte check and the 10.4 checks cover the part that can run here |
| 11.1 | Build on jimu-ui and Calcite; do not hand-roll buttons, inputs, dialogs, icons | Needs Brian (decision) | The help guide uses `Modal`, `Button`, `TextInput`, `CalciteIcon`. The rest of `widget.tsx` predates the rule and hand-rolls filter buttons, popovers (`renderColFilterPopover`), the photo viewer dialog and three inline SVG icons (`widget.tsx:4279,4756,4762,4825,4851`). Replacing them is a restyle, which this audit was told not to do. Decide whether to schedule it. No command. |
| 11.1 | Icon-only buttons have `title` and `aria-label` with the same text | Pass | Help button `widget.tsx:5542`; funnel `widget.tsx:4242-4245`; photo viewer close, prev, next `widget.tsx:5401-5450`; hint dismiss `FirstRunHint.tsx` |
| 11.2 | `theme.ts` present, byte copy, `useTokens()` used; class component gets tokens through a small function component | Fixed | `widget.tsx:239-243` (`Themed`), `widget.tsx:5551-5553` (render wraps in `<Themed>`), `setting.tsx` (`Themed` + `renderBody(tk)`) |
| 11.2 | No hard-coded colors where a token fits; same look | Fixed | hex literals in `widget.tsx` down from 231 to 70: 16 are the `DEFAULT_TOKENS` fallbacks (`widget.tsx:246-251`), 9 the status and priority chip colors (`SC`, `PC`), 5 the skeleton shimmer, and the rest success greens, danger tints, the light-blue focus ring and the photo viewer's black overlay, which have no token. `setting.tsx` has none left |
| 11.2 | Banner recipe (`infoBg` + `text` + 3px primary bar), never `*-light` | Fixed | `FirstRunHint.tsx`; settings info box `setting.tsx:120`; `tests/help.test.js` asserts no `*-light` in `widget.tsx` |
| 11.3 | Toolbar with text and buttons is two rows | Pass | search row holds one input and two buttons; filter buttons wrap on their own row `widget.tsx:4560` |
| 11.3 | Lists inside a modal are an accordion or scroll inside 70vh | Pass | `HelpPopup.tsx` (`maxHeight: '70vh'`, one section open) |
| 11.3 | Wide content scrolls inside its own box | Pass | table region `overflow: "auto"` `widget.tsx:4060` |
| 11.4 | One polite live region, visually hidden, every message written to it | Fixed | `widget.tsx:5564` (`role="status" aria-live="polite" aria-atomic="true"`, was `aria-live="assertive"` with no role). No `alert()` calls exist (grep) |
| 11.4 | Cards: full `aria-label`, `aria-busy` while loading, visible focus ring | Pass | card `aria-label` `widget.tsx:4889`, `aria-busy` `widget.tsx:4074,4872`, focus ring via `FOCUS_RING` |
| 11.4 | Toggle chips are `<button aria-pressed>`; bulk bar `role="toolbar"`; status bar `role="status"` | Pass | `widget.tsx:4604,4627,4649`; `widget.tsx:4560`; `widget.tsx:4793` |
| 11.4 | Every input has a label; every icon button has `aria-label` | Pass | `htmlFor` labels `widget.tsx:5037-5132`; date inputs and search carry `aria-label`; file input hidden with `aria-hidden` |
| 11.4 | Checkboxes wrap in a label or are tied to one | Pass | `widget.tsx:3420,3513` (`htmlFor`), column popover checkboxes inside `<label>` `widget.tsx:3877` |
| 11.4 | Keyboard on custom controls | Fixed | column resize handle: `tabIndex={0}`, arrow keys and Home, `aria-valuenow/min/max` `widget.tsx:4304-4325`, `nudgeColWidth` `widget.tsx:3645`. Sort headers and rows already had Enter and Space |
| 11.4 | Focus handling | Fixed | photo viewer returns focus to the thumbnail that opened it `widget.tsx:1622-1630` (`openLightbox`, `closeLightbox`) |
| 11.4 | No color-only meaning | Pass | status and priority chips carry text; filter dots are `aria-hidden` beside text; funnel state is in the `aria-label`; Internal comments carry an "Internal" chip |
| 11.4 | `prefers-reduced-motion` | Fixed | `widget.tsx:1272` rule injected with the shimmer keyframes; root carries `rac-manager-root` `widget.tsx:5559` |
| 11.4 | `role="application"` on the root (switches screen readers out of reading mode) | Fixed | now `role="region"` `widget.tsx:5559` |
| 12.3 | Widget-level `tsconfig.json`, mode B, `jsx: react-jsx` + `jsxImportSource @emotion/react`, shims listed first in `files` | Pass | `tsconfig.json:8-9,20`; `src/exb-editor-shims.d.ts` (master), `src/vendor-shims.d.ts` (declares `calcite-components` and the `jimu-for-builder` shape) |
| 12.3 | `npx tsc -p .` prints nothing | Needs Brian | cannot run here. Command: `npx tsc -p .` in the widget folder (Command Prompt, regular user; add `--ignoreDeprecations 6.0` on TypeScript 6). Syntax of every file was checked with `ts.transpileModule` (`tests/transpile.js`: `syntax errors: 0`) |
| 12.13 | No `view.popup.<x>` without a guard, no `highlightOptions`, `autoOpenEnabled`, `autoCloseEnabled` | Pass | grep over `src/`: zero hits for `.popup`, `highlightOptions`, `autoOpenEnabled`, `autoCloseEnabled`. Highlights go through `layerView.highlight()` (`widget.tsx:1661,2264`), which exists in 5.x. `.watch(` is used on `definitionExpression` and `stationary` (`widget.tsx:1884,1910`), both still present in 5.x |
| 12.14 | `componentDidUpdate` compares `prevProps.state` before acting on open or close | Pass | `widget.tsx:1286-1345` reacts only to `prevState.tableColFilters` changes and never reads `props.state`; there is no controller open/close side effect to guard |
| 12.1 | Nothing under `src/setting/` imports `esri/*` | Pass | `setting.tsx` imports `jimu-core`, `jimu-for-builder`, `jimu-ui`, `jimu-ui/advanced/setting-components`, `../runtime/theme` (which imports `jimu-theme` only) |
| 12.7 | A config flag that turns a feature off removes it everywhere | Pass | `showHelp` gates the button, the modal, the hint and (through `helpEnabled`) nothing else renders |
| 14.1 | Test harness: `tests/transpile.js` copied, node `--test` suites for pure functions | Fixed | `tests/transpile.js` (copy of the reference), `tests/help.test.js`, `tests/format.test.js`, `tests/labels.test.js`; run below |
| 14.2 | Pure helpers moved by cut and paste into `src/runtime/lib/` | Fixed | `src/runtime/lib/format.ts` (`fmt`, `ago`, `agoFull`, `agoDate`, `ymd`, `fmtDay`, `matchAll`, plus `nameTokens`, the three-line inline split from `onView`), `src/runtime/lib/labels.ts` (`S`, `P`, `C`, `CT`, `toggleVal`, plus `statusLabel`, `priorityLabel`, `categoryLabel` wrapping the `|| "Unknown"` fallback the card and row code used) |
| 14.3 | `package.json` `scripts.test` | Fixed | `"test": "node tests/transpile.js && node --test tests/*.test.js"`. The rules asked for `node --test tests/`; Node 22 treats a bare directory as a file ("Cannot find module .../tests"), so the reference widget's form is used |
| 14.4 | `npx jest` and `npx tsc -p .` clean before a release (Jest variant) | Pass | the node runner variant replaces Jest, as the reference widgets do; `tsc` is 12.3 above |
| 15.1 | `docs/handover/README.md`, `CODE_STRUCTURE.md`, `MAINTENANCE.md`, `TROUBLESHOOTING.md` | Fixed | `docs/handover/` (four files, prose and tables, no em dashes) |
| 15.2 | `EXPORT_FORMAT.md`, `STORAGE.md`, `PORTING_<version>.md` | Pass (not needed) | no on-disk export format or store; the localStorage keys are documented in `CODE_STRUCTURE.md` and `TROUBLESHOOTING.md`. The Excel layout is produced code, not a format others read back |
| 15.3 | `CHANGELOG.md` newest first, Added / Changed / Fixed | Fixed | "Unreleased" entry added at the top |
| 15.4 | Every release bumps `manifest.json` and `package.json` together | Needs Brian | versions were deliberately left at `1.1.4`. At release: set both to the next version, date the Unreleased heading |
| 19 | Section 19 (text not supplied) | Needs Brian | Re-run this row against Section 19 once the text is in the bundle. No command. |
| F.1 | No em dashes in files written or edited | Pass | new files: zero. In `widget.tsx` and `setting.tsx` the only added lines containing one are existing lines whose colors changed (the table's placeholder dash cells and one settings sentence); no new prose carries one |
| F.2 | Banned strings grep | Pass | the AUDIT_RULES banned-string grep (organization name, host names, the internal IP range) over the folder: 0 hits |
| F.3 | Every new `.ts`/`.tsx` parses | Pass | `node tests/transpile.js` over `src/`: `syntax errors: 0` |

## Test run

```
> node tests/transpile.js && node --test tests/*.test.js
syntax errors: 0
# tests 19
# pass 19
# fail 0
```

## What changed, by file

New: `src/runtime/theme.ts`, `src/runtime/components/HelpPopup.tsx`, `src/runtime/components/FirstRunHint.tsx`, `src/runtime/helpSections.ts`, `src/runtime/translations/default.ts`, `src/runtime/lib/format.ts`, `src/runtime/lib/labels.ts`, `tests/transpile.js`, `tests/help.test.js`, `tests/format.test.js`, `tests/labels.test.js`, `docs/handover/README.md`, `docs/handover/CODE_STRUCTURE.md`, `docs/handover/MAINTENANCE.md`, `docs/handover/TROUBLESHOOTING.md`, `AUDIT.md`.

Edited: `src/runtime/widget.tsx` (imports; moved helpers; `Themed`, `DEFAULT_TOKENS`, `t`, hint storage; `hdr`/`lbl`/`row`/`SkeletonCard`/`stars` take tokens; state `helpOpen`/`hintDismissed`; help handlers; lightbox focus return; keyboard column resize; hex literals to tokens in the render methods; live region; root role and class; reduced motion rule; Help button, hint and `HelpPopup` in the tree), `src/setting/setting.tsx` (tokens, `showHelp` switch), `config.json` (`showHelp`), `package.json` (scripts), `.gitignore` (`tests/build/`), `.npmignore` (`tests/`), `CHANGELOG.md`, `README.md`.

## Open points for Brian

1. Run `npx tsc -p .` (Command Prompt, regular, widget folder). The type check could not run here; the syntax check did. Likely spots if anything shows: the `type Tokens` import style (`import { useTokens, type Tokens }`) needs TypeScript 4.5+, and `Switch`'s `onChange` signature in the settings panel (`(evt, checked)`) is typed `any` through the shim.
2. Regenerate both lockfiles (rows 4.1 and 4.2).
3. Decide on row 11.1 (hand-rolled controls remain).
4. Open the app once: Help button in both headers, the "New here?" banner (clear `racManager.helpHintDismissed.<widgetId>` from localStorage to see it again), the settings switch, dark theme colors, the photo viewer's focus return, Tab to a column edge and press the arrow keys.
5. Sections 3 and 19 of the playbook were not in the audit bundle; two rows above wait for them.
