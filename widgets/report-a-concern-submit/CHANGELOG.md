# Changelog

Newest first. Every release bumps `manifest.json` and `package.json` together.

## 3.2.0 (2026-09-25)

- Added: `src/runtime/theme.ts`, the family's shared token reader (byte copy of the reference). `resolveTheme()` in the widget and `panelColors()` in the settings panel now read the same theme paths (primary, surface, background, text, hint, divider, error) with the previous fallbacks; hard-coded hex colors in `widget.tsx` and `setting.tsx` replaced with theme fields where one fits. No visual change on the default theme.
- Added: node test harness. `tests/transpile.js` (syntax and emit of every source file), `tests/validators.test.js`, `tests/profanity.test.js`, `tests/categoryBoundaries.test.js`; `npm test` runs them.
- Changed: the email and phone validators, the profanity filter and `CATEGORY_BOUNDARY_MAP` moved unchanged from `widget.tsx` into `src/runtime/lib/` so they can be unit tested; the widget imports them.
- Accessibility: one visually hidden polite live region at the widget root announces step changes, address search results, copy confirmation and submit results; keyboard focus moves to the step heading on every step change; address suggestions are keyboard operable (Tab, Enter, Space); the photo file inputs are visually hidden instead of `display:none` so they are reachable by keyboard and screen reader; the photo grid is a labelled group; the Search button keeps its accessible name while the spinner shows; Remove photo has a `title`; a visible focus ring for every control and a reduced motion rule now apply to the whole widget, not only the Location step.
- Docs: `docs/handover/` (README, CODE_STRUCTURE, MAINTENANCE, TROUBLESHOOTING), README "Developer checks" section, `AUDIT.md` (playbook audit record).
- Not changed: version numbers. Bump `manifest.json` and `package.json` together at release.

## 3.1.9 (2026-09-25)

- Changed: no built-in default for `commentsTableUrl`; configure it (or add the comments table to the web map) for the status view to show public comments.
- Changed: neutral defaults for the outside-boundary message and header image alt text; placeholders in the settings panel use example values.
- Changed: moved into the report-a-concern mono-repo.

## 3.1.8 (2026-09-18)

- Security: the beacon's session id now falls back to `crypto.getRandomValues` and then to a clock value instead of `Math.random`, which CodeQL flags as insecure randomness (shared beacon 1.1.1). The id only groups one page load's events; it is never a secret or a credential.
- Build: `tsconfig.json` is `jsx: react-jsx` with `jsxImportSource: @emotion/react`, matching the Experience Builder client. ts-loader reads the widget tsconfig, and the previous classic `jsx: react` setting made the settings panel and runtime fail with "Cannot convert undefined or null to object" after a full rebuild. No functional change.

## 3.1.7 (2026-09-18)

- Added: anonymous usage and error telemetry (shared beacon module; off unless the portal publishes an exb-beacon-sink table; telemetry: false in config disables it).

## 3.1.6 (2026-09-17)

- Packaging: the Visual Studio editor shims are no longer in the release zip. `publish.ps1` strips them from a staging copy (`$ReleaseOnlyExclude`) and refuses to zip if any ambient `declare module` of react, jimu or esri survives. The shims stay in the GitHub repo; clone users delete them before building.

## Earlier releases

See the GitHub releases page and the changelog section of the README, if any.
