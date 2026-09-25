# Changelog

All notable changes to the RAC Ticket Manager widget are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.1.4 (2026-09-25)

- Changed: organization name for the Excel export (workbook author and summary subtitle) is now the `orgName` setting instead of a hard-coded value. Default "GIS Division".
- Changed: moved into the report-a-concern mono-repo; changelog links updated.

## 1.1.3 (2026-09-18)

- Security: the beacon's session id now falls back to `crypto.getRandomValues` and then to a clock value instead of `Math.random`, which CodeQL flags as insecure randomness (shared beacon 1.1.1). The id only groups one page load's events; it is never a secret or a credential.
- Build: `tsconfig.json` is `jsx: react-jsx` with `jsxImportSource: @emotion/react`, matching the Experience Builder client. ts-loader reads the widget tsconfig, and the previous classic `jsx: react` setting made the settings panel and runtime fail with "Cannot convert undefined or null to object" after a full rebuild. No functional change.

## 1.1.2 (2026-09-18)

- Added: anonymous usage and error telemetry (shared beacon module; off unless the portal publishes an exb-beacon-sink table; telemetry: false in config disables it).

## 1.1.1 (2026-09-17)

- Packaging: the Visual Studio editor shims are no longer in the release zip. `publish.ps1` strips them from a staging copy (`$ReleaseOnlyExclude`) and refuses to zip if any ambient `declare module` of react, jimu or esri survives. The shims stay in the GitHub repo; clone users delete them before building.
- Editor: widget-level `tsconfig.json` moved to the self-contained mode B setup for Experience Builder 1.21 (pnpm): no `paths`, `"types": []`, master `src/exb-editor-shims.d.ts` copied from `widgets\_vs`, widget-specific declarations in `src/vendor-shims.d.ts`. `npx tsc -p .` reports 0 errors. Webpack output is unchanged (jsx settings kept).
- Packaging: `publish.ps1` now points at the Experience Builder 1.21 install.

## [1.1.0] - 2026-07-08

### Added

- Staff can now attach a photo when adding a comment on a ticket. A
  "Photo" button in the comment composer accepts a single image (JPG, PNG,
  WebP, HEIC, AVIF), shows a preview, and uploads it when the comment is
  sent. Useful for documenting completed work or clarifying a response.
- Uploaded photos are stored as native attachments on the Tickets feature
  (the same store the Photos tab already reads); no database schema change.
  The photo count and "Has Photos" filter update automatically via the
  existing RAC_PhotoCount_Sync attribute rule.
- Staff-uploaded photos carry a visibility-aware filename prefix: "staff-"
  when attached to a public comment (shown to the submitter on the public
  status page, requires submit widget v3.1.0+) and "staffint-" when attached
  to an internal note (never shown publicly). The Photos tab labels each
  photo Staff · Public, Staff · Internal, or Submitter.
- Photo validation and metadata stripping (EXIF removed via canvas
  re-encode) reuse the same proven pipeline as the public submit widget.

### Notes

- Comment text is still required to send; a photo attaches to that comment.
- Photos on public comments become visible to the submitter through the
  submit widget's ticket status page (deep link) as of submit widget v3.1.0.
  Submitter-facing email (rac_comments_mailer.py) is unchanged.

## [1.0.2] - 2026-06-18

### Fixed

- Table view activity badges now wrap onto a second line instead of spilling
  past the column when a ticket has comments, photos, and a survey response all
  at once.
- Table view no longer crushes columns into unreadable slivers when the panel
  is narrow (for example with the map sharing the space). Columns now compress
  only to a readable minimum, past which the table scrolls horizontally.
- Category and assigned-to cells no longer break words mid-syllable
  ("Transport ation"); whole words stay intact and only a word too long for the
  column is broken.

## [1.0.1] - 2026-06-16

### Fixed

- Resolved/closed date now records the actual system time when a ticket is
  resolved on the same day, instead of a flat local noon. The widget previously
  stamped every resolution at 12:00 PM regardless of when the work was closed
  out. Backdated resolutions are unaffected and still store at local noon, since
  a past day has no real completion time and noon avoids an off-by-one when the
  epoch is rendered in local time. Only new resolutions are affected; tickets
  already resolved under the prior logic remain at 12:00 PM.

## [1.0.0] - 2026-05-26

### Added

- Initial release. Ticket list and detail review against the configured Tickets
  feature service and its related comments, photo metadata, and survey response
  tables.
- Status updates with required status-change comments and an editable
  resolved/closed date (backdating writes an internal audit comment).
- Internal notes character cap with live counter, cascading category/subcategory
  dropdowns with integrity validation, server-side column and badge filters,
  Excel export, sidebar resize persistence, and a photo lightbox with keyboard
  navigation.
- Settings panel for the map widget and related table names.

[1.0.2]: https://github.com/brianmcleer/report-a-concern/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/brianmcleer/report-a-concern/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/brianmcleer/report-a-concern/releases/tag/v1.0.0
