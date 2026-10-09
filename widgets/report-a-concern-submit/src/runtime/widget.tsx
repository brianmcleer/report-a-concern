/// <reference path="./esri.d.ts" />
import { React, type AllWidgetProps } from "jimu-core";
import { JimuMapViewComponent, type JimuMapView } from "jimu-arcgis";
import type { IMConfig } from "../config";
import { beacon } from "../shared/beacon";
import type { BeaconHandle } from "../shared/beacon";
import { isValidEmail, PHONE_DIGITS_RE, stripPhoneDigits } from "./lib/validators";
import { containsProfanity } from "./lib/profanity";
import { CATEGORY_BOUNDARY_MAP } from "./lib/categoryBoundaries";
import defaultMessages from "./translations/default";
import __i18nDefaults from './translations/default'
import { __setIntl, __tc } from './i18n-t'
let __i18nIntl: any = null
/** Module translator: app language via the widget intl, English from default.ts, {name} values filled. */
const __t = (id: string, values?: { [key: string]: any }): string => {
  const msg: string = (__i18nDefaults as any)[id] ?? id
  if (__i18nIntl && typeof __i18nIntl.formatMessage === 'function') {
    try { return __i18nIntl.formatMessage({ id, defaultMessage: msg }, values) } catch (e) { }
  }
  return msg.replace(/\{(\w+)\}/g, (m: string, k: string) => (values && values[k] != null ? String(values[k]) : m))
}


// ╔═══════════════════════════════════════════════════════════╗
// ║  Report A Concern — Public Submission Widget             ║
// ║  Experience Builder 1.21 · Single-file widget            ║
// ║                                                          ║
// ║  4-step wizard: Location → Details → Contact → Review    ║
// ║  Inherits theme colors/fonts from EB theme system.       ║
// ║                                                          ║
// ║  v2.3   — Category ↔ Boundary filtering via              ║
// ║           Category_Boundary_Lookup table.                ║
// ║  v2.3.1 — Fix: created_date + address always in payload  ║
// ║           Fix: uploadAttachmentREST isProxy signature    ║
// ║  v2.3.2 — Fix: token in Geometry Service / reverseGeocode║
// ║           Fix: setPoint clears stale selectedAddress     ║
// ║           Fix: configured geocoderUrl used everywhere    ║
// ║  v2.3.3 — Feat: ticket_number on success + URL param     ║
// ║  v2.3.4 — Fix: uid() standalone function                 ║
// ║  v2.3.5 — Feat: ?ticket= deep link → live status view    ║
// ║  v2.3.6 — Feat: public comments on status view           ║
// ║           Fix: goTo uses scale:1128 instead of zoom:17   ║
// ║           Fix: email URL uses ticket_number not GUID     ║
// ║           Chore: all console statements removed          ║
// ║  v2.3.7 — Fix: status view zooms map + opens popup       ║
// ║           Fix: GUID normalisation for comments query     ║
// ║  v2.3.8 — Fix: is_public=1 filter restored in comments   ║
// ║           Fix: misplaced console.log in reverseGeocode   ║
// ║           Fix: config.commentsTableUrl direct override   ║
// ║           Chore: all debug console statements removed    ║
// ║  v2.3.9 — Feat: copy-to-clipboard button on success view ║
// ║  v2.4.0 — Feat: CATEGORY_BOUNDARY_MAP hardcoded fallback ║
// ║           for category-level boundary validation when    ║
// ║           Category_Boundary_Lookup table is not          ║
// ║           configured. Drainage & Stormwater (and all     ║
// ║           city-managed categories) enforce CITY_LIMITS;  ║
// ║           Water → WATER_DIST; Sewer → SEWER_DIST.        ║
// ║           WCAG 2.1 AA: label/htmlFor associations,       ║
// ║           aria-required, aria-invalid, aria-describedby, ║
// ║           role=alert on all error/warning messages,      ║
// ║           aria-live on dynamic status regions,           ║
// ║           aria-hidden on disabled form sections,         ║
// ║           autoComplete on contact fields, aria-pressed   ║
// ║           on toggle buttons, aria-busy on async ops,     ║
// ║           role=region on review cards, role=status on    ║
// ║           success screen, combobox pattern on geocoder.  ║
// ║  v2.6.0 — Feat: photos + video attachment support.       ║
// ║           Up to 3 photos (JPEG/PNG/WebP/HEIC, 15 MB ea.) ║
// ║           Up to 1 video (MP4/MOV, 60 s / 150 MB).        ║
// ║           Duration enforced via HTMLVideoElement.        ║
// ║           OWASP security: magic-byte validation, UUID    ║
// ║           safe filenames, MIME allowlist.                ║
// ║           Slot-based UI: thumbnail grid in Details step; ║
// ║           file count badge in Review step.               ║
// ║  v2.6.2 — Fix: removed capture="environment" so mobile   ║
// ║           users can pick from camera roll.               ║
// ║  v2.7.0 — Revert: enterprise FeatureServer attachments.  ║
// ║           AGOL addAttachment requires a token regardless ║
// ║           of OBAC settings — hard platform limitation.   ║
// ║           Files now uploaded to ReportAConcern_Reporter  ║
// ║           via addAttachment after applyEdits (non-fatal).║
// ║           Removed: uploadMediaToAGOL, agolMediaTableUrl. ║
// ║  v2.7.1 — Security: sanitizeUrl() on headerImageLink     ║
// ║           blocks javascript:/data: protocol injection.   ║
// ║           Security: address_submitted capped at 250 chars║
// ║           at submit time (geocoder reverse path bypass). ║
// ║  v2.7.2 — Fix: removed capture="environment" from photo  ║
// ║           input so system file picker is shown on mobile ║
// ║           (camera roll, take photo, Google Drive, etc.). ║
// ║  v2.7.3 — WCAG: fontWeight 500→700 on 11px success text  ║
// ║           (service area line) to ensure AA contrast at   ║
// ║           any EB theme success color.                    ║
// ║           WCAG: Edit location/details/contact buttons    ║
// ║           use aria-label instead of title — title is not ║
// ║           reliably announced by all screen readers on    ║
// ║           interactive elements.                          ║
// ║  v2.7.4 — Fix: iOS auto-zoom on input focus prevented    ║
// ║           via @media (hover:none) and (pointer:coarse)   ║
// ║           { font-size: 16px } — WebKit zooms when any    ║
// ║           input has font-size < 16px. Desktop unaffected.║
// ║  v2.7.5 — Feat: client-side profanity filter on           ║
// ║           description and name fields. Word-boundary      ║
// ║           regex + leet-speak normalisation; blocks common ║
// ║           profanity and slurs to prevent staff            ║
// ║           mistreatment. Error message prompts removal     ║
// ║           before submit. UX layer only — server-side      ║
// ║           moderation remains the authoritative gate.      ║
// ║  v2.7.6 — Feat: drag-and-drop file upload on desktop.     ║
// ║           Photo slots and video zone accept dragover/drop  ║
// ║           events; drag-active highlight (brand border +   ║
// ║           brandLight bg + ring) shown during hover.       ║
// ║           "Drag & drop" hint shown only on pointer:fine   ║
// ║           (desktop) devices via matchMedia. Shared        ║
// ║           processPhotoFile helper used by both input-change ║
// ║           used by both input-change and drop paths so     ║
// ║           OWASP validation runs identically in both cases.║
// ║  v2.7.7 — Feat: client-side photo compression via Canvas  ║
// ║           API. compressPhoto() scales longest side to     ║
// ║           ≤1920 px and exports as JPEG at quality 0.82;   ║
// ║           result only used if smaller than original.      ║
// ║           HEIC and non-decodable formats fall back to     ║
// ║           original silently. OWASP validation runs on     ║
// ║           the original file; compression is post-validate.║
// ║  v2.8.1 — Fix: profanity filter bypass via compound words  ║
// ║           like "fuckmyballs" (11 chars). Two fixes:        ║
// ║           (1) fuck/shit Pass 1 patterns now have NO        ║
// ║           trailing SUFFIX/\b — the \b was blocking matches ║
// ║           when a word char immediately followed the root   ║
// ║           (e.g. "fuck" + "m"). Safe because no English     ║
// ║           word contains either root innocuously.           ║
// ║           (2) Pass 2 long-run threshold lowered 12→11 to   ║
// ║           catch 11-char concatenated evasion runs.         ║
// ║  v2.8.2 — Security: fix polyglot/appended-payload bypass   ║
// ║           in photo uploads. (1) compressPhoto() always     ║
// ║           uses canvas-re-encoded output — removes the size ║
// ║           bailout that let EICAR-in-JPEG reach the server. ║
// ║           (2) validateMediaFile() step 6: JPEG FF D9 EOI   ║
// ║           trailer check (≤2 trailing bytes) catches future ║
// ║           polyglot variants even if canvas is bypassed     ║
// ║           (e.g. HEIC fallback path).                       ║
// ║  v2.8.3 — Feat: Spanish-language profanity filter.         ║
// ║           normalizeLeet() now strips Unicode diacriticals   ║
// ║           via NFD decomposition before pattern matching,   ║
// ║           enabling \b word boundaries to work correctly on ║
// ║           accented input (cabrón→cabron, coño→cono, etc.). ║
// ║           Pass 1 + Pass 2 extended with Mexican/pan-Latin  ║
// ║           American and Castilian Spanish profanity and     ║
// ║           slurs: chinga*, puta/puto, pendejo/a, cabrón,    ║
// ║           coño, mierda, culo, verga, joder, maricón,       ║
// ║           culero, hijoputa, perra, polla, hostia, mamón,   ║
// ║           gilipollas, cojones, sudaca. All patterns        ║
// ║           boundary-tested for false positives (putativo,   ║
// ║           icono, vehiculo, ampolla, mammon confirmed safe).║
// ║  v2.8.4 — Fix: offensive emoji bypass in name/description  ║
// ║           fields. 🖕 (U+1F595) and all 5 skin-tone variants║
// ║           passed through containsProfanity() because the   ║
// ║           emoji is outside ASCII and skipped by normalizeLeet║
// ║           and the [a-z]{11,} Pass 2 alpha-run scan.         ║
// ║           Fix: OFFENSIVE_EMOJI_RE checked against the raw   ║
// ║           (pre-normalisation) input before Pass 1/2 run.    ║
// ║  v2.8.5 — Hardening: tighter email validation regex.        ║
// ║           Old: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ — allowed   ║
// ║           quoted locals, numeric TLDs, 1-char TLDs,         ║
// ║           consecutive dots, and hyphen-edge domain labels.  ║
// ║           New: explicit char allowlist on local part        ║
// ║           (a-z 0-9 ._%+−, max 64 chars), RFC-compliant      ║
// ║           domain label regex (no leading/trailing hyphen,   ║
// ║           max 63 chars per label), alpha-only TLD 2–24      ║
// ║           chars, consecutive-dot rejection, 254-char total  ║
// ║           length cap (RFC 5321).                            ║
// ║  v2.8.6 — Security: fix polyglot/appended-payload bypass    ║
// ║           for video uploads (same class as v2.8.2 JPEG      ║
// ║           fix). Video had no canvas re-encode equivalent,   ║
// ║           so a valid MP4/MOV with EICAR appended after its  ║
// ║           last ISOBMFF box passed all 5 validation layers   ║
// ║           and reached the server raw. Fix: async ISOBMFF    ║
// ║           box-chain walker (isobmffBoxChainIsClean) added   ║
// ║           as validateMediaFile step 7 for mp4/mov. Only     ║
// ║           reads 8-byte box headers — skips mdat payload —  ║
// ║           then verifies last box ends exactly at EOF.        ║
// ║  v2.8.7 — Feat: submission progress bar. New state fields   ║
// ║           submitPhase (label string) and submitProgress     ║
// ║           (0–100) thread through onSubmit → submitViaREST / ║
// ║           submitViaLayer → uploadAttachmentREST /           ║
// ║           uploadAttachment. Phases: "Submitting report"     ║
// ║           (0→40%), each attachment evenly shares 40→95%,    ║
// ║           "Finalizing" (95→100%). Animated bar with CSS     ║
// ║           transition replaces the submit button area while  ║
// ║           in-flight. WCAG: role=progressbar, aria-valuenow, ║
// ║           aria-valuemin/max, aria-label, aria-live label.   ║
// ║  v2.8.8 — Restore: dedicated submitting screen between      ║
// ║           Review and Success. renderSubmitting() replaces   ║
// ║           the entire widget body (stepper hidden) while     ║
// ║           submitting=true via a new render() branch. Shows  ║
// ║           the progress bar full-width with animated fill,   ║
// ║           phase label, and a brief summary of what was      ║
// ║           submitted (category, address). Inline progress    ║
// ║           bar removed from renderStepReview — nav row       ║
// ║           reverts to plain Submit button (submit triggers   ║
// ║           the screen swap immediately).                     ║
// ║  v2.8.9 — Fix: widget resets to default state on device     ║
// ║           orientation change (portrait ↔ landscape).        ║
// ║           Root cause: JimuMapViewComponent fires            ║
// ║           onActiveViewChange again when the MapView resizes ║
// ║           on rotation, which re-called onViewReady and      ║
// ║           unconditionally ran the full init sequence        ║
// ║           (setState loading:true + layer/table discovery),  ║
// ║           wiping all wizard state. Fix: guard at top of     ║
// ║           onViewReady — if metadataLoaded is already true   ║
// ║           and the incoming view's portalItem ID matches the ║
// ║           already-loaded map, only the jmv reference is     ║
// ║           updated (setState jmv only). Full init only runs  ║
// ║           on the first call or if the map genuinely changes.║
// ║  v2.9.0 — Feat: portrait orientation lock for phones.       ║
// ║           Screen Orientation API lock() is only available   ║
// ║           in fullscreen/PWA contexts and does not work in   ║
// ║           an EB iframe. CSS transform approach used instead:║
// ║           when window.innerWidth > window.innerHeight on a  ║
// ║           touch device, the widget root is rotated -90deg   ║
// ║           with width/height swapped so content always reads ║
// ║           in portrait. orientationchange + resize listeners ║
// ║           registered in componentDidMount, removed in       ║
// ║           componentWillUnmount. Desktop (pointer:fine) is   ║
// ║           excluded — lock only fires on touch devices.      ║
// ║  v2.9.1 — Fix: "Could not retrieve ticket #N" on deep-link  ║
// ║           status view. loadTicketStatus() was deriving its  ║
// ║           query URL from ticketsLayer (the display MapServer║
// ║           in the web map), but MapServer Query is disabled  ║
// ║           on ReportAConcern_Reporter_Display — the server   ║
// ║           returned a JSON error, not features. Fix: new     ║
// ║           config field statusQueryUrl — a separate public-  ║
// ║           queryable layer URL (e.g. ReportAConcern_Status/  ║
// ║           FeatureServer/0 or any layer with Query enabled   ║
// ║           and PII excluded). When set, loadTicketStatus()   ║
// ║           uses it directly; falls back to ticketsLayer URL  ║
// ║           when not set (internal use / Query-enabled sites).║
// ║  v2.9.2 — Fix: Android photo picker shows no options (no    ║
// ║           Camera, Google Drive, Google Photos, etc.) and    ║
// ║           photos fail to upload on Android.                 ║
// ║           Root cause 1 (picker): accept attribute used      ║
// ║           explicit MIME list (image/jpeg,image/png,…).      ║
// ║           Android Chrome passes these types directly to the ║
// ║           OS intent system which only matches apps handling ║
// ║           those exact types, bypassing Camera and Drive.    ║
// ║           Fix: accept="image/*" — shows full Android chooser║
// ║           (Camera, Google Photos, Google Drive, Files, etc.)║
// ║           Security enforcement stays in JS (MIME allowlist  ║
// ║           + magic bytes); accept is UI hint only.           ║
// ║           Root cause 2 (upload failure): Samsung and other  ║
// ║           Android OEMs report camera photos with non-std    ║
// ║           MIME "image/jpg" (missing the 'e'). This was not  ║
// ║           in PHOTO_ALLOWED_MIMES so Step 4 (MIME allowlist) ║
// ║           silently rejected the file. Fix: "image/jpg"      ║
// ║           added to PHOTO_ALLOWED_MIMES as Android fallback. ║
// ║  v2.9.3 — Fix: iOS rotation still resets widget state.     ║
// ║           Root cause: onViewReady guard required BOTH      ║
// ║           portalItem IDs to be non-empty truthy strings.   ║
// ║           On iOS in an EB iframe portalItem.id is often    ║
// ║           null/empty, so every rotation fell through to    ║
// ║           full re-init. Fix: flipped guard logic — only    ║
// ║           re-init when map change is CONFIRMED (both IDs   ║
// ║           available and different); default to jmv-swap    ║
// ║           when IDs unavailable (safe, preserves state).    ║
// ║           Fix: Android photos still failing from Google    ║
// ║           Photos/Drive. Root cause: content providers      ║
// ║           deliver File.name with no extension ("photo",    ║
// ║           "image") or a full content URI path with "/"     ║
// ║           (e.g. "DCIM/Camera/IMG.jpg"). Step 2 rejected    ║
// ║           both. Fix: (1) strip to basename before parsing  ║
// ║           (UUID rename means original name never reaches   ║
// ║           server); (2) infer ext from MIME when absent.   ║
// ║  v2.9.4 — Security: fix ISOBMFF embedded-payload bypass   ║
// ║           in video uploads. isobmffBoxChainIsClean() only  ║
// ║           verified the top-level box chain terminated at  ║
// ║           EOF — it never looked inside container boxes.   ║
// ║           Attack: goldtest.mp4 embeds EICAR inside a      ║
// ║           crafted box with type \x00\x00\x00! (null bytes ║
// ║           in the 4CC field) inside moov→udta→meta. The   ║
// ║           top-level chain was perfectly valid so the      ║
// ║           check passed. Fix: isobmffBoxChainIsClean()     ║
// ║           replaced by isobmffIsClean() which recursively  ║
// ║           walks all known ISOBMFF container boxes and     ║
// ║           validates every box-type 4CC for printable ASCII║
// ║           (0x20–0x7E). No legitimate box type ever has a  ║
// ║           null byte; any non-printable byte in a 4CC is   ║
// ║           an injection artifact → file rejected.          ║
// ║  v2.9.5 — Fix: Android video picker shows no Camera,      ║
// ║           Google Drive, or Google Photos option. Same root ║
// ║           cause as the v2.9.2 photo fix — explicit MIME   ║
// ║           list (video/mp4,video/quicktime,.mp4,.mov) was  ║
// ║           passed to Android OS intent system, restricting ║
// ║           the chooser to apps that exactly match those    ║
// ║           types. Fix: accept="video/*" triggers the full  ║
// ║           Android chooser (Camera, Google Photos, Drive,  ║
// ║           Files). Security enforcement unchanged — JS     ║
// ║           MIME allowlist + magic bytes + ISOBMFF tree     ║
// ║           walk remain the authoritative gate.             ║
// ║  v2.9.6 — Fix: Android photos still rejected after v2.9.2 ║
// ║           accept="image/*" fix. Root cause: AVIF format   ║
// ║           (default camera output on Pixel 8+ / Android    ║
// ║           14+) was not in PHOTO_ALLOWED_EXTS, MIMES, or   ║
// ║           checkMagicBytes. Android also delivers          ║
// ║           image/pjpeg (Samsung progressive JPEG),         ║
// ║           image/jfif, image/x-jpeg, image/x-png which    ║
// ║           were not in PHOTO_ALLOWED_MIMES.                ║
// ║           Fixes: (1) AVIF added to PHOTO_ALLOWED_EXTS,   ║
// ║           PHOTO_ALLOWED_MIMES, MIME_TO_EXT, and           ║
// ║           checkMagicBytes (brands avif/avis/avio —        ║
// ║           same ISOBMFF ftyp structure as HEIC).           ║
// ║           (2) JFIF, pjpeg, x-jpeg, x-png aliases added   ║
// ║           to PHOTO_ALLOWED_MIMES. (3) ISOBMFF tree check  ║
// ║           extended to cover avif and heic (both use same  ║
// ║           container and were previously unchecked).        ║
// ║           (4) compressPhoto() canvas re-encodes AVIF to   ║
// ║           JPEG on Android Chrome 85+ — HEIC/older fallback║
// ║           returns original AVIF which still passes AVIF   ║
// ║           magic byte + ISOBMFF validation.                ║
// ║  v2.9.7 — Fix: portrait orientation lock not working on   ║
// ║           iOS. Two root causes:                           ║
// ║           (1) orientationchange on iOS fires BEFORE the   ║
// ║           browser updates layout dimensions (200–400 ms   ║
// ║           later). The 50 ms debounce read stale portrait  ║
// ║           values → isLandscape never flipped → CSS lock   ║
// ║           never applied. Fix: after orientationchange,    ║
// ║           defer until the next resize event fires (which  ║
// ║           iOS only emits after dimensions are final) with ║
// ║           a 500 ms safety fallback.                       ║
// ║           (2) window.innerWidth inside an EB iframe is    ║
// ║           unreliable on iOS WKWebView (reflects iframe    ║
// ║           width, not device viewport). Fix: orientation   ║
// ║           detection now uses a priority chain:            ║
// ║           screen.orientation.type (iOS 16.4+) →          ║
// ║           window.orientation (all iOS, 90/−90=landscape)  ║
// ║           → visualViewport.width > height →              ║
// ║           innerWidth > innerHeight (last resort).         ║
// ║  v2.9.8 — Fix: Android photos still rejected in WebViews  ║
// ║           and on devices where content providers return   ║
// ║           no extension AND no MIME type.                  ║
// ║           Bug 1: Step 3 hard-rejected (\"File must have an ║
// ║           extension\") when file.name had no extension AND ║
// ║           file.type was empty — common for Google Drive   ║
// ║           and some OEM content providers in WebViews.     ║
// ║           Fix: added inferExtFromMagicBytes() fallback —  ║
// ║           reads first 16 bytes via FileReader, detects    ║
// ║           JPEG/PNG/WebP/HEIC/AVIF/MP4/MOV from signature. ║
// ║           Bug 2: readFileTail() used Blob.arrayBuffer()   ║
// ║           (Chrome 76+ only). On older WebViews this       ║
// ║           silently threw → JPEG trailer check failed →    ║
// ║           \"Could not verify file integrity\" rejection.    ║
// ║           Bug 3: isobmffIsClean() called               ║
// ║           file.slice().arrayBuffer() in every loop — same ║
// ║           older-WebView failure; all AVIF/HEIC photos     ║
// ║           rejected at Step 7 on affected devices.         ║
// ║           Fix (bugs 2+3): added readFileRange() helper    ║
// ║           using FileReader (supported since Android 4).   ║
// ║           readFileTail and isobmffIsClean both now use it.║
// ║  v2.9.9 — Fix: portrait lock reworked as browser-capability║
// ║           detection across all 4 major browsers.          ║
// ║           Previous approach listened to window.            ║
// ║           orientationchange for all browsers and always   ║
// ║           waited for a resize event before reading dims.  ║
// ║           Root cause: screen.orientation.change (Chrome,  ║
// ║           Edge, Firefox, Safari 16.4+) fires AFTER the    ║
// ║           type is already updated — no dim-wait needed.   ║
// ║           window.orientationchange dims lag 200-400ms only║
// ║           on Safari < 16.4.                               ║
// ║           New strategy: if screen.orientation.addEventListener║
// ║           is available, bind to screen.orientation.change ║
// ║           and apply immediately. window.orientationchange ║
// ║           is only used as fallback (Safari < 16.4) and    ║
// ║           now skipped when screen.orientation is present  ║
// ║           to avoid double-applying. resize event retained ║
// ║           to resolve legacy pending state and handle      ║
// ║           keyboard/chrome-chrome toggles.                 ║
// ║  v3.0.0 — Fix: ticket deep-link (?ticket_number=N) stopped║
// ║           opening the status view on page load.           ║
// ║           Root cause 1: EB rewrites window.location before║
// ║           React componentDidMount fires — the param was   ║
// ║           gone before the widget ever read it.            ║
// ║           Fix: read URL at module level (before React      ║
// ║           mounts) AND store in sessionStorage as backup.  ║
// ║           Root cause 2: pendingStatusTicketNumber was only ║
// ║           consumed in the onViewReady full-init callback.  ║
// ║           If onViewReady fired a second time (orientation, ║
// ║           EB re-render) it hit the jmv-swap path which    ║
// ║           never checked pendingStatusTicketNumber, so the  ║
// ║           pending ticket was silently lost.               ║
// ║           Fix: also consume from jmv-swap path + add      ║
// ║           componentDidUpdate safety net that fires        ║
// ║           loadTicketStatus whenever metadataLoaded flips  ║
// ║           true AND pendingStatusTicketNumber is set.      ║
// ║  v3.0.1 — Fix: deep-link still broken when statusQueryUrl ║
// ║           IS configured. Root cause: the external site's  ║
// ║           Create-only FeatureServer causes a layer view   ║
// ║           error that prevents onViewReady from ever       ║
// ║           completing, so metadataLoaded never flips true  ║
// ║           and pendingStatusTicketNumber is never consumed. ║
// ║           Fix: componentDidMount now fires loadTicketStatus║
// ║           immediately when statusQueryUrl is set — no map ║
// ║           needed, it's a plain REST fetch. Only falls back ║
// ║           to the pending/map-wait path when statusQueryUrl ║
// ║           is blank (internal portal / Query-enabled map). ║
// ║  v3.0.2 — Fix: status view rendered by loadTicketStatus   ║
// ║  v3.0.3 — Removed: video upload support. Widget is now    ║
// ║           photos-only (up to 3 JPEG/PNG/WebP/HEIC/AVIF).  ║
// ║           Removed: VIDEO_ALLOWED_EXTS, VIDEO_ALLOWED_MIMES,║
// ║           MAX_VIDEO_SIZE_MB, MAX_VIDEO_DURATION_SEC,       ║
// ║           stripVideoMetadata(), processVideoFile(), all    ║
// ║           video UI (slot, drag-drop zone, camera button),  ║
// ║           and video badge on Review step.                  ║
// ║  v3.1.0 — Feat: staff photos on the status view. The deep- ║
// ║           link status page now lists ticket attachments    ║
// ║           whose filename starts with "staff-" (photos the  ║
// ║           RAC Manager attaches to PUBLIC comments).         ║
// ║           "staffint-" (internal-note photos) and the        ║
// ║           submitter's own uploads are never shown.          ║
// ║           OBJECTID captured from the existing status query; ║
// ║           photos fetched from {layer}/{oid}/attachments.    ║
// ║  v3.1.3 — Fix: block RFC 2606/6761 reserved email domains   ║
// ║           (example.com/.net/.org, *.test, *.invalid,        ║
// ║           *.localhost, *.local) at submit. These are valid  ║
// ║           syntax but rejected by the relay (501 5.1.5) and  ║
// ║           re-queued on every mailer run, flooding           ║
// ║           Notification_Log. Also changed the email field    ║
// ║           placeholder off "your.email@example.com" so it is ║
// ║           no longer copied in verbatim.                     ║
// ║  v3.3.1 — Fix: allow the given name "Dick" in the name and  ║
// ║           description fields. The profanity filter's dick   ║
// ║           pattern flagged the bare name, so a resident      ║
// ║           named Dick could not submit a report. Pattern     ║
// ║           now requires an aggressive compound suffix        ║
// ║           (dickhead/dickface/dickwad/dickbag/dicktard);     ║
// ║           standalone "dick"/"dicks"/"Dick's" passes, while  ║
// ║           "Dickens"/"Dickinson" stay safe via \b.           ║
// ╚═══════════════════════════════════════════════════════════╝
// ║           (List of Dirty, Naughty, Obscene and Otherwise  ║
// ║           Bad Words, MIT license). Added: Hispanic/Latino  ║
// ║           slurs (beaner, spic, wetback), Black/AA slurs   ║
// ║           (coon, darkie, jigaboo), Asian slur (slanteye), ║
// ║           Middle Eastern slurs (raghead, towelhead),       ║
// ║           South Asian slur (paki), trans slur (tranny),   ║
// ║           hate symbols (swastika, neonazi), British        ║
// ║           profanity (bollocks, tosser, wanker, arsehole),  ║
// ║           and crude anatomical terms (butthole, bunghole). ║
// ║           All new patterns boundary-tested for false-      ║
// ║           positive safety (e.g. spice, Pakistan, bullock). ║
// ╚═══════════════════════════════════════════════════════════╝

// ── Standalone helpers — outside class to avoid `this` issues ──

function uid(): string {
    // Use crypto.getRandomValues for cryptographically secure UUIDs.
    // Math.random() is predictable and must not be used for security-relevant IDs.
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        // Set version 4 bits (byte 6: 0100xxxx) and variant bits (byte 8: 10xxxxxx)
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    // Fallback for environments without crypto (should never happen in a modern browser)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * Allowlist-based URL sanitizer for config-supplied hrefs.
 * Only http: and https: pass through — strips javascript:, data:, vbscript:, etc.
 * Used on headerImageLink which is set by EB admins, not public users, but
 * defense-in-depth is warranted for anything that ends up as an <a href>.
 */
function sanitizeUrl(url: string): string {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
    } catch { }
    return "";
}

