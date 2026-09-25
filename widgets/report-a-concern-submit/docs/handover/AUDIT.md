# Playbook audit: report-a-concern-submit 3.1.9

Audited against the widget handoff playbook, Sections 2, 3, 4, 10, 11, 12 (items 3, 13, 14),
14, 15 and 19. Status is Pass (already met), Fixed (changed in this pass) or Needs Brian (needs
the real EB install or a decision; the exact command is given). Evidence is file:line at the
time of writing.

Summary: 24 Pass, 20 Fixed, 5 Needs Brian.

## Section 2: standard files

| Requirement | Status | Evidence |
|---|---|---|
| README with features, requirements, install, troubleshooting, license | Pass | `README.md` |
| README "Developer checks" section | Fixed | `README.md`, section "Developer checks" |
| CHANGELOG newest first, one heading per version | Pass | `CHANGELOG.md` |
| CHANGELOG "Unreleased" entry for this pass | Fixed | `CHANGELOG.md` top entry |
| LICENSE present | Pass | `LICENSE` (Apache-2.0) |
| `package.json` has keywords, author, license, empty `dependencies` (jimu, React, esri supplied by EB) | Pass | `package.json` |
| `package.json` test script | Fixed | `package.json` `scripts.test`: `node tests/transpile.js && node --test tests/*.test.js` |
| `manifest.json` and `package.json` versions match | Pass | both 3.1.9. Not bumped here; Brian bumps both at release. |
| `.gitignore`, `.npmignore`, `icon.svg`, `config.json` | Pass | present at root; `.npmignore` now also excludes `tests/build/` |
| No hard-coded service URLs or identifying strings | Pass | The banned-string grep from the audit rules (organization name, host names, IP range) returns nothing over this folder. |

## Section 3

| Requirement | Status | Evidence |
|---|---|---|
| Section 3 checks | Needs Brian | The text of Section 3 was not supplied to this audit, so it was not checked. Command: open the playbook, Section 3, and tick its list against this folder. No program or elevation involved. |

## Section 4: lockfile

| Requirement | Status | Evidence |
|---|---|---|
| `package-lock.json` from the real EB environment | Pass | `package-lock.json` present (npm era) |
| `pnpm-lock.yaml` shipped alongside for EB 1.21 | Needs Brian | Not in the folder and cannot be generated here. Command: Command Prompt, regular user, in `C:\arcgis-experience-builder-1.21\client`: `pnpm install`, then confirm `your-extensions\widgets\report-a-concern-submit\pnpm-lock.yaml` exists and commit it. `.npmignore` already keeps both lockfiles out of the zip. |

## Section 10: in-widget help guide

| Requirement | Status | Evidence |
|---|---|---|
| Help guide where it makes sense | Pass (decision: no guide) | See "Help guide decision" below and `docs/handover/README.md`. |