function getTokenFromIdentityManager(): string {
    try {
        const esriId = (window as any).require?.("esri/identity/IdentityManager");
        if (esriId?.credentials) {
            for (const c of esriId.credentials) {
                if (c.token) return c.token;
            }
        }
    } catch { }
    return "";
}

/** Token-based name match — mirrors the manager widget's matchAll() utility. */
function matchAllTokens(haystack: string, tokens: string[]): boolean {
    const h = haystack.toLowerCase().replace(/_/g, " ");
    return tokens.every(t => h.includes(t));
}

// ══════════════════════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════════════════════

interface TicketFormData {
    submitted_by_name: string;
    submitted_by_email: string;
    submitted_by_phone: string;
    category: number | null;
    subcategory: string;
    description: string;
}

interface SubtypeInfo {
    code: number;
    name: string;
    domains: Record<string, CodedValueDomain>;
}

interface CodedValueDomain {
    type: string;
    name: string;
    codedValues: { name: string; code: string | number }[];
}

interface GeoResult {
    address: string;
    location: { x: number; y: number; spatialReference: any } | null;
}

interface LookupEntry {
    category: number;
    boundaryId: string;
    isValid: boolean;
    redirectMessage: string;
    displayOrder: number;
}

/** Minimal ticket fields shown in the status view for bookmarked URLs */
interface StatusTicket {
    ticket_number: number;
    /** GUID — used only as FK for the comments query, never displayed */
    ticket_id: string;
    category: number | null;
    subcategory: string;
    status: number | null;
    priority: number | null;
    description: string;
    created_date: number | null;
    address_submitted: string;
    /** OBJECTID from the status query — needed to fetch attachments */
    objectid: number | null;
}

/** A public-facing comment shown in the ticket status view */
interface StatusComment {
    commentText: string;
    commentDate: number | null;
}

/**
 * A staff photo shown in the ticket status view. Sourced from native
 * FeatureServer attachments on the Tickets feature whose filename starts
 * with "staff-" (attached to a PUBLIC comment in the RAC Manager).
 * "staffint-" (internal-note photos) and submitter uploads are excluded.
 */
interface StatusPhoto {
    url: string;
    name: string;
    uploadDate: number | null;
}

type FieldErrors = Record<string, string>;
type WizardStep = 0 | 1 | 2 | 3;

interface GeofenceResult {
    insideBoundary: boolean;
    matchedBoundaries: string[];
    matchedBoundaryIds: string[];
    checking: boolean;
}

/**
 * Result of the category-level boundary check (Step 1).
 * Used as a fallback when the Category_Boundary_Lookup table is not configured.
 * When the lookup table IS configured, `getFilteredCategories()` handles this
 * and `categoryGeofence` is not rendered.
 */
interface CategoryGeofenceResult {
    checking: boolean;
    valid: boolean | null; // null = not yet checked
}

interface WidgetState {
    jmv: JimuMapView | null;
    ticketsLayer: __esri.FeatureLayer | null;
    boundariesUrl: string;
    subtypes: SubtypeInfo[];
    loading: boolean;
    metadataLoaded: boolean;
    initError: string;

    lookupUrl: string;
    lookupData: LookupEntry[];
    lookupLoaded: boolean;
    lookupLoading: boolean;
    lookupError: string;

    commentsTableUrl: string;

    step: WizardStep;

    mapPoint: __esri.Point | null;
    placingPin: boolean;
    clickHandler: __esri.Handle | null;
    gpsLocating: boolean;
    addressQuery: string;
    addressSearching: boolean;
    addressResults: GeoResult[];
    addressError: string;
    selectedAddress: string;
    geofence: GeofenceResult;

    /** Category-level boundary result — fallback when lookup table not configured. */
    categoryGeofence: CategoryGeofenceResult;

    form: TicketFormData;
    fieldErrors: FieldErrors;

    // ── Media attachments (up to 3 photos) ────────────────────
    photoFiles: File[];
    photoPreviews: string[];
    photoErrors: string[];   // per-slot error message, parallel to photoFiles

    submitting: boolean;
    submitResult: "idle" | "success" | "error";
    submitMessage: string;
    /** Human-readable label shown below the progress bar during submission. */
    submitPhase: string;
    /** Integer 0–100 shown in the progress bar during submission. */
    submitProgress: number;

    ticketNumber: number | null;

    /** True for ~2 s after the user clicks "Copy link" on the success screen. */
    urlCopied: boolean;

    // ── Drag-and-drop state ──────────────────────────────────
    /** Index of the photo slot currently being dragged over, or null. */
    dragOverPhotoSlot: number | null;

    // ── Status view ──────────────────────────────────────────
    pendingStatusTicketNumber: number | null;
    statusViewLoading: boolean;
    statusViewTicket: StatusTicket | null;
    statusViewError: string;
    statusViewComments: StatusComment[];
    statusViewCommentsLoading: boolean;
    statusViewPhotos: StatusPhoto[];
    statusViewPhotosLoading: boolean;

    /** Latest message for the visually hidden polite live region (step changes, results, errors). */
    liveMessage: string;

    /** True when a touch device is in landscape — triggers CSS portrait lock. */
}

// ══════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════

const EMPTY_FORM: TicketFormData = {
    submitted_by_name: "",
    submitted_by_email: "",
    submitted_by_phone: "",
    category: null,
    subcategory: "",
    description: "",
};

const EMPTY_GEOFENCE: GeofenceResult = {
    insideBoundary: false,
    matchedBoundaries: [],
    matchedBoundaryIds: [],
    checking: false,
};

const EMPTY_CAT_GEOFENCE: CategoryGeofenceResult = {
    checking: false,
    valid: null,
};

const DEFAULT_GEOCODER =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

// Public comments layer used by the deep-link status view. Comments live on a
// SEPARATE service from the tickets layer, so a fallback derived off the
// tickets URL can never reach them. Set config.commentsTableUrl (or add the
// comments table to the web map) for the status view to show comments. There
// is no built-in default: an empty value means the status view shows the
// ticket without its public comments.
const DEFAULT_COMMENTS_URL = "";

const DEFAULT_STATUS = 1;
const DEFAULT_PRIORITY = 2;

const STATUS_LABELS: Record<number, string> = {
    1: "Open",
    2: "Received",
    3: "In Progress",
    4: "Resolved",
    5: "Closed",
};

const PRIORITY_LABELS: Record<number, string> = {
    1: "Low",
    2: "Medium",
    3: "High",
};

// Email and phone validators moved to ./lib/validators.ts (pure functions, unit tested).

// Profanity filter moved to ./lib/profanity.ts (pure functions, unit tested).

const MAX_PHOTOS = 3;
const MAX_PHOTO_SIZE_MB = 15;
const STEP_LABELS = ["Location", "Details", "Contact", "Review"] as const;

/**
 * Off-screen but still in the accessibility tree and the tab order. Used for the
 * polite live region and for file inputs whose visible control is a styled label.
 * display:none would remove them from keyboard and screen reader reach.
 */
const VISUALLY_HIDDEN: React.CSSProperties = {
    position: "absolute", width: 1, height: 1, margin: -1, padding: 0,
    overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
};

// ── Photo compression settings ────────────────────────────────
// Applied after OWASP validation, before upload.
// HEIC files cannot be decoded to canvas natively in most browsers
// and fall back to the original uncompressed file automatically.
const COMPRESS_MAX_DIMENSION_PX = 1920;  // longest side cap (px)
const COMPRESS_JPEG_QUALITY = 0.82;  // 0–1; 0.82 ≈ high quality, ~60–70% size reduction

// ══════════════════════════════════════════════════════════════
//  OWASP FILE UPLOAD SECURITY
//  Ref: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
//
//  Defense-in-depth layers applied here (client side):
//    1. Filename safety    — null bytes, path separators, length, double-ext
//    2. Extension allowlist — strict final-ext check after cleaning
//    3. MIME allowlist      — quick pre-check (not authoritative; spoofable)
//    4. Magic byte check    — reads actual file bytes; cannot be bypassed by rename
//    5. Safe upload name    — UUID-based; raw user filename never sent to server
//
//  Note: client-side validation is a UX layer. ArcGIS Server attachment endpoint
//  is the authoritative gate. Antivirus / CDR scanning is a server-side concern.
// ══════════════════════════════════════════════════════════════

/**
 * Filename segments (dot-split, not just the final ext) must not match any
 * of these. Catches double-extension attacks such as "malware.php.jpg".
 */
const DANGEROUS_EXTS = new Set([
    "php", "php3", "php4", "php5", "php7", "phtml", "phar",
    "asp", "aspx", "ascx", "ashx", "asmx", "cer",
    "jsp", "jspx", "jsw", "jsv", "jtml",
    "py", "pyc", "pyo", "rb", "pl", "cgi",
    "sh", "bash", "zsh", "ksh", "bat", "cmd", "ps1", "vbs", "vbe", "wsf", "wsh",
    "exe", "com", "dll", "msi", "bin", "elf",
    "js", "jsx", "ts", "tsx",
    "html", "htm", "xhtml", "mhtml",
    "svg", "xml", "xsl", "xslt",
    "swf", "jar", "war", "ear",
    "htaccess", "htpasswd",
    "config", "env",
]);

/** Allowlisted extensions for photos (normalized, no dot). */
const PHOTO_ALLOWED_EXTS = ["jpg", "png", "webp", "heic", "avif"];

/**
 * Allowlisted MIME types for photos.
 * Empty string is included because some browsers (iOS Safari) report no MIME
 * for HEIC files — the magic byte check is the authoritative gate in that case.
 *
 * Android-specific additions:
 *   image/jpg    — non-standard alias (Samsung and other OEMs, missing the 'e')
 *   image/avif   — default camera format on Pixel 8+ / Android 14+
 *   image/jfif   — JFIF variant of JPEG (some Android browsers/tools)
 *   image/pjpeg  — progressive JPEG reported by some Samsung camera apps
 *   image/x-jpeg — OEM camera app MIME alias
 *   image/x-png  — rare PNG variant from some Android tools
 */
const PHOTO_ALLOWED_MIMES = new Set([
    "image/jpeg",
    "image/jpg",    // non-standard alias — Samsung and other Android OEMs
    "image/jfif",   // JFIF JPEG variant
    "image/pjpeg",  // progressive JPEG (Samsung)
    "image/x-jpeg", // OEM camera alias
    "image/png",
    "image/x-png",  // rare PNG variant
    "image/webp",
    "image/heic",
    "image/heif",
    "image/avif",   // Pixel 8+ / Android 14+ default camera format
    "",             // iOS Safari omits MIME for HEIC — magic bytes will confirm
]);



/**
 * Read a byte range from a File using the FileReader API.
 *
 * Unlike Blob.arrayBuffer() (added Chrome 76), FileReader has been available
 * since Android 4 / Chrome 6 and works correctly in all WebViews including
 * older ArcGIS mobile WebViews. readFileTail and isobmffIsClean use this
 * helper so that validation does not silently fail on older Android devices.
 */
function readFileRange(file: File, start: number, end: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) =>
            resolve(new Uint8Array(e.target!.result as ArrayBuffer));
        reader.onerror = () => reject(new Error("Could not read file range."));
        reader.readAsArrayBuffer(file.slice(start, end));
    });
}

/** Read the first `count` bytes of a File as a Uint8Array. */
function readMagicBytes(file: File, count: number): Promise<Uint8Array> {
    return readFileRange(file, 0, count);
}

/** Return true when `bytes` starts with all values in `sig`. */
function bytesStartWith(bytes: Uint8Array, sig: number[]): boolean {
    return sig.every((b, i) => bytes[i] === b);
}

/**
 * Validate file signature (magic bytes) for a given normalized extension.
 *
 * Covers: jpg, png, webp, heic, mp4, mov
 *
 * A renamed file (e.g. script.php renamed to image.jpg) will fail here
 * because the actual byte sequence does not match the JPEG signature.
 */
function checkMagicBytes(bytes: Uint8Array, ext: string): boolean {
    switch (ext) {
        case "jpg":
            // JPEG: FF D8 FF
            return bytesStartWith(bytes, [0xFF, 0xD8, 0xFF]);

        case "png":
            // PNG: 89 50 4E 47 0D 0A 1A 0A
            return bytesStartWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        case "webp":
            // WebP: bytes 0–3 = "RIFF" (52 49 46 46), bytes 8–11 = "WEBP" (57 45 42 50)
            return (
                bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
                bytes[8] === 0x57 && bytes[9] === 0x45 &&
                bytes[10] === 0x42 && bytes[11] === 0x50
            );

        case "heic": {
            // ISO Base Media File Format: bytes 4–7 = "ftyp" (66 74 79 70)
            // Major brand (bytes 8–11) must be a recognised HEIF-family brand.
            const HEIF_BRANDS = new Set([
                "heic", "heix", "hevc", "hevx",
                "heim", "heis", "hevm", "hevs",
                "mif1", "msf1",
            ]);
            const hasFtyp =
                bytes[4] === 0x66 && bytes[5] === 0x74 &&
                bytes[6] === 0x79 && bytes[7] === 0x70;
            if (!hasFtyp) return false;
            const brand = String.fromCharCode(
                bytes[8], bytes[9], bytes[10], bytes[11],
            ).toLowerCase().trim();
            return HEIF_BRANDS.has(brand);
        }

        case "avif": {
            // AVIF uses the same ISO Base Media File Format (ISOBMFF) as HEIC.
            // ftyp box at bytes 4–7; major brand at bytes 8–11.
            // Valid AVIF brands: "avif" (still image), "avis" (image sequence),
            // "avio" (progressive/layered). Introduced in Android 14 as the
            // Pixel 8+ default camera format.
            const hasFtyp =
                bytes[4] === 0x66 && bytes[5] === 0x74 &&
                bytes[6] === 0x79 && bytes[7] === 0x70;
            if (!hasFtyp) return false;
            const brand = String.fromCharCode(
                bytes[8], bytes[9], bytes[10], bytes[11],
            ).toLowerCase().trim();
            return brand === "avif" || brand === "avis" || brand === "avio";
        }

        case "mp4": {
            // ISO Base Media File Format with MP4-family brands.
            // ftyp box at bytes 4–7; major brand at bytes 8–11.
            const hasFtyp =
                bytes[4] === 0x66 && bytes[5] === 0x74 &&
                bytes[6] === 0x79 && bytes[7] === 0x70;
            if (!hasFtyp) return false;
            const brand = String.fromCharCode(
                bytes[8], bytes[9], bytes[10], bytes[11],
            ).toLowerCase().trim();
            // Reject HEIC/HEIF brands — those are image formats, not video.
            const HEIF_BRANDS = new Set([
                "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1",
            ]);
            // Accept anything that isn't a HEIF brand.
            // This covers: mp4, mp41, mp42, isom, iso2, avc1, M4V, M4A, f4v,
            // qt (QuickTime), and any future brand — the ISOBMFF structural
            // check (step 7) is the authoritative gate for container integrity.
            return !HEIF_BRANDS.has(brand);
        }

        case "mov": {
            // QuickTime MOV: any ISOBMFF file with an ftyp box, or older MOV
            // containers that begin directly with moov/free/mdat/wide/skip.
            //
            // iOS Camera records .mov files but uses brands like "mp42" or
            // "avc1" — not the legacy "qt  " brand. The brand alone is not a
            // reliable discriminator between MP4 and MOV; both share the same
            // ISOBMFF container. We accept any ftyp-based file as MOV here
            // because the ISOBMFF structural check (step 7) is the real gate.
            const hasFtyp =
                bytes[4] === 0x66 && bytes[5] === 0x74 &&
                bytes[6] === 0x79 && bytes[7] === 0x70;
            if (hasFtyp) return true;
            // Older QuickTime containers start with a box whose type
            // (bytes 4–7) is one of: moov, free, mdat, wide, skip.
            const boxType = String.fromCharCode(
                bytes[4], bytes[5], bytes[6], bytes[7],
            ).toLowerCase();
            return ["moov", "free", "mdat", "wide", "skip"].includes(boxType);
        }

        default:
            return false;
    }
}

/**
 * Infer a normalised file extension from magic bytes alone.
 *
 * Used as a last resort in validateMediaFile Step 3 when the filename has
 * no extension AND file.type is empty — a common combination when files
 * are delivered by Android content providers (Google Drive, Samsung Gallery,
 * some OEM camera apps) inside a WebView.
 *
 * Returns a lowercase extension string ("jpg", "png", "webp", "heic",
 * "avif", "mp4", "mov") or null when the signature is unrecognised.
 */
async function inferExtFromMagicBytes(file: File): Promise<string | null> {
    try {
        const bytes = await readMagicBytes(file, 16);

        // JPEG: FF D8 FF
        if (bytesStartWith(bytes, [0xFF, 0xD8, 0xFF])) return "jpg";

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (bytesStartWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return "png";

        // WebP: RIFF????WEBP
        if (bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
            return "webp";
        }

        // ISOBMFF (HEIC, AVIF, MP4, MOV): ftyp box at bytes 4–7
        if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
            const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase().trim();
            const heifBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
            if (heifBrands.has(brand)) return "heic";
            if (brand === "avif" || brand === "avis" || brand === "avio") return "avif";
            if (brand === "qt") return "mov";
            return "mp4"; // any other ISOBMFF brand — treat as MP4
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Generate an OWASP-safe upload filename.
 *
 * Returns `{uuid}.{allowlisted-ext}` — the original user-supplied filename
 * is NEVER sent to the server, eliminating:
 *   · Path traversal  (e.g. ../../etc/passwd.jpg)
 *   · Special character injection
 *   · Filename-based server-side exploits
 */
function getSafeUploadName(file: File, allowedExts: string[]): string {
    const rawName = (file.name || "").replace(/\0/g, "");
    const lastDot = rawName.lastIndexOf(".");
    const rawExt = lastDot >= 0 ? rawName.slice(lastDot + 1).toLowerCase() : "";
    // Normalise common aliases to canonical form
    const extAliases: Record<string, string> = {
        jpeg: "jpg",
        jfif: "jpg",   // JFIF is JPEG — re-encode will handle it
        heif: "heic",
        quicktime: "mov",
    };
    const ext = extAliases[rawExt] ||
        (allowedExts.includes(rawExt) ? rawExt : "bin");
    return `${uid()}.${ext}`;
}

/**
 * Client-side photo compression using the Canvas API.
 *
 * Process:
 *   1. Decode the image into a hidden <img> element via an object URL.
 *   2. Compute scale factor so neither dimension exceeds COMPRESS_MAX_DIMENSION_PX.
 *   3. Draw onto an offscreen <canvas> at the scaled size.
 *   4. Export as image/jpeg at COMPRESS_JPEG_QUALITY.
 *   5. Always use the canvas-re-encoded output — even when the blob is larger
 *      than the original. Canvas re-encoding strips any data appended after the
 *      image content (polyglot/EICAR attack). The prior "return original if
 *      larger" bailout was removed in v2.8.2 as it bypassed this sanitization.
 *
 * HEIC fallback: browsers cannot decode HEIC natively in most cases, so any
 * error during canvas decoding silently returns the original file.
 *
 * The returned File always has a UUID-based .jpg name so the upload filename
 * remains safe and consistent regardless of input format.
 */
/**
 * Re-encode a photo through the canvas API to strip all metadata (EXIF,
 * IPTC, XMP, comments) and remove any appended payload.
 *
 * Returns the re-encoded File on success, or null if the browser could not
 * decode the image (e.g. HEIC on non-Safari, tainted canvas). Callers must
 * handle null — for HEIC the ISOBMFF structural check covers the gap;
 * for other formats a null return should be treated as a processing error.
 */
async function compressPhoto(file: File): Promise<File | null> {
    return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            try {
                // ── Scale to fit within COMPRESS_MAX_DIMENSION_PX ──────
                let { naturalWidth: w, naturalHeight: h } = img;
                if (w > COMPRESS_MAX_DIMENSION_PX || h > COMPRESS_MAX_DIMENSION_PX) {
                    const scale = COMPRESS_MAX_DIMENSION_PX / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }

                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) { resolve(null); return; }

                ctx.drawImage(img, 0, 0, w, h);

                canvas.toBlob(
                    (blob) => {
                        if (!blob) { resolve(null); return; }
                        // Canvas re-encode from decoded pixel data only —
                        // all EXIF, IPTC, XMP, and comment metadata is
                        // discarded. Appended payloads (EICAR, polyglots)
                        // are also stripped because canvas only reads pixels.
                        const reencoded = new File([blob], `${uid()}.jpg`, { type: "image/jpeg" });
                        resolve(reencoded);
                    },
                    "image/jpeg",
                    COMPRESS_JPEG_QUALITY,
                );
            } catch {
                resolve(null);
            }
        };

        img.onerror = () => {
            // HEIC and other browser-undecodable formats end up here.
            // Return null — processPhotoFile handles HEIC separately.
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        };

        img.src = objectUrl;
    });
}

/** Read the last `tailBytes` bytes of a File as a Uint8Array. */
async function readFileTail(file: File, tailBytes: number): Promise<Uint8Array> {
    const start = Math.max(0, file.size - tailBytes);
    return readFileRange(file, start, file.size);
}

/**
 * Verify a JPEG file ends with a valid End-of-Image (FF D9) marker within
 * the last `tail` bytes, with no more than 2 trailing bytes after it.
 *
 * A valid JPEG must terminate with FF D9. Files with significant data after
 * FF D9 are polyglot attacks (e.g. EICAR payload appended after EOI).
 * Allows ≤2 trailing bytes as tolerance for edge-case encoders.
 */
function jpegHasValidTrailer(tail: Uint8Array): boolean {
    for (let i = tail.length - 2; i >= 0; i--) {
        if (tail[i] === 0xFF && tail[i + 1] === 0xD9) {
            const trailing = tail.length - 2 - i;
            return trailing <= 2;
        }
    }
    return false; // No FF D9 found in last 16 bytes — reject.
}

interface MediaValidationResult {
    valid: boolean;
    error: string;
}

/**
 * Walk the ISOBMFF (ISO Base Media File Format) top-level box chain for an
 * MP4 or MOV file and verify that the last box ends exactly at EOF.
 *
 * Boxes are [size:uint32be][type:4ascii][data...]. Only the 8-byte headers
 * are read — the data payload (which can be hundreds of MB for mdat) is
 * skipped entirely by jumping offset += boxSize. A typical MP4 has 3–5
 * top-level boxes, so this costs 3–5 × 8-byte async slice calls.
 *
 * Returns false (reject) when:
 *   · Any header is truncated (offset + 8 > file.size)
 *   · Any box reports size < 8 (smaller than its own header — corrupt/injected)
 *   · Extended-size boxes (size === 1, used for > 4 GB) are present —
 *     conservative rejection, impossible at the 150 MB upload cap
 *   · The cumulative box sizes do not equal file.size — trailing bytes exist
 *
 * A file with EICAR or any payload appended after the last valid box is
 * always rejected: the walk ends at offset < file.size (gap), or the EICAR
 * bytes are misread as a box header with a nonsensical size and the walk
 * overruns file.size (offset !== file.size at termination).
 *
 * v2.9.4: replaced by isobmffIsClean() which also recursively validates
 * every box-type 4CC field for printable ASCII. See isobmffIsClean for
 * the full description of the embedded-payload attack this closes.
 */

/**
 * Set of known ISOBMFF container box types whose children must be walked.
 * Any non-container box is treated as a leaf — its payload is not examined,
 * but its 4CC is still checked for printable ASCII.
 */
const ISOBMFF_CONTAINERS = new Set([
    "moov", "trak", "mdia", "minf", "dinf", "stbl",
    "udta", "meta", "ilst", "moof", "traf", "mvex",
    "edts", "sinf", "schi", "tref", "iprp", "ipco",
]);

/**
 * Recursively validate an ISOBMFF (MP4 / MOV) byte range:
 *
 *   1. Every box-type 4CC must consist entirely of printable ASCII (0x20–0x7E).
 *      No legitimate registered box type ever contains a null byte or control
 *      character. A crafted type such as \x00\x00\x00! is always an injected
 *      payload box (as used in the goldtest.mp4 attack: moov→udta→meta→\x00\x00\x00!
 *      smuggled the EICAR string inside a syntactically valid box chain).
 *
 *   2. The cumulative box sizes within each range must exactly account for every
 *      byte — no gaps (appended payload) and no overruns (corrupt sizing).
 *
 *   3. For each known container type (moov, trak, udta, meta …) the function
 *      recurses into the box payload and applies rules 1 and 2 there too.
 *
 * Reads only 8-byte box headers; skips mdat payload entirely — a 150 MB
 * mdat costs nothing beyond a single slice call per recursion level.
 */
async function isobmffIsClean(file: File, start: number = 0, end?: number): Promise<boolean> {
    const fileSize = file.size;
    const rangeEnd = end ?? fileSize;
    let offset = start;

    while (offset < rangeEnd) {
        // Read exactly 8 bytes: [size: uint32 BE][type: 4 bytes ASCII]
        const header = await readFileRange(file, offset, offset + 8);
        if (header.length < 8) return false; // truncated header

        const boxSize =
            (((header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3]) >>> 0);

        // ── Rule 1: validate 4CC bytes ────────────────────────
        // Bytes 4–7 are the box type. Reject null bytes (0x00) and
        // ASCII control characters (0x01–0x1F) — these are never present
        // in any registered ISOBMFF or QuickTime 4CC and are the signature
        // of the goldtest.mp4 injection attack (null byte in crafted 4CC).
        //
        // High bytes (0x80–0xFF) are intentionally allowed: QuickTime MOV
        // files from iOS cameras use © (0xA9) as the first byte of metadata
        // atom types (©cmt, ©nam, ©too, ©day, etc.). Rejecting 0xA9 would
        // block all iOS-recorded videos that contain standard metadata.
        for (let i = 4; i < 8; i++) {
            if (header[i] < 0x20) return false;
        }

        const boxType = String.fromCharCode(header[4], header[5], header[6], header[7]);

        let effectiveSize: number;
        let payloadStart: number;

        if (boxSize === 0) {
            // Extends to end of enclosing range — always the last box.
            effectiveSize = rangeEnd - offset;
            payloadStart = offset + 8;
        } else if (boxSize === 1) {
            // Extended 64-bit size — impossible within the 150 MB upload cap.
            return false;
        } else if (boxSize < 8) {
            // Smaller than its own header — corrupt or injected.
            return false;
        } else {
            effectiveSize = boxSize;
            payloadStart = offset + 8;
        }

        const payloadEnd = offset + effectiveSize;

        // ── Rule 2 + 3: recurse into containers ──────────────
        if (ISOBMFF_CONTAINERS.has(boxType) && payloadEnd > payloadStart) {
            // The meta box exists in two incompatible forms:
            //
            //   ISO 14496-12 (MP4):  FullBox — 4 bytes of version+flags
            //                        precede the children. First byte = 0x00
            //                        (version), next 3 = flags (usually 0x00).
            //
            //   QuickTime (MOV):     Plain container — NO version+flags prefix.
            //                        Children start immediately at payloadStart.
            //
            // Probe: if the first byte inside meta is 0x00 (ISO version byte),
            // treat it as a FullBox and skip 4 bytes. Otherwise treat it as a
            // plain QuickTime container and start children at payloadStart.
            let childStart: number;
            if (boxType === "meta") {
                if (payloadStart + 4 <= payloadEnd) {
                    const probe = await readFileRange(file, payloadStart, payloadStart + 1);
                    childStart = (probe.length > 0 && probe[0] === 0x00)
                        ? payloadStart + 4   // ISO FullBox meta
                        : payloadStart;       // QuickTime plain meta
                } else {
                    childStart = payloadStart;
                }
            } else {
                childStart = payloadStart;
            }
            if (childStart < payloadEnd) {
                const ok = await isobmffIsClean(file, childStart, payloadEnd);
                if (!ok) return false;
            }
        }

        offset += effectiveSize;
    }

    // ── Rule 2: chain must end exactly at range boundary ─────
    return offset === rangeEnd;
}


/**
 * OWASP-compliant media file validator.
 *
 * Validation order:
 *   1. File size
 *   2. Filename safety (null bytes, path separators, length, double-extension)
 *   3. Extension allowlist (final extension only, normalised)
 *   4. MIME type allowlist (quick pre-check; spoofable — not the final word)
 *   5. Magic byte / file signature (authoritative — cannot be spoofed by rename)
 *   6. JPEG trailer check (FF D9 EOI within last 16 bytes, ≤2 trailing bytes)
 *   7. MP4/MOV ISOBMFF full-tree integrity check: chain terminates at EOF AND
 *      every box-type 4CC in every container is printable ASCII (no null bytes)
 */
async function validateMediaFile(
    file: File,
    allowedExts: string[],
    allowedMimes: Set<string>,
    maxBytes: number,
): Promise<MediaValidationResult> {


    // ── 1. Size ───────────────────────────────────────────────
    if (file.size > maxBytes) {
        const mb = Math.round(maxBytes / (1024 * 1024));
        return { valid: false, error: `File must be under ${mb} MB.` };
    }
    if (file.size === 0) {
        return { valid: false, error: "File is empty." };
    }

    // ── 2. Filename safety ────────────────────────────────────
    // Android content providers (Google Photos, Google Drive, camera apps)
    // frequently deliver File.name as:
    //   · A full content URI path:  "DCIM/Camera/IMG_001.jpg"
    //   · An extensionless name:    "photo", "image", "document%2F1234"
    // The original filename is NEVER sent to the server (getSafeUploadName
    // replaces it with a UUID), so we sanitize here rather than reject.
    let rawName = (file.name || "").replace(/\0/g, "");

    // Strip path prefix — take only the basename after the last / or \.
    // This neutralises path traversal in the received name without rejecting
    // legitimate photos delivered via Android content URI paths.
    const lastSlash = Math.max(rawName.lastIndexOf("/"), rawName.lastIndexOf("\\"));
    if (lastSlash >= 0) rawName = rawName.slice(lastSlash + 1);

    // URL-decode any percent-encoded segments (e.g. "document%2F1234" → "document/1234")
    // then re-strip the path component after decoding.
    try {
        const decoded = decodeURIComponent(rawName);
        const slashAfterDecode = Math.max(decoded.lastIndexOf("/"), decoded.lastIndexOf("\\"));
        rawName = slashAfterDecode >= 0 ? decoded.slice(slashAfterDecode + 1) : decoded;
    } catch { /* malformed percent-encoding — use rawName as-is */ }

    // Filename length (255 is safe across all major filesystems)
    if (rawName.length > 255) {
        return { valid: false, error: "Filename is too long." };
    }

    // Double-extension attack: any dot-separated segment except the final
    // extension must not appear in the dangerous-extension blocklist.
    // e.g. "malware.php.jpg" → reject because "php" is in the blocklist.
    const segments = rawName.split(".");
    if (segments.length >= 2) {
        const prefixSegments = segments.slice(0, -1);
        for (const seg of prefixSegments) {
            if (DANGEROUS_EXTS.has(seg.toLowerCase())) {
                return { valid: false, error: "File type not allowed." };
            }
        }
    }

    // ── 3. Extension resolution ───────────────────────────────
    // Priority: (a) extension from sanitised filename, (b) extension inferred
    // from MIME type when the filename has no extension. Extensionless names
    // are common when Android content providers deliver files from Google
    // Photos or Google Drive ("photo", "image", "document%2F1234").
    const MIME_TO_EXT: Record<string, string> = {
        "image/jpeg": "jpg", "image/jpg": "jpg",
        "image/jfif": "jpg", "image/pjpeg": "jpg", "image/x-jpeg": "jpg",
        "image/png": "png", "image/x-png": "png",
        "image/webp": "webp",
        "image/heic": "heic", "image/heif": "heic",
        "image/avif": "avif",
    };
    const extAliases: Record<string, string> = { jpeg: "jpg", jfif: "jpg", heif: "heic" };

    let normalizedExt = "";
    if (segments.length >= 2 && segments[segments.length - 1] !== "") {
        const rawExt = segments[segments.length - 1].toLowerCase();
        normalizedExt = extAliases[rawExt] || rawExt;
    } else if (file.type && MIME_TO_EXT[file.type.toLowerCase()]) {
        // Filename has no extension — infer from MIME type.
        normalizedExt = MIME_TO_EXT[file.type.toLowerCase()];
    } else {
        // Last resort: read magic bytes to identify format.
        // Handles Android content providers (Google Drive, OEM gallery apps,
        // some WebViews) that deliver files with empty name AND empty MIME type.
        const inferred = await inferExtFromMagicBytes(file);
        if (inferred) {
            normalizedExt = inferred;
        } else {
            return { valid: false, error: "File must have an extension." };
        }
    }

    if (!allowedExts.includes(normalizedExt)) {
        return {
            valid: false,
            error: `".${normalizedExt}" files are not accepted. Allowed: ${allowedExts.join(", ")}.`,
        };
    }

    // ── 4. MIME type allowlist ────────────────────────────────
    // Only reject when a non-empty, explicitly disallowed MIME is provided.
    // Empty string is allowed because iOS Safari omits MIME for HEIC.
    if (file.type !== "" && !allowedMimes.has(file.type)) {
        return { valid: false, error: "File type not permitted." };
    }

    // ── 5. Magic byte / file signature validation ─────────────
    // Read 16 bytes — sufficient for all supported formats.
    try {
        const bytes = await readMagicBytes(file, 16);
        if (!checkMagicBytes(bytes, normalizedExt)) {
            return {
                valid: false,
                error: "File content does not match its declared type. The file may be corrupted or renamed.",
            };
        }
    } catch {
        return { valid: false, error: "Could not verify file integrity." };
    }

    // ── 6. JPEG trailer check (polyglot / appended payload defense) ──────
    // Valid JPEGs must end with FF D9 (End-of-Image marker). Any significant
    // data after FF D9 indicates an appended payload attack (e.g. EICAR test
    // string, embedded scripts, archives). This check is the safety net for
    // cases where compressPhoto() falls back to the original file — e.g. when
    // the browser cannot decode HEIC natively, or if canvas.toBlob() errors.
    if (normalizedExt === "jpg") {
        try {
            const tail = await readFileTail(file, 16);
            if (!jpegHasValidTrailer(tail)) {
                return {
                    valid: false,
                    error: "File content does not match its declared type. The file may be corrupted or renamed.",
                };
            }
        } catch {
            return { valid: false, error: "Could not verify file integrity." };
        }
    }

    // ── 7. ISOBMFF full-tree integrity check ──────────────────────────────
    // Applies to ISOBMFF-based photo formats: avif, heic.
    // Recursively walks all container boxes and:
    //   · Verifies the top-level chain terminates exactly at EOF
    //   · Verifies every box-type 4CC in every container is printable ASCII
    //     (0x20–0x7E). Null bytes in a 4CC are the signature of crafted
    //     injection boxes (the goldtest.mp4 attack vector).
    if (normalizedExt === "avif" || normalizedExt === "heic") {
        try {
            const clean = await isobmffIsClean(file);
            if (!clean) {
                return {
                    valid: false,
                    error: "File content does not match its declared type. The file may be corrupted or renamed.",
                };
            }
        } catch (err) {
            return { valid: false, error: "Could not verify file integrity." };
        }
    }

    return { valid: true, error: "" };
}

// CATEGORY_BOUNDARY_MAP moved to ./lib/categoryBoundaries.ts (pure data, unit tested).

// ══════════════════════════════════════════════════════════════
//  THEME SYSTEM
// ══════════════════════════════════════════════════════════════

interface ThemeColors {
    brand: string;
    /** Text color on a brand-colored background (theme primary.text). */
    brandText: string;
    brandLight: string;
    brandBorder: string;
    success: string;
    successBg: string;
    successBorder: string;
    error: string;
    errorBg: string;
    errorBorder: string;
    warning: string;
    warningBg: string;
    warningBorder: string;
    text: string;
    textLight: string;
    textMuted: string;
    border: string;
    /** Hairline separators and card outlines (theme divider). */
    divider: string;
    inputBg: string;
    pageBg: string;
    fontFamily: string;
}