**Help guide decision.** The playbook adds the guide "only where it makes sense". This widget
is a public, four-step wizard. Each step has a heading that says what to do ("Where is the
concern?", "What's the concern?", "How can we reach you?", "Review Your Report"), every field
has a label and a one-line hint, the primary button names the next step ("Next: Details"), the
stepper shows progress, and every error is inline next to its field with `role="alert"`. The
standard section set (Start here, Saving, Loading, Menu, Share, Organize, Keep, Trouble, Tips)
does not fit: there is nothing to save, load, share or organize, and no menu. A Help button
would give a one-time public user a second place to read the instructions the step already
shows. The staff-facing RAC Manager widget is where the guide belongs. If a feature that needs
explaining outside its step is added later (for example a multi-ticket status page), add the
guide then by copying `HelpPopup.tsx`, `theme.ts` and the tests from the Time Machine reference.
`theme.ts` is already in place for that day.

## Section 11: UI conventions, theme tokens, accessibility

| Requirement | Status | Evidence |
|---|---|---|
| 11.1 Build on jimu-ui and Calcite, do not hand-roll buttons, inputs, dialogs | Needs Brian | The runtime is hand-rolled HTML (`<button>`, `<input>`, `<select>`, `<textarea>`) throughout `src/runtime/widget.tsx` (for example `renderStepContact`, line 5201 on). Replacing them with jimu-ui `Button`, `TextInput`, `Select`, `TextArea` is a restyle of a 5,000-line public form and a visual change on a live site, which this audit was told not to do. Decision needed: leave as is (the form has its own consistent look and full ARIA) or schedule a jimu-ui port as its own release. No command; a design decision. |
| 11.1 Icon buttons get `title` and `aria-label` with the same text | Fixed | Clear address already had both (4682); Remove photo now has `title` (widget.tsx:5074); Search keeps an accessible name while its spinner replaces the text (4601); Copy link had both (5498). |
| 11.2 `src/runtime/theme.ts` byte-identical to the reference | Fixed | `src/runtime/theme.ts` copied from `ref/time-machine/theme.ts`; `cmp` reports identical. |
| 11.2 No hard-coded colors; use tokens where a token fits | Fixed | `resolveTheme()` now reads the same theme paths as `theme.ts` (widget.tsx:1489 to 1503: primary, error, surface.paper, surface.background, surface.paperText, divider) and exposes `brandText` and `divider`; 46 hex literals in `widget.tsx` replaced with theme fields. `panelColors()` added to `setting.tsx` (same reads); 43 hex literals replaced. Remaining literals: the fallbacks inside the two resolvers, `#000` photo backdrop, `#fff` text on a black overlay, `#ffffff` in `mixColor` (needs a 7-char hex), success greens in the settings panel (no success token), three mid greys used as outline emphasis in settings (no token). The class component cannot call the `useTokens` hook, so the reads are mirrored rather than imported; documented in `docs/handover/CODE_STRUCTURE.md`. |
| 11.2 Banner contrast: tinted background, explicit text color | Pass | `warningBox`, `errorBox`, `gfChecking` set both background tint and text color (widget.tsx `buildStyles`) |
| 11.3 Toolbars with text plus buttons are two rows | Pass | Nav rows hold two buttons only (`navRow`); the search row is input plus one button. |
| 11.3 Modal content capped at 70vh | Pass | No modals in the widget. |
| 11.4 One polite live region for results | Fixed | widget.tsx:5831 `<div role="status" aria-live="polite" aria-atomic="true">` bound to `state.liveMessage`; set in `goToStep` (2828), `announce` (2844), search results (3561), copy link (4323), every submit error path and `onSubmitSuccess` (4184). No `alert()` calls exist. |
| 11.4 Focus handling on view change | Fixed | `goToStep` moves focus to the step heading (`focusStepHeading`, 2836); each step heading is an `h2` with `tabIndex={-1}` (4552, 4891, 5207, 5318). The Contact heading was a `div` and is now an `h2`. |
| 11.4 Keyboard on custom controls | Fixed | Address suggestions (`role="option"`) now `tabIndex={0}` with Enter and Space (4628 to 4632); file inputs behind the Add Photo and camera labels are visually hidden instead of `display:none` (5113, 5148, `VISUALLY_HIDDEN` 723) so Tab reaches them. |
| 11.4 Visible focus ring | Fixed | Root style block, widget.tsx:5837 to 5846, `:focus-visible` outline in the brand color for every control inside `#rac-submit-root`. |
| 11.4 No color-only meaning | Pass | Status badge, stepper dots, geofence results and field errors all carry text or an `aria-label`. |
| 11.4 prefers-reduced-motion | Fixed | Was only in the Location step's style block (4455); now also at the root, scoped to the widget (5847), so the Details, Contact, Review, loading and submitting screens are covered. |
| 11.4 Every input has a label | Pass | `htmlFor` on every field; photo grid is now `role="group" aria-labelledby="rac-photos-label"` (5047). |
| 11.4 Cards: `aria-label`, `aria-busy`, `role="region"` | Pass | Review and status cards `role="region" aria-label` (5329 on, 5570 on); GPS and Search `aria-busy`. |
| 11.4 Checkboxes wrapped in a label | Pass | No checkboxes. |

## Section 12: EB 1.21 gotchas

| Requirement | Status | Evidence |
|---|---|---|
| Item 3: widget tsconfig mode B, `jsx: react-jsx` + `jsxImportSource: @emotion/react`, `types: []`, no `paths`/`baseUrl` | Pass | `tsconfig.json:29-31`; no `paths`. Optional: the reference also sets `"typeRoots": []`; add it if VS still opens `@types` files. |
| Item 3: shims present, `__esri` open interfaces | Pass | `src/exb-editor-shims.d.ts`, `src/runtime/esri.d.ts` |
| Item 3: no `/** @jsx jsx */` pragma added | Pass | `setting.tsx:2` already carried the pragma before this audit and none was added; under `react-jsx` TypeScript ignores it (playbook item 3). Optional cleanup for Brian, not required. |
| Item 3: `npx tsc -p .` prints nothing | Needs Brian | Cannot run tsc here (no EB install). `node tests/transpile.js` (syntax and emit of every source file) reports `syntax errors: 0`. Command: Command Prompt, regular user, in the widget folder: `npx tsc -p .` |
| Item 1: nothing under `src/setting` imports `esri/*` | Pass | `setting.tsx` imports jimu-core, jimu-for-builder, jimu-ui only; `fetchMetadata` uses `fetch`. |
| Item 13: `view.popup.<x>` without a guard, `highlightOptions`, `autoOpenEnabled`, `autoCloseEnabled` | Pass | grep over `src` finds none. Popup use is `view.openPopup(...)` (2745 to 2755) and `view.closePopup?.()` (4296); highlight is `layerView.highlight(feature)` (2744) with the handle removed on unmount. |
| Item 14: `componentDidUpdate` gates on a real change before acting | Pass | widget.tsx:2263 to 2303 compares `prevState` field by field before saving wizard state, and `!prevState.metadataLoaded && s.metadataLoaded` before the deep-link load. It does not react to `props.state` at all, so the open/close loop cannot occur. |

## Section 14: tests

| Requirement | Status | Evidence |
|---|---|---|
| `tests/transpile.js` copied from the reference | Fixed | `tests/transpile.js` (byte copy of `ref/time-machine/tests/transpile.js`) |
| Node test files over pure functions | Fixed | `tests/validators.test.js` (4 tests), `tests/profanity.test.js` (7), `tests/categoryBoundaries.test.js` (3): 14 tests, all pass. |
| Pure functions extracted by cut and paste with an import added | Fixed | `src/runtime/lib/validators.ts`, `profanity.ts`, `categoryBoundaries.ts`; imported at widget.tsx:7 to 9. Bodies unchanged; only `export` added and em dashes in the moved comments replaced. |
| `npm test` passes here | Fixed | `node tests/transpile.js` prints `syntax errors: 0`; `node --test tests/*.test.js` prints `# pass 14`, `# fail 0`. |
| `tests/build/` never ships | Fixed | `.gitignore` already had `build/`; `.npmignore` now lists `tests/build/`. |

## Section 15: documentation set

| Requirement | Status | Evidence |
|---|---|---|
| `docs/handover/README.md` | Fixed | where to start, build, checks, release, where the data goes, help guide decision |
| `docs/handover/CODE_STRUCTURE.md` | Fixed | file map, two "where is X" tables with line anchors, config key table |
| `docs/handover/MAINTENANCE.md` | Fixed | bump EB version, add a config key, add a category, add a word to the filter, add a help line, change a color, release |
| `docs/handover/TROUBLESHOOTING.md` | Fixed | symptom, cause, fix tables for setup, the form, the status view, accessibility |
| `STORAGE.md`, `EXPORT_FORMAT.md`, `PORTING_<version>.md` | Pass | Not applicable: the widget keeps no store of its own (two `sessionStorage` keys, described in the README table) and has no export format. |
| CHANGELOG at the widget root | Pass | `CHANGELOG.md` |

## Section 19

| Requirement | Status | Evidence |
|---|---|---|
| Section 19 checks | Needs Brian | The text of Section 19 was not supplied to this audit, so it was not checked. Command: open the playbook, Section 19, and tick its list against this folder. |

## Final checks

| Check | Result |
|---|---|
| Em dashes in files written or edited by this pass | None in `AUDIT.md`, `docs/handover/*`, `tests/*`, `src/runtime/lib/*`, `src/runtime/theme.ts`, the README and CHANGELOG additions, and every line added to `widget.tsx` and `setting.tsx`. Pre-existing em dashes remain in untouched comments and a few visible strings of `widget.tsx` (for example the review card "Edit location" aria-labels), `setting.tsx` and `config.ts`; not mass-edited per the rules. Optional for Brian: replace the visible ones in `setting.tsx` section titles and option labels. |
| Banned strings grep | Zero hits. |
| Every new `.ts`/`.tsx` file parses | `node tests/transpile.js` over all of `src`: `syntax errors: 0`. |
| Versions | Not changed. Brian bumps `manifest.json` and `package.json` together at release. |