function hexToLight(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3) || "1a", 16);
    const g = parseInt(hex.slice(3, 5) || "6d", 16);
    const b = parseInt(hex.slice(5, 7) || "aa", 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function mixColor(c1: string, c2: string, ratio: number): string {
    const p = (h: string, i: number) => parseInt(h.slice(i, i + 2) || "00", 16);
    if (!c1.startsWith("#") || c1.length < 7) return "#999";
    if (!c2.startsWith("#") || c2.length < 7) return "#999";
    const r = Math.round(p(c1, 1) * (1 - ratio) + p(c2, 1) * ratio);
    const g = Math.round(p(c1, 3) * (1 - ratio) + p(c2, 3) * ratio);
    const b = Math.round(p(c1, 5) * (1 - ratio) + p(c2, 5) * ratio);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function resolveTheme(theme: any): ThemeColors {
    const sys = theme?.sys?.color;
    const colors = theme?.colors;
    const body = theme?.body;
    const typography = theme?.sys?.typography || theme?.typography;

    // Reads follow src/runtime/theme.ts (the family's useTokens hook) so the widget
    // takes the same theme values as every other widget. This is a class component,
    // so it cannot call the hook; the paths and fallback order are the same ones.
    const brand = sys?.primary?.main || sys?.primary?.default || colors?.primary || "#1a6daa";
    const danger = sys?.error?.main || sys?.danger?.main || sys?.danger?.default || colors?.danger || "#c0392b";
    const success = sys?.success?.main || sys?.success?.default || colors?.success || "#1e7e34";
    const warning = sys?.warning?.main || sys?.warning?.default || colors?.warning || "#d4a017";
    const dark = sys?.surface?.paperText || sys?.color?.dark || colors?.dark || "#333";
    const surface = sys?.surface?.paper || sys?.color?.surface || colors?.white || "#fff";
    const background = sys?.surface?.background || sys?.color?.background || colors?.light || "#f7f8fa";
    const divider = sys?.divider?.secondary || sys?.divider?.primary || "#e1e5e9";
    const fontFamily =
        typography?.fontFamilyBase || body?.fontFamily ||
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

    return {
        brand,
        brandText: sys?.primary?.text || "#fff",
        brandLight: hexToLight(brand, 0.08),
        brandBorder: hexToLight(brand, 0.3),
        success,
        successBg: hexToLight(success, 0.08),
        successBorder: hexToLight(success, 0.3),
        error: danger,
        errorBg: hexToLight(danger, 0.06),
        errorBorder: hexToLight(danger, 0.3),
        warning,
        warningBg: hexToLight(warning, 0.08),
        warningBorder: hexToLight(warning, 0.3),
        text: dark,
        // AA-compliant muted colors: textLight #595959 (7:1), textMuted #767676 (4.54:1) on white.
        // Kept as literals on purpose: a theme's hint color is not guaranteed to pass contrast.
        textLight: "#595959",
        textMuted: "#767676",
        border: "#ccc",
        divider,
        inputBg: surface,
        pageBg: background,
        fontFamily,
    };
}

// ══════════════════════════════════════════════════════════════
//  DYNAMIC STYLE BUILDER
// ══════════════════════════════════════════════════════════════

function buildStyles(t: ThemeColors) {
    return {
        root: {
            width: "100%", height: "100%", overflow: "auto",
            fontFamily: t.fontFamily, background: t.pageBg, color: t.text,
        } as React.CSSProperties,

        header: {
            background: t.brand, color: t.brandText, padding: "16px 20px",
            fontSize: 20, fontWeight: 700, letterSpacing: 0.3,
            fontFamily: t.fontFamily,
            display: "flex", alignItems: "center", gap: 12,
        } as React.CSSProperties,

        body: { padding: "0 20px 28px" } as React.CSSProperties,

        stepper: {
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "20px 24px 12px", gap: 0,
        } as React.CSSProperties,

        stepDot: (active: boolean, done: boolean): React.CSSProperties => ({
            width: 34, height: 34, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700,
            border: `2px solid ${done ? t.brand : active ? t.brand : t.divider}`,
            background: done ? t.brand : active ? t.inputBg : t.pageBg,
            color: done ? t.brandText : active ? t.brand : t.textMuted,
            transition: "all 0.2s", flexShrink: 0,
            boxShadow: active ? `0 0 0 4px ${hexToLight(t.brand, 0.12)}` : "none",
        }),

        stepLine: (done: boolean): React.CSSProperties => ({
            flex: 1, height: 2, maxWidth: 48,
            background: done ? t.brand : t.divider,
            transition: "background 0.2s",
        }),

        stepLabel: (active: boolean): React.CSSProperties => ({
            fontSize: 11, fontWeight: active ? 700 : 500,
            textAlign: "center", color: active ? t.brand : t.textMuted,
            marginTop: 5, letterSpacing: 0.1,
        }),

        stepCol: {
            display: "flex", flexDirection: "column" as const,
            alignItems: "center", minWidth: 48,
        } as React.CSSProperties,

        sectionTitle: {
            fontSize: 17, fontWeight: 700, color: t.text,
            marginBottom: 18, letterSpacing: -0.2,
        } as React.CSSProperties,

        label: {
            display: "block", fontSize: 11, fontWeight: 700,
            color: t.textMuted, marginBottom: 6,
            textTransform: "uppercase" as const, letterSpacing: 0.6,
        } as React.CSSProperties,

        required: { color: t.error, marginLeft: 2 } as React.CSSProperties,

        input: (hasError: boolean): React.CSSProperties => ({
            width: "100%", padding: "11px 14px", fontSize: 14,
            fontFamily: t.fontFamily,
            border: `1.5px solid ${hasError ? t.error : t.textMuted}`,
            borderRadius: 10, marginBottom: hasError ? 2 : 14,
            boxSizing: "border-box",
            background: t.inputBg, color: t.text,
            transition: "border-color 0.15s, box-shadow 0.15s",
            boxShadow: hasError ? "none" : "0 1px 3px rgba(0,0,0,0.05)",
        }),

        select: (hasError: boolean): React.CSSProperties => ({
            width: "100%", padding: "11px 14px", fontSize: 14,
            fontFamily: t.fontFamily,
            border: `1.5px solid ${hasError ? t.error : t.textMuted}`,
            borderRadius: 10, marginBottom: hasError ? 2 : 14,
            background: t.inputBg, color: t.text,
            boxSizing: "border-box",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }),

        textarea: (hasError: boolean): React.CSSProperties => ({
            width: "100%", padding: "11px 14px", fontSize: 14,
            fontFamily: t.fontFamily,
            border: `1.5px solid ${hasError ? t.error : t.textMuted}`,
            borderRadius: 10, marginBottom: hasError ? 2 : 14,
            minHeight: 90, resize: "vertical" as const,
            boxSizing: "border-box", color: t.text,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }),

        fieldError: {
            fontSize: 12, color: t.error, marginBottom: 10, marginTop: 0,
        } as React.CSSProperties,

        hint: {
            fontSize: 11, color: t.textMuted, marginTop: -8, marginBottom: 12,
        } as React.CSSProperties,

        locBtnRow: { display: "flex", gap: 10, marginBottom: 12 } as React.CSSProperties,

        locBtn: (active: boolean): React.CSSProperties => ({
            flex: 1, display: "flex", alignItems: "center",
            justifyContent: "center", gap: 8,
            padding: "13px 10px", fontSize: 13, fontWeight: 600,
            fontFamily: t.fontFamily,
            border: active ? `2px solid ${t.brand}` : "2px solid transparent",
            borderRadius: 12, cursor: "pointer",
            background: active ? t.brandLight : t.inputBg,
            color: active ? t.brand : t.text,
            transition: "all 0.15s",
            boxShadow: active ? `0 0 0 1px ${t.brandBorder}` : "0 2px 8px rgba(0,0,0,0.08)",
        }),

        coordBox: {
            fontSize: 12, color: t.success, fontWeight: 600,
            marginBottom: 12, padding: "10px 14px",
            background: t.successBg, borderRadius: 10,
            border: `1.5px solid ${t.successBorder}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        } as React.CSSProperties,

        selectedAddr: {
            fontSize: 13, color: t.brand, fontWeight: 600,
            marginBottom: 12, padding: "10px 14px",
            background: t.brandLight, borderRadius: 10,
            border: `1.5px solid ${t.brandBorder}`,
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        } as React.CSSProperties,

        searchRow: {
            display: "flex", gap: 0, marginBottom: 8,
            background: t.inputBg,
            border: `1.5px solid ${t.textMuted}`,
            borderRadius: 999,
            overflow: "hidden",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            alignItems: "center",
        } as React.CSSProperties,

        searchInput: {
            flex: 1, padding: "12px 4px 12px 0", fontSize: 14,
            fontFamily: t.fontFamily,
            border: "none", borderRadius: 0,
            boxSizing: "border-box" as const,
            color: t.text, background: "transparent",
        } as React.CSSProperties,

        searchBtn: {
            padding: "8px 16px 8px 10px", fontSize: 13, fontWeight: 700,
            fontFamily: t.fontFamily,
            background: t.brand, color: t.brandText,
            border: "none", borderRadius: 999,
            cursor: "pointer", whiteSpace: "nowrap" as const,
            margin: "4px 4px 4px 0",
            flexShrink: 0,
        } as React.CSSProperties,

        resultsList: {
            listStyle: "none", margin: "0 0 14px 0", padding: 0,
            border: `1.5px solid ${t.textMuted}`, borderRadius: 14,
            maxHeight: 196, overflowY: "auto" as const,
            background: t.inputBg,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            overflow: "hidden",
        } as React.CSSProperties,

        resultItem: {
            padding: "13px 18px", fontSize: 14, fontWeight: 500,
            color: t.text, cursor: "pointer",
            borderBottom: `1px solid ${t.divider}`, background: t.inputBg,
            display: "flex", alignItems: "center", gap: 10,
        } as React.CSSProperties,

        resultItemHoverBg: t.brandLight,

        navRow: { display: "flex", gap: 10, marginTop: 24 } as React.CSSProperties,

        btnPrimary: (disabled: boolean): React.CSSProperties => ({
            flex: 1, padding: "14px 20px", fontSize: 15, fontWeight: 700,
            fontFamily: t.fontFamily,
            background: disabled ? mixColor(t.brand, "#ffffff", 0.4) : t.brand,
            color: t.brandText, border: "none", borderRadius: 12,
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "background 0.15s, box-shadow 0.15s",
            boxShadow: disabled ? "none" : "0 4px 14px rgba(0,0,0,0.18)",
            letterSpacing: 0.2,
        }),

        btnSecondary: {
            flex: 1, padding: "14px 20px", fontSize: 15, fontWeight: 600,
            fontFamily: t.fontFamily,
            background: t.inputBg, color: t.text,
            border: `1.5px solid ${t.textMuted}`, borderRadius: 12,
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
        } as React.CSSProperties,

        successBox: {
            padding: 28, background: t.successBg,
            border: `1px solid ${t.successBorder}`,
            borderRadius: 8, textAlign: "center" as const, marginTop: 8,
        } as React.CSSProperties,

        errorBox: {
            padding: 14, background: t.errorBg,
            border: `1.5px solid ${t.errorBorder}`,
            borderRadius: 10, color: t.error, fontSize: 13,
            marginBottom: 16, lineHeight: 1.5,
            boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        } as React.CSSProperties,

        warningBox: {
            padding: 12, background: t.warningBg,
            border: `1px solid ${t.warningBorder}`,
            borderRadius: 6, color: t.warning, fontSize: 12,
            lineHeight: 1.5, marginTop: 4, marginBottom: 8,
        } as React.CSSProperties,

        reviewCard: {
            background: t.inputBg, border: `1.5px solid ${t.textMuted}`,
            borderRadius: 12, padding: "16px 18px", marginBottom: 12,
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        } as React.CSSProperties,

        reviewLabel: {
            fontSize: 11, fontWeight: 700, color: t.textMuted,
            textTransform: "uppercase" as const,
            letterSpacing: 0.5, marginBottom: 4,
        } as React.CSSProperties,

        reviewValue: {
            fontSize: 14, color: t.text, lineHeight: 1.4,
        } as React.CSSProperties,

        reviewEdit: {
            fontSize: 12, color: t.brand, cursor: "pointer",
            fontWeight: 600, background: "none", border: "none",
            padding: 0, marginTop: 4,
        } as React.CSSProperties,

        skeleton: {
            height: 16, borderRadius: 4, background: t.divider,
            marginBottom: 12,
            animation: "pulse 1.5s ease-in-out infinite",
        } as React.CSSProperties,

        gfChecking: {
            fontSize: 12, color: t.brand, fontWeight: 600,
            marginBottom: 12, padding: "10px 14px",
            background: t.brandLight, borderRadius: 10,
            border: `1.5px solid ${t.brandBorder}`,
        } as React.CSSProperties,

        gfOutside: {
            fontSize: 13, color: t.error, fontWeight: 600,
            marginBottom: 12, padding: "12px 16px",
            background: t.errorBg, borderRadius: 10,
            border: `1.5px solid ${t.errorBorder}`,
            lineHeight: 1.5,
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        } as React.CSSProperties,

        gfResetBtn: {
            marginTop: 10, padding: "10px 16px", fontSize: 13,
            fontWeight: 600, fontFamily: t.fontFamily,
            background: t.inputBg, color: t.error,
            border: `1.5px solid ${t.errorBorder}`,
            borderRadius: 8, cursor: "pointer", width: "100%",
        } as React.CSSProperties,

        redirectMsg: {
            fontSize: 12, color: t.warning, fontWeight: 500,
            padding: "8px 12px", marginTop: 6, marginBottom: 12,
            background: t.warningBg, borderRadius: 6,
            border: `1px solid ${t.warningBorder}`,
            lineHeight: 1.5,
        } as React.CSSProperties,

        disabledOption: {
            color: t.textMuted, fontStyle: "italic" as const,
        } as React.CSSProperties,

        disabledSection: {
            opacity: 0.35,
            pointerEvents: "none" as const,
            userSelect: "none" as const,
            filter: "grayscale(40%)",
        } as React.CSSProperties,

        phoneLink: {
            color: t.brand, fontWeight: 700,
            textDecoration: "underline",
            whiteSpace: "nowrap" as const,
        } as React.CSSProperties,

        // ── Media slots (Details step) ────────────────────────
        mediaGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            marginBottom: 8,
        } as React.CSSProperties,

        photoSlot: (filled: boolean, hasError: boolean, dragOver?: boolean): React.CSSProperties => ({
            position: "relative",
            aspectRatio: "1",
            borderRadius: 10,
            border: `2px dashed ${hasError ? t.error : (dragOver || filled) ? t.brand : t.border}`,
            background: dragOver ? t.brandLight : filled ? "#000" : t.pageBg,
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", cursor: filled ? "default" : "pointer",
            transition: "border-color 0.15s, background 0.15s",
            boxShadow: dragOver ? `0 0 0 3px ${t.brandBorder}` : "none",
        }),

        photoSlotImg: {
            width: "100%", height: "100%", objectFit: "cover" as const,
            display: "block",
        } as React.CSSProperties,

        photoSlotRemove: {
            position: "absolute" as const,
            top: 4, right: 4,
            width: 22, height: 22,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.65)",
            color: "#fff",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, lineHeight: 1,
            padding: 0,
        } as React.CSSProperties,

        photoSlotCamera: {
            position: "absolute" as const,
            bottom: 4, right: 4,
            width: 26, height: 26,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
        } as React.CSSProperties,

        photoSlotAdd: {
            display: "flex", flexDirection: "column" as const,
            alignItems: "center", justifyContent: "center",
            gap: 4, color: t.textMuted, fontSize: 11,
            fontWeight: 600, textAlign: "center" as const,
            width: "100%", height: "100%",
            background: "none", border: "none", cursor: "pointer",
            padding: 4, fontFamily: t.fontFamily,
        } as React.CSSProperties,


        // ── Submit progress bar ──────────────────────────────
        progressBarTrack: {
            width: "100%", height: 10, borderRadius: 999,
            background: hexToLight(t.brand, 0.15),
            overflow: "hidden",
            border: `1px solid ${t.brandBorder}`,
        } as React.CSSProperties,

        progressBarFill: (pct: number): React.CSSProperties => ({
            height: "100%",
            width: `${pct}%`,
            background: t.brand,
            borderRadius: 999,
            transition: "width 0.35s ease",
        }),

        progressLabel: {
            fontSize: 12, fontWeight: 600, color: t.textMuted,
            marginTop: 6, textAlign: "center" as const,
        } as React.CSSProperties,
        copyRow: {
            display: "flex", alignItems: "stretch", gap: 0,
            background: t.pageBg, border: `1px solid ${t.border}`,
            borderRadius: 6, overflow: "hidden", marginBottom: 24,
        } as React.CSSProperties,

        copyUrl: {
            flex: 1, padding: "9px 12px", fontSize: 11,
            fontFamily: "monospace", color: t.textLight,
            background: "transparent", border: "none",
            whiteSpace: "nowrap" as const,
            overflow: "hidden", textOverflow: "ellipsis",
            cursor: "default",
        } as React.CSSProperties,

        copyBtn: (copied: boolean): React.CSSProperties => ({
            flexShrink: 0, padding: "9px 14px",
            fontSize: 12, fontWeight: 700, fontFamily: t.fontFamily,
            background: copied ? t.success : t.brand,
            color: t.brandText, border: "none", cursor: "pointer",
            transition: "background 0.2s",
            whiteSpace: "nowrap" as const,
        }),

        // ── Comment card (status view) ───────────────────────
        commentCard: {
            background: t.brandLight,
            border: `1px solid ${t.brandBorder}`,
            borderRadius: 8, padding: "12px 16px", marginBottom: 10,
        } as React.CSSProperties,

        commentDate: {
            fontSize: 11, fontWeight: 700, color: t.brand,
            textTransform: "uppercase" as const,
            letterSpacing: 0.5, marginBottom: 6,
        } as React.CSSProperties,

        commentText: {
            fontSize: 14, color: t.text, lineHeight: 1.5,
        } as React.CSSProperties,
    };
}

// ══════════════════════════════════════════════════════════════
//  PHONE NUMBER LINKIFIER (WCAG / ADA)
// ══════════════════════════════════════════════════════════════

const PHONE_LINK_RE = /(\+?1?\s*[-.]?\s*\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/g;

function linkifyPhones(text: string, style: React.CSSProperties): React.ReactNode[] {
    if (!text) return [text];
    const parts = text.split(PHONE_LINK_RE);
    return parts.map((part, i) => {
        if (PHONE_LINK_RE.test(part)) {
            PHONE_LINK_RE.lastIndex = 0;
            const digits = part.replace(/[^\d+]/g, "");
            const tel = digits.startsWith("+") ? digits
                : digits.length === 10 ? `+1${digits}`
                    : digits.length === 11 && digits.startsWith("1") ? `+${digits}`
                        : digits;
            const prev = parts[i - 1] || "";
            const needsSpace = prev.length > 0 && !/\s$/.test(prev);
            return (
                <React.Fragment key={i}>
                    {needsSpace && " "}
                    <a href={`tel:${tel}`} style={style}
                        aria-label={__t("uiCall", { trim: part.trim() })} role="link">
                        {part.trim()}
                    </a>
                </React.Fragment>
            );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
    });
}

// ══════════════════════════════════════════════════════════════
//  DEEP-LINK URL CAPTURE
//
//  EB rewrites window.location during its own routing init, which
//  can happen before React componentDidMount fires. Capturing the
//  ticket number at module evaluation time (before React mounts)
//  ensures it is never lost. sessionStorage provides a backup in
//  case EB triggers a full page re-navigation.
// ══════════════════════════════════════════════════════════════

const DEEP_LINK_SESSION_KEY = "rac_pending_ticket";

function captureDeepLinkTicket(): number | null {
    try {
        // 1. Current URL query string.
        const p = new URLSearchParams(window.location.search);
        let raw = p.get("ticket_number") ?? p.get("ticket") ?? null;
        // 2. EB sometimes migrates params into the hash fragment.
        if (!raw) {
            const hp = new URLSearchParams(window.location.hash.replace(/^#\??/, ""));
            raw = hp.get("ticket_number") ?? hp.get("ticket") ?? null;
        }
        if (raw && !isNaN(Number(raw))) {
            try { sessionStorage.setItem(DEEP_LINK_SESSION_KEY, String(Number(raw))); } catch { }
            return Number(raw);
        }
        // 3. sessionStorage fallback if URL was already rewritten.
        const s = sessionStorage.getItem(DEEP_LINK_SESSION_KEY);
        if (s && !isNaN(Number(s))) return Number(s);
    } catch { }
    return null;
}

function consumeDeepLinkTicket(): number | null {
    const n = captureDeepLinkTicket();
    try { sessionStorage.removeItem(DEEP_LINK_SESSION_KEY); } catch { }
    return n;
}

// Evaluate at module load time — before EB routing rewrites the URL.
const INITIAL_DEEP_LINK_TICKET: number | null = captureDeepLinkTicket();

// ══════════════════════════════════════════════════════════════
//  WIZARD STATE PERSISTENCE (rotation / full-remount survival)
//
//  On iOS in an EB iframe, rotating the device causes EB to fully
//  unmount and remount the widget (componentWillUnmount → didMount).
//  We persist serialisable wizard state to sessionStorage so the
//  user's progress survives the remount.
//
//  File attachments (photos) cannot be serialised and are
//  intentionally not persisted — they will be lost on rotation.
//  Everything else (step, form data, address, geofence) is saved.
// ══════════════════════════════════════════════════════════════

const WIZARD_SESSION_KEY = "rac_wizard_state_v1";

interface PersistedWizardState {
    step: number;
    form: {
        submitted_by_name: string;
        submitted_by_email: string;
        submitted_by_phone: string;
        category: number | null;
        subcategory: string;
        description: string;
    };
    selectedAddress: string;
    addressQuery: string;
    mapPoint: { x: number; y: number; spatialReference: { wkid: number } } | null;
    geofence: { insideBoundary: boolean; matchedBoundaries: string[]; matchedBoundaryIds: string[]; checking: boolean };
    categoryGeofence: { checking: boolean; valid: boolean | null };
}

function saveWizardState(state: PersistedWizardState): void {
    try {
        sessionStorage.setItem(WIZARD_SESSION_KEY, JSON.stringify(state));
    } catch { }
}

function loadWizardState(): PersistedWizardState | null {
    try {
        const raw = sessionStorage.getItem(WIZARD_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedWizardState;
        // Basic validation — must have a valid step number
        if (typeof parsed?.step !== "number") return null;
        return parsed;
    } catch { }
    return null;
}

function clearWizardState(): void {
    try { sessionStorage.removeItem(WIZARD_SESSION_KEY); } catch { }
}



export default class ReportAConcernSubmit extends React.PureComponent<
    AllWidgetProps<IMConfig>,
    WidgetState
> {
    // exb-i18n-kit translator: the app locale via the widget's intl, English from default.ts
    // as the fallback (with {placeholders} filled) when intl is not there.
    nls = (id: string, values?: { [key: string]: any }): string => {
        const intl = (this.props as any).intl;
        const msg: string = (defaultMessages as any)[id] ?? id;
        if (intl && typeof intl.formatMessage === "function") return intl.formatMessage({ id, defaultMessage: msg }, values);
        return msg.replace(/\{(\w+)\}/g, (m: string, k: string) => (values && values[k] != null ? String(values[k]) : m));
    };

    private beacon: BeaconHandle | null = null;
    private graphicRef: __esri.Graphic | null = null;
    private boundaryGraphicRefs: __esri.Graphic[] = [];
    private statusHighlight: __esri.Handle | null = null;
    private suggestTimer: ReturnType<typeof setTimeout> | null = null;
    private copyResetTimer: ReturnType<typeof setTimeout> | null = null;
    private rootRef = React.createRef<HTMLDivElement>();

    state: WidgetState = {
        jmv: null,
        ticketsLayer: null,
        boundariesUrl: "",
        subtypes: [],
        loading: false,
        metadataLoaded: false,
        initError: "",

        lookupUrl: "",
        lookupData: [],
        lookupLoaded: false,
        lookupLoading: false,
        lookupError: "",

        commentsTableUrl: "",

        step: 0,
        mapPoint: null,
        placingPin: false,
        clickHandler: null,
        gpsLocating: false,
        addressQuery: "",
        addressSearching: false,
        addressResults: [],
        addressError: "",
        selectedAddress: "",
        geofence: { ...EMPTY_GEOFENCE },
        categoryGeofence: { ...EMPTY_CAT_GEOFENCE },

        form: { ...EMPTY_FORM },
        fieldErrors: {},
        photoFiles: [],
        photoPreviews: [],
        photoErrors: [],
        submitting: false,
        submitResult: "idle",
        submitMessage: "",
        submitPhase: "",
        submitProgress: 0,
        ticketNumber: null,
        urlCopied: false,

        dragOverPhotoSlot: null,

        pendingStatusTicketNumber: null,
        statusViewLoading: false,
        statusViewTicket: null,
        statusViewError: "",
        statusViewComments: [],
        statusViewCommentsLoading: false,
        statusViewPhotos: [],
        statusViewPhotosLoading: false,

        liveMessage: "",
    };

    private getTheme = (): ThemeColors => resolveTheme(this.props.theme);
    private getStyles = () => buildStyles(this.getTheme());

    private getGeocoderUrl = (): string =>
        this.props.config?.geocoderUrl?.trim() || DEFAULT_GEOCODER;

    private getEnterpriseGeoServiceUrl = (): string => {
        const base = this.props.config?.boundariesLayerUrl?.trim() ||
            this.props.config?.writeEndpointUrl?.trim() || "";
        if (base) {
            const match = base.match(/^(https?:\/\/[^/]+\/arcgis)/i);
            if (match) return `${match[1]}/rest/services/Utilities/Geometry/GeometryServer`;
        }
        return "";
    };

    // ── Derive the comments table URL ────────────────────────
    // Priority order:
    //   1. config.commentsTableUrl  — explicit direct URL (most reliable)
    //   2. allTables name-token discovery from the web map
    //   3. Fallback: ticketsLayer base URL + config.commentsTableIndex (default 6)
    private getCommentsTableUrl = (): string => this.state.commentsTableUrl;

    // ── Lifecycle ───────────────────────────────────────────

    componentDidMount(): void {
        this.beacon = beacon.init(this.props);

        // ── Restore wizard state after rotation-triggered remount ──
        const saved = loadWizardState();
        if (saved && saved.step > 0) {
            // Only restore mid-wizard state (step > 0). Step 0 with no data
            // is not worth restoring — let the form start fresh.
            const restoredPoint = saved.mapPoint
                ? (() => {
                    try {
                        const Point = (window as any).require?.("esri/geometry/Point");
                        if (Point) return new Point(saved.mapPoint);
                    } catch { }
                    return null;
                })()
                : null;
            this.setState({
                step: saved.step as any,
                form: saved.form,
                selectedAddress: saved.selectedAddress,
                addressQuery: saved.addressQuery,
                // mapPoint restored below once map is ready — store raw coords for now
                geofence: saved.geofence,
                categoryGeofence: saved.categoryGeofence,
            });
            // Restore the mapPoint via a short delay to let the map init first
            if (saved.mapPoint) {
                setTimeout(() => {
                    try {
                        const Point = (window as any).require?.("esri/geometry/Point");
                        if (Point) {
                            this.setState({ mapPoint: new Point(saved.mapPoint) });
                        }
                    } catch { }
                }, 500);
            }
        }

        const tn = INITIAL_DEEP_LINK_TICKET ?? consumeDeepLinkTicket();
        const statusQueryUrl = (this.props.config as any)?.statusQueryUrl?.trim() || "";
        if (tn != null) {
            if (statusQueryUrl) {
                this.loadTicketStatus(tn);
            } else {
                this.setState({ pendingStatusTicketNumber: tn });
            }
        }
    }

    componentWillUnmount(): void {
        this.state.clickHandler?.remove();
        if (this.statusHighlight) {
            try { this.statusHighlight.remove(); } catch { }
            this.statusHighlight = null;
        }
        if (this.suggestTimer) clearTimeout(this.suggestTimer);
        if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
        if (this.graphicRef && this.state.jmv?.view) {
            try {
                (this.state.jmv.view as __esri.MapView).graphics.remove(this.graphicRef);
            } catch { }
        }
        this.graphicRef = null;
        this.clearBoundaryOverlay();
    }

    /**
     * Safety net for the deep-link flow.
     *
     * Fires whenever metadataLoaded flips true (i.e. onViewReady full-init
     * just finished) while pendingStatusTicketNumber is still set. This covers
     * the race where componentDidMount runs before onViewReady fires, and
     * onViewReady took a re-init path that didn't call the setState callback
     * (e.g. a genuine map change after the initial load).
     */
    componentDidUpdate(
        _prevProps: AllWidgetProps<IMConfig>,
        prevState: WidgetState,
    ): void {
        // ── Save wizard state to sessionStorage on every relevant change ──
        // This allows restoration after a rotation-triggered full remount.
        const s = this.state;
        const p = prevState;
        const wizardChanged =
            s.step !== p.step ||
            s.form !== p.form ||
            s.selectedAddress !== p.selectedAddress ||
            s.addressQuery !== p.addressQuery ||
            s.mapPoint !== p.mapPoint ||
            s.geofence !== p.geofence ||
            s.categoryGeofence !== p.categoryGeofence;

        if (wizardChanged && s.submitResult !== "success") {
            const mp = s.mapPoint as any;
            saveWizardState({
                step: s.step,
                form: s.form,
                selectedAddress: s.selectedAddress,
                addressQuery: s.addressQuery,
                mapPoint: mp
                    ? { x: mp.x, y: mp.y, spatialReference: { wkid: mp.spatialReference?.wkid ?? 32612 } }
                    : null,
                geofence: s.geofence,
                categoryGeofence: s.categoryGeofence,
            });
        }

        // ── Deep-link safety net ──
        if (!prevState.metadataLoaded && s.metadataLoaded) {
            const { pendingStatusTicketNumber } = s;
            if (pendingStatusTicketNumber != null) {
                this.setState({ pendingStatusTicketNumber: null });
                this.loadTicketStatus(pendingStatusTicketNumber);
            }
        }
    }



    // ══════════════════════════════════════════════════════════
    //  REVERSE GEOCODE
    // ══════════════════════════════════════════════════════════

    reverseGeocode = async (pt: __esri.Point) => {
        try {
            let locationParam: string;

            if (pt.longitude != null && pt.latitude != null) {
                locationParam = `${pt.longitude},${pt.latitude}`;
            } else if (pt.spatialReference?.wkid === 3857 || pt.spatialReference?.wkid === 102100) {
                const wm = (window as any).require?.("esri/geometry/support/webMercatorUtils");
                if (wm) {
                    const gp = wm.webMercatorToGeographic(pt) as __esri.Point;
                    locationParam = `${gp.x},${gp.y}`;
                } else {
                    locationParam = JSON.stringify({
                        x: pt.x, y: pt.y,
                        spatialReference: { wkid: pt.spatialReference.wkid },
                    });
                }
            } else {
                locationParam = JSON.stringify({
                    x: pt.x, y: pt.y,
                    spatialReference: { wkid: pt.spatialReference?.wkid || 32612 },
                });
            }

            const token = getTokenFromIdentityManager();
            const params = new URLSearchParams({ f: "json", location: locationParam });
            if (token) params.set("token", token);

            const resp = await fetch(`${this.getGeocoderUrl()}/reverseGeocode?${params}`);
            const json = await resp.json();
            const addr = json?.address?.Match_addr || json?.address?.LongLabel || json?.address?.ShortLabel || "";
            if (addr) this.setState({ selectedAddress: addr, addressQuery: addr });
        } catch { }
    };

    // ══════════════════════════════════════════════════════════
    //  MAP CONNECTION & INITIALIZATION
    // ══════════════════════════════════════════════════════════

    onViewReady = async (jmv: JimuMapView) => {
        if (!jmv?.view) return;

        const incomingItemId: string =
            (jmv.view as any)?.map?.portalItem?.id ||
            (jmv.view as any)?.map?.id || "";


        // ── Orientation-change guard ──────────────────────────────
        if (this.state.metadataLoaded) {
            const loadedItemId: string =
                (this.state.jmv?.view as any)?.map?.portalItem?.id ||
                (this.state.jmv?.view as any)?.map?.id || "";

            const mapsConfirmedDifferent =
                !!incomingItemId && !!loadedItemId && incomingItemId !== loadedItemId;


            if (!mapsConfirmedDifferent) {
                // Same map (IDs match) or IDs unavailable — swap jmv ref only.
                // All wizard state, form data, and step position are preserved.
                // Also consume any pending deep-link ticket that may have been
                // set in componentDidMount before this onViewReady fired.
                this.setState({ jmv }, () => {
                    const { pendingStatusTicketNumber } = this.state;
                    if (pendingStatusTicketNumber != null) {
                        this.setState({ pendingStatusTicketNumber: null });
                        this.loadTicketStatus(pendingStatusTicketNumber);
                    }
                });
                return;
            }
            // Both IDs available and different → genuine map change, fall through
            // to full re-init below.
        }

        this.setState({ jmv, loading: true, initError: "" });

        try {
            const view = jmv.view as __esri.MapView;
            const map = view.map as __esri.WebMap;
            await map.when();
            await map.loadAll();

            const idx = this.props.config?.ticketsLayerIndex ?? 0;
            let ticketsLayer: __esri.FeatureLayer | null = null;

            for (const lyr of map.allLayers.toArray()) {
                if (lyr.type === "sublayer") {
                    const sub = lyr as __esri.Sublayer;
                    if (sub.id === idx) { ticketsLayer = await sub.createFeatureLayer(); break; }
                }
                if (lyr.type === "feature") {
                    const fl = lyr as __esri.FeatureLayer;
                    if (fl.layerId === idx) { ticketsLayer = fl; break; }
                }
            }

            if (!ticketsLayer) {
                const fls = map.allLayers.filter((l) => l.type === "feature").toArray() as __esri.FeatureLayer[];
                if (fls[idx]) ticketsLayer = fls[idx];
            }

            if (!ticketsLayer) {
                this.setState({ loading: false, initError: `Could not find Tickets layer at index ${idx}.` });
                return;
            }

            await ticketsLayer.load();
            const subtypes = this.parseSubtypes(ticketsLayer);

            // ── Resolve comments table URL ────────────────────────
            // Priority: explicit config URL → allTables name-token match → index fallback.
            let commentsTableUrl = "";

            // 1. Explicit override in widget config — most reliable, bypasses discovery.
            const cfgCommentsUrl = this.props.config?.commentsTableUrl?.trim() || "";
            if (cfgCommentsUrl) {
                commentsTableUrl = cfgCommentsUrl;
            }

            // 2. Auto-discover from allTables in the web map by name token.
            if (!commentsTableUrl) {
                try {
                    const allTables = (map as any).allTables?.toArray() || [];
                    await Promise.all(allTables.map((t: any) => t.load().catch(() => { })));
                    const cTokens = (__tc(this.props.config?.commentsTableName, "ticketComments"))
                        .toLowerCase().replace(/_/g, " ").split(/\s+/);
                    const commentsTable = allTables.find((t: any) =>
                        matchAllTokens(t.title || "", cTokens) || matchAllTokens(t.name || "", cTokens)
                    );
                    if (commentsTable?.url) {
                        commentsTableUrl = commentsTable.url;
                    }
                } catch { }
            }

            // 3. Fallback: construct from tickets layer URL + configured index.
            if (!commentsTableUrl && ticketsLayer.url) {
                const commentsIdx = this.props.config?.commentsTableIndex ?? 6;
                const base = ticketsLayer.url.replace(/\/\d+\s*$/, "").replace(/\/$/, "");
                commentsTableUrl = `${base}/${commentsIdx}`;
            }

            const cfgUrl = this.props.config?.boundariesLayerUrl?.trim() || "";
            let validatedBoundariesUrl = "";

            if (cfgUrl) {
                try {
                    const token = getTokenFromIdentityManager();
                    const p = new URLSearchParams({ f: "json" });
                    if (token) p.set("token", token);
                    const r = await fetch(`${cfgUrl}?${p}`);
                    const j = await r.json();
                    if (!j.error && j.geometryType) validatedBoundariesUrl = cfgUrl;
                } catch { }
            }

            let validatedLookupUrl = "";
            const enableFiltering = this.props.config?.enableCategoryFiltering ?? true;

            if (enableFiltering) {
                const lookupCfgUrl = this.props.config?.lookupTableUrl?.trim() || "";
                if (lookupCfgUrl) validatedLookupUrl = await this.validateTableUrl(lookupCfgUrl);

                if (!validatedLookupUrl && validatedBoundariesUrl) {
                    const lookupIdx = this.props.config?.lookupTableIndex ?? 2;
                    const derived = validatedBoundariesUrl.replace(/\/\d+\s*$/, `/${lookupIdx}`);
                    validatedLookupUrl = await this.validateTableUrl(derived);
                }
            }

            this.setState(
                {
                    ticketsLayer,
                    subtypes,
                    loading: false,
                    metadataLoaded: true,
                    boundariesUrl: validatedBoundariesUrl,
                    lookupUrl: validatedLookupUrl,
                    commentsTableUrl,
                },
                () => {
                    const { pendingStatusTicketNumber } = this.state;
                    if (pendingStatusTicketNumber != null) {
                        this.setState({ pendingStatusTicketNumber: null });
                        this.loadTicketStatus(pendingStatusTicketNumber);
                    }
                }
            );
        } catch (err) {
            this.setState({ loading: false, initError: `Init error: ${(err as any)?.message || err}` });
        }
    };

    validateTableUrl = async (url: string): Promise<string> => {
        try {
            const token = getTokenFromIdentityManager();
            const p = new URLSearchParams({ f: "json" });
            if (token) p.set("token", token);
            const r = await fetch(`${url}?${p}`);
            const j = await r.json();
            if (j.error) return "";
            if (j.fields || j.geometryType) return url;
            return "";
        } catch { return ""; }
    };

    parseSubtypes(layer: __esri.FeatureLayer): SubtypeInfo[] {
        const result: SubtypeInfo[] = [];
        const src = (layer as any).sourceJSON;

        if (src?.subtypes?.length) {
            for (const st of src.subtypes) {
                const domains: Record<string, CodedValueDomain> = {};
                if (st.domains) {
                    for (const [fn, dd] of Object.entries(st.domains)) {
                        const d = dd as any;
                        if (d?.type === "codedValue" && d.codedValues) {
                            domains[fn] = {
                                type: "codedValue", name: d.name,
                                codedValues: d.codedValues.map((cv: any) => ({ name: cv.name, code: cv.code })),
                            };
                        }
                    }
                }
                result.push({ code: st.code, name: st.name, domains });
            }
            return result;
        }

        const catField = layer.fields?.find((f) => f.name.toLowerCase() === "category");
        if (catField?.domain?.type === "coded-value") {
            const cvd = catField.domain as __esri.CodedValueDomain;
            for (const cv of cvd.codedValues) result.push({ code: cv.code as number, name: cv.name, domains: {} });
        }
        return result;
    }

    // ══════════════════════════════════════════════════════════
    //  STATUS VIEW — TICKET LOOKUP
    // ══════════════════════════════════════════════════════════

    loadTicketStatus = async (ticketNumber: number) => {
        this.beacon?.action('status-lookup');
        const { ticketsLayer } = this.state;

        // ── Resolve the query URL ─────────────────────────────────
        const cfgStatusUrl = (this.props.config as any)?.statusQueryUrl?.trim() || "";
        const layerUrl = cfgStatusUrl ||
            (ticketsLayer?.url
                ? `${ticketsLayer.url}/${ticketsLayer.layerId ?? this.props.config?.ticketsLayerIndex ?? 0}`
                : "");


        if (!layerUrl) {
            this.setState({
                statusViewLoading: false,
                statusViewError: `Could not load status for ticket #${ticketNumber}. No query URL configured.`,
            });
            return;
        }

        this.setState({ statusViewLoading: true, statusViewError: "", statusViewTicket: null, statusViewComments: [], statusViewPhotos: [], statusViewPhotosLoading: false });

        try {
            const token = getTokenFromIdentityManager();
            const body = new URLSearchParams({
                f: "json",
                where: `ticket_number = ${ticketNumber}`,
                outFields: "*",
                returnGeometry: "true",
                outSR: String(this.getMapSRWkid()),
            });
            if (token) body.set("token", token);

            const resp = await fetch(`${layerUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
            });
            const json = await resp.json();

            if (json.error) {
                this.setState({ statusViewLoading: false, statusViewError: `Could not retrieve ticket #${ticketNumber}.` });
                return;
            }

            if (!json.features?.length) {
                this.setState({ statusViewLoading: false, statusViewError: `Ticket #${ticketNumber} was not found.` });
                return;
            }

            const feature = json.features[0];
            const a = feature.attributes || {};

            // ticket_id links tickets to comments. The public display layer may
            // expose it under a different name (globalid, ticket_guid, etc.) or
            // via alias, so: try known names, then scan every attribute for a
            // GUID-shaped value and use that. GUID form: {8-4-4-4-12} hex,
            // braces optional.
            const GUID_RE = /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/;
            // Collect EVERY GUID-shaped value on the ticket record. One of them
            // is the ticket_id that joins to comments; others (e.g. GlobalID)
            // are harmless. We query comments against all of them.
            const guidCandidates: Array<{ field: string; value: string }> = [];
            const namedFirst =
                a.ticket_id ?? a.TICKET_ID ?? a.ticketid ?? a.TicketID
                ?? a.ticket_guid ?? a.TICKET_GUID ?? a.ticketGuid ?? "";
            for (const k of Object.keys(a)) {
                const v = a[k];
                if (typeof v === "string" && GUID_RE.test(v.trim())) {
                    guidCandidates.push({ field: k, value: v.trim().replace(/[{}]/g, "").toUpperCase() });
                }
            }
            // Dedupe by value.
            const seenGuid = new Set<string>();
            const guidValues = guidCandidates.filter(g => !seenGuid.has(g.value) && seenGuid.add(g.value)).map(g => g.value);
            const resolvedId: string = (namedFirst || guidValues[0] || "").replace(/[{}]/g, "").toUpperCase();

            const ticket: StatusTicket = {
                ticket_number: a.ticket_number ?? a.TICKET_NUMBER ?? ticketNumber,
                ticket_id: resolvedId,
                category: a.category ?? a.Category ?? null,
                subcategory: a.subcategory ?? a.Subcategory ?? "",
                status: a.status ?? a.Status ?? null,
                priority: a.priority ?? a.Priority ?? null,
                description: a.description ?? a.Description ?? "",
                created_date: a.created_date ?? a.Created_Date ?? null,
                address_submitted: a.address_submitted ?? a.Address_Submitted ?? "",
                objectid: a.OBJECTID ?? a.objectid ?? a.ObjectId ?? null,
            };

            const rawGeometry = feature.geometry || null;

            this.setState({ statusViewLoading: false, statusViewTicket: ticket }, () => {
                if (rawGeometry) this.zoomToTicketGeometry(rawGeometry, ticket.ticket_number);
                if (guidValues.length > 0) {
                    const cfgCommentsUrl = (this.props.config as any)?.commentsTableUrl?.trim() || "";
                    const commentsUrl = cfgCommentsUrl || this.state.commentsTableUrl || DEFAULT_COMMENTS_URL;
                    this.loadTicketComments(resolvedId, commentsUrl, guidValues);
                }
                if (ticket.objectid != null) this.loadStatusPhotos(layerUrl, ticket.objectid);
            });

        } catch (err) {
            this.beacon?.error(err, 'status-lookup');
            this.setState({ statusViewLoading: false, statusViewError: "Failed to load ticket status." });
        }
    };

    // ── STATUS VIEW — STAFF PHOTOS ────────────────────────────
    //  Native FeatureServer attachments on the Tickets feature, filtered
    //  to filenames starting with "staff-" — the prefix the RAC Manager
    //  writes when a photo is attached to a PUBLIC comment. "staffint-"
    //  (internal-note photos) and the submitter's own uploads are never
    //  listed. Anonymous read against the same public query layer used by
    //  loadTicketStatus; failures degrade silently to an empty section.

    loadStatusPhotos = async (layerUrl: string, oid: number) => {
        this.setState({ statusViewPhotosLoading: true });
        try {
            const token = getTokenFromIdentityManager();
            const params = new URLSearchParams({ f: "json" });
            if (token) params.set("token", token);

            const resp = await fetch(`${layerUrl}/${oid}/attachments?${params}`);
            const json = await resp.json();
            if (json.error || !json.attachmentInfos) {
                this.setState({ statusViewPhotosLoading: false, statusViewPhotos: [] });
                return;
            }

            const photos: StatusPhoto[] = (json.attachmentInfos as any[])
                .filter((att) => {
                    const nm = (att.name || "").toLowerCase();
                    // staff- only; staffint- is internal and must never show.
                    if (!nm.startsWith("staff-") || nm.startsWith("staffint-")) return false;
                    return (att.contentType || "").toLowerCase().startsWith("image/");
                })
                .map((att) => ({
                    url: token
                        ? `${layerUrl}/${oid}/attachments/${att.id}?token=${token}`
                        : `${layerUrl}/${oid}/attachments/${att.id}`,
                    name: att.name || "",
                    uploadDate: att.uploadDate ?? null,
                }));

            this.setState({ statusViewPhotosLoading: false, statusViewPhotos: photos });
        } catch {
            this.setState({ statusViewPhotosLoading: false, statusViewPhotos: [] });
        }
    };

    // ══════════════════════════════════════════════════════════
    //  STATUS VIEW — ZOOM MAP + OPEN POPUP
    // ══════════════════════════════════════════════════════════

    zoomToTicketGeometry = async (rawGeometry: any, ticketNumber: number) => {
        const { jmv, ticketsLayer } = this.state;
        if (!jmv?.view) return;

        const view = jmv.view as __esri.MapView;
        const Point = (window as any).require?.("esri/geometry/Point");
        if (!Point) return;

        const pt = new Point({
            x: rawGeometry.x,
            y: rawGeometry.y,
            spatialReference: rawGeometry.spatialReference || { wkid: this.getMapSRWkid() },
        });

        if (this.statusHighlight) {
            try { this.statusHighlight.remove(); } catch { }
            this.statusHighlight = null;
        }

        try { await view.goTo({ target: pt, scale: 1128 }); } catch { }

        if (!ticketsLayer) return;

        try {
            const [layerView, result] = await Promise.all([
                view.whenLayerView(ticketsLayer as any),
                ticketsLayer.queryFeatures({
                    where: `ticket_number = ${ticketNumber}`,
                    returnGeometry: true,
                    outFields: ["*"],
                    outSpatialReference: view.spatialReference,
                }),
            ]);

            if (result?.features?.length) {
                const feature = result.features[0];
                this.statusHighlight = (layerView as any).highlight(feature);
                (view as any).openPopup({
                    features: [feature],
                    location: feature.geometry,
                    fetchFeatures: true,
                });
            } else {
                (view as any).openPopup({ title: __t("ticketTicketNumber", { ticketNumber: ticketNumber }), location: pt });
            }
        } catch {
            try {
                (view as any).openPopup({ title: __t("ticketTicketNumber", { ticketNumber: ticketNumber }), location: pt });
            } catch { }
        }
    };

    // ══════════════════════════════════════════════════════════
    //  STATUS VIEW — PUBLIC COMMENTS
    // ══════════════════════════════════════════════════════════

    loadTicketComments = async (ticketGuid: string, explicitUrl?: string, candidateIds?: string[]) => {
        const commentsUrl = (explicitUrl && explicitUrl.trim())
            || (this.props.config?.commentsTableUrl?.trim() || "")
            || this.getCommentsTableUrl()
            || DEFAULT_COMMENTS_URL;
        if (!commentsUrl) return;

        this.setState({ statusViewCommentsLoading: true });

        try {
            const token = getTokenFromIdentityManager();

            // Query against every candidate GUID (bare + brace form), so
            // whichever field on the ticket record is the real ticket_id will
            // match. Falls back to the single passed id if no list given.
            const ids = (candidateIds && candidateIds.length ? candidateIds : [ticketGuid])
                .map(x => (x || "").replace(/[{}]/g, "").toUpperCase())
                .filter(Boolean);
            const uniq = Array.from(new Set(ids));
            const idClause = uniq
                .map(bare => `ticket_id = '{${bare}}' OR ticket_id = '${bare}'`)
                .join(" OR ");
            const where = `(${idClause}) AND is_public = 1`;

            // GET (not POST) so the request matches a plain anonymous browser
            // query against the public comments layer.
            const params = new URLSearchParams({
                f: "json",
                where,
                outFields: "comment_text,comment_type,created_date,is_public",
                orderByFields: "created_date ASC",
                returnGeometry: "false",
            });
            if (token) params.set("token", token);

            const resp = await fetch(`${commentsUrl}/query?${params.toString()}`, { method: "GET" });
            const json = await resp.json();

            if (json.error || !json.features) {
                this.setState({ statusViewCommentsLoading: false });
                return;
            }

            const comments: StatusComment[] = json.features
                .map((f: any) => {
                    const a = f.attributes || {};
                    return {
                        commentText: a.comment_text ?? a.COMMENT_TEXT ?? a.Comment_Text ?? "",
                        commentDate: a.comment_date ?? a.COMMENT_DATE ?? a.Comment_Date
                            ?? a.created_date ?? a.CREATED_DATE ?? null,
                    };
                })
                .filter((c: StatusComment) => !!c.commentText);

            this.setState({ statusViewCommentsLoading: false, statusViewComments: comments });
        } catch {
            this.setState({ statusViewCommentsLoading: false });
        }
    };

    // ══════════════════════════════════════════════════════════
    //  WIZARD NAVIGATION & VALIDATION
    // ══════════════════════════════════════════════════════════

    goToStep = (step: WizardStep) => {
        // Announce the new step in the polite live region and move keyboard focus to
        // the step heading, so screen reader and keyboard users land on the new content.
        this.setState({ step, liveMessage: `Step ${step + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[step]}` }, this.focusStepHeading);
        this.rootRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    /** Focus the current step's heading (tabIndex -1) after a step change. */
    private focusStepHeading = (): void => {
        try {
            const h = this.rootRef.current?.querySelector<HTMLElement>("h2[data-rac-step-heading]");
            h?.focus({ preventScroll: true });
        } catch { }
    };

    /** Write a message to the polite live region (see render). */
    private announce = (message: string): void => {
        this.setState({ liveMessage: message });
    };

    nextStep = () => {
        if (!this.validateCurrentStep()) return;
        if (this.state.step < 3) this.goToStep((this.state.step + 1) as WizardStep);
    };

    prevStep = () => {
        if (this.state.step > 0) this.goToStep((this.state.step - 1) as WizardStep);
    };

    validateCurrentStep(): boolean {
        switch (this.state.step) {
            case 0: return this.validateLocation();
            case 1: return this.validateDetails();
            case 2: return this.validateContact();
            default: return true;
        }
    }

    validateLocation(): boolean {
        const { mapPoint, geofence } = this.state;
        if (!mapPoint) { this.setState({ fieldErrors: { location: "Please set a location." } }); return false; }
        if (geofence.checking) { this.setState({ fieldErrors: { location: "Checking service area..." } }); return false; }
        if (!geofence.insideBoundary) {
            this.setState({ fieldErrors: { location: __tc(this.props.config?.outsideBoundaryMessage, "thisLocationIsOutsideTheService") } });
            return false;
        }
        this.setState({ fieldErrors: {} });
        return true;
    }

    validateDetails(): boolean {
        const { form, lookupData, lookupLoaded, lookupError, categoryGeofence } = this.state;
        const errors: FieldErrors = {};
        const filtering = this.isCategoryFilteringActive();

        if (form.category == null) {
            errors.category = "Please select a category.";
        } else if (filtering) {
            // Primary path: lookup table validates category against matched boundaries.
            // "No entry" means this category is not serviced at this location — block it.
            // Only enforce when lookup has loaded successfully (be permissive on error).
            const entry = lookupData.find((e) => e.category === form.category);
            if (lookupLoaded && !lookupError && !entry) {
                // No lookup row for this category at the matched boundaries — not serviced here.
                errors.category = "This category is not available for the selected location.";
            } else if (entry && !entry.isValid) {
                // Explicit invalid entry — use redirect message if available.
                errors.category = __tc(entry.redirectMessage, "thisCategoryIsNotAvailableFor");
            }
        } else if (categoryGeofence.valid === false) {
            // Fallback path: hardcoded CATEGORY_BOUNDARY_MAP check.
            errors.category = "This category is not available for the selected location.";
        }

        if (!form.description.trim()) {
            errors.description = "Please describe the concern.";
        } else if (form.description.trim().length < 10) {
            errors.description = "Please provide more detail (at least 10 characters).";
        } else if (containsProfanity(form.description)) {
            errors.description = "Please remove any inappropriate language before submitting.";
        }

        if (form.category != null) {
            const st = this.state.subtypes.find((s) => s.code === form.category);
            const d = st?.domains["subcategory"] || st?.domains["Subcategory"];
            if (d?.codedValues?.length && !form.subcategory) {
                errors.subcategory = "Please select a subcategory.";
            }
        }

        this.setState({ fieldErrors: errors });
        return Object.keys(errors).length === 0;
    }

    validateContact(): boolean {
        const { form } = this.state;
        const errors: FieldErrors = {};
        if (!form.submitted_by_name.trim()) errors.submitted_by_name = "Name is required.";
        else if (containsProfanity(form.submitted_by_name)) errors.submitted_by_name = "Please remove any inappropriate language before submitting.";
        if (!form.submitted_by_email.trim()) errors.submitted_by_email = "Email is required.";
        else if (!isValidEmail(form.submitted_by_email)) errors.submitted_by_email = "Please enter a valid email address.";
        if (form.submitted_by_phone.trim() && !PHONE_DIGITS_RE.test(stripPhoneDigits(form.submitted_by_phone)))
            errors.submitted_by_phone = "Please enter a 10-digit US phone number.";
        this.setState({ fieldErrors: errors });
        return Object.keys(errors).length === 0;
    }

    validateAllSteps(): boolean {
        if (!this.validateLocation()) { this.goToStep(0); return false; }
        if (!this.validateDetails()) { this.goToStep(1); return false; }
        if (!this.validateContact()) { this.goToStep(2); return false; }
        return true;
    }

    // ══════════════════════════════════════════════════════════
    //  MAP INTERACTION — PIN, GPS, GEOFENCE
    // ══════════════════════════════════════════════════════════

    getMapSRWkid = (): number => {
        const view = this.state.jmv?.view as __esri.MapView;
        return view?.spatialReference?.wkid || 4326;
    };

    togglePlacePin = () => {
        const { jmv, placingPin, clickHandler } = this.state;
        if (!jmv?.view) return;
        const view = jmv.view as __esri.MapView;

        if (placingPin) {
            clickHandler?.remove();
            this.setState({ placingPin: false, clickHandler: null });
            view.cursor = "default";
        } else {
            view.cursor = "crosshair";
            const h = view.on("click", (evt: __esri.ViewClickEvent) => {
                evt.stopPropagation();
                this.setPoint(evt.mapPoint);
                h.remove();
                this.setState({ placingPin: false, clickHandler: null, fieldErrors: {} });
                view.cursor = "default";
            });
            this.setState({ placingPin: true, clickHandler: h });
        }
    };

    setPoint = (pt: __esri.Point, skipReverseGeocode: boolean = false, knownAddress: string = "") => {
        const { jmv } = this.state;
        if (!jmv?.view) return;
        const view = jmv.view as __esri.MapView;

        if (this.graphicRef) { view.graphics.remove(this.graphicRef); this.graphicRef = null; this.clearBoundaryOverlay(); }

        const thm = this.getTheme();
        const Graphic = (window as any).require?.("esri/Graphic");
        if (Graphic) {
            const hex = thm.brand.startsWith("#") ? thm.brand : "#1a6daa";
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            this.graphicRef = new Graphic({
                geometry: pt,
                symbol: { type: "simple-marker", color: [r, g, b, 0.9], size: 14, outline: { color: [255, 255, 255], width: 2 } } as any,
            });
            view.graphics.add(this.graphicRef);
        }

        // Reset both geofence results and the category selection whenever a new point is placed.
        this.setState({
            mapPoint: pt,
            fieldErrors: {},
            selectedAddress: knownAddress,
            addressQuery: knownAddress,
            form: { ...this.state.form, category: null, subcategory: "" },
            lookupData: [],
            lookupLoaded: false,
            lookupError: "",
            categoryGeofence: { ...EMPTY_CAT_GEOFENCE },
        });

        this.checkGeofence(pt);
        if (!skipReverseGeocode && (this.props.config?.enableGeocoder !== false)) this.reverseGeocode(pt);
    };

    checkGeofence = async (pt: __esri.Point) => {
        const { boundariesUrl } = this.state;

        if (!boundariesUrl) {
            this.setState({ geofence: { insideBoundary: true, matchedBoundaries: [], matchedBoundaryIds: [], checking: false } });
            this.queryLookupTable([]);
            return;
        }

        this.setState({ geofence: { insideBoundary: false, matchedBoundaries: [], matchedBoundaryIds: [], checking: true } });

        try {
            const token = getTokenFromIdentityManager();
            const boundaryIdField = this.props.config?.boundaryIdField ?? "boundary_id";
            const pointJson = JSON.stringify({
                x: pt.x, y: pt.y,
                spatialReference: { wkid: pt.spatialReference?.wkid || 4326 },
            });

            const body = new URLSearchParams({
                f: "json",
                geometry: pointJson,
                geometryType: "esriGeometryPoint",
                spatialRel: "esriSpatialRelIntersects",
                inSR: String(pt.spatialReference?.wkid || 4326),
                outFields: "*",
                returnGeometry: "false",
                // Initial gate: pass if inside any valid service boundary type.
                // CITY_LIMITS = all city-managed categories.
                // WATER_DIST / SEWER_DIST = utility categories outside city limits.
                // OTHER boundaries (irrigation districts etc.) do not qualify.
                // The category-level check (checkCategoryGeofence) then uses
                // Category_Boundary_Lookup to validate the specific
                // category+boundary combination after category selection.
                where: "is_active = 1 AND boundary_type IN ('CITY_LIMITS', 'WATER_DIST', 'SEWER_DIST')",
            });
            if (token) body.set("token", token);

            const resp = await fetch(`${boundariesUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
            });
            const json = await resp.json();

            if (json.error) {
                this.setState({
                    geofence: { ...EMPTY_GEOFENCE },
                    fieldErrors: { location: `Geofence error: ${__tc(json.error.message, "serverError")}` },
                });
                return;
            }

            const features = json.features || [];

            if (features.length > 0) {
                const names: string[] = [];
                const boundaryIds: string[] = [];

                for (const f of features) {
                    const a = f.attributes || {};
                    names.push(a.boundary_name || a.BOUNDARY_NAME || a.NAME || a.name || a.boundary_id || `OID ${a.OBJECTID}`);
                    const idVal = a[boundaryIdField] ?? a[boundaryIdField.toUpperCase()] ?? a[boundaryIdField.toLowerCase()];
                    if (idVal != null) boundaryIds.push(String(idVal));
                }

                this.setState({
                    geofence: { insideBoundary: true, matchedBoundaries: names, matchedBoundaryIds: boundaryIds, checking: false },
                    fieldErrors: {},
                });
                this.queryLookupTable(boundaryIds);
            } else {
                this.setState({ geofence: { insideBoundary: false, matchedBoundaries: [], matchedBoundaryIds: [], checking: false } });
            }
        } catch {
            this.setState({ geofence: { ...EMPTY_GEOFENCE }, fieldErrors: { location: "Could not verify service area." } });
        }
    };

    // ══════════════════════════════════════════════════════════
    //  CATEGORY-LEVEL BOUNDARY CHECK (v2.4.0)
    //
    //  Hardcoded fallback for when the Category_Boundary_Lookup
    //  REST table is not configured. Uses CATEGORY_BOUNDARY_MAP
    //  to determine the required boundary_type for the selected
    //  category, then queries Service_Boundaries directly with
    //  a boundary_type WHERE filter.
    //
    //  Called from onFieldChange whenever category changes.
    //  Only rendered in the UI when isCategoryFilteringActive()
    //  returns false (i.e., lookup table not configured).
    //
    //  On any REST failure, falls through permissively — the
    //  server-side attribute rule (RAC_Geofence_Validate) is
    //  the authoritative enforcement layer.
    // ══════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════
    //  CATEGORY BOUNDARY OVERLAY
    //  Shows valid submission area as a transparent green polygon
    //  on the map when a category is selected.
    // ══════════════════════════════════════════════════════════

    clearBoundaryOverlay = () => {
        const view = this.state.jmv?.view as __esri.MapView | null;
        if (!view || this.boundaryGraphicRefs.length === 0) return;
        this.boundaryGraphicRefs.forEach((g) => view.graphics.remove(g));
        this.boundaryGraphicRefs = [];
    };

    showCategoryBoundary = async (categoryCode: number | null): Promise<void> => {
        this.clearBoundaryOverlay();
        const { jmv, boundariesUrl } = this.state;
        if (!categoryCode || !jmv || !boundariesUrl) return;

        const view = jmv.view as __esri.MapView;
        const viewSR = view.spatialReference?.wkid ?? 102100;

        try {
            // Step 1: determine which boundary_ids are valid for this category.
            // Primary: query lookup table for is_valid=1 entries for this category.
            // Fallback: use CATEGORY_BOUNDARY_MAP boundary_type to query directly.
            // Step 1: query lookup table for valid boundary_ids for this category.
            // This ensures we only show districts where the category IS serviced
            // (e.g. only the boundaries whose provider handles Water tickets).
            const { lookupUrl } = this.state;
            const requiredBoundaryType = (CATEGORY_BOUNDARY_MAP as any)[categoryCode];
            if (!requiredBoundaryType && !lookupUrl) return;

            // Query lookup table for valid boundary_ids for this category.
            // If the lookup is unavailable or returns nothing, do not show the overlay —
            // falling back to all boundaries of a type would show invalid districts (e.g.
            // a neighboring provider's district that does not take Water tickets).
            let whereClause: string | null = null;

            if (lookupUrl && (this.props.config?.enableCategoryFiltering ?? true)) {
                try {
                    const token = getTokenFromIdentityManager();
                    const lBody = new URLSearchParams({
                        f: "json",
                        where: `category = ${categoryCode} AND is_valid = 1`,
                        outFields: "boundary_id",
                        returnGeometry: "false",
                    });
                    if (token) lBody.set("token", token);
                    const lResp = await fetch(`${lookupUrl}/query`, {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: lBody,
                    });
                    const lJson = await lResp.json();
                    const boundaryIds: string[] = (lJson.features ?? [])
                        .map((f: any) => String(f.attributes?.boundary_id ?? f.attributes?.BOUNDARY_ID ?? ""))
                        .filter(Boolean);
                    if (boundaryIds.length > 0) {
                        const escaped = boundaryIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
                        whereClause = `boundary_id IN (${escaped}) AND is_active = 1`;
                    }
                } catch { /* non-fatal */ }
            } else if (requiredBoundaryType === "CITY_LIMITS") {
                // City limits is always a single unambiguous polygon — safe to show
                // without a lookup check since all city-managed categories are valid citywide.
                whereClause = `boundary_type = 'CITY_LIMITS' AND is_active = 1`;
            }

            // No valid boundaries determined — skip overlay.
            if (!whereClause) return;

            const token = getTokenFromIdentityManager();
            const bBody = new URLSearchParams({
                f: "json",
                where: whereClause,
                outFields: "boundary_id,boundary_name",
                returnGeometry: "true",
                outSR: String(viewSR),
            });
            if (token) bBody.set("token", token);
            const bResp = await fetch(`${boundariesUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: bBody,
            });
            const bJson = await bResp.json();
            if (bJson.error || !bJson.features?.length) return;

            // Step 3: add green polygon graphics to the map.
            const Graphic = (window as any).require?.("esri/Graphic");
            if (!Graphic) return;

            const fillSymbol = {
                type: "simple-fill",
                color: [34, 197, 94, 0.35],    // green-500, 35% fill — visible over aerial imagery
                outline: { color: [255, 255, 255, 1.0], width: 3 },  // white outline for contrast
            };

            // Get human-readable category name for the popup title.
            const categoryName = this.state.subtypes.find((s) => s.code === categoryCode)?.name ?? "Service Area";

            const newGraphics: __esri.Graphic[] = [];
            for (const feature of bJson.features) {
                if (!feature.geometry) continue;
                const attrs = feature.attributes ?? {};
                const boundaryName = attrs.boundary_name ?? attrs.BOUNDARY_NAME ?? attrs.boundary_id ?? "Service Boundary";
                const graphic = new Graphic({
                    geometry: { type: "polygon", ...feature.geometry, spatialReference: { wkid: viewSR } },
                    symbol: fillSymbol,
                    attributes: { boundaryName, categoryName },
                    popupTemplate: {
                        title: `${categoryName} Service Area`,
                        content: `<b>${boundaryName}</b><br/>This is the valid submission area for <b>${categoryName}</b> requests.`,
                    },
                });
                view.graphics.add(graphic);
                newGraphics.push(graphic);
            }
            this.boundaryGraphicRefs = newGraphics;

        } catch {
            // Non-fatal — overlay is decorative; geofence enforcement continues.
        }
    };

    checkCategoryGeofence = async (categoryCode: number | null): Promise<void> => {
        const { mapPoint, boundariesUrl } = this.state;

        // Guard: can't check without a category, a location, and a boundaries URL.
        if (!categoryCode || !mapPoint || !boundariesUrl) {
            this.setState({ categoryGeofence: { ...EMPTY_CAT_GEOFENCE } });
            return;
        }

        const requiredBoundaryType = CATEGORY_BOUNDARY_MAP[categoryCode];

        // null means this category is accepted anywhere — mark valid immediately.
        if (requiredBoundaryType === null || requiredBoundaryType === undefined) {
            this.setState({ categoryGeofence: { checking: false, valid: true } });
            return;
        }

        this.setState({ categoryGeofence: { checking: true, valid: null } });

        try {
            const ptSR = mapPoint.spatialReference?.wkid
                ?? mapPoint.spatialReference?.latestWkid
                ?? 4326;

            const geomJson = JSON.stringify({
                x: mapPoint.x, y: mapPoint.y,
                spatialReference: { wkid: ptSR },
            });

            const body = new URLSearchParams({
                f: "json",
                geometry: geomJson,
                geometryType: "esriGeometryPoint",
                spatialRel: "esriSpatialRelIntersects",
                inSR: String(ptSR),
                // Filter to only the boundary type required by this category.
                where: `boundary_type = '${requiredBoundaryType}' AND is_active = 1`,
                returnGeometry: "false",
                outFields: "boundary_id,boundary_name,boundary_type",
            });

            const token = getTokenFromIdentityManager();
            if (token) body.append("token", token);

            const resp = await fetch(`${boundariesUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
            });

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const json = await resp.json();
            if (json.error) throw new Error(`Server: ${JSON.stringify(json.error)}`);

            const isValid = (json.features ?? []).length > 0;
            this.setState({ categoryGeofence: { checking: false, valid: isValid } });

        } catch {
            // On any failure, be permissive — server-side rules enforce the
            // authoritative boundary check at insert time.
            this.setState({ categoryGeofence: { checking: false, valid: true } });
        }
    };

    // ══════════════════════════════════════════════════════════
    //  CATEGORY ↔ BOUNDARY LOOKUP
    // ══════════════════════════════════════════════════════════

    isCategoryFilteringActive = (): boolean =>
        (this.props.config?.enableCategoryFiltering ?? true) && !!this.state.lookupUrl;

    queryLookupTable = async (boundaryIds: string[]) => {
        const { lookupUrl } = this.state;
        if (!lookupUrl || !(this.props.config?.enableCategoryFiltering ?? true)) {
            this.setState({ lookupLoaded: true, lookupData: [] });
            return;
        }

        this.setState({ lookupLoading: true, lookupError: "" });

        try {
            const token = getTokenFromIdentityManager();
            let where = "1=1";
            if (boundaryIds.length > 0) {
                const escaped = boundaryIds.map((id) => `'${id.replace(/'/g, "''")}'`);
                where = `boundary_id IN (${escaped.join(",")})`;
            }

            const body = new URLSearchParams({
                f: "json", where,
                outFields: "category,boundary_id,is_valid,redirect_message,display_order",
                returnGeometry: "false",
            });
            if (token) body.set("token", token);

            const resp = await fetch(`${lookupUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
            });
            const json = await resp.json();

            if (json.error) {
                this.setState({ lookupLoading: false, lookupLoaded: true, lookupError: `Lookup error: ${__tc(json.error.message, "serverError")}`, lookupData: [] });
                return;
            }

            const lookupData: LookupEntry[] = (json.features || []).map((f: any) => {
                const a = f.attributes || {};
                return {
                    category: a.category ?? a.Category ?? a.CATEGORY,
                    boundaryId: String(a.boundary_id ?? a.BOUNDARY_ID ?? ""),
                    isValid: (a.is_valid ?? a.IS_VALID ?? a.Is_Valid ?? 1) === 1,
                    redirectMessage: a.redirect_message ?? a.REDIRECT_MESSAGE ?? "",
                    displayOrder: a.display_order ?? a.DISPLAY_ORDER ?? 999,
                };
            });

            this.setState({ lookupLoading: false, lookupLoaded: true, lookupData });
        } catch (err) {
            this.setState({ lookupLoading: false, lookupLoaded: true, lookupError: "Could not load category rules.", lookupData: [] });
        }
    };

    getFilteredCategories(): { code: number; name: string; isValid: boolean; redirectMessage: string; }[] {
        const { subtypes, lookupData, lookupLoaded } = this.state;
        const filtering = this.isCategoryFilteringActive();

        if (!filtering || !lookupLoaded || lookupData.length === 0) {
            return subtypes.map((st) => ({ code: st.code, name: st.name, isValid: true, redirectMessage: "" }));
        }

        const behavior = this.props.config?.invalidCategoryBehavior ?? "show_message";
        const catMap = new Map<number, { isValid: boolean; redirectMessage: string; boundaryId: string }>();

        for (const entry of lookupData) {
            const existing = catMap.get(entry.category);
            if (!existing) {
                // First entry for this category
                catMap.set(entry.category, { isValid: entry.isValid, redirectMessage: entry.redirectMessage, boundaryId: entry.boundaryId });
            } else if (entry.isValid && !existing.isValid) {
                // Replace invalid with valid
                catMap.set(entry.category, { isValid: true, redirectMessage: "", boundaryId: entry.boundaryId });
            } else if (!entry.isValid && !existing.isValid) {
                // Both invalid: prefer specific district messages over generic CITY_LIMITS messages
                const existingIsCityLimits = existing.boundaryId.includes('CITY_LIMITS');
                const entryIsCityLimits = entry.boundaryId.includes('CITY_LIMITS');

                if (existingIsCityLimits && !entryIsCityLimits) {
                    // Replace generic CITY_LIMITS message with specific district message
                    catMap.set(entry.category, { isValid: entry.isValid, redirectMessage: entry.redirectMessage, boundaryId: entry.boundaryId });
                }
            }
        }

        const result: { code: number; name: string; isValid: boolean; redirectMessage: string; }[] = [];

        for (const st of subtypes) {
            const lookup = catMap.get(st.code);
            if (!lookup) {
                if (behavior === "hide") continue;
                result.push({ code: st.code, name: st.name, isValid: false, redirectMessage: "This category is not available for the selected location." });
            } else if (lookup.isValid) {
                result.push({ code: st.code, name: st.name, isValid: true, redirectMessage: "" });
            } else {
                if (behavior === "hide") continue;
                result.push({ code: st.code, name: st.name, isValid: false, redirectMessage: __tc(lookup.redirectMessage, "thisCategoryIsNotAvailableFor") });
            }
        }

        return result;
    }

    // ── GPS ──────────────────────────────────────────────────

    useGPS = () => {
        if (!navigator.geolocation) return;
        this.setState({ gpsLocating: true, fieldErrors: {} });

        const safety = setTimeout(() => {
            this.setState({ gpsLocating: false, fieldErrors: { location: "Location timed out." } });
        }, 15000);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(safety);
                const { jmv } = this.state;
                if (!jmv?.view) { this.setState({ gpsLocating: false }); return; }
                const view = jmv.view as __esri.MapView;
                const Point = (window as any).require?.("esri/geometry/Point");
                if (!Point) { this.setState({ gpsLocating: false }); return; }

                const gp = new Point({ longitude: pos.coords.longitude, latitude: pos.coords.latitude, spatialReference: { wkid: 4326 } });
                const w = view.spatialReference?.wkid;

                if (w === 3857 || w === 102100) {
                    const wm = (window as any).require?.("esri/geometry/support/webMercatorUtils");
                    if (wm) {
                        const p = wm.geographicToWebMercator(gp) as __esri.Point;
                        this.setPoint(p);
                        view.goTo({ target: p, scale: 1128 });
                        this.setState({ gpsLocating: false });
                        return;
                    }
                }

                if (w === 4326) {
                    this.setPoint(gp);
                    view.goTo({ target: gp, scale: 1128 });
                    this.setState({ gpsLocating: false });
                    return;
                }

                this.projectGPSPoint(pos.coords.latitude, pos.coords.longitude, view);
            },
            () => {
                clearTimeout(safety);
                this.setState({ gpsLocating: false, fieldErrors: { location: "Could not get location." } });
            },
            { enableHighAccuracy: true, timeout: 12000 }
        );
    };

    projectGPSPoint = async (lat: number, lng: number, view: __esri.MapView) => {
        const geoSvcUrl = this.getEnterpriseGeoServiceUrl();
        if (!geoSvcUrl) {
            this.setState({ gpsLocating: false, fieldErrors: { location: "Could not project GPS (no geometry service)." } });
            return;
        }

        try {
            const token = getTokenFromIdentityManager();
            const body = new URLSearchParams({
                f: "json",
                inSR: "4326",
                outSR: String(view.spatialReference.wkid),
                geometries: JSON.stringify({ geometryType: "esriGeometryPoint", geometries: [{ x: lng, y: lat }] }),
            });
            if (token) body.set("token", token);

            const resp = await fetch(`${geoSvcUrl}/project`, { method: "POST", body });
            const json = await resp.json();

            if (json.error || !json.geometries?.length) {
                this.setState({ gpsLocating: false, fieldErrors: { location: "Could not project GPS coordinates." } });
                return;
            }

            const Point = (window as any).require?.("esri/geometry/Point");
            if (!Point) { this.setState({ gpsLocating: false }); return; }

            const pt = new Point({ x: json.geometries[0].x, y: json.geometries[0].y, spatialReference: view.spatialReference });
            this.setPoint(pt);
            view.goTo({ target: pt, scale: 1128 });
            this.setState({ gpsLocating: false });
        } catch {
            this.setState({ gpsLocating: false, fieldErrors: { location: "GPS projection failed." } });
        }
    };

    // ══════════════════════════════════════════════════════════
    //  GEOCODER / ADDRESS SEARCH
    // ══════════════════════════════════════════════════════════

    onAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        this.setState({ addressQuery: val, addressError: "" });
        if (this.suggestTimer) clearTimeout(this.suggestTimer);
        if (val.trim().length >= 3) this.suggestTimer = setTimeout(() => this.fetchSuggestions(val.trim()), 350);
        else this.setState({ addressResults: [] });
    };

    onAddressKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); if (this.suggestTimer) clearTimeout(this.suggestTimer); this.searchAddress(); }
    };

    fetchSuggestions = async (text: string) => {
        try {
            const token = getTokenFromIdentityManager();
            const mapSR = this.getMapSRWkid();
            const params = new URLSearchParams({ f: "json", singleLine: text, outFields: "Match_addr", maxLocations: "5", outSR: String(mapSR) });
            if (token) params.set("token", token);

            const view = this.state.jmv?.view as __esri.MapView;
            if (view?.center?.longitude != null && view?.center?.latitude != null) {
                params.set("location", `${view.center.longitude},${view.center.latitude}`);
                params.set("distance", "50000");
            }

            const resp = await fetch(`${this.getGeocoderUrl()}/findAddressCandidates?${params}`);
            const json = await resp.json();
            if (this.state.addressQuery.trim() !== text) return;
            if (json.candidates?.length) {
                this.setState({
                    addressResults: json.candidates.map((c: any) => ({
                        address: (c.address || c.attributes?.Match_addr || "").trim(),
                        location: c.location ? { x: c.location.x, y: c.location.y, spatialReference: { wkid: mapSR } } : null,
                    })),
                });
            } else { this.setState({ addressResults: [] }); }
        } catch { }
    };

    searchAddress = async () => {
        this.beacon?.action('search');
        const q = this.state.addressQuery?.trim();
        if (!q || q.length < 3) return;
        this.setState({ addressSearching: true, addressResults: [], addressError: "" });
        try {
            const token = getTokenFromIdentityManager();
            const mapSR = this.getMapSRWkid();
            const params = new URLSearchParams({ f: "json", singleLine: q, outFields: "Addr_type,Match_addr", maxLocations: "6", outSR: String(mapSR) });
            if (token) params.set("token", token);

            const view = this.state.jmv?.view as __esri.MapView;
            if (view?.center?.longitude != null && view?.center?.latitude != null) {
                params.set("location", `${view.center.longitude},${view.center.latitude}`);
                params.set("distance", "50000");
            }

            const resp = await fetch(`${this.getGeocoderUrl()}/findAddressCandidates?${params}`);
            const json = await resp.json();
            if (json.candidates?.length) {
                this.setState({
                    addressResults: json.candidates.map((c: any) => ({
                        address: (c.address || c.attributes?.Match_addr || "").trim(),
                        location: c.location ? { x: c.location.x, y: c.location.y, spatialReference: { wkid: mapSR } } : null,
                    })),
                    addressSearching: false,
                });
                this.announce((json.candidates.length === 1 ? this.nls('candidatesCountAddressFoundPressTabTo', { candidatesCount: json.candidates.length }) : this.nls('candidatesCountAddressesFoundPressTabTo', { candidatesCount: json.candidates.length })));
            } else { this.setState({ addressResults: [], addressSearching: false, addressError: "No results found." }); }
        } catch { this.setState({ addressSearching: false, addressError: "Search failed." }); }
    };

    selectAddress = (result: GeoResult) => {
        if (!result.location) return;
        const { jmv } = this.state;
        if (!jmv?.view) return;
        const view = jmv.view as __esri.MapView;
        const Point = (window as any).require?.("esri/geometry/Point");
        if (!Point) return;
        const pt = new Point({ x: result.location.x, y: result.location.y, spatialReference: view.spatialReference });
        const addr = (result.address || "").trim();
        this.setPoint(pt, true, addr);
        view.goTo({ target: pt, scale: 1128 });
        this.setState({ addressResults: [], fieldErrors: {} });
    };

    clearAddress = () => {
        this.setState({
            selectedAddress: "", addressQuery: "", addressResults: [],
            mapPoint: null, geofence: { ...EMPTY_GEOFENCE },
            lookupData: [], lookupLoaded: false, lookupError: "",
            categoryGeofence: { ...EMPTY_CAT_GEOFENCE },
            form: { ...this.state.form, category: null, subcategory: "" },
        });
        if (this.graphicRef && this.state.jmv?.view) {
            (this.state.jmv.view as __esri.MapView).graphics.remove(this.graphicRef);
            this.graphicRef = null;
            this.clearBoundaryOverlay();
        }
    };

    resetLocation = () => {
        if (this.graphicRef && this.state.jmv?.view) {
            (this.state.jmv.view as __esri.MapView).graphics.remove(this.graphicRef);
            this.graphicRef = null;
            this.clearBoundaryOverlay();
        }
        this.setState({
            mapPoint: null, selectedAddress: "", addressQuery: "",
            addressResults: [], addressError: "", placingPin: false, fieldErrors: {},
            geofence: { ...EMPTY_GEOFENCE }, lookupData: [], lookupLoaded: false, lookupError: "",
            categoryGeofence: { ...EMPTY_CAT_GEOFENCE },
            form: { ...this.state.form, category: null, subcategory: "" },
        });
        this.rootRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    // ══════════════════════════════════════════════════════════
    //  FORM HANDLERS
    // ══════════════════════════════════════════════════════════

    onFieldChange = (field: keyof TicketFormData, value: any) => {
        this.setState(
            (prev) => {
                const form = { ...prev.form, [field]: value };
                if (field === "category") form.subcategory = "";
                const fieldErrors = { ...prev.fieldErrors };
                delete fieldErrors[field];
                return { form, fieldErrors, submitResult: "idle" as const, submitMessage: "" };
            },
            () => {
                // When category changes, trigger the fallback boundary check.
                // This only surfaces in the UI when the lookup table is not configured.
                if (field === "category") {
                    this.setState({ categoryGeofence: { ...EMPTY_CAT_GEOFENCE } });
                    this.checkCategoryGeofence(value as number | null);
                    this.showCategoryBoundary(value as number | null);
                }
            }
        );
    };

    // ── Shared file processors — called by both input-change and drop paths ──
    //    OWASP validation (size, filename, ext, MIME, magic bytes) runs
    //    identically regardless of how the file arrived.

    processPhotoFile = async (slotIndex: number, file: File) => {
        const result = await validateMediaFile(
            file,
            PHOTO_ALLOWED_EXTS,
            PHOTO_ALLOWED_MIMES,
            MAX_PHOTO_SIZE_MB * 1024 * 1024,
        );

        if (!result.valid) {
            const newErrors = [...this.state.photoErrors];
            newErrors[slotIndex] = result.error;
            this.setState({ photoErrors: newErrors });
            return;
        }

        // ── Re-encode through canvas to strip all metadata ────────────────
        // compressPhoto() decodes pixel data and re-encodes as a fresh JPEG,
        // discarding all EXIF, IPTC, XMP, and comment fields in the process.
        // This removes injected metadata (e.g. EICAR test string, hidden
        // comments) regardless of the original format.
        //
        // Returns null when the browser cannot decode the image (HEIC on
        // non-Safari, tainted canvas, etc.). For HEIC/AVIF, validateMediaFile
        // step 7 (isobmffIsClean) already enforces structural integrity.
        // For JPEG/PNG/WebP, a null return means the file could not be
        // sanitised — reject rather than upload unstripped content.
        const uploadFile = await compressPhoto(file);

        const isHEICOrAVIF = file.name.toLowerCase().match(/\.(heic|heif|avif)$/) ||
            file.type === "image/heic" || file.type === "image/heif" ||
            file.type === "image/avif";

        if (uploadFile === null) {
            if (isHEICOrAVIF) {
                // HEIC/AVIF: browser cannot re-encode but isobmffIsClean already
                // validated the structure. Upload the original — metadata in
                // HEIC/AVIF is covered by the ISOBMFF 4CC printable-ASCII check.
                // Intentional fall-through to use original file.
            } else {
                // JPEG/PNG/WebP that couldn't be re-encoded — reject to avoid
                // uploading unstripped content.
                const newErrors = [...this.state.photoErrors];
                newErrors[slotIndex] = "Could not process image. Please try a different photo.";
                this.setState({ photoErrors: newErrors });
                return;
            }
        }

        const finalFile = uploadFile ?? file;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const newFiles = [...this.state.photoFiles];
            const newPreviews = [...this.state.photoPreviews];
            const newErrs = [...this.state.photoErrors];
            newFiles[slotIndex] = finalFile;
            newPreviews[slotIndex] = ev.target?.result as string;
            newErrs[slotIndex] = "";
            this.setState({ photoFiles: newFiles, photoPreviews: newPreviews, photoErrors: newErrs });
        };
        // Preview from the processed file so thumbnail matches what gets uploaded.
        reader.readAsDataURL(finalFile);
    };

    // ── Add a photo to a specific slot (0-based index) ──────
    onPhotoAdd = async (slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        e.target.value = ""; // reset so same file can be re-selected after an error
        if (!file) return;
        await this.processPhotoFile(slotIndex, file);
    };

    // ── Drag-and-drop handlers — photos ─────────────────────
    onPhotoSlotDragOver = (slotIndex: number, e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.state.dragOverPhotoSlot !== slotIndex)
            this.setState({ dragOverPhotoSlot: slotIndex });
    };

    onPhotoSlotDragLeave = (_slotIndex: number, e: React.DragEvent) => {
        e.preventDefault();
        this.setState({ dragOverPhotoSlot: null });
    };

    onPhotoSlotDrop = async (slotIndex: number, e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.setState({ dragOverPhotoSlot: null });
        const file = e.dataTransfer.files?.[0] || null;
        if (!file) return;
        await this.processPhotoFile(slotIndex, file);
    };

    onPhotoRemove = (slotIndex: number) => {
        const newFiles = [...this.state.photoFiles];
        const newPreviews = [...this.state.photoPreviews];
        const newErrors = [...this.state.photoErrors];
        newFiles.splice(slotIndex, 1);
        newPreviews.splice(slotIndex, 1);
        newErrors.splice(slotIndex, 1);
        this.setState({ photoFiles: newFiles, photoPreviews: newPreviews, photoErrors: newErrors });
    };



    getSubcategories(): { code: string | number; name: string }[] {
        const { form, subtypes } = this.state;
        if (form.category == null) return [];
        const st = subtypes.find((s) => s.code === form.category);
        if (!st) return [];
        const d = st.domains["subcategory"] || st.domains["Subcategory"];
        return d?.codedValues?.length ? d.codedValues : [];
    }

    getCategoryName = (): string =>
        this.state.subtypes.find((s) => s.code === this.state.form.category)?.name || "—";

    getSubcategoryName = (): string => {
        if (!this.state.form.subcategory) return "—";
        return this.getSubcategories().find((s) => String(s.code) === String(this.state.form.subcategory))?.name || this.state.form.subcategory;
    };

    getSubcategoryNameFor = (category: number | null, code: string): string => {
        if (!code || category == null) return code || "—";
        const st = this.state.subtypes.find((s) => s.code === category);
        const d = st?.domains["subcategory"] || st?.domains["Subcategory"];
        return d?.codedValues?.find((cv) => String(cv.code) === String(code))?.name || code;
    };

    // ══════════════════════════════════════════════════════════
    //  CRITICAL-ISSUE ALERTS
    //  ----------------------------------------------------------
    //  Soft-warn banner shown when the citizen has selected a
    //  category/subcategory combination that the city wants
    //  them to phone in instead. Submission is NOT blocked.
    //  Matching is by case-insensitive name; an alert with blank
    //  subcategory matches ALL subcategories of that category.
    //  More specific (subcategory-matched) entries win over
    //  category-only entries.
    // ══════════════════════════════════════════════════════════

    /**
     * Find the matching CriticalAlert for the current form selection.
     * Returns null when no alert is configured for this combination.
     * Subcategory-specific matches win over category-only (blank-sub) matches.
     *
     * Returns a normalized shape that always has a `phones` array — the
     * legacy `phone` scalar field (still accepted in old configs) is
     * folded in as a single-row phones array on the way out.
     */
    getCriticalAlert = (): {
        category: string;
        subcategory: string;
        phones: Array<{ label: string; name: string; number: string }>;
        message: string;
    } | null => {
        const alerts = (this.props.config as any)?.criticalAlerts as
            | Array<{
                category?: string;
                subcategory?: string;
                // Legacy single-phone shape (still supported).
                phone?: string;
                // New multi-phone shape (preferred).
                phones?: Array<{ label?: string; name?: string; number?: string }>;
                message?: string;
            }>
            | undefined;
        if (!alerts || alerts.length === 0) return null;

        const catName = this.getCategoryName();
        const subName = this.state.form.subcategory ? this.getSubcategoryName() : "";
        if (!catName || catName === "—") return null;

        const norm = (s: string | undefined | null) => (s || "").trim().toLowerCase();
        const c = norm(catName);
        const s = norm(subName);

        // Build the unified phones array from either source.
        // Drop entries with no number.
        const buildPhones = (
            a: {
                phone?: string;
                phones?: Array<{ label?: string; name?: string; number?: string }>;
            }
        ): Array<{ label: string; name: string; number: string }> => {
            const out: Array<{ label: string; name: string; number: string }> = [];
            if (Array.isArray(a.phones) && a.phones.length > 0) {
                for (const p of a.phones) {
                    const num = (p?.number || "").trim();
                    if (!num) continue;
                    out.push({
                        label: (p?.label || "").trim(),
                        name: (p?.name || "").trim(),
                        number: num,
                    });
                }
            }
            // Fall back to legacy single phone if no phones[] entries.
            if (out.length === 0 && a.phone && a.phone.trim()) {
                out.push({ label: "", name: "", number: a.phone.trim() });
            }
            return out;
        };

        let categoryOnlyMatch: any = null;
        for (const a of alerts) {
            const ac = norm(a.category);
            const aSub = norm(a.subcategory);
            if (!ac || ac !== c) continue;
            const phones = buildPhones(a);
            if (phones.length === 0) continue; // skip rows with no callable numbers
            if (aSub && aSub === s) {
                // Most specific possible match — return immediately.
                return {
                    category: a.category || "",
                    subcategory: a.subcategory || "",
                    phones,
                    message: a.message || "",
                };
            }
            if (!aSub && !categoryOnlyMatch) {
                categoryOnlyMatch = { a, phones };
            }
        }
        if (categoryOnlyMatch) {
            return {
                category: categoryOnlyMatch.a.category || "",
                subcategory: categoryOnlyMatch.a.subcategory || "",
                phones: categoryOnlyMatch.phones,
                message: categoryOnlyMatch.a.message || "",
            };
        }
        return null;
    };

    /**
     * Build a tel: href from a display phone string. Strips formatting
     * characters but keeps leading + for international numbers.
     */
    private telHref = (phone: string): string => {
        const cleaned = (phone || "").replace(/[^\d+]/g, "");
        return cleaned ? `tel:${cleaned}` : "";
    };

    /**
     * Render the critical-issue alert banner. Used on Step 2 (Details)
     * and Step 4 (Review). Returns null when no alert is active.
     *
     * The banner is amber/warning-colored to differentiate from the
     * red error boxes used for blocking conditions (out-of-boundary,
     * etc). role="alert" announces it to screen readers when the
     * subcategory dropdown changes.
     *
     * Renders one phone block per entry in alert.phones. Each block
     * shows an optional label (e.g. "Monday-Friday 8 AM to 5 PM") and
     * optional name (e.g. "Customer Service") above the tap-to-call
     * number. Single-phone alerts (legacy or new) render just one block.
     */
    renderCriticalAlertBanner = (placement: "details" | "review"): React.ReactElement | null => {
        const alert = this.getCriticalAlert();
        if (!alert) return null;

        const t = this.getTheme();
        const defaultMsg =
            (this.props.config as any)?.criticalAlertDefaultMessage ||
            __t("forTheFastestResponsePleaseCall");
        const body = (alert.message && alert.message.trim()) || defaultMsg;

        const boxStyle: React.CSSProperties = {
            padding: "14px 16px",
            background: t.warningBg,
            border: `2px solid ${t.warningBorder}`,
            borderRadius: 10,
            color: t.text,
            fontSize: 13,
            lineHeight: 1.5,
            marginTop: placement === "details" ? 4 : 0,
            marginBottom: 14,
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        };

        const headerStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 700,
            fontSize: 14,
            color: t.warning,
            marginBottom: 6,
        };

        const phoneBlock: React.CSSProperties = {
            display: "flex",
            flexDirection: "column",
            gap: 2,
            marginTop: 10,
            padding: "10px 12px",
            background: t.inputBg,
            border: `1.5px solid ${t.warningBorder}`,
            borderRadius: 8,
        };

        const phoneLabelStyle: React.CSSProperties = {
            fontSize: 12,
            fontWeight: 600,
            color: t.warning,
            letterSpacing: 0.2,
            textTransform: "uppercase",
        };

        const phoneNameStyle: React.CSSProperties = {
            fontSize: 13,
            color: t.text,
            opacity: 0.85,
        };

        const phoneNumberRow: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 4,
        };

        const phoneLink: React.CSSProperties = {
            fontSize: 18,
            fontWeight: 700,
            color: t.text,
            textDecoration: "none",
            letterSpacing: 0.3,
        };

        return (
            <div style={boxStyle} role="alert" aria-live="polite">
                <div style={headerStyle}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <span>
                        {alert.phones.length > 1
                            ? this.nls('pleaseCallUsForThisIssue')
                            : this.nls('pleaseCallUsForThisIssue')}
                    </span>
                </div>
                <div>{body}</div>
                {alert.phones.map((p, idx) => {
                    const tel = this.telHref(p.number);
                    const ariaLabel = this.nls('callJoin', { join: [p.name, p.label, p.number].filter(Boolean).join(", ") });
                    return (
                        <div key={idx} style={phoneBlock}>
                            {p.label && <span style={phoneLabelStyle}>{p.label}</span>}
                            {p.name && <span style={phoneNameStyle}>{p.name}</span>}
                            <div style={phoneNumberRow}>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                                    stroke={t.warning} strokeWidth="2.2"
                                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
                                </svg>
                                {tel ? (
                                    <a href={tel} style={phoneLink} aria-label={ariaLabel}>
                                        {p.number}
                                    </a>
                                ) : (
                                    <span style={phoneLink}>{p.number}</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // ══════════════════════════════════════════════════════════
    //  QUERY BACK TICKET NUMBER
    // ══════════════════════════════════════════════════════════

    queryTicketNumber = async (objectId: number): Promise<number | null> => {
        const { ticketsLayer } = this.state;
        if (!ticketsLayer?.url) return null;

        try {
            const token = getTokenFromIdentityManager();
            const layerUrl = `${ticketsLayer.url}/${ticketsLayer.layerId ?? this.props.config?.ticketsLayerIndex ?? 0}`;
            const body = new URLSearchParams({ f: "json", where: `OBJECTID = ${objectId}`, outFields: "ticket_number", returnGeometry: "false" });
            if (token) body.set("token", token);

            const resp = await fetch(`${layerUrl}/query`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
            const json = await resp.json();
            if (json.error) return null;

            const attrs = json.features?.[0]?.attributes;
            const tn = attrs?.ticket_number ?? attrs?.TICKET_NUMBER ?? attrs?.Ticket_Number ?? null;
            return (tn != null && !isNaN(Number(tn))) ? Number(tn) : null;
        } catch { return null; }
    };

    // ══════════════════════════════════════════════════════════
    //  SUBMIT
    // ══════════════════════════════════════════════════════════

    onSubmit = async () => {
        this.beacon?.action('submit');
        const { ticketsLayer, mapPoint, form, photoFiles, geofence } = this.state;
        if (!mapPoint) return;
        if (!this.validateAllSteps()) return;

        this.setState({
            submitting: true, submitResult: "idle", submitMessage: "",
            submitPhase: "Submitting report\u2026", submitProgress: 0,
        });

        // Helper called by submitViaREST / submitViaLayer to push phase + percent updates.
        const onProgress = (phase: string, progress: number) => {
            this.setState({ submitPhase: phase, submitProgress: Math.min(100, Math.round(progress)) });
        };

        try {
            const cfg = this.props.config;
            const writeUrl = cfg?.writeEndpointUrl?.trim() || "";
            const now = Date.now();

            const attrs: Record<string, any> = {
                ticket_id: `{${uid()}}`,
                submitted_by_name: form.submitted_by_name.trim(),
                submitted_by_email: form.submitted_by_email.trim(),
                submitted_by_phone: form.submitted_by_phone.trim() || null,
                category: form.category,
                subcategory: form.subcategory || null,
                description: form.description.trim(),
                status: DEFAULT_STATUS,
                priority: DEFAULT_PRIORITY,
                submitted_date: now,
                created_date: now,
                notification_sent: 0,
                survey_sent: 0,
                source: "WEB",
                address_submitted: (this.state.selectedAddress || "").slice(0, 250) || null,
            };

            if ((cfg?.populateBoundaryId ?? true) && geofence.matchedBoundaryIds.length > 0) {
                const fieldName = cfg?.ticketBoundaryIdField ?? "boundary_id";
                attrs[fieldName] = geofence.matchedBoundaryIds.length === 1
                    ? geofence.matchedBoundaryIds[0]
                    : geofence.matchedBoundaryIds.join(",");
            }

            const geometry = { x: mapPoint.x, y: mapPoint.y, spatialReference: { wkid: mapPoint.spatialReference?.wkid || 32612 } };

            if (writeUrl) await this.submitViaREST(writeUrl, attrs, geometry, photoFiles, onProgress);
            else if (ticketsLayer) await this.submitViaLayer(ticketsLayer, attrs, geometry, photoFiles, onProgress);
            else this.setState({ submitting: false, submitResult: "error", submitMessage: "No write endpoint or map layer configured.", liveMessage: "No write endpoint or map layer configured.", submitPhase: "", submitProgress: 0 });
        } catch (err: any) {
            this.beacon?.error(err, 'submit');
            let msg = "An error occurred.";
            if (err?.message) msg = err.message;
            if (err?.details?.messages?.length) msg = err.details.messages.join("\n");
            this.setState({ submitting: false, submitResult: "error", submitMessage: msg, liveMessage: msg, submitPhase: "", submitProgress: 0 });
        }
    };

    submitViaREST = async (writeUrl: string, attrs: Record<string, any>, geometry: any, photoFiles: File[], onProgress: (phase: string, pct: number) => void) => {
        const isProxy = writeUrl.includes("/sharing/proxy");
        const body = new URLSearchParams({ f: "json", adds: JSON.stringify([{ attributes: attrs, geometry }]) });
        if (!isProxy) { const token = getTokenFromIdentityManager(); if (token) body.set("token", token); }

        onProgress("Submitting report\u2026", 10);
        const resp = await fetch(`${writeUrl}/applyEdits`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, credentials: isProxy ? "include" : "same-origin" });
        const json = await resp.json();
        onProgress("Submitting report\u2026", 40);

        if (json.error) { const msg = `Server error: ${json.error.message || JSON.stringify(json.error)}`; this.setState({ submitting: false, submitResult: "error", submitMessage: msg, liveMessage: msg, submitPhase: "", submitProgress: 0 }); return; }

        const addResults = json.addResults || [];
        if (!addResults.length) { this.setState({ submitting: false, submitResult: "error", submitMessage: "No result from server.", liveMessage: "No result from server.", submitPhase: "", submitProgress: 0 }); return; }

        const r = addResults[0];
        if (r.error) { const msg = __tc(r.error.description || r.error.message, "submissionRejected"); this.setState({ submitting: false, submitResult: "error", submitMessage: msg, liveMessage: msg, submitPhase: "", submitProgress: 0 }); return; }

        // ── Upload attachments to enterprise FeatureServer (non-fatal) ──
        // addAttachment on enterprise ArcGIS Server works anonymously for public
        // Create-enabled services. Failures are silently swallowed so the ticket
        // is never rolled back — the citizen's report is always preserved.
        if (r.objectId != null && photoFiles.length > 0) {
            const total = photoFiles.length;
            for (let i = 0; i < total; i++) {
                const file = photoFiles[i];
                const label = total > 1 ? `Uploading photo ${i + 1} of ${total}\u2026` : "Uploading photo\u2026";
                onProgress(label, 40 + (55 * i) / total);
                const safeName = getSafeUploadName(file, PHOTO_ALLOWED_EXTS);
                await this.uploadAttachmentREST(writeUrl, r.objectId, file, safeName, isProxy);
                onProgress(label, 40 + (55 * (i + 1)) / total);
            }
        }

        onProgress("Finalizing\u2026", 95);
        const ticketNumber = r.objectId != null ? await this.queryTicketNumber(r.objectId) : null;
        onProgress("Finalizing\u2026", 100);
        this.onSubmitSuccess(ticketNumber);
    };

    submitViaLayer = async (ticketsLayer: __esri.FeatureLayer, attrs: Record<string, any>, geometry: any, photoFiles: File[], onProgress: (phase: string, pct: number) => void) => {
        const fieldMap = new Map<string, string>();
        if (ticketsLayer.fields) for (const f of ticketsLayer.fields) fieldMap.set(f.name.toLowerCase(), f.name);
        const mapped: Record<string, any> = {};
        for (const [key, val] of Object.entries(attrs)) mapped[fieldMap.get(key.toLowerCase()) || key] = val;

        const Graphic = (window as any).require?.("esri/Graphic");
        const Point = (window as any).require?.("esri/geometry/Point");
        const pt = new Point({ x: geometry.x, y: geometry.y, spatialReference: { wkid: geometry.spatialReference.wkid } });

        onProgress("Submitting report\u2026", 10);
        const result = await ticketsLayer.applyEdits({ addFeatures: [new Graphic({ geometry: pt, attributes: mapped })] });
        onProgress("Submitting report\u2026", 40);

        if (result.addFeatureResults?.length > 0) {
            const r = result.addFeatureResults[0];
            if (r.error) { const msg = __tc(r.error.message, "submissionRejected"); this.setState({ submitting: false, submitResult: "error", submitMessage: msg, liveMessage: msg, submitPhase: "", submitProgress: 0 }); return; }
            // ── Upload attachments to enterprise FeatureServer (non-fatal) ──
            if (r.objectId != null && photoFiles.length > 0) {
                const total = photoFiles.length;
                for (let i = 0; i < total; i++) {
                    const file = photoFiles[i];
                    const label = total > 1 ? `Uploading photo ${i + 1} of ${total}\u2026` : "Uploading photo\u2026";
                    onProgress(label, 40 + (55 * i) / total);
                    const safeName = getSafeUploadName(file, PHOTO_ALLOWED_EXTS);
                    await this.uploadAttachment(ticketsLayer, r.objectId, file, safeName);
                    onProgress(label, 40 + (55 * (i + 1)) / total);
                }
            }
            onProgress("Finalizing\u2026", 95);
            const ticketNumber = r.objectId != null ? await this.queryTicketNumber(r.objectId) : null;
            onProgress("Finalizing\u2026", 100);
            this.onSubmitSuccess(ticketNumber);
        } else {
            this.setState({ submitting: false, submitResult: "error", submitMessage: "No result from server.", liveMessage: "No result from server.", submitPhase: "", submitProgress: 0 });
        }
    };

    onSubmitSuccess = (ticketNumber: number | null = null) => {
        clearWizardState(); // ticket submitted — no need to restore wizard state
        if (this.graphicRef && this.state.jmv?.view) {
            (this.state.jmv.view as __esri.MapView).graphics.remove(this.graphicRef);
            this.graphicRef = null;
            this.clearBoundaryOverlay();
        }

        if (ticketNumber != null) {
            try {
                const url = new URL(window.location.href);
                url.hash = "";
                url.searchParams.set("ticket_number", String(ticketNumber));
                window.history.replaceState(null, "", url.toString());
            } catch { }
        }

        this.setState({
            submitting: false, submitResult: "success",
            submitMessage: __tc(this.props.config?.successMessage, "thankYouYourConcernHasBeen"),
            submitPhase: "", submitProgress: 0,
            ticketNumber, form: { ...EMPTY_FORM }, mapPoint: null,
            photoFiles: [], photoPreviews: [], photoErrors: [],
            addressQuery: "", selectedAddress: "", addressResults: [], fieldErrors: {},
            geofence: { ...EMPTY_GEOFENCE }, lookupData: [], lookupLoaded: false,
            categoryGeofence: { ...EMPTY_CAT_GEOFENCE },
            urlCopied: false,
            liveMessage: ticketNumber != null ? `Report submitted. Your ticket number is ${ticketNumber}.` : "Report submitted.",
            statusViewTicket: null, statusViewError: "", statusViewLoading: false,
            statusViewComments: [], statusViewCommentsLoading: false,
            statusViewPhotos: [], statusViewPhotosLoading: false,
        });
        this.rootRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    /**
     * Upload a single file as an attachment to a FeatureServer feature.
     *
     * OWASP: the `safeName` parameter (UUID-based, generated by getSafeUploadName)
     * is used as the filename in the multipart POST, so the original user-supplied
     * filename is NEVER transmitted to the server.
     */
    uploadAttachmentREST = async (
        writeUrl: string,
        oid: number,
        file: File,
        safeName: string,
        isProxy: boolean = false,
    ): Promise<void> => {
        try {
            const fd = new FormData();
            fd.append("f", "json");
            // safeName replaces file.name — raw user filename never sent to server
            fd.append("attachment", file, safeName);

            let token = "";
            if (!isProxy) {
                token = getTokenFromIdentityManager();
                if (token) fd.append("token", token);
            }

            const attachUrl = `${writeUrl}/${oid}/addAttachment`;

            const resp = await fetch(attachUrl, {
                method: "POST",
                body: fd,
                credentials: isProxy ? "include" : "same-origin",
            });

            const json = await resp.json().catch(() => null);
            if (!json?.addAttachmentResult?.success) {
                console.warn("[RAC-ATT] FAILED — full response:", JSON.stringify(json));
            }
        } catch (err) {
            console.warn("[RAC-ATT] EXCEPTION in uploadAttachmentREST:", err);
        }
    };

    uploadAttachment = async (layer: __esri.FeatureLayer, oid: number, file: File, safeName: string) => {
        try {
            const fd = new FormData();
            const token = (layer as any).credential?.token || getTokenFromIdentityManager();
            fd.append("f", "json");
            fd.append("attachment", file, safeName);
            if (token) fd.append("token", token);

            const resp = await fetch(
                `${layer.url}/${layer.layerId}/addAttachment?objectId=${oid}`,
                { method: "POST", body: fd },
            );
            const json = await resp.json().catch(() => null);
            if (!json?.addAttachmentResult?.success) {
                console.warn("[RAC-ATT] layer path FAILED:", JSON.stringify(json));
            }
        } catch (err) {
            console.warn("[RAC-ATT] EXCEPTION in uploadAttachment:", err);
        }
    };

    onNewReport = () => {
        clearWizardState(); // user is explicitly starting fresh
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete("ticket_number");
            url.searchParams.delete("ticket");
            window.history.replaceState(null, "", url.toString());
        } catch { }

        if (this.statusHighlight) {
            try { this.statusHighlight.remove(); } catch { }
            this.statusHighlight = null;
        }
        try { (this.state.jmv?.view as any)?.closePopup?.(); } catch { }

        if (this.copyResetTimer) { clearTimeout(this.copyResetTimer); this.copyResetTimer = null; }

        this.setState({
            step: 0, form: { ...EMPTY_FORM }, mapPoint: null,
            photoFiles: [], photoPreviews: [], photoErrors: [],
            submitResult: "idle", submitMessage: "", submitPhase: "", submitProgress: 0, ticketNumber: null,
            urlCopied: false,
            addressQuery: "", selectedAddress: "", addressResults: [], fieldErrors: {},
            geofence: { ...EMPTY_GEOFENCE }, lookupData: [], lookupLoaded: false, lookupError: "",
            categoryGeofence: { ...EMPTY_CAT_GEOFENCE },
            statusViewTicket: null, statusViewError: "", statusViewLoading: false,
            statusViewComments: [], statusViewCommentsLoading: false,
            statusViewPhotos: [], statusViewPhotosLoading: false,
            pendingStatusTicketNumber: null,
        });
        this.rootRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    // ══════════════════════════════════════════════════════════
    //  COPY TICKET URL TO CLIPBOARD
    // ══════════════════════════════════════════════════════════

    copyTicketUrl = (url: string) => {
        const doSet = () => {
            this.setState({ urlCopied: true });
            this.announce(this.nls('ticketStatusLinkCopied'));
            if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
            this.copyResetTimer = setTimeout(() => {
                this.setState({ urlCopied: false });
                this.copyResetTimer = null;
            }, 2000);
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(url).then(doSet).catch(() => this.fallbackCopy(url, doSet));
        } else {
            this.fallbackCopy(url, doSet);
        }
    };

    private fallbackCopy = (text: string, onSuccess: () => void) => {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            onSuccess();
        } catch { }
    };

    // ══════════════════════════════════════════════════════════
    //  RENDER — STEPPER
    //  WCAG: aria-label on each step dot includes step number,
    //  label, and completion state for screen reader context.
    // ══════════════════════════════════════════════════════════

    renderStepper() {
        const S = this.getStyles();
        const { step } = this.state;
        return (
            <nav style={S.stepper} aria-label={this.nls('formProgress')}>
                {STEP_LABELS.map((label, i) => {
                    const done = i < step;
                    const active = i === step;
                    const stateLabel = done ? this.nls('completed') : active ? this.nls('currentStep') : "";
                    return (
                        <React.Fragment key={i}>
                            {i > 0 && <div style={S.stepLine(done)} aria-hidden="true" />}
                            <div style={S.stepCol}>
                                <div
                                    style={S.stepDot(active, done)}
                                    aria-current={active ? "step" : undefined}
                                    aria-label={this.nls('stepILabelStateLabel', { i: i + 1, label, stateLabel })}
                                    role="img"
                                >
                                    {done ? "\u2713" : i + 1}
                                </div>
                                <div style={S.stepLabel(active)} aria-hidden="true">{label}</div>
                            </div>
                        </React.Fragment>
                    );
                })}
            </nav>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — STEP 0: LOCATION
    //  WCAG changes:
    //  · label/htmlFor association on address search input
    //  · aria-expanded + aria-haspopup + aria-controls for
    //    combobox pattern on the geocoder input
    //  · aria-live="polite" wrapper around geofence status so
    //    screen readers announce changes without interrupting
    //  · role="alert" on the outside-boundary warning
    //  · aria-pressed on the Place Pin toggle button
    //  · aria-busy on the GPS button while locating
    //  · aria-label on the clear-address × button
    // ══════════════════════════════════════════════════════════

    renderStepLocation() {
        const cfg = this.props.config;
        const S = this.getStyles();
        const t = this.getTheme();
        const showGeo = cfg?.enableGeocoder !== false;
        const mobileMode = cfg?.mobileMode ?? false;
        const {
            placingPin, gpsLocating, mapPoint, selectedAddress,
            addressQuery, addressSearching, addressResults, addressError,
            fieldErrors, geofence,
        } = this.state;
        const canProceed = !!mapPoint && !geofence.checking && geofence.insideBoundary;
        const hasResults = addressResults.length > 0;

        // ── Shared keyframes + hover/focus styles ────────────────
        const sharedKeyframes = `
            @keyframes rac-spin { to { transform: rotate(360deg); } }
            @keyframes rac-ripple {
                0%   { transform: scale(1);   opacity: 0.5; }
                100% { transform: scale(2.2); opacity: 0;   }
            }
            #rac-gps-card:hover:not(:disabled),
            #rac-gps-card-mobile:hover:not(:disabled) {
                border-color: ${t.brand} !important;
                box-shadow: 0 6px 20px ${hexToLight(t.brand, 0.18)} !important;
                transform: translateY(-1px);
            }
            #rac-gps-card:active:not(:disabled),
            #rac-gps-card-mobile:active:not(:disabled) {
                transform: translateY(0);
                box-shadow: 0 2px 10px rgba(0,0,0,0.07) !important;
            }
            #rac-pin-btn:hover:not([aria-pressed="true"]) {
                border-color: ${t.brand} !important;
                box-shadow: 0 6px 20px rgba(0,0,0,0.10) !important;
                transform: translateY(-1px);
            }
            #rac-search-row:focus-within {
                border-color: ${t.brand} !important;
                box-shadow: 0 0 0 3px ${hexToLight(t.brand, 0.15)}, 0 2px 8px rgba(0,0,0,0.08) !important;
            }
            /* ── 2.4.7 Focus Visible ─────────────────────────── */
            #rac-gps-card:focus-visible,
            #rac-gps-card-mobile:focus-visible,
            #rac-pin-btn:focus-visible {
                outline: 3px solid ${t.brand} !important;
                outline-offset: 2px !important;
            }
            #rac-addr-results li:focus-visible {
                outline: 2px solid ${t.brand};
                outline-offset: -2px;
            }
            /* ── 2.3.3 Reduced motion ────────────────────────── */
            @media (prefers-reduced-motion: reduce) {
                *, *::before, *::after {
                    animation-duration: 0.01ms !important;
                    animation-iteration-count: 1 !important;
                    transition-duration: 0.01ms !important;
                }
            }
            /* ── iOS auto-zoom prevention ────────────────────── */
            /* iOS WebKit zooms the viewport on focus when font-size < 16px. */
            /* Setting 16px on touch devices prevents zoom without disabling  */
            /* user-scalable (which would violate WCAG 1.4.4 Resize Text).   */
            @media (hover: none) and (pointer: coarse) {
                input, select, textarea {
                    font-size: 16px !important;
                }
            }
        `;

        // ── GPS card — reused in both mobile and desktop ─────────
        const renderGpsCard = (id: string) => (
            <button
                id={id}
                onClick={this.useGPS}
                disabled={gpsLocating}
                aria-busy={gpsLocating}
                title={this.nls('useYourDeviceSGpsTo')}
                style={{
                    width: "100%",
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "15px 18px",
                    background: t.inputBg,
                    border: `1.5px solid ${gpsLocating ? t.brand : t.textMuted}`,
                    borderRadius: 14,
                    cursor: gpsLocating ? "default" : "pointer",
                    textAlign: "left",
                    transition: "border-color 0.15s, box-shadow 0.15s, transform 0.12s",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.07)",
                    fontFamily: t.fontFamily,
                    opacity: gpsLocating ? 0.8 : 1,
                }}
            >
                <div style={{
                    position: "relative", width: 46, height: 46, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: "50%", background: t.brandLight,
                }}>
                    {gpsLocating && (
                        <div style={{
                            position: "absolute", inset: 0, borderRadius: "50%",
                            border: `2px solid ${t.brand}`,
                            animation: "rac-ripple 1.1s ease-out infinite",
                        }} aria-hidden="true" />
                    )}
                    {gpsLocating ? (
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"
                            style={{ animation: "rac-spin 0.8s linear infinite" }}>
                            <circle cx="11" cy="11" r="9" stroke={t.brandBorder} strokeWidth="2.5" />
                            <path d="M11 2a9 9 0 0 1 9 9" stroke={t.brand} strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                    ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                            stroke={t.brand} strokeWidth="2" strokeLinecap="round"
                            strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="4" />
                            <line x1="12" y1="2" x2="12" y2="6" />
                            <line x1="12" y1="18" x2="12" y2="22" />
                            <line x1="2" y1="12" x2="6" y2="12" />
                            <line x1="18" y1="12" x2="22" y2="12" />
                        </svg>
                    )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: t.text, lineHeight: 1.2, marginBottom: 3 }}>
                        {gpsLocating ? this.nls('detectingLocation') : this.nls('useMyLocation')}
                    </div>
                    <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.3 }}>
                        {gpsLocating ? this.nls('pleaseWait') : this.nls('detectYourCurrentGpsPosition')}
                    </div>
                </div>
                {!gpsLocating && (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                        stroke={t.textMuted} strokeWidth="2" strokeLinecap="round"
                        strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                        <polyline points="6 3 11 8 6 13" />
                    </svg>
                )}
            </button>
        );

        return (
            <div>
                <style>{sharedKeyframes}</style>

                {/* Section heading */}
                <h2 style={{
                    fontSize: 17, fontWeight: 700, color: t.text,
                    margin: "0 0 20px 0", letterSpacing: -0.2, outline: "none",
                }} tabIndex={-1} data-rac-step-heading="true">
                    {this.nls('whereIsTheConcern')}
                </h2>

                {/* Location-level field error */}
                {fieldErrors.location && (
                    <div style={S.errorBox} role="alert">{fieldErrors.location}</div>
                )}

                {/* ── Address search ──────────────────────────── */}
                {showGeo && (
                    <div style={{ marginBottom: 14 }}>
                        <label style={S.label} htmlFor="rac-addr-search">
                            {this.nls('searchByAddress')}
                        </label>
                        {/* Pill search row */}
                        <div id="rac-search-row" style={S.searchRow}>
                            <div style={{ display: "flex", alignItems: "center", paddingLeft: 14, flexShrink: 0 }}
                                aria-hidden="true">
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                                    stroke={addressSearching ? t.brand : t.textMuted}
                                    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="11" cy="11" r="7" />
                                    <line x1="16.5" y1="16.5" x2="22" y2="22" />
                                </svg>
                            </div>
                            <input
                                id="rac-addr-search"
                                style={S.searchInput}
                                type="text"
                                placeholder={this.nls('typeAnAddress')}
                                value={addressQuery}
                                onChange={this.onAddressChange}
                                onKeyDown={this.onAddressKeyDown}
                                autoComplete="street-address"
                                role="combobox"
                                aria-expanded={hasResults}
                                aria-haspopup="listbox"
                                aria-controls={hasResults ? "rac-addr-results" : undefined}
                                aria-autocomplete="list"
                                aria-label={this.nls('searchByStreetAddress')}
                                maxLength={200}
                            />
                            <button
                                style={S.searchBtn}
                                onClick={this.searchAddress}
                                disabled={addressSearching || (addressQuery?.trim()?.length || 0) < 3}
                                aria-busy={addressSearching}
                                title={this.nls('searchForThisAddress')}
                                aria-label={this.nls('searchForThisAddress')}
                            >
                                {addressSearching ? (
                                    <svg width="14" height="14" viewBox="0 0 22 22" fill="none"
                                        aria-hidden="true"
                                        style={{ animation: "rac-spin 0.8s linear infinite", display: "block" }}>
                                        <circle cx="11" cy="11" r="9" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" />
                                        <path d="M11 2a9 9 0 0 1 9 9" stroke={t.brandText} strokeWidth="2.5" strokeLinecap="round" />
                                    </svg>
                                ) : this.nls('search')}
                            </button>
                        </div>

                        {/* Address suggestions dropdown */}
                        {hasResults && (
                            <ul
                                id="rac-addr-results"
                                style={S.resultsList}
                                role="listbox"
                                aria-label={this.nls('addressSuggestions')}
                            >
                                {addressResults.map((r, i) => (
                                    <li
                                        key={i}
                                        style={S.resultItem}
                                        role="option"
                                        aria-selected="false"
                                        tabIndex={0}
                                        onClick={() => this.selectAddress(r)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.selectAddress(r); }
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = S.resultItemHoverBg;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = t.inputBg;
                                        }}
                                        onFocus={(e) => {
                                            e.currentTarget.style.background = S.resultItemHoverBg;
                                        }}
                                        onBlur={(e) => {
                                            e.currentTarget.style.background = t.inputBg;
                                        }}
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                            stroke={t.textMuted} strokeWidth="2" strokeLinecap="round"
                                            strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                                            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
                                            <circle cx="12" cy="10" r="3" />
                                        </svg>
                                        {r.address}
                                    </li>
                                ))}
                            </ul>
                        )}

                        {addressError && (
                            <div style={{ fontSize: 12, color: t.error, marginBottom: 8 }} role="alert">
                                {addressError}
                            </div>
                        )}
                    </div>
                )}

                {/* Selected address chip */}
                {selectedAddress && (
                    <div style={S.selectedAddr}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                stroke={t.brand} strokeWidth="2.2" strokeLinecap="round"
                                strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
                                <circle cx="12" cy="10" r="3" />
                            </svg>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {selectedAddress}
                            </span>
                        </div>
                        <button
                            onClick={this.clearAddress}
                            style={{
                                background: "none", border: "none", cursor: "pointer",
                                color: t.brand, fontWeight: 700, fontSize: 18,
                                padding: "0 0 0 10px", lineHeight: 1, flexShrink: 0,
                            }}
                            aria-label={this.nls('clearSelectedAddress')}
                            title={this.nls('clearSelectedAddress')}
                        >
                            &times;
                        </button>
                    </div>
                )}

                {/* Divider */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
                    <div style={{ flex: 1, height: 1, background: t.divider }} />
                    <span style={{
                        fontSize: 11, fontWeight: 700, color: t.textMuted,
                        letterSpacing: "0.1em", textTransform: "uppercase",
                    }}>{this.nls('orUseTheMap')}</span>
                    <div style={{ flex: 1, height: 1, background: t.divider }} />
                </div>

                {/* ── Map tools ────────────────────────────────── */}
                {mobileMode ? (
                    renderGpsCard("rac-gps-card-mobile")
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* Place Pin card */}
                        <button
                            id="rac-pin-btn"
                            style={{
                                width: "100%",
                                display: "flex", alignItems: "center", gap: 14,
                                padding: "15px 18px",
                                background: placingPin ? t.brandLight : t.inputBg,
                                border: placingPin ? `1.5px solid ${t.brand}` : `1.5px solid ${t.textMuted}`,
                                borderRadius: 14,
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "border-color 0.15s, box-shadow 0.15s, transform 0.12s",
                                boxShadow: placingPin
                                    ? `0 0 0 3px ${hexToLight(t.brand, 0.15)}`
                                    : "0 2px 10px rgba(0,0,0,0.07)",
                                fontFamily: t.fontFamily,
                            }}
                            onClick={this.togglePlacePin}
                            aria-pressed={placingPin}
                            title={placingPin ? this.nls('clickToCancelPinPlacement') : this.nls('clickThenClickTheMapTo')}
                        >
                            <div style={{
                                width: 46, height: 46, flexShrink: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                borderRadius: "50%",
                                background: placingPin ? t.brand : t.brandLight,
                            }}>
                                {placingPin ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                        stroke={t.brandText} strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                                        stroke={t.brand} strokeWidth="2" strokeLinecap="round"
                                        strokeLinejoin="round" aria-hidden="true">
                                        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
                                        <circle cx="12" cy="10" r="3" />
                                    </svg>
                                )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: 15, fontWeight: 700,
                                    color: placingPin ? t.brand : t.text,
                                    lineHeight: 1.2, marginBottom: 3,
                                }}>
                                    {placingPin ? this.nls('cancelPinPlacement') : this.nls('placePinOnMap')}
                                </div>
                                <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.3 }}>
                                    {placingPin
                                        ? this.nls('clickAnywhereOnTheMapTo')
                                        : this.nls('clickTheMapToMarkThe')}
                                </div>
                            </div>
                            {!placingPin && (
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                                    stroke={t.textMuted} strokeWidth="2" strokeLinecap="round"
                                    strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                                    <polyline points="6 3 11 8 6 13" />
                                </svg>
                            )}
                        </button>

                        {renderGpsCard("rac-gps-card")}
                    </div>
                )}

                {/* Geofence status */}
                <div aria-live="polite" aria-atomic="true" style={{ marginTop: 14 }}>
                    {mapPoint && geofence.checking && (
                        <div style={S.gfChecking}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <svg width="14" height="14" viewBox="0 0 22 22" fill="none"
                                    aria-hidden="true"
                                    style={{ animation: "rac-spin 0.8s linear infinite", flexShrink: 0 }}>
                                    <circle cx="11" cy="11" r="9" stroke={hexToLight(t.brand, 0.3)} strokeWidth="2.5" />
                                    <path d="M11 2a9 9 0 0 1 9 9" stroke={t.brand} strokeWidth="2.5" strokeLinecap="round" />
                                </svg>
                                {this.nls('checkingServiceArea')}
                            </div>
                        </div>
                    )}

                    {mapPoint && !geofence.checking && geofence.insideBoundary && (
                        <div style={S.coordBox}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                    stroke={t.success} strokeWidth="2.5" strokeLinecap="round"
                                    strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>{this.nls('locationConfirmed')}</span>
                            </div>
                            {geofence.matchedBoundaries.length > 0 && (
                                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5, color: t.success, paddingLeft: 23 }}>
                                    {this.nls('serviceAreaJoin', { join: geofence.matchedBoundaries.join(", ") })}
                                </div>
                            )}
                            {geofence.matchedBoundaryIds.length > 0 && this.isCategoryFilteringActive() && (
                                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 3, color: t.textMuted, paddingLeft: 23 }}>
                                    {this.nls('categoriesWillBeFilteredForThis')}
                                </div>
                            )}
                        </div>
                    )}

                    {mapPoint && !geofence.checking && !geofence.insideBoundary && (
                        <div style={S.gfOutside} role="alert">
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                    stroke={t.error} strokeWidth="2.2" strokeLinecap="round"
                                    strokeLinejoin="round" aria-hidden="true"
                                    style={{ flexShrink: 0, marginTop: 1 }}>
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                <span>{cfg?.outsideBoundaryMessage || this.nls('thisLocationIsOutsideTheService')}</span>
                            </div>
                            <button onClick={this.resetLocation} style={S.gfResetBtn}>
                                &larr; Try a Different Location
                            </button>
                        </div>
                    )}
                </div>

                {/* Hint text */}
                {!mapPoint && !placingPin && (
                    <p style={{ fontSize: 12, color: t.textMuted, marginTop: 10, marginBottom: 0 }}>
                        {mobileMode
                            ? this.nls('searchAnAddressOrTapUse')
                            : this.nls('searchAnAddressDropAPin')}
                    </p>
                )}

                {/* Next button — full width */}
                <div style={{ marginTop: 24 }}>
                    <button
                        style={{ ...S.btnPrimary(!canProceed), width: "100%" }}
                        onClick={this.nextStep}
                        disabled={!canProceed}
                        aria-disabled={!canProceed}
                    >
                        {this.nls('nextDetailsRarr')}
                    </button>
                </div>
            </div>
        );
    }

    renderStepDetails() {
        const S = this.getStyles();
        const t = this.getTheme();
        const {
            form, fieldErrors, photoPreviews, photoErrors,
            lookupLoading, lookupError, categoryGeofence,
        } = this.state;

        const subcats = this.getSubcategories();
        const filteredCats = this.getFilteredCategories();
        const filtering = this.isCategoryFilteringActive();
        const selectedCatInfo = filteredCats.find((c) => c.code === form.category);

        // Primary: lookup table says this category is blocked here.
        const showRedirect = filtering && !!selectedCatInfo && !selectedCatInfo.isValid;

        // Fallback: hardcoded CATEGORY_BOUNDARY_MAP check via checkCategoryGeofence().
        // Only active when the lookup table URL is NOT configured (filtering=false).
        // When the lookup table IS configured, showRedirect is the authoritative path.
        const catGeoChecking = !filtering && form.category != null && categoryGeofence.checking;
        const catGeoBlocked = !filtering && form.category != null && !categoryGeofence.checking && categoryGeofence.valid === false;

        // True when any blocking condition prevents the user advancing.
        const disableSection = showRedirect || catGeoBlocked;
        const isNextBlocked = showRedirect || catGeoBlocked || catGeoChecking;

        return (
            <div>
                <h2 style={S.sectionTitle} tabIndex={-1} data-rac-step-heading="true">{this.nls('whatSTheConcern')}</h2>

                {/* Lookup error (non-fatal — categories still shown unfiltered) */}
                {lookupError && (
                    <div style={S.warningBox} role="alert">&#9888; {lookupError}</div>
                )}

                {/* ── Category ───────────────────────────────────────── */}
                <label style={S.label} htmlFor="rac-category">
                    {this.nls('category')}
                    <span style={S.required} aria-hidden="true">*</span>
                </label>

                {lookupLoading ? (
                    <div style={{ ...S.gfChecking, marginBottom: 12 }} aria-live="polite">
                        {this.nls('loadingAvailableCategories')}
                    </div>
                ) : (
                    <React.Fragment>
                        <select
                            id="rac-category"
                            style={S.select(!!fieldErrors.category)}
                            value={form.category ?? ""}
                            onChange={(e) =>
                                this.onFieldChange("category", e.target.value ? parseInt(e.target.value, 10) : null)
                            }
                            aria-required="true"
                            aria-invalid={!!fieldErrors.category}
                            aria-describedby={fieldErrors.category ? "rac-category-err" : undefined}
                        >
                            <option value="">{this.nls('selectACategory')}</option>
                            {filteredCats.map((cat) => (
                                <option key={cat.code} value={cat.code}>{cat.name}</option>
                            ))}
                        </select>

                        {/* Primary: lookup table redirect message */}
                        {showRedirect && selectedCatInfo?.redirectMessage && (
                            <div style={S.redirectMsg} role="alert">
                                &#9888; {linkifyPhones(selectedCatInfo.redirectMessage, S.phoneLink)}
                            </div>
                        )}

                        {/* Fallback: CATEGORY_BOUNDARY_MAP boundary check — shown when
                            catGeoBlocked is true. Complements the lookup table; fires
                            even when the lookup table is configured but has incomplete
                            rows for this category+boundary combination. */}
                        <div aria-live="polite" aria-atomic="true">
                            {catGeoChecking && (
                                <div style={S.gfChecking}>
                                    {__t("checkingAvailabilityForThisLocation")}
                                </div>
                            )}
                            {catGeoBlocked && (
                                <div style={S.gfOutside} role="alert">
                                    {__t("thisCategoryIsNotAvailableFor2")}
                                </div>
                            )}
                        </div>
                    </React.Fragment>
                )}

                {/* Category validation error */}
                {fieldErrors.category && (
                    <div id="rac-category-err" style={S.fieldError} role="alert">
                        {fieldErrors.category}
                    </div>
                )}

                {/* Category count hint */}
                {filtering && !lookupLoading && (
                    <div style={{ fontSize: 11, color: t.textMuted, marginTop: -6, marginBottom: 10 }}>
                        {filteredCats.filter((c) => c.isValid).length} {this.nls('ofFilteredCatsCountCategoriesAvailableForThis', { filteredCatsCount: filteredCats.length })}
                    </div>
                )}

                {/* ── Remaining fields — disabled/hidden when category is blocked ── */}
                {/*
                    aria-hidden removes the disabled section from the accessibility tree
                    entirely, preventing screen readers from landing on inactive controls.
                    The visual disabledSection style (opacity + pointer-events) covers
                    sighted users.
                */}
                <div
                    style={disableSection ? S.disabledSection : undefined}
                    aria-hidden={disableSection ? "true" : undefined}
                >
                    {/* ── Subcategory ──────────────────────────────────── */}
                    {subcats.length > 0 && (
                        <div>
                            <label style={S.label} htmlFor="rac-subcategory">
                                {this.nls('subcategory')}
                                <span style={S.required} aria-hidden="true">*</span>
                            </label>
                            <select
                                id="rac-subcategory"
                                style={S.select(!!fieldErrors.subcategory)}
                                value={form.subcategory}
                                onChange={(e) => this.onFieldChange("subcategory", e.target.value)}
                                disabled={disableSection}
                                aria-required="true"
                                aria-invalid={!!fieldErrors.subcategory}
                                aria-describedby={fieldErrors.subcategory ? "rac-subcategory-err" : undefined}
                            >
                                <option value="">{this.nls('select')}</option>
                                {subcats.map((sc) => (
                                    <option key={sc.code} value={sc.code}>{sc.name}</option>
                                ))}
                            </select>
                            {fieldErrors.subcategory && (
                                <div id="rac-subcategory-err" style={S.fieldError} role="alert">
                                    {fieldErrors.subcategory}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Critical-issue alert (soft warn) ──────────── */}
                    {this.renderCriticalAlertBanner("details")}

                    {/* ── Description ─────────────────────────────────── */}
                    <label style={S.label} htmlFor="rac-description">
                        {this.nls('description')}
                        <span style={S.required} aria-hidden="true">*</span>
                    </label>
                    <textarea
                        id="rac-description"
                        style={S.textarea(!!fieldErrors.description)}
                        value={form.description}
                        onChange={(e) => this.onFieldChange("description", e.target.value)}
                        placeholder={this.nls('describeTheConcernInDetail')}
                        maxLength={500}
                        disabled={disableSection}
                        aria-required="true"
                        aria-invalid={!!fieldErrors.description}
                        aria-describedby={fieldErrors.description ? "rac-description-err" : "rac-desc-hint"}
                    />
                    {fieldErrors.description ? (
                        <div id="rac-description-err" style={S.fieldError} role="alert">
                            {fieldErrors.description}
                        </div>
                    ) : (
                        // aria-live="polite" so the char count announces on change
                        // without being too noisy (uses polite, not assertive).
                        <div id="rac-desc-hint" style={S.hint} aria-live="polite">
                            {form.description.length}/500
                        </div>
                    )}

                    {/* ── Photos ──────────────────────────────────────── */}
                    <div style={{ marginTop: 8, marginBottom: 14 }}>
                        <div id="rac-photos-label" style={S.label}>
                            {this.nls('photosOptionalUpToMaxPhotos', { MAX_PHOTOS })}
                        </div>

                        {/* 3-slot thumbnail grid */}
                        <div style={S.mediaGrid} role="group" aria-labelledby="rac-photos-label">
                            {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
                                const filled = !!photoPreviews[i];
                                const slotErr = photoErrors[i] || "";
                                const inputId = this.nls('racPhotoI', { i });
                                const dragOver = this.state.dragOverPhotoSlot === i;
                                const isDesktop = typeof window !== "undefined" &&
                                    !!window.matchMedia?.(this.nls('hoverHoverAndPointerFine')).matches;
                                return (
                                    <div
                                        key={i}
                                        style={S.photoSlot(filled, !!slotErr, dragOver)}
                                        onDragOver={(e) => !disableSection && this.onPhotoSlotDragOver(i, e)}
                                        onDragLeave={(e) => this.onPhotoSlotDragLeave(i, e)}
                                        onDrop={(e) => !disableSection && this.onPhotoSlotDrop(i, e)}
                                    >
                                        {filled ? (
                                            <>
                                                <img
                                                    src={photoPreviews[i]}
                                                    alt={this.nls('photoIPreview', { i: i + 1 })}
                                                    style={S.photoSlotImg}
                                                />
                                                <button
                                                    style={S.photoSlotRemove}
                                                    onClick={() => this.onPhotoRemove(i)}
                                                    aria-label={this.nls('removePhotoI', { i: i + 1 })}
                                                    title={this.nls('removePhotoI', { i: i + 1 })}
                                                    disabled={disableSection}
                                                >
                                                    ×
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <label
                                                    htmlFor={inputId}
                                                    style={{
                                                        ...S.photoSlotAdd,
                                                        cursor: disableSection ? "not-allowed" : "pointer",
                                                        opacity: disableSection ? 0.4 : 1,
                                                    }}
                                                    aria-label={this.nls('addPhotoIFromLibrary', { i: i + 1 })}
                                                >
                                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                                                        stroke="currentColor" strokeWidth="1.8"
                                                        strokeLinecap="round" strokeLinejoin="round"
                                                        aria-hidden="true">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                                        <polyline points="21 15 16 10 5 21" />
                                                    </svg>
                                                    <span>{dragOver ? this.nls('dropPhoto') : this.nls('addPhoto')}</span>
                                                    {isDesktop && !dragOver && (
                                                        <span style={{ fontSize: 10, color: t.textMuted, fontWeight: 500 }}>
                                                            {this.nls('orDragDrop')}
                                                        </span>
                                                    )}
                                                </label>
                                                {/* Gallery picker input */}
                                                <input
                                                    id={inputId}
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => this.onPhotoAdd(i, e)}
                                                    disabled={disableSection}
                                                    style={VISUALLY_HIDDEN}
                                                    aria-label={this.nls('addPhotoIFromLibrary', { i: i + 1 })}
                                                />
                                                {/* Camera button — touch devices only.
                                                    Uses capture="environment" to launch
                                                    the camera directly, bypassing the
                                                    Android photo picker which hides the
                                                    camera option behind a "..." menu. */}
                                                {!isDesktop && (
                                                    <>
                                                        <label
                                                            htmlFor={`${inputId}-cam`}
                                                            style={{
                                                                ...S.photoSlotCamera,
                                                                opacity: disableSection ? 0.4 : 1,
                                                                cursor: disableSection ? "not-allowed" : "pointer",
                                                            }}
                                                            aria-label={this.nls('takePhotoIWithCamera', { i: i + 1 })}
                                                        >
                                                            {/* Camera icon */}
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                                stroke="currentColor" strokeWidth="2"
                                                                strokeLinecap="round" strokeLinejoin="round"
                                                                aria-hidden="true">
                                                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                                                <circle cx="12" cy="13" r="4" />
                                                            </svg>
                                                        </label>
                                                        <input
                                                            id={`${inputId}-cam`}
                                                            type="file"
                                                            accept="image/*"
                                                            capture="environment"
                                                            onChange={(e) => this.onPhotoAdd(i, e)}
                                                            disabled={disableSection}
                                                            style={VISUALLY_HIDDEN}
                                                            aria-label={this.nls('takePhotoIWithCamera', { i: i + 1 })}
                                                        />
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Per-slot errors */}
                        {photoErrors.map((err, i) => err ? (
                            <div key={i} style={S.fieldError} role="alert">{err}</div>
                        ) : null)}

                        <div style={{ ...S.hint, marginTop: 4 }}>
                            {this.nls('jpegPngWebPOrHeicMax', { MAX_PHOTO_SIZE_MB })}
                        </div>
                    </div>
                </div>

                {/* ── Navigation ──────────────────────────────────────── */}
                <div style={S.navRow}>
                    <button style={S.btnSecondary} onClick={this.prevStep}>
                        &larr; Location
                    </button>
                    <button
                        style={S.btnPrimary(isNextBlocked)}
                        onClick={this.nextStep}
                        disabled={isNextBlocked}
                        aria-disabled={isNextBlocked}
                    >
                        {this.nls('nextContactRarr')}
                    </button>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — STEP 2: CONTACT
    //  WCAG changes:
    //  · label/htmlFor on all inputs
    //  · aria-required on name and email
    //  · aria-invalid when field has an error
    //  · aria-describedby wiring each input to its error or hint
    //  · id on all error and hint elements
    //  · role="alert" on all error divs
    //  · autoComplete attributes (WCAG 1.3.5 — Identify Input Purpose)
    // ══════════════════════════════════════════════════════════

    renderStepContact() {
        const S = this.getStyles();
        const { form, fieldErrors } = this.state;

        return (
            <div>
                <h2 style={S.sectionTitle} tabIndex={-1} data-rac-step-heading="true">{this.nls('howCanWeReachYou')}</h2>

                {/* ── Name ──────────────────────────────────────────── */}
                <label style={S.label} htmlFor="rac-name">
                    {this.nls('name')}
                    <span style={S.required} aria-hidden="true">*</span>
                </label>
                <input
                    id="rac-name"
                    style={S.input(!!fieldErrors.submitted_by_name)}
                    type="text"
                    value={form.submitted_by_name}
                    onChange={(e) => this.onFieldChange("submitted_by_name", e.target.value)}
                    placeholder={this.nls('yourFullName')}
                    maxLength={150}
                    autoComplete="name"
                    aria-required="true"
                    aria-invalid={!!fieldErrors.submitted_by_name}
                    aria-describedby={fieldErrors.submitted_by_name ? "rac-name-err" : undefined}
                />
                {fieldErrors.submitted_by_name && (
                    <div id="rac-name-err" style={S.fieldError} role="alert">
                        {fieldErrors.submitted_by_name}
                    </div>
                )}

                {/* ── Email ─────────────────────────────────────────── */}
                <label style={S.label} htmlFor="rac-email">
                    {this.nls('email')}
                    <span style={S.required} aria-hidden="true">*</span>
                </label>
                <input
                    id="rac-email"
                    style={S.input(!!fieldErrors.submitted_by_email)}
                    type="email"
                    value={form.submitted_by_email}
                    onChange={(e) => this.onFieldChange("submitted_by_email", e.target.value)}
                    placeholder="name@youremail.com"
                    maxLength={150}
                    autoComplete="email"
                    aria-required="true"
                    aria-invalid={!!fieldErrors.submitted_by_email}
                    aria-describedby={
                        fieldErrors.submitted_by_email ? "rac-email-err" : "rac-email-hint"
                    }
                />
                {fieldErrors.submitted_by_email ? (
                    <div id="rac-email-err" style={S.fieldError} role="alert">
                        {fieldErrors.submitted_by_email}
                    </div>
                ) : (
                    <div id="rac-email-hint" style={S.hint}>
                        {this.nls('usedForStatusUpdates')}
                    </div>
                )}

                {/* ── Phone ─────────────────────────────────────────── */}
                <label style={S.label} htmlFor="rac-phone">
                    {this.nls('phoneOptional')}
                </label>
                <input
                    id="rac-phone"
                    style={S.input(!!fieldErrors.submitted_by_phone)}
                    type="tel"
                    value={form.submitted_by_phone}
                    onChange={(e) => this.onFieldChange("submitted_by_phone", e.target.value)}
                    placeholder="(970) 555-0123"
                    maxLength={14}
                    autoComplete="tel"
                    inputMode="tel"
                    aria-invalid={!!fieldErrors.submitted_by_phone}
                    aria-describedby={
                        fieldErrors.submitted_by_phone ? "rac-phone-err" : "rac-phone-hint"
                    }
                />
                {fieldErrors.submitted_by_phone ? (
                    <div id="rac-phone-err" style={S.fieldError} role="alert">
                        {fieldErrors.submitted_by_phone}
                    </div>
                ) : (
                    <div id="rac-phone-hint" style={S.hint}>
                        {this.nls('_10DigitUsNumberEG')}
                    </div>
                )}

                <div style={S.navRow}>
                    <button style={S.btnSecondary} onClick={this.prevStep}>&larr; Details</button>
                    <button style={S.btnPrimary(false)} onClick={this.nextStep}>{this.nls('reviewRarr')}</button>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — STEP 3: REVIEW
    //  WCAG changes:
    //  · role="alert" on the submit error message
    //  · role="region" + aria-label on each review card
    //  · aria-busy on submit button while request is in flight
    // ══════════════════════════════════════════════════════════

    renderStepReview() {
        const S = this.getStyles();
        const t = this.getTheme();
        const {
            form, selectedAddress, mapPoint,
            submitResult, submitMessage, geofence,
        } = this.state;

        return (
            <div>
                <h2 style={S.sectionTitle} tabIndex={-1} data-rac-step-heading="true">{this.nls('reviewYourReport')}</h2>

                {/* Submit error — role="alert" ensures immediate announcement */}
                {submitResult === "error" && submitMessage && (
                    <div style={S.errorBox} role="alert">{submitMessage}</div>
                )}

                {/* ── Critical-issue alert (soft warn) ──────────────── */}
                {this.renderCriticalAlertBanner("review")}

                {/* ── Location card ──────────────────────────────────── */}
                <div style={S.reviewCard} role="region" aria-label={this.nls('locationSummary')}>
                    <div style={S.reviewLabel}>{this.nls('location')}</div>
                    <div style={S.reviewValue}>
                        {selectedAddress || (mapPoint
                            ? `${mapPoint.latitude?.toFixed(6) ?? mapPoint.y?.toFixed(2)}, ${mapPoint.longitude?.toFixed(6) ?? mapPoint.x?.toFixed(2)}`
                            : this.nls('notSet'))}
                    </div>
                    {geofence.matchedBoundaries.length > 0 && (
                        <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>
                            {this.nls('serviceAreaJoin', { join: geofence.matchedBoundaries.join(", ") })}
                        </div>
                    )}
                    <button
                        style={S.reviewEdit}
                        onClick={() => this.goToStep(0)}
                        aria-label={this.nls('editLocationReturnToStep1')}
                    >
                        {this.nls('editLocation')}
                    </button>
                </div>

                {/* ── Concern details card ───────────────────────────── */}
                <div style={S.reviewCard} role="region" aria-label={this.nls('concernDetailsSummary')}>
                    <div style={S.reviewLabel}>{this.nls('concern')}</div>
                    <div style={S.reviewValue}>
                        <strong>{this.getCategoryName()}</strong>
                        {form.subcategory && <span> &rsaquo; {this.getSubcategoryName()}</span>}
                    </div>
                    <div style={{ ...S.reviewValue, marginTop: 6, color: t.textLight }}>
                        {form.description || "—"}
                    </div>
                    {/* Media count badge */}
                    {this.state.photoFiles.filter(Boolean).length > 0 && (
                        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" as const }}>
                            {this.state.photoFiles.filter(Boolean).length > 0 && (
                                <span style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    fontSize: 11, fontWeight: 700, color: t.brand,
                                    background: t.brandLight, border: `1px solid ${t.brandBorder}`,
                                    borderRadius: 20, padding: "3px 10px",
                                }}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth="2.2"
                                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                                    </svg>
                                    {(this.state.photoFiles.filter(Boolean).length > 1 ? this.nls('filterCountPhotos', { filterCount: this.state.photoFiles.filter(Boolean).length }) : this.nls('filterCountPhoto', { filterCount: this.state.photoFiles.filter(Boolean).length }))}
                                </span>
                            )}
                        </div>
                    )}
                    <button
                        style={S.reviewEdit}
                        onClick={() => this.goToStep(1)}
                        aria-label={this.nls('editDetailsReturnToStep2')}
                    >
                        {this.nls('editDetails')}
                    </button>
                </div>

                {/* ── Contact card ───────────────────────────────────── */}
                <div style={S.reviewCard} role="region" aria-label={this.nls('contactInformationSummary')}>
                    <div style={S.reviewLabel}>{this.nls('contact')}</div>
                    <div style={S.reviewValue}>{form.submitted_by_name || "—"}</div>
                    <div style={{ ...S.reviewValue, color: t.textLight }}>{form.submitted_by_email}</div>
                    {form.submitted_by_phone && (
                        <div style={{ ...S.reviewValue, color: t.textLight }}>{form.submitted_by_phone}</div>
                    )}
                    <button
                        style={S.reviewEdit}
                        onClick={() => this.goToStep(2)}
                        aria-label={this.nls('editContactReturnToStep3')}
                    >
                        {this.nls('editContact')}
                    </button>
                </div>

                <div style={S.navRow}>
                    <button style={S.btnSecondary} onClick={this.prevStep}>&larr; Contact</button>
                    <button
                        style={S.btnPrimary(false)}
                        onClick={this.onSubmit}
                    >
                        {this.props.config?.submitButtonLabel || this.nls('submitReport')}
                    </button>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — SUCCESS
    //  WCAG: role="status" (polite announcement, not urgent alert)
    // ══════════════════════════════════════════════════════════

    renderSuccess() {
        const S = this.getStyles();
        const t = this.getTheme();
        const { ticketNumber, submitMessage, urlCopied } = this.state;

        let confirmUrl = "";
        try {
            const url = new URL(window.location.href);
            url.hash = "";
            if (ticketNumber != null) url.searchParams.set("ticket_number", String(ticketNumber));
            confirmUrl = url.toString();
        } catch { }

        return (
            <div style={S.successBox} role="status">
                <div style={{ fontSize: 52, marginBottom: 12, color: t.success }} aria-hidden="true">
                    &#10003;
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: ticketNumber != null ? 8 : 16, color: t.success }}>
                    {this.nls('reportSubmitted')}
                </div>

                {ticketNumber != null && (
                    <div
                        style={{
                            display: "inline-block", fontSize: 28, fontWeight: 800,
                            color: t.brand, background: t.brandLight,
                            border: `2px solid ${t.brandBorder}`, borderRadius: 10,
                            padding: "10px 28px", marginBottom: 16, letterSpacing: 1,
                        }}
                        aria-label={this.nls('yourTicketNumberIsTicketNumber', { ticketNumber })}
                    >
                        #{ticketNumber}
                    </div>
                )}

                <div style={{ fontSize: 14, color: t.text, marginBottom: confirmUrl ? 16 : 24, lineHeight: 1.5 }}>
                    {submitMessage}
                </div>

                {/* Ticket status URL with one-click copy */}
                {confirmUrl && ticketNumber != null && (
                    <div style={{ marginBottom: 24, textAlign: "left" as const }}>
                        <div style={{
                            fontSize: 11, fontWeight: 700, color: t.textLight,
                            textTransform: "uppercase" as const, letterSpacing: 0.4, marginBottom: 6,
                        }}>
                            {this.nls('bookmarkOrCopyYourTicketStatus')}
                        </div>
                        <div style={S.copyRow}>
                            <input
                                readOnly
                                type="text"
                                value={confirmUrl}
                                style={S.copyUrl}
                                aria-label={this.nls('ticketStatusUrl')}
                                onFocus={(e) => e.currentTarget.select()}
                            />
                            <button
                                style={S.copyBtn(urlCopied)}
                                onClick={() => this.copyTicketUrl(confirmUrl)}
                                aria-label={urlCopied ? this.nls('linkCopiedToClipboard') : this.nls('copyTicketStatusLinkToClipboard')}
                                title={urlCopied ? this.nls('copied') : this.nls('copyLink')}
                            >
                                {urlCopied ? this.nls('copied2') : this.nls('copy')}
                            </button>
                        </div>
                    </div>
                )}

                <button
                    onClick={this.onNewReport}
                    style={{ ...S.btnPrimary(false), width: "auto", padding: "12px 36px", fontSize: 14 } as any}
                >
                    {this.nls('submitAnotherReport')}
                </button>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — TICKET STATUS VIEW
    //  WCAG: role="region" + aria-label on each detail card.
    // ══════════════════════════════════════════════════════════

    renderTicketStatus() {
        const S = this.getStyles();
        const t = this.getTheme();
        const { statusViewTicket, statusViewError, statusViewComments, statusViewCommentsLoading, statusViewPhotos, statusViewPhotosLoading } = this.state;

        if (statusViewError && !statusViewTicket) {
            return (
                <div style={{ paddingTop: 8 }}>
                    <div style={S.errorBox} role="alert">{statusViewError}</div>
                    <div style={S.navRow}>
                        <button style={S.btnPrimary(false)} onClick={this.onNewReport}>{this.nls('submitAReport')}</button>
                    </div>
                </div>
            );
        }

        if (!statusViewTicket) return null;

        const tk = statusViewTicket;
        const statusLabel = STATUS_LABELS[tk.status ?? 0] || __t("statusStatus", { status: tk.status });
        const priorityLabel = PRIORITY_LABELS[tk.priority ?? 0] || __t("priorityPriority", { priority: tk.priority });
        const categoryName = this.state.subtypes.find((s) => s.code === tk.category)?.name
            || (tk.category != null ? `Category ${tk.category}` : "—");
        const subcategoryName = tk.subcategory
            ? this.getSubcategoryNameFor(tk.category, tk.subcategory)
            : null;
        const submittedDate = tk.created_date
            ? new Date(tk.created_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
            : "—";

        const isResolved = tk.status === 4 || tk.status === 5;
        const statusColor = isResolved ? t.success : t.brand;
        const statusBg = isResolved ? t.successBg : t.brandLight;
        const statusBorder = isResolved ? t.successBorder : t.brandBorder;

        return (
            <div>
                <div style={S.sectionTitle}>{this.nls('ticketStatus')}</div>

                {/* Ticket number badge */}
                <div style={{ textAlign: "center", marginBottom: 16 }}>
                    <div
                        style={{ display: "inline-block", fontSize: 28, fontWeight: 800, color: t.brand, background: t.brandLight, border: `2px solid ${t.brandBorder}`, borderRadius: 10, padding: "10px 28px", letterSpacing: 1 }}
                        aria-label={this.nls('ticketNumberTicketNumber', { ticket_number: tk.ticket_number })}
                    >
                        #{tk.ticket_number}
                    </div>
                </div>

                {/* Status badge */}
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                    <span
                        style={{ display: "inline-block", padding: "6px 24px", borderRadius: 20, fontSize: 14, fontWeight: 700, background: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }}
                        aria-label={this.nls('ticketStatusStatusLabel', { statusLabel })}
                    >
                        {statusLabel}
                    </span>
                </div>

                {/* Location */}
                {tk.address_submitted && (
                    <div style={S.reviewCard} role="region" aria-label={this.nls('ticketLocation')}>
                        <div style={S.reviewLabel}>{this.nls('location')}</div>
                        <div style={S.reviewValue}>{tk.address_submitted}</div>
                    </div>
                )}

                {/* Category */}
                <div style={S.reviewCard} role="region" aria-label={this.nls('ticketCategory')}>
                    <div style={S.reviewLabel}>{this.nls('category')}</div>
                    <div style={S.reviewValue}>
                        <strong>{categoryName}</strong>
                        {subcategoryName && (
                            <span style={{ color: t.textLight }}> &rsaquo; {subcategoryName}</span>
                        )}
                    </div>
                </div>

                {/* Description */}
                <div style={S.reviewCard} role="region" aria-label={this.nls('ticketDescription')}>
                    <div style={S.reviewLabel}>{this.nls('description')}</div>
                    <div style={S.reviewValue}>{tk.description || "—"}</div>
                </div>

                {/* Priority + Date */}
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                    <div style={{ ...S.reviewCard, flex: 1, marginBottom: 0 }} role="region" aria-label={this.nls('ticketPriority')}>
                        <div style={S.reviewLabel}>{this.nls('priority')}</div>
                        <div style={S.reviewValue}>{priorityLabel}</div>
                    </div>
                    <div style={{ ...S.reviewCard, flex: 1, marginBottom: 0 }} role="region" aria-label={this.nls('submissionDate')}>
                        <div style={S.reviewLabel}>{this.nls('submitted')}</div>
                        <div style={S.reviewValue}>{submittedDate}</div>
                    </div>
                </div>

                {/* Public staff comments */}
                {(statusViewCommentsLoading || statusViewComments.length > 0) && (
                    <div style={{ marginTop: 20 }}>
                        <div style={S.sectionTitle}>{this.nls('staffUpdates')}</div>
                        {statusViewCommentsLoading ? (
                            <div style={S.gfChecking} aria-live="polite">{this.nls('loadingUpdates')}</div>
                        ) : (
                            statusViewComments.map((c, i) => (
                                <div key={i} style={S.commentCard} role="article" aria-label={this.nls('staffUpdateI', { i: i + 1 })}>
                                    {c.commentDate && (
                                        <div style={S.commentDate}>
                                            <time dateTime={new Date(c.commentDate).toISOString()}>
                                                {new Date(c.commentDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                                            </time>
                                        </div>
                                    )}
                                    <div style={S.commentText}>{c.commentText}</div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Photos from City staff — staff- prefix only, never
                    staffint- (internal) or the submitter's own uploads */}
                {(statusViewPhotosLoading || statusViewPhotos.length > 0) && (
                    <div style={{ marginTop: 20 }}>
                        <div style={S.sectionTitle}>{this.nls('photosFromCityStaff')}</div>
                        {statusViewPhotosLoading ? (
                            <div style={S.gfChecking} aria-live="polite">{this.nls('loadingPhotos')}</div>
                        ) : (
                            statusViewPhotos.map((p, i) => (
                                <div key={i} style={{ marginBottom: 12, borderRadius: 8, overflow: "hidden", border: `1px solid ${t.divider}`, background: t.inputBg }} role="figure" aria-label={this.nls('photoFromCityStaffIOf', { i: i + 1, statusViewPhotosCount: statusViewPhotos.length })}>
                                    <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }} aria-label={this.nls('openStaffPhotoIFullSize', { i: i + 1 })}>
                                        <img
                                            src={p.url}
                                            alt={this.nls('photoAddedByCityStaffUploadDate', { uploadDate: p.uploadDate ? " on " + new Date(p.uploadDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "" })}
                                            style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }}
                                            loading="lazy"
                                        />
                                    </a>
                                    {p.uploadDate && (
                                        <div style={{ fontSize: 12, color: t.textMuted, padding: "6px 10px" }}>
                                            <time dateTime={new Date(p.uploadDate).toISOString()}>
                                                {new Date(p.uploadDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                                            </time>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

                <div style={S.navRow}>
                    <button style={S.btnPrimary(false)} onClick={this.onNewReport}>
                        {this.nls('submitANewReport')}
                    </button>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — LOADING
    //  WCAG: role="status" + aria-busy="true" + aria-label so
    //  screen readers announce that content is loading.
    // ══════════════════════════════════════════════════════════

    renderLoading() {
        const S = this.getStyles();
        const t = this.getTheme();
        return (
            <div
                style={{ padding: 20 }}
                role="status"
                aria-busy="true"
                aria-label={this.nls('loadingFormPleaseWait')}
            >
                <style>{`@keyframes pulse { 0%,100% { opacity:.6 } 50% { opacity:1 } } @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; } }`}</style>
                {[100, 60, 80, 100, 40].map((w, i) => (
                    <div key={i} style={{ ...S.skeleton, width: `${w}%` }} aria-hidden="true" />
                ))}
                <div style={{ textAlign: "center", color: t.textMuted, marginTop: 8, fontSize: 13 }}>
                    {this.nls('loading')}
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — SUBMITTING SCREEN
    //  Dedicated in-between screen shown while the ticket record
    //  is being written and attachments uploaded. Replaces the
    //  entire widget body so the stepper and review form are
    //  hidden and there is no way to double-submit.
    //
    //  WCAG:
    //  · role="status" on the outer div (polite live region)
    //  · aria-busy="true" signals async activity to AT
    //  · role="progressbar" with aria-valuenow/min/max
    //  · aria-live="polite" on the phase label
    //  · @keyframes rac-submit-pulse animates the bar shimmer;
    //    animation is suppressed by prefers-reduced-motion.
    // ══════════════════════════════════════════════════════════

    renderSubmitting() {
        const S = this.getStyles();
        const t = this.getTheme();
        const { submitPhase, submitProgress, form, selectedAddress } = this.state;
        const categoryName = this.state.subtypes.find(s => s.code === form.category)?.name || "";

        return (
            <div
                style={{ padding: "32px 20px 28px", textAlign: "center" as const }}
                role="status"
                aria-busy="true"
                aria-label={this.nls('submittingYourReportPleaseWait')}
            >
                <style>{`
                    @keyframes rac-submit-pulse {
                        0%   { opacity: 0.55 }
                        50%  { opacity: 1 }
                        100% { opacity: 0.55 }
                    }
                    @media (prefers-reduced-motion: reduce) {
                        .rac-submit-shimmer { animation: none !important; }
                    }
                `}</style>

                {/* Animated send icon */}
                <div style={{ marginBottom: 20 }}>
                    <svg
                        width="52" height="52" viewBox="0 0 24 24" fill="none"
                        stroke={t.brand} strokeWidth="1.6" strokeLinecap="round"
                        strokeLinejoin="round" aria-hidden="true"
                        className="rac-submit-shimmer"
                        style={{ animation: "rac-submit-pulse 1.4s ease-in-out infinite" }}
                    >
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                </div>

                {/* Heading */}
                <div style={{
                    fontSize: 17, fontWeight: 700, color: t.text,
                    marginBottom: 6, letterSpacing: -0.2,
                }}>
                    {this.nls('sendingYourReport')}
                </div>

                {/* Brief summary of what's being submitted */}
                {(categoryName || selectedAddress) && (
                    <div style={{
                        fontSize: 13, color: t.textMuted, marginBottom: 24,
                        lineHeight: 1.5,
                    }}>
                        {categoryName && <span>{categoryName}</span>}
                        {categoryName && selectedAddress && <span> &middot; </span>}
                        {selectedAddress && (
                            <span style={{
                                overflow: "hidden", textOverflow: "ellipsis",
                                display: "inline-block", maxWidth: "100%",
                                verticalAlign: "bottom",
                            }}>
                                {selectedAddress}
                            </span>
                        )}
                    </div>
                )}

                {/* Progress bar */}
                <div style={{ textAlign: "left" as const, marginBottom: 10 }}>
                    <div
                        role="progressbar"
                        aria-valuenow={submitProgress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={this.nls('submissionProgressSubmitProgress', { submitProgress })}
                        style={S.progressBarTrack}
                    >
                        <div style={S.progressBarFill(submitProgress)} aria-hidden="true" />
                    </div>
                </div>

                {/* Phase label + percentage */}
                <div
                    style={{ ...S.progressLabel, textAlign: "left" as const }}
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {submitPhase || this.nls('submitting')}&nbsp;&nbsp;{submitProgress}%
                </div>

                <div style={{
                    fontSize: 12, color: t.textMuted, marginTop: 20, lineHeight: 1.5,
                }}>
                    {this.nls('pleaseDonTCloseThisWindow')}
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER — MAIN
    // ══════════════════════════════════════════════════════════

    render() {
    __setIntl((this.props as any).intl)
    __i18nIntl = (this.props as any).intl
        const S = this.getStyles();
        const cfg = this.props.config;
        const mid = cfg?.useMapWidgetIds?.[0];
        const {
            loading, metadataLoaded, initError, submitResult, step,
            statusViewLoading, statusViewTicket, statusViewError,
            submitting,
        } = this.state;

        const showStatusView = !statusViewLoading && (!!statusViewTicket || !!statusViewError);
        const t = this.getTheme();

        return (
            <div style={S.root} id="rac-submit-root" ref={this.rootRef}>
                {/* One polite live region for the whole widget (handoff Section 11.4).
                    Step changes and submit results are written here; the inline
                    role="alert" and aria-live blocks in each step stay as they are. */}
                <div role="status" aria-live="polite" aria-atomic="true" style={VISUALLY_HIDDEN}>
                    {this.state.liveMessage}
                </div>
                {/* Keyboard focus ring for every control, and reduced motion for the
                    whole widget (the per-step style blocks only cover their own step). */}
                <style>{`
                    #rac-submit-root button:focus-visible,
                    #rac-submit-root input:focus-visible,
                    #rac-submit-root select:focus-visible,
                    #rac-submit-root textarea:focus-visible,
                    #rac-submit-root a:focus-visible,
                    #rac-submit-root [tabindex]:focus-visible {
                        outline: 3px solid ${t.brand};
                        outline-offset: 2px;
                    }
                    #rac-submit-root h2[data-rac-step-heading]:focus-visible { outline: none; }
                    @media (prefers-reduced-motion: reduce) {
                        #rac-submit-root *, #rac-submit-root *::before, #rac-submit-root *::after {
                            animation-duration: 0.01ms !important;
                            animation-iteration-count: 1 !important;
                            transition-duration: 0.01ms !important;
                        }
                    }
                `}</style>
                {/* ── Portrait orientation lock (pure CSS, zero JS state) ────────
                    Touch devices only (pointer: coarse). Rotates the widget -90°
                    and swaps width/height so content always reads as portrait.
                    No React state = no re-renders = no wizard state wipe on rotate.

                    In landscape: 100vw = long side, 100vh = short side.
                    width: 100vh  → short side becomes the visual width
                    height: 100vw → long side becomes the visual height
                    translateX(-100vh) → moves the rotated element back into view */}
                <style>{`
                    @media screen and (orientation: landscape) and (pointer: coarse) {
                        #rac-submit-root {
                            transform: rotate(-90deg) translateX(-100vh) !important;
                            transform-origin: top left !important;
                            width: 100vh !important;
                            height: 100vw !important;
                            position: absolute !important;
                            top: 0 !important;
                            left: 0 !important;
                            overflow-y: auto !important;
                            overflow-x: hidden !important;
                        }
                    }
                `}</style>
                {mid && (
                    <JimuMapViewComponent
                        useMapWidgetId={mid}
                        onActiveViewChange={this.onViewReady}
                    />
                )}

                <header style={{ ...S.header, fontSize: cfg?.headerTitleSize ?? 20 }}>
                    {cfg?.headerImageUrl && (() => {
                        const img = (
                            <img
                                src={cfg.headerImageUrl}
                                alt={cfg.headerImageAlt ?? ""}
                                style={{
                                    maxHeight: 40,
                                    maxWidth: 160,
                                    objectFit: "contain",
                                    flexShrink: 0,
                                    display: "block",
                                }}
                            />
                        );
                        return cfg?.headerImageLink ? (
                            <a
                                href={sanitizeUrl(cfg.headerImageLink)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={cfg.headerImageAlt || undefined}
                                style={{ display: "flex", alignItems: "center", lineHeight: 0 }}
                            >
                                {img}
                            </a>
                        ) : img;
                    })()}
                    <span style={(() => {
                        const align = cfg?.headerTitleAlign ?? "left";
                        return {
                            flex: 1,
                            textAlign: align as React.CSSProperties["textAlign"],
                            // "left" needs no special treatment beyond natural flow,
                            // but flex:1 is set for all so center/right work correctly
                        };
                    })()}>
                        {cfg?.headerTitle || this.nls('reportAConcern')}
                    </span>
                </header>

                {!mid && (
                    <div style={{ padding: 20 }}>
                        <div style={S.errorBox} role="alert">{this.nls('noMapWidgetConfigured')}</div>
                    </div>
                )}
                {initError && (
                    <div style={{ padding: 20 }}>
                        <div style={S.errorBox} role="alert">{initError}</div>
                    </div>
                )}

                {/* Status view loading spinner — independent of map init */}
                {statusViewLoading && this.renderLoading()}

                {/* Map/wizard init loading spinner — only when not in status view */}
                {loading && !statusViewLoading && !showStatusView && this.renderLoading()}

                {/* Submitting screen — shown while ticket record + attachments upload */}
                {!loading && !statusViewLoading && !showStatusView && submitting && (
                    <div style={{ padding: "0 0 8px" }}>{this.renderSubmitting()}</div>
                )}

                {/* Ticket status view — deep-link ?ticket= or ?ticket_number=
                    Note: NOT gated on !loading — the status fetch is independent
                    of map init. onViewReady sets loading:true which would otherwise
                    block the status view on the external site where layer view
                    creation fails for the Create-only FeatureServer. */}
                {!statusViewLoading && showStatusView && (
                    <div style={{ padding: 20 }}>{this.renderTicketStatus()}</div>
                )}

                {/* Fresh submission success — same session, no page reload */}
                {!loading && !statusViewLoading && !showStatusView && !submitting && submitResult === "success" && (
                    <div style={{ padding: 20 }}>{this.renderSuccess()}</div>
                )}

                {/* Wizard form */}
                {!loading && !statusViewLoading && !showStatusView && !submitting && metadataLoaded && submitResult !== "success" && (
                    <div>
                        {this.renderStepper()}
                        <div style={S.body}>
                            {step === 0 && this.renderStepLocation()}
                            {step === 1 && this.renderStepDetails()}
                            {step === 2 && this.renderStepContact()}
                            {step === 3 && this.renderStepReview()}
                        </div>
                    </div>
                )}
            </div>
        );
    }
}