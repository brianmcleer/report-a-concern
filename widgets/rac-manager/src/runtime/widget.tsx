import { React, AllWidgetProps, getAppStore } from "jimu-core";
import ReactDOM from "react-dom";
import { JimuMapViewComponent, JimuMapView } from "jimu-arcgis";
import { Button, TextInput, TextArea, Select, Option } from "jimu-ui";
import { CalciteIcon } from "calcite-components";
import { beacon } from '../shared/beacon';
import type { BeaconHandle } from '../shared/beacon';
import { useTokens, type Tokens } from "./theme";
import HelpPopup from "./components/HelpPopup";
import FirstRunHint from "./components/FirstRunHint";
import { buildHelpSections, type HelpFeatures } from "./helpSections";
import defaultMessages from "./translations/default";
import { fmt, ago, agoFull, agoDate, ymd, fmtDay, matchAll, nameTokens } from "./lib/format";
import { S, P, C, CT, statusLabel as statusLabelOf, priorityLabel, categoryLabel, toggleVal } from "./lib/labels";
// ExcelJS is loaded from CDN at export time to avoid webpack/Node
// compatibility issues with the npm package in browser builds.

// ── Constants ────────────────────────────────────────────────
// S, P, C (status, priority, category labels) and CT (comment types) live in
// ./lib/labels so the node tests can load them without the widget.
// Status and priority chip colors. Brand colors with no theme token; the
// label text always sits beside them, so nothing relies on the color alone.
const SC: Record<number, string> = { 1: "#2563eb", 2: "#7c3aed", 3: "#d97706", 4: "#16a34a", 5: "#6b7280" };
const PC: Record<number, string> = { 1: "#6b7280", 2: "#2563eb", 3: "#d97706", 4: "#dc2626" };
const PG = 50;
// Max length of the internal_notes column on the ticket layer. Resolution/closure
// notes are truncated to this before write and the TextArea caps input at the same
// value. Update if the column definition changes.
const INTERNAL_NOTES_MAXLEN = 500;

// ── Table column defaults / resize bounds ────────────────────
// Keys match the column.key values in renderTicketTable.
// Used by:
//   • renderTicketTable's column defs (single source of truth for widths)
//   • resetColWidth() to restore a column to its default
//   • startColResize() to clamp drag values inside sensible bounds
// All columns get an explicit pixel width — no flex columns. When the
// sum of widths exceeds the container, the table scrolls horizontally
// (industry standard for data tables like Excel / Google Sheets).
const COL_DEFAULT_WIDTH: Record<string, number> = {
    ticket_number: 80,
    status: 110,
    priority: 102,
    category: 280,
    assigned_to: 150,
    created_date: 140,
    modified_date: 140,
    resolved_date: 140,
    badges: 120,
};
const COL_MIN_WIDTH = 50;
const COL_MAX_WIDTH = 600;

// Per-column compression floor. As the panel narrows, columns compress
// proportionally (see the colgroup below), but never below these widths.
// Past that point the table scrolls horizontally (its container is
// overflow:auto) instead of crushing cells into unreadable slivers or
// forcing text to wrap. A column the user has manually dragged narrower
// than its floor keeps that smaller width.
const COL_FLOOR_WIDTH: Record<string, number> = {
    ticket_number: 64,
    status: 84,
    priority: 76,
    category: 150,
    assigned_to: 104,
    created_date: 88,
    modified_date: 88,
    resolved_date: 88,
    badges: 60,
};

// Sort options exposed in the list toolbar.
// Values prefixed with "_" are client-side badge sorts — the server query
// falls back to created_date DESC and the page is re-sorted after badges load.
const SORT_OPTS = [
    { label: "Newest First", value: "created_date DESC" },
    { label: "Oldest First", value: "created_date ASC" },
    { label: "Priority \u2193", value: "priority DESC,created_date DESC" },
    { label: "Priority \u2191", value: "priority ASC,created_date DESC" },
    { label: "Status", value: "status ASC,created_date DESC" },
    { label: "Category", value: "category ASC,created_date DESC" },
    { label: "Comments: Most", value: "_comments DESC" },
    { label: "Comments: Fewest", value: "_comments ASC" },
    { label: "Survey: Yes First", value: "_survey DESC" },
    { label: "Survey: No First", value: "_survey ASC" },
];

// ── Filter persistence ───────────────────────────────────────
const FILTER_STORAGE_KEY = "rac-manager-filters-v1";

// ── Sidebar width persistence ────────────────────────────────
// When this widget is nested inside an ExB sidebar widget, we
// remember the user's last-dragged sidebar width and restore it
// on next visit. This is purely cosmetic — if it ever fails to
// find the sidebar (e.g. layout change, ExB DOM shift), we just
// skip without affecting the rest of the widget.
const SIDEBAR_WIDTH_STORAGE_KEY = "rac-manager-sidebar-width-v1";
// How long to wait after a drag stops before persisting. Avoids
// hammering localStorage during the live drag.
const SIDEBAR_PERSIST_DEBOUNCE_MS = 400;
// Sanity guards — pixel widths outside this range almost certainly
// reflect a bug or a window minimize; ignore them so we don't save
// a value that would render the sidebar collapsed on next load.
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 1600;
// Tablet/phone guard. The saved width comes from a desktop drag
// (often 800px+). Pinning that on a tablet or phone pushed the
// sidebar past the screen edge and clipped the widget. Below this
// viewport width the pin is released so ExB's own per-device layout
// sizes the sidebar, and nothing is saved.
const SIDEBAR_DESKTOP_MIN_VIEWPORT = 1025;
// Keep at least this many px of the map visible when a pinned or
// dragged width is clamped to the window.
const SIDEBAR_VIEWPORT_MARGIN = 48;
// Widget width below which the list header switches to its
// compact (phone) layout.
const COMPACT_WIDTH = 480;
// How long a success banner stays up before clearing itself.
const OK_DISMISS_MS = 5000;

interface SavedFilters {
    search: string;
    fS: number[];
    fC: number[];
    fP: number[];
    // Toolbar Assigned-to filter. Department-name strings (not numeric
    // coded values) because assigned_to has a string-keyed coded-value
    // domain whose names ARE the department labels. Optional so saved
    // payloads written before this field existed still parse.
    fA?: string[];
    fDateFrom: string;
    fDateTo: string;
    sortOrder: string;
    fHasComments: boolean;
    fHasSurvey: boolean;
    fHasPhotos: boolean;
    viewMode: "cards" | "table";
    // Per-column widths in pixels, keyed by column key. Only keys
    // present here override the column's default width — others use
    // their built-in defaults. Persists across sessions.
    tableColWidths?: Record<string, number>;
    // Per-column filter state (status, priority, etc. from the
    // column-header funnel popovers). Optional so saved-filter
    // payloads from before this field was added still parse.
    tableColFilters?: {
        ticket_number: string;
        status: number[];
        priority: number[];
        category: number[];
        assigned_to: string[];
        activity: string[];
        created_date: string;
        modified_date: string;
        resolved_date: string;
    };
}

function loadSavedFilters(): Partial<SavedFilters> {
    try {
        const raw = localStorage.getItem(FILTER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveFilters(filters: SavedFilters): void {
    try {
        localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
        // Fail silently — non-critical.
    }
}

// ── Category → Department auto-suggest ───────────────────────
const CAT_DEPT: Record<number, string> = {
    1: "Water", 2: "Sewer", 3: "Streets", 4: "Transportation & Engineering",
    5: "Parks", 6: "Parks", 7: "Drainage", 8: "Code Enforcement",
    9: "Code Enforcement", 10: "Transportation & Engineering", 11: "Transportation & Engineering", 12: "General Services",
    13: "Code Enforcement",
};

// ── Department → valid category codes (inverse of CAT_DEPT) ─
// When assigned_to changes, the category dropdown is filtered to these codes.
// Unassigned (empty string) shows all categories.
// Keys must EXACTLY match the coded value names in the assigned_to domain.
const DEPT_CATS: Record<string, number[]> = Object.entries(CAT_DEPT).reduce(
    (acc, [code, dept]) => { (acc[dept] = acc[dept] || []).push(Number(code)); return acc; },
    {} as Record<string, number[]>
);

// ── Departments that accept any category (no routing restriction) ─
// These are catch-all or administrative departments not tied to a single
// service category. Add dept names here to suppress the mismatch warning
// and allow staff to pick any category freely.
const UNRESTRICTED_DEPTS = new Set([
    "Nonsense/Possible Spam",
    // Add other catch-all depts here as needed
]);

// Tracks depts we've already warned about — prevents console spam on re-renders.
const _warnedDepts = new Set<string>();

// ── Helper: get valid category codes for a dept, with fallback ─
function validCatsForDept(dept: string): number[] {
    if (!dept) return Object.keys(C).map(Number);
    if (UNRESTRICTED_DEPTS.has(dept)) return Object.keys(C).map(Number);
    const cats = DEPT_CATS[dept];
    if (!cats || cats.length === 0) {
        // Warn once per unknown dept — not on every render.
        if (!_warnedDepts.has(dept)) {
            _warnedDepts.add(dept);
            console.warn(`RAC Manager: No DEPT_CATS entry for dept "${dept}" — showing all categories. Add to CAT_DEPT or UNRESTRICTED_DEPTS.`);
        }
        return Object.keys(C).map(Number);
    }
    return cats;
}

// ── Integrity check: returns a human-readable warning or null if clean ─────
// Used both in the UI (amber banner) and in save() (block save on critical issues).
function integrityWarning(
    eA: string, eC: number, eSC: string,
    deptOptions: string[],
    catSubcatOptions: Record<number, { code: string; name: string }[]>
): string | null {
    // 1. Dept exists in the domain
    if (eA && !deptOptions.includes(eA)) {
        return `Department "${eA}" is not a valid option. Please re-select.`;
    }
    // 2. Category is valid for the selected dept (skip for unrestricted depts)
    if (eA && !UNRESTRICTED_DEPTS.has(eA)) {
        const valid = validCatsForDept(eA);
        if (!valid.includes(eC)) {
            return `Category "${C[eC] || eC}" is not handled by "${eA}". Please update the category.`;
        }
    }
    // 3. Subcategory is valid for the selected category (only when options are defined)
    if (eSC) {
        const opts = catSubcatOptions[eC];
        if (opts && opts.length > 0 && !opts.some(o => o.code === eSC)) {
            return `Subcategory value is not valid for "${C[eC] || eC}". Please re-select.`;
        }
    }
    return null;
}

// ── Theme tokens ─────────────────────────────────────────────
// theme.ts is the shared useTokens() hook (Section 11.2, byte copy across
// widgets). A class component cannot call a hook, so render() wraps the tree
// in <Themed>, a tiny function component that reads the tokens and hands them
// to the class through this.tk before the rest of the tree is built.
function Themed({ children }: { children: (tk: Tokens) => React.ReactNode }) {
    const tk = useTokens();
    return <React.Fragment>{children(tk)}</React.Fragment>;
}
// Same fallbacks theme.ts uses when no Experience theme is present. Only read
// before the first <Themed> render (never in practice), kept so this.tk is
// never undefined.
const DEFAULT_TOKENS: Tokens = {
    primary: "#0079c1", primaryText: "#ffffff", surface: "#ffffff", background: "#f7f8fa",
    text: "#1b1f24", textSecondary: "#5a6572", divider: "#e1e5e9", danger: "#d64545",
    warning: "#8a6100", warningBg: "#ffffff", info: "#0079c1", infoBg: "#ffffff",
    radius: "4px", radiusLg: "8px", shadow: "0 1px 3px rgba(0,0,0,0.10)", shadowHover: "0 6px 16px rgba(0,0,0,0.14)"
};

let racIntl: any = null; // set in Widget.render so the module-level t follows the app language
// ── Help guide (Section 10) ──────────────────────────────────
// Strings come from translations/default.ts. This is a class component, so
// it reads defaultMessages directly (the Print Advanced pattern) instead of
// useIntl(); {token} values are filled in by hand.
const t = (id: string, values?: Record<string, string>): string => {
    const __intl: any = racIntl; if (__intl && typeof __intl.formatMessage === "function") { try { return __intl.formatMessage({ id, defaultMessage: (defaultMessages as any)[id] ?? id }, values) } catch (e) { } }
    let s = String((defaultMessages as any)[id] ?? id);
    if (values) for (const k of Object.keys(values)) s = s.split(`{${k}}`).join(values[k]);
    return s;
};
// First-run hint dismissal, per browser and per widget id so two copies of
// the widget in one app do not share it. try/catch: private browsing throws.
const HELP_HINT_KEY = "racManager.helpHintDismissed";
const readHelpHint = (id: string): boolean => { try { return window.localStorage.getItem(`${HELP_HINT_KEY}.${id}`) === "1"; } catch (e) { return false; } };
const writeHelpHint = (id: string): void => { try { window.localStorage.setItem(`${HELP_HINT_KEY}.${id}`, "1"); } catch (e) { /* private browsing */ } };

// ── Style helpers ────────────────────────────────────────────
const hdr = (tk: Tokens): React.CSSProperties => ({ fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: tk.textSecondary, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${tk.divider}` });
const lbl = (tk: Tokens): React.CSSProperties => ({ display: "block", fontSize: 11, fontWeight: 600, color: tk.textSecondary, marginBottom: 3, textTransform: "uppercase" as const, letterSpacing: "0.05em" });
const FOCUS_RING = "0 0 0 3px rgba(37,99,235,0.25)";
// Root class so the injected stylesheet can switch animations and transitions
// off for people who asked their system for reduced motion.
const ROOT_CLASS = "rac-manager-root";

// Shimmer gradient used by skeleton cards
const SHIMMER: React.CSSProperties = {
    background: "linear-gradient(90deg, #f0f0f0 25%, #fafafa 50%, #f0f0f0 75%)",
    backgroundSize: "200% 100%",
    animation: "rac-shimmer 1.4s infinite",
    borderRadius: 4,
};

function row(tk: Tokens, l: string, v: string) {
    return (
        <div style={{ display: "flex", padding: "5px 0", fontSize: 13, borderBottom: `1px solid ${tk.background}` }}>
            <span style={{ width: 100, flexShrink: 0, color: tk.textSecondary, fontSize: 12 }}>{l}</span>
            <span style={{ color: tk.text, fontWeight: 500 }}>{v}</span>
        </div>
    );
}

// ── Skeleton card — shown while tickets are loading ──────────
function SkeletonCard({ tk }: { tk: Tokens }) {
    return (
        <div style={{ padding: "10px 12px", marginBottom: 6, border: `1px solid ${tk.divider}`, borderLeft: `3px solid ${tk.divider}`, borderRadius: 6, background: tk.surface }} aria-hidden="true">
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <div style={{ ...SHIMMER, width: 52, height: 18, borderRadius: 99 }} />
                <div style={{ ...SHIMMER, width: 48, height: 18, borderRadius: 99 }} />
                <div style={{ ...SHIMMER, width: 36, height: 14, marginLeft: "auto" }} />
            </div>
            <div style={{ ...SHIMMER, width: "55%", height: 14, marginBottom: 6 }} />
            <div style={{ ...SHIMMER, width: "88%", height: 12, marginBottom: 4 }} />
            <div style={{ ...SHIMMER, width: "40%", height: 12 }} />
        </div>
    );
}

// ── Utilities ────────────────────────────────────────────────
// fmt, ago, agoFull, agoDate, ymd, fmtDay and matchAll live in ./lib/format
// (pure, covered by tests/format.test.js).
function uid() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16) }) }

/**
 * Get an AGOL token for the given URL from the ArcGIS JS API IdentityManager.
 * The staff user is already signed in to Portal/AGOL via Experience Builder,
 * so IdentityManager holds a valid credential for the organization's portal.
 * Returns empty string on failure (graceful fallback to unauthenticated request).
 */
async function getAgolToken(url: string): Promise<string> {
    try {
        const esriId: any = await new Promise((resolve, reject) => {
            const req = (window as any).require;
            if (!req) return reject("no require");
            req(["esri/identity/IdentityManager"], (idm: any) => resolve(idm), reject);
        });
        const cred = await esriId.getCredential(url, { prompt: false });
        return cred?.token ?? "";
    } catch {
        return "";
    }
}

// ══ PHOTO ATTACHMENT PIPELINE ══════════════════════════════════════
//  Ported verbatim from the report-a-concern-submit widget so both widgets
//  share one proven validation + metadata-strip pipeline. Staff photos are
//  uploaded as native Tickets-feature attachments (see uploadCommentPhoto),
//  which requires no schema change. Depends only on uid() (defined above).
// ═══════════════════════════════════════════════════════════════════════
const MAX_PHOTO_SIZE_MB = 15;

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

// toggleVal lives in ./lib/labels (pure, covered by tests/labels.test.js).

function stars(tk: Tokens, rating: number | null, max = 5) {
    if (rating == null) return <span style={{ color: tk.textSecondary, fontSize: 12 }}>No rating</span>;
    const filled = Math.min(Math.max(Math.round(rating), 0), max);
    return (
        <span role="img" aria-label={`${rating} out of ${max} stars`} style={{ fontSize: 16, letterSpacing: 2 }}>
            {Array.from({ length: max }, (_, i) => (
                <span key={i} aria-hidden="true" style={{ color: i < filled ? "#b5650f" : tk.divider }}>{"\u2605"}</span>
            ))}
            <span style={{ fontSize: 12, color: tk.text, marginLeft: 6 }}>{rating}/{max}</span>
        </span>
    );
}

function Tip({ text, children }: { text: string; children: React.ReactElement }) {
    return <span title={text} style={{ position: "relative" }}>{children}</span>;
}

// ── State ────────────────────────────────────────────────────
type TabId = "details" | "comments" | "photos" | "survey";
type FilterPanel = "none" | "status" | "category" | "priority" | "assigned";

interface St {
    compact: boolean;
    mode: "list" | "detail"; tickets: any[]; sel: any; comments: any[]; photos: any[]; survey: any;
    loading: boolean; saving: boolean; exporting: boolean; err: string; ok: string;
    search: string; fS: number[]; fC: number[]; fP: number[]; fA: string[];
    fDateFrom: string; fDateTo: string;
    fHasComments: boolean; fHasSurvey: boolean; fHasPhotos: boolean;
    openFilter: FilterPanel;
    sortOrder: string;
    eS: number; eP: number; eA: string; eC: number; eSC: string; resolveNote: string; resolveDate: string;
    nc: string; np: number; nct: string; tab: TabId;
    // Photo staged in the Add Comment composer, uploaded as a Tickets
    // attachment when the comment is sent. attPreview is a data URL.
    attFile: File | null; attPreview: string; attError: string; attUploading: boolean;
    jmv: JimuMapView | null; ticketsLayer: any; commentsTable: any; photosTable: any; surveyTable: any;
    deptOptions: string[]; subcatLookup: Record<string, string>; catSubcatOptions: Record<number, { code: string; name: string }[]>;
    extentFilter: boolean;
    deepLinkTicketNumber: number | null;
    badges: Record<string, { comments: number; photos: number; survey: boolean }>;
    lightboxIndex: number | null;   // index into this.state.photos; null = closed
    total: number; off: number; badgeTicketIds: string[] | null; ready: boolean;
    viewMode: "cards" | "table";   // user-toggled list-area display style
    // Per-column quick-filter values for the table view. Transient
    // (not persisted) — these refine the already-loaded page in the
    // browser, complementary to the main toolbar filters which drive
    // the server query. Keys match the column `key` in renderTicketTable.
    //   • Coded-value columns (status/priority/category) use multi-
    //     select arrays of numeric codes so checkbox popovers work.
    //   • Assigned uses a multi-select array of department-name strings.
    //   • Activity uses a multi-select array of badge-type strings
    //     ("comments"/"photos"/"survey") — AND semantics within selection.
    //   • Free-text columns (#) still use a single string.
    //   • Created uses a single YYYY-MM-DD date string (exact-day match).
    tableColFilters: {
        ticket_number: string;
        status: number[];
        priority: number[];
        category: number[];
        assigned_to: string[];
        activity: string[];
        created_date: string;
        modified_date: string;
        resolved_date: string;
    };
    // Which column header has its filter popover open, or null. The
    // popover positions itself below its header cell. Only one open
    // at a time — clicking another header closes the current one.
    openColFilter: string | null;
    // Per-column user-resized widths in pixels. Empty = use column defaults.
    // Persisted across sessions via localStorage.
    tableColWidths: Record<string, number>;
    // While a resize drag is active, the column key being resized.
    // Used to style the resize handle persistently during drag (otherwise
    // it would revert to neutral as soon as the mouse drifts off the
    // 8px hit zone, which makes the affordance feel jumpy).
    colResizing: string | null;
    // Help guide (Section 10): the guide is open; the first-run hint was dismissed.
    helpOpen: boolean;
    hintDismissed: boolean;
}

export default class Widget extends React.PureComponent<AllWidgetProps<any>, St> {
    private beacon: BeaconHandle | null = null;
    hl: any = null;
    hoverHl: any = null;
    ticketsLayerView: any = null;
    attInputRef: HTMLInputElement | null = null;
    filterRef = React.createRef<HTMLDivElement>();
    // Ref pointing at the widget's outermost wrapper. Used to walk
    // up to the ExB sidebar parent (if any) for the sidebar-width
    // restore/persist feature in componentDidMount.
    rootRef = React.createRef<HTMLDivElement>();
    // Ref to the table element. Used by the column-resize drag to
    // update the table's width and individual <col> widths directly
    // via DOM, bypassing React re-renders during the drag for
    // jank-free 60fps performance. State is committed only on mouseup.
    tableRef = React.createRef<HTMLTableElement>();
    // Sidebar tracking state — only set when the widget IS inside
    // a sidebar. ResizeObserver fires on every drag step; we
    // debounce the localStorage write via _sidebarSaveTimer.
    private _sidebarEl: HTMLElement | null = null;
    private _sidebarRO: ResizeObserver | null = null;
    private _sidebarSaveTimer: any = null;
    // Drag-handling state. We pin the sidebar to the restored width on
    // mount; if we simply released the pin when ExB's splitter drag
    // begins, ExB would snap the sidebar to its configured default
    // (e.g. 842px) before the drag could take over, making the
    // splitter visually jump away from the cursor. Instead, we handle
    // the drag ourselves: track mousedown on the splitter edge, then
    // update the pinned width in real time as the cursor moves. ExB's
    // own drag handler is suppressed via preventDefault/stopPropagation
    // in capture phase so it can't fight our updates.
    private _sidebarDragActive: boolean = false;
    private _sidebarDragEdge: "left" | "right" = "left";
    private _sidebarDragStartX: number = 0;
    private _sidebarDragStartWidth: number = 0;
    private _sidebarMouseDownHandler: ((e: MouseEvent) => void) | null = null;
    private _sidebarMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private _sidebarMouseUpHandler: ((e: MouseEvent) => void) | null = null;
    // Width saved from localStorage, re-applied when the viewport
    // grows back to desktop size (rotate, window resize).
    private _sidebarSavedWidth: number | null = null;
    private _viewportHandler: (() => void) | null = null;
    private _viewportTimer: any = null;
    // Watches the widget's own width for the compact layout.
    private _rootRO: ResizeObserver | null = null;
    // Auto-dismiss timer for the green success banner.
    private _okTimer: any = null;
    // Tracks the last-applied definitionExpression so select() and back() can
    // reapply it after goTo() and React re-renders. ExB's rendering pipeline
    // can interact with the map layer between setState and goTo completion,
    // silently clearing the expression.
    _defExpr: string = "";

    state: St = {
        compact: typeof window !== "undefined" && window.innerWidth < COMPACT_WIDTH,
        mode: "list", tickets: [], sel: null, comments: [], photos: [], survey: null,
        loading: false, saving: false, exporting: false, err: "", ok: "",
        search: "", fS: [], fC: [], fP: [], fA: [],
        fDateFrom: "", fDateTo: "",
        fHasComments: false, fHasSurvey: false, fHasPhotos: false,
        openFilter: "none",
        sortOrder: "created_date DESC",
        eS: 1, eP: 2, eA: "", eC: 1, eSC: "", resolveNote: "", resolveDate: "", nc: "", np: 1, nct: "PUBLIC", tab: "details", attFile: null, attPreview: "", attError: "", attUploading: false,
        jmv: null, ticketsLayer: null, commentsTable: null, photosTable: null, surveyTable: null,
        deptOptions: [], subcatLookup: {}, catSubcatOptions: {}, extentFilter: false,
        lightboxIndex: null,
        deepLinkTicketNumber: null,
        badges: {},
        total: 0, off: 0, badgeTicketIds: null, ready: false,
        viewMode: "cards",
        tableColFilters: {
            ticket_number: "",
            status: [], priority: [], category: [], assigned_to: [],
            activity: [],
            created_date: "",
            modified_date: "",
            resolved_date: "",
        },
        openColFilter: null,
        tableColWidths: {},
        colResizing: null,
        helpOpen: false,
        hintDismissed: true,
    };
    // Theme tokens for the current render, set by <Themed> in render() before
    // any render* method runs. Never read them outside a render path.
    tk: Tokens = DEFAULT_TOKENS;
    // Element that had focus when the photo viewer opened, so closing it puts
    // focus back on the thumbnail instead of dropping it on the page body.
    private lightboxReturnFocus: HTMLElement | null = null;

    componentDidMount() {
        this.beacon = beacon.init(this.props);
        this.setState({ hintDismissed: readHelpHint(this.props.id) });
        document.addEventListener("mousedown", this.handleClickOutside);
        document.addEventListener("keydown", this.handleEsc);

        // Restore previously saved filter/sort preferences.
        const saved = loadSavedFilters();
        if (Object.keys(saved).length > 0) {
            // tableColFilters: rebuild from saved values, falling back to
            // empty defaults for each field. Defensive — the saved
            // payload may predate this field, or some inner arrays may
            // be missing/wrong-type. Wrap in try/catch via Array.isArray.
            const sCol = saved.tableColFilters || {} as any;
            const cleanArr = (a: any) => Array.isArray(a) ? a : [];
            const cleanStr = (s: any) => typeof s === "string" ? s : "";
            this.setState({
                search: saved.search ?? "",
                fS: saved.fS ?? [],
                fC: saved.fC ?? [],
                fP: saved.fP ?? [],
                fA: Array.isArray(saved.fA) ? saved.fA : [],
                fDateFrom: saved.fDateFrom ?? "",
                fDateTo: saved.fDateTo ?? "",
                sortOrder: saved.sortOrder ?? "created_date DESC",
                fHasComments: saved.fHasComments ?? false,
                fHasSurvey: saved.fHasSurvey ?? false,
                fHasPhotos: saved.fHasPhotos ?? false,
                viewMode: saved.viewMode === "table" ? "table" : "cards",
                tableColWidths: saved.tableColWidths && typeof saved.tableColWidths === "object"
                    ? saved.tableColWidths : {},
                tableColFilters: {
                    ticket_number: cleanStr(sCol.ticket_number),
                    status: cleanArr(sCol.status),
                    priority: cleanArr(sCol.priority),
                    category: cleanArr(sCol.category),
                    assigned_to: cleanArr(sCol.assigned_to),
                    activity: cleanArr(sCol.activity),
                    created_date: cleanStr(sCol.created_date),
                    modified_date: cleanStr(sCol.modified_date),
                    resolved_date: cleanStr(sCol.resolved_date),
                },
            });
        }

        // Deep link — ?ticket_number=N auto-selects the ticket on load.
        const params = new URLSearchParams(window.location.search);
        const tn = params.get("ticket_number");
        if (tn && !isNaN(Number(tn))) {
            this.setState({ deepLinkTicketNumber: Number(tn) });
        }

        // Inject shimmer keyframe once.
        if (!document.getElementById("rac-shimmer-style-v2")) {
            document.getElementById("rac-shimmer-style")?.remove();
            const style = document.createElement("style");
            style.id = "rac-shimmer-style-v2";
            style.textContent = `@keyframes rac-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .${ROOT_CLASS} *, .${ROOT_CLASS} *::before, .${ROOT_CLASS} *::after { animation: none !important; transition: none !important; } }
.${ROOT_CLASS}, .${ROOT_CLASS} * { box-sizing: border-box; }
.${ROOT_CLASS} img, .${ROOT_CLASS} video { max-width: 100%; }
@media (pointer: coarse) {
  .${ROOT_CLASS} select, .${ROOT_CLASS} input:not([type=checkbox]):not([type=radio]), .${ROOT_CLASS} [role=toolbar] button, .${ROOT_CLASS} [role=radiogroup] button, .${ROOT_CLASS} [role=tablist] button { min-height: 36px; }
  .${ROOT_CLASS} input, .${ROOT_CLASS} select, .${ROOT_CLASS} textarea { font-size: 16px !important; }
}`;
            document.head.appendChild(style);
        }

        // ── Sidebar width tracking ───────────────────────────────
        // When the manager is nested in an ExB sidebar widget, find
        // the sidebar element so we can (a) restore its last-dragged
        // width and (b) watch for the user to resize it again and
        // persist the new value. Wrapped in retries because ExB
        // sometimes finishes constructing the sidebar parent AFTER
        // its child widgets have mounted.
        this.setupSidebarWidthTracking();

        // Re-check the sidebar pin on rotate / window resize so a
        // tablet turned to portrait (or a desktop window made narrow)
        // never keeps a width wider than the screen.
        this._viewportHandler = () => {
            if (this._viewportTimer) clearTimeout(this._viewportTimer);
            this._viewportTimer = setTimeout(() => this.applySidebarPin(), 120);
        };
        window.addEventListener("resize", this._viewportHandler);
        window.addEventListener("orientationchange", this._viewportHandler);

        // Compact layout follows the widget's own width (sidebar,
        // panel or full page), not just the device.
        try {
            this._rootRO = new ResizeObserver(entries => {
                const w = entries[0]?.contentRect?.width ?? 0;
                if (w <= 0) return;
                const compact = w < COMPACT_WIDTH;
                if (compact !== this.state.compact) this.setState({ compact });
            });
            if (this.rootRef.current) this._rootRO.observe(this.rootRef.current);
        } catch { this._rootRO = null; }
    }

    componentDidUpdate(_prevProps: AllWidgetProps<any>, prevState: St) {
        // Success banners clear themselves after OK_DISMISS_MS. Every new
        // message restarts the timer; errors stay until dismissed.
        if (prevState.ok !== this.state.ok) {
            if (this._okTimer) { clearTimeout(this._okTimer); this._okTimer = null; }
            if (this.state.ok) {
                this._okTimer = setTimeout(() => { this._okTimer = null; this.setState({ ok: "" }); }, OK_DISMISS_MS);
            }
        }

        // Persist + reload on column-filter changes.
        const a = prevState.tableColFilters;
        const b = this.state.tableColFilters;
        if (a === b) return;

        const arrayChanged = (x: any[], y: any[]) =>
            x.length !== y.length || x.some((v, i) => v !== y[i]);

        // Save updated state every time the column-filter object
        // identity changes (every popover click / clear).
        this.persistFilters();

        // If toolbar filters or search changed in the same update
        // (e.g. Clear All resets both layers at once), the toolbar
        // handler is already scheduled to reload. Skip our trigger
        // to avoid a double-query.
        const toolbarAlsoChanged =
            prevState.fS !== this.state.fS ||
            prevState.fC !== this.state.fC ||
            prevState.fP !== this.state.fP ||
            prevState.fA !== this.state.fA ||
            prevState.search !== this.state.search ||
            prevState.fDateFrom !== this.state.fDateFrom ||
            prevState.fDateTo !== this.state.fDateTo ||
            prevState.fHasComments !== this.state.fHasComments ||
            prevState.fHasSurvey !== this.state.fHasSurvey ||
            prevState.fHasPhotos !== this.state.fHasPhotos;
        if (toolbarAlsoChanged) return;

        // Activity column filter (badge counts) goes through the
        // same server-side pipeline as the toolbar's Has Comments /
        // Has Survey / Has Photos buttons — refreshBadgeFilter()
        // pre-computes ticket_ids and feeds them into buildWhere()
        // via badgeTicketIds. So when activity changes, route
        // through refreshBadgeFilter rather than calling load()
        // directly (it will load() at the end).
        const activityChanged = arrayChanged(a.activity, b.activity);

        const otherSqlChanged =
            a.ticket_number !== b.ticket_number ||
            a.created_date !== b.created_date ||
            a.modified_date !== b.modified_date ||
            a.resolved_date !== b.resolved_date ||
            arrayChanged(a.status, b.status) ||
            arrayChanged(a.priority, b.priority) ||
            arrayChanged(a.category, b.category) ||
            arrayChanged(a.assigned_to, b.assigned_to);

        if (activityChanged) {
            // refreshBadgeFilter already calls load(0) at the end.
            // It also handles the "all flags off" case by clearing
            // badgeTicketIds, so it's safe to call unconditionally.
            this.refreshBadgeFilter();
        } else if (otherSqlChanged) {
            // Reset to page 1 — total counts and offsets are based on
            // the filtered set, so position in the unfiltered set is
            // no longer meaningful.
            this.setState({ off: 0 }, () => this.load(0));
        }
    }

    componentWillUnmount() {
        document.removeEventListener("mousedown", this.handleClickOutside);
        document.removeEventListener("keydown", this.handleEsc);
        // Defensive: if a column-resize drag was in progress when the
        // widget unmounted, tear down its document-level listeners and
        // reset the body cursor / user-select.
        document.removeEventListener("mousemove", this.handleColResizeMove);
        document.removeEventListener("mouseup", this.handleColResizeEnd);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Tear down sidebar-width observer + flush any pending save.
        if (this._sidebarRO) {
            try { this._sidebarRO.disconnect(); } catch { /* ignore */ }
            this._sidebarRO = null;
        }
        if (this._sidebarSaveTimer) {
            clearTimeout(this._sidebarSaveTimer);
            this._sidebarSaveTimer = null;
        }
        // Tear down sidebar drag-release listeners.
        this.uninstallSidebarDragRelease();
        if (this._okTimer) { clearTimeout(this._okTimer); this._okTimer = null; }
        if (this._viewportHandler) {
            window.removeEventListener("resize", this._viewportHandler);
            window.removeEventListener("orientationchange", this._viewportHandler);
            this._viewportHandler = null;
        }
        if (this._viewportTimer) { clearTimeout(this._viewportTimer); this._viewportTimer = null; }
        if (this._rootRO) {
            try { this._rootRO.disconnect(); } catch { /* ignore */ }
            this._rootRO = null;
        }
    }

    // ── Sidebar width tracking helpers ────────────────────────
    // Finds the actual resizable sidebar element by walking up the DOM
    // ONCE from this widget's root, collecting two things:
    //   1. The first "resizable" element encountered (side-collapsable
    //      in ExB 1.20, widget-sidebar in 1.19) — closest to our widget
    //   2. Whether we eventually pass a sidebar marker class higher up
    //      (widget-sidebar-layout, etc) — confirms we're truly inside
    //      a sidebar widget arrangement and not just any element that
    //      happens to use the "side" class name.
    //
    // The DOM shape (ExB 1.20) walking from the widget outward is:
    //   rac-manager
    //     ... layout-item is-widget
    //       ... layout fixed-layout
    //         side w-100                       ← outer side container
    //           side-collapsable               ← user-resizable element
    //             ...
    //               widget-sidebar-layout      ← marker (HIGHER than resizable)
    //                 ...
    //                   sidebar-widget root
    //
    // So we encounter the resizable BEFORE the marker on the way up.
    private findSidebarAncestor(): HTMLElement | null {
        const root = this.rootRef.current;
        if (!root) return null;

        // Classes that identify the actual resizable element
        const RESIZABLE_CLASSES = [
            "side-collapsable",   // ExB 1.20
            "widget-sidebar",     // ExB 1.19 (was both marker AND resizable)
        ];
        // Classes that confirm we're inside a sidebar widget at all
        const SIDEBAR_MARKER_CLASSES = [
            "widget-sidebar-layout",   // ExB 1.20
            "widget-sidebar",          // ExB 1.19
            "jimu-widget-sidebar",     // legacy
        ];

        let resizable: HTMLElement | null = null;
        let foundMarker = false;

        let el: HTMLElement | null = root.parentElement;
        while (el && el !== document.body) {
            const cl = el.classList;
            if (cl) {
                // Track first resizable encountered (closest to widget)
                if (!resizable && RESIZABLE_CLASSES.some(c => cl.contains(c))) {
                    resizable = el;
                }
                // Track if any sidebar marker passed
                if (SIDEBAR_MARKER_CLASSES.some(c => cl.contains(c))) {
                    foundMarker = true;
                    // Once we have both, no need to keep walking
                    if (resizable) break;
                }
            }
            el = el.parentElement;
        }

        // Need both: confirms (a) we're inside a sidebar widget and
        // (b) we have an element to track for width changes.
        if (foundMarker && resizable) {
            return resizable;
        }
        return null;
    }

    // Restore the saved sidebar width (if any) and start watching for
    // user resizes. Retries up to ~3s because the sidebar parent can
    // mount AFTER its child widgets in some ExB layouts.
    private setupSidebarWidthTracking = (attempt = 0) => {
        const sidebar = this.findSidebarAncestor();
        if (!sidebar) {
            if (attempt < 5) {
                setTimeout(() => this.setupSidebarWidthTracking(attempt + 1), 200 * Math.pow(1.5, attempt));
            }
            return;
        }
        this._sidebarEl = sidebar;

        // Restore last-known width, if any. Validate it's a number in
        // the sensible range before applying — protects against stale
        // or corrupted localStorage values.
        let savedWidth: number | null = null;
        try {
            const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
            if (raw) {
                const w = Number(raw);
                if (isFinite(w) && w >= SIDEBAR_MIN_WIDTH && w <= SIDEBAR_MAX_WIDTH) {
                    savedWidth = w;
                }
            }
        } catch { /* localStorage may be disabled; ignore */ }

        this._sidebarSavedWidth = savedWidth;
        // Pin (desktop only, clamped to the window) or release (tablet
        // and phone). See applySidebarPin.
        this.applySidebarPin();

        // Watch for resizes (during manual drag). Debounce the
        // localStorage write so we save once when motion stops.
        try {
            this._sidebarRO = new ResizeObserver(entries => {
                if (!entries.length) return;
                const w = Math.round(entries[0].contentRect.width);
                if (w < SIDEBAR_MIN_WIDTH || w > SIDEBAR_MAX_WIDTH) return;
                // Only remember widths set on a desktop screen. A
                // tablet/phone width would shrink the desktop layout.
                if (!this.isDesktopViewport()) return;
                if (w > this.maxSidebarWidth()) return;
                this._sidebarSavedWidth = w;
                if (this._sidebarSaveTimer) clearTimeout(this._sidebarSaveTimer);
                this._sidebarSaveTimer = setTimeout(() => {
                    try {
                        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w));
                    } catch { /* ignore quota / disabled storage */ }
                }, SIDEBAR_PERSIST_DEBOUNCE_MS);
            });
            this._sidebarRO.observe(sidebar);
        } catch {
            // ResizeObserver missing or sidebar not observable — fall
            // back silently. The restore on next load still works.
            this._sidebarRO = null;
        }
    };

    private isDesktopViewport(): boolean {
        return typeof window !== "undefined" && window.innerWidth >= SIDEBAR_DESKTOP_MIN_VIEWPORT;
    }

    // Widest the sidebar may be: never past the window edge.
    private maxSidebarWidth(): number {
        const vw = typeof window !== "undefined" ? window.innerWidth : SIDEBAR_MAX_WIDTH;
        return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, vw - SIDEBAR_VIEWPORT_MARGIN));
    }

    // Desktop: pin the saved width, clamped to the window, and take
    // over the splitter drag. Tablet/phone: remove the pin and cap
    // the sidebar at the screen width so ExB's per-device layout
    // drives it and nothing is cut off.
    private applySidebarPin = () => {
        const sb = this._sidebarEl;
        if (!sb) return;
        if (this.isDesktopViewport()) {
            sb.style.maxWidth = "";
            if (this._sidebarSavedWidth !== null) {
                sb.style.width = `${Math.min(this._sidebarSavedWidth, this.maxSidebarWidth())}px`;
                this.installSidebarDragRelease();
            }
        } else {
            this.uninstallSidebarDragRelease();
            sb.style.width = "";
            sb.style.maxWidth = "100vw";
        }
    };

    // Installs document-level listeners that recognize a sidebar
    // splitter drag and manage it ourselves. Pattern:
    //   • mousedown OUTSIDE our widget root AND within a few px of
    //     the sidebar's left or right edge  → start drag
    //   • mousemove with button held while dragging → update pinned
    //     width to follow the cursor
    //   • mouseup → end drag (ResizeObserver has already saved the
    //     value to localStorage during the drag)
    // Throughout the drag, the inline width pin stays set — we just
    // change its value. That prevents ExB's layout pass from reverting
    // the sidebar to its configured default mid-drag (which would
    // cause the splitter to teleport away from the cursor).
    private installSidebarDragRelease = () => {
        if (this._sidebarMouseDownHandler) return; // already installed

        this._sidebarMouseDownHandler = (e: MouseEvent) => {
            // Only react to primary-button drags
            if (e.button !== 0) return;
            if (!this._sidebarEl) return;
            const root = this.rootRef.current;
            if (!root) return;
            // Splitter is always outside our widget root; clicks INSIDE
            // the widget are content interactions (rows, buttons, etc.)
            if (root.contains(e.target as Node)) return;

            // Is the cursor near the sidebar's left or right edge?
            // ExB's splitter hit zone is small (~6-10px); we use 15
            // to be forgiving.
            const rect = this._sidebarEl.getBoundingClientRect();
            const HIT = 15;
            let edge: "left" | "right" | null = null;
            if (Math.abs(e.clientX - rect.left) <= HIT) edge = "left";
            else if (Math.abs(e.clientX - rect.right) <= HIT) edge = "right";
            else return; // not a splitter drag

            this._sidebarDragActive = true;
            this._sidebarDragEdge = edge;
            this._sidebarDragStartX = e.clientX;
            this._sidebarDragStartWidth = this._sidebarEl.offsetWidth;

            // Block ExB's splitter handler — it would race with us.
            e.preventDefault();
            e.stopPropagation();
        };

        this._sidebarMouseMoveHandler = (e: MouseEvent) => {
            if (!this._sidebarDragActive) return;
            if (!this._sidebarEl) {
                this._sidebarDragActive = false;
                return;
            }
            // Defensive: if mouseup was missed (window blurred during
            // drag, etc.), end the drag when we see no button held.
            if (e.buttons === 0) {
                this._sidebarDragActive = false;
                return;
            }

            const dx = e.clientX - this._sidebarDragStartX;
            // Left edge: dragging RIGHT shrinks (right-side sidebar);
            //   moving away from the sidebar interior grows it.
            // Right edge: opposite.
            let newWidth = this._sidebarDragEdge === "left"
                ? this._sidebarDragStartWidth - dx
                : this._sidebarDragStartWidth + dx;

            // Clamp to sensible bounds
            if (newWidth < SIDEBAR_MIN_WIDTH) newWidth = SIDEBAR_MIN_WIDTH;
            else if (newWidth > this.maxSidebarWidth()) newWidth = this.maxSidebarWidth();

            this._sidebarEl.style.width = `${newWidth}px`;

            e.preventDefault();
            e.stopPropagation();
        };

        this._sidebarMouseUpHandler = () => {
            if (this._sidebarDragActive) {
                this._sidebarDragActive = false;
                // ResizeObserver already saved the final width.
            }
        };

        // Capture phase so we run BEFORE ExB's bubble-phase splitter
        // listeners — gives stopPropagation a chance to suppress them.
        document.addEventListener("mousedown", this._sidebarMouseDownHandler, true);
        document.addEventListener("mousemove", this._sidebarMouseMoveHandler, true);
        document.addEventListener("mouseup", this._sidebarMouseUpHandler, true);
    };

    private uninstallSidebarDragRelease = () => {
        if (this._sidebarMouseDownHandler) {
            document.removeEventListener("mousedown", this._sidebarMouseDownHandler, true);
            this._sidebarMouseDownHandler = null;
        }
        if (this._sidebarMouseMoveHandler) {
            document.removeEventListener("mousemove", this._sidebarMouseMoveHandler, true);
            this._sidebarMouseMoveHandler = null;
        }
        if (this._sidebarMouseUpHandler) {
            document.removeEventListener("mouseup", this._sidebarMouseUpHandler, true);
            this._sidebarMouseUpHandler = null;
        }
        this._sidebarDragActive = false;
    };

    // ── Help guide ─────────────────────────────────────────────
    // Opening the guide counts as answering the first-run hint, so both dismiss it.
    openHelp = () => {
        if (!this.state.hintDismissed) writeHelpHint(this.props.id);
        this.setState({ helpOpen: true, hintDismissed: true });
    };
    closeHelp = () => { this.setState({ helpOpen: false }); };
    dismissHint = () => { writeHelpHint(this.props.id); this.setState({ hintDismissed: true }); };
    // Flags for the guide, computed from the same checks the UI itself uses
    // (Section 10.6) so the guide never describes a control that is not shown.
    helpFeatures = (): HelpFeatures => ({
        mapConnected: !!this.props.config?.useMapWidgetIds?.[0],
        comments: !!this.state.commentsTable,
        survey: !!this.state.surveyTable,
        sidebar: !!this._sidebarEl,
    });
    helpEnabled = (): boolean => this.props.config?.showHelp !== false;

    // ── Photo viewer (lightbox) ────────────────────────────────
    openLightbox = (idx: number) => {
        this.lightboxReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.setState({ lightboxIndex: idx });
    };
    closeLightbox = () => {
        const back = this.lightboxReturnFocus;
        this.lightboxReturnFocus = null;
        this.setState({ lightboxIndex: null }, () => { try { back?.focus(); } catch (e) { /* element gone */ } });
    };

    handleClickOutside = (e: MouseEvent) => {
        if (this.state.openFilter !== "none" && this.filterRef.current && !this.filterRef.current.contains(e.target as Node)) {
            this.setState({ openFilter: "none" });
        }
        // Table column-filter popover: close if the click landed outside
        // any open popover and outside the filter-icon that opened it.
        // The popover and the icon both stop propagation on their own
        // clicks, so any event reaching here is a true outside click.
        if (this.state.openColFilter) {
            this.setState({ openColFilter: null });
        }
    };

    handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape" && this.state.openFilter !== "none") {
            this.setState({ openFilter: "none" });
        }
        if (e.key === "Escape" && this.state.openColFilter) {
            this.setState({ openColFilter: null });
        }
    };

    clearHoverHl = () => {
        if (this.hoverHl) { this.hoverHl.remove(); this.hoverHl = null; }
    };

    hoverHighlight = (oid: number) => {
        this.clearHoverHl();
        if (this.ticketsLayerView && oid != null) {
            this.hoverHl = this.ticketsLayerView.highlight(oid);
        }
    };

    // ── Badge filter: pre-resolve server-side ticket_id set ─────
    // Queries badge tables for ALL matching ticket_ids, stores them in
    // badgeTicketIds, which buildWhere() injects as a server-side IN() clause.
    // This gives correct full-page results and correct map display.
    refreshBadgeFilter = async () => {
        const { fHasComments, fHasSurvey, fHasPhotos,
            commentsTable, surveyTable, ticketsLayer,
            tableColFilters } = this.state;

        // A badge type is required if EITHER source asks for it:
        //   • toolbar: fHasComments / fHasSurvey / fHasPhotos
        //   • column-header Activity popover: tableColFilters.activity[]
        // Both use AND semantics, so union the requirement sets.
        const reqComments = fHasComments || tableColFilters.activity.includes("comments");
        const reqSurvey = fHasSurvey || tableColFilters.activity.includes("survey");
        const reqPhotos = fHasPhotos || tableColFilters.activity.includes("photos");

        // Nothing required — clear and reload normally
        if (!reqComments && !reqSurvey && !reqPhotos) {
            this.setState({ badgeTicketIds: null }, () => this.load(0));
            return;
        }

        // normalizeGuid strips braces so GUIDs match across all tables/layers
        const normalizeGuid = (id: any): string =>
            String(id ?? "").replace(/^\{|\}$/g, "").toLowerCase();

        const sets: Array<Set<string>> = [];

        // ── Has Comments ─────────────────────────────────────────
        if (reqComments && commentsTable) {
            try {
                const q = commentsTable.createQuery();
                q.where = "1=1";
                q.outFields = ["ticket_id"];
                q.returnGeometry = false;
                q.num = 10000;
                const r = await commentsTable.queryFeatures(q);
                const ids = new Set<string>();
                (r.features || []).forEach((f: any) => {
                    const tid = normalizeGuid(f.attributes?.ticket_id);
                    if (tid) ids.add(tid);
                });
                sets.push(ids);
            } catch (e) {
                console.error("Badge filter — comments query failed:", e);
                // Push empty set so intersection still works correctly
                sets.push(new Set<string>());
            }
        }

        // ── Has Survey ───────────────────────────────────────────
        if (reqSurvey && surveyTable) {
            try {
                const q = surveyTable.createQuery();
                q.where = "1=1";
                q.outFields = ["ticket_id"];
                q.returnGeometry = false;
                q.num = 10000;
                const r = await surveyTable.queryFeatures(q);
                const ids = new Set<string>();
                (r.features || []).forEach((f: any) => {
                    const tid = normalizeGuid(f.attributes?.ticket_id);
                    if (tid) ids.add(tid);
                });
                sets.push(ids);
            } catch (e) {
                console.error("Badge filter — survey query failed:", e);
                sets.push(new Set<string>());
            }
        }

        // ── Has Photos ───────────────────────────────────────────
        // Photos are enterprise FeatureServer attachments (DBO.Tickets__ATTACH).
        // Enterprise 11.5 queryAttachments requires objectIds — definitionExpression
        // is not supported. Strategy: fetch all OBJECTID+ticket_id from the tickets
        // layer, then chunk through queryAttachments with objectIds to find which
        // OIDs have attachments, then map back to ticket_ids.
        if (reqPhotos && ticketsLayer) {
            // DBO.Tickets has a photo_count field maintained by the RAC_PhotoCount_Sync
            // attribute rule. Query photo_count > 0 directly — same pattern as comments
            // and surveys. No attachment scanning needed.
            try {
                const layerUrl = `${ticketsLayer.url}/${ticketsLayer.layerId ?? 0}`;
                const token = await getAgolToken(ticketsLayer.url);
                const photoParams = new URLSearchParams({
                    f: "json",
                    where: "photo_count > 0",
                    outFields: "ticket_id",
                    returnGeometry: "false",
                });
                if (token) photoParams.set("token", token);
                const photoResp = await fetch(`${layerUrl}/query?${photoParams}`);
                const photoJson = await photoResp.json();
                if (photoJson.error) throw new Error(`photo_count query error: ${JSON.stringify(photoJson.error)}`);
                const ids = new Set<string>();
                (photoJson.features || []).forEach((f: any) => {
                    const tid = normalizeGuid(f.attributes?.ticket_id);
                    if (tid) ids.add(tid);
                });
                sets.push(ids);
            } catch (e) {
                console.error("Badge filter — photos query failed:", e);
                sets.push(new Set<string>());
            }
        }

        // Intersect all active filter sets
        const result: string[] = sets.length === 0 ? [] :
            Array.from(sets.reduce((a, b) => new Set([...a].filter(id => b.has(id)))));

        this.setState({ badgeTicketIds: result }, () => this.load(0));
    };

    // ── Centralized definitionExpression setter ───────────────
    setDefExpr = (expr: string) => {
        this._defExpr = expr;
        const { ticketsLayer } = this.state;
        if (ticketsLayer) ticketsLayer.definitionExpression = expr;
    };

    // ── Filter persistence ─────────────────────────────────────
    persistFilters = () => {
        const { search, fS, fC, fP, fA, fDateFrom, fDateTo, sortOrder, fHasComments, fHasSurvey, fHasPhotos, viewMode, tableColWidths, tableColFilters } = this.state;
        saveFilters({ search, fS, fC, fP, fA, fDateFrom, fDateTo, sortOrder, fHasComments, fHasSurvey, fHasPhotos, viewMode, tableColWidths, tableColFilters });
    };

    // ── Map connection ─────────────────────────────────────────
    onView = async (jmv: JimuMapView) => {
        if (!jmv) return;
        this.setState({ jmv });

        try {
            await jmv.view.when();
            await jmv.view.map.when();

            const allLayers = jmv.view.map.allLayers.toArray();
            await Promise.all(allLayers.map((l: any) => l.load().catch(() => { })));
            const allTables = jmv.view.map.allTables?.toArray() || [];
            await Promise.all(allTables.map((t: any) => t.load().catch(() => { })));

            const cfg = this.props.config || {};
            const tTitle = cfg.ticketsLayerTitle || "Tickets";
            const cTokens = nameTokens(cfg.commentsTableName || "Ticket Comments");
            const pTokens = nameTokens(cfg.photosTableName || "Ticket Photos");
            const sTokens = nameTokens(cfg.surveyTableName || "Survey Responses");

            const ticketsLayer = allLayers.find((l: any) => l.title === tTitle && l.type === "feature");
            if (!ticketsLayer) {
                this.setState({ err: `Layer "${tTitle}" not found in map. Check the layer title in widget settings.` });
                return;
            }

            const commentsTable = allTables.find((t: any) => matchAll(t.title || "", cTokens) || matchAll(t.name || "", cTokens));
            const photosTable = allTables.find((t: any) => matchAll(t.title || "", pTokens) || matchAll(t.name || "", pTokens));
            const surveyTable = allTables.find((t: any) => matchAll(t.title || "", sTokens) || matchAll(t.name || "", sTokens));


            // ── Department domain ────────────────────────────────
            let deptOptions: string[] = [];
            try {
                const atField = ticketsLayer.fields?.find((f: any) => f.name === "assigned_to");
                if (atField?.domain?.codedValues) {
                    deptOptions = atField.domain.codedValues.map((cv: any) => cv.name).sort();
                }
            } catch (e) { console.error("RAC Manager: Failed to read department domain:", e); }

            // ── Subcategory domain (flat + subtype overrides) ────
            const subcatLookup: Record<string, string> = {};
            try {
                const scField = ticketsLayer.fields?.find((f: any) => f.name === "subcategory");
                if (scField?.domain?.codedValues) {
                    scField.domain.codedValues.forEach((cv: any) => { subcatLookup[String(cv.code)] = cv.name; });
                }
                (ticketsLayer.subtypes || []).forEach((st: any) => {
                    const scDomain = st.domains?.["subcategory"];
                    if (scDomain?.codedValues) {
                        scDomain.codedValues.forEach((cv: any) => { subcatLookup[String(cv.code)] = cv.name; });
                    }
                });
            } catch (e) { console.error("RAC Manager: Failed to read subcategory domain:", e); }

            // ── Per-category subcategory options (for cascading dropdown) ──
            // NOTE: ArcGIS JS API subtype objects expose the code as st.code (integer).
            // st.id is undefined — using it silently produces keyed-by-undefined entries.
            const catSubcatOptions: Record<number, { code: string; name: string }[]> = {};
            try {
                (ticketsLayer.subtypes || []).forEach((st: any) => {
                    // st.code is the subtype integer (matches the category field value).
                    const subtypeCode = st.code ?? st.id;
                    if (subtypeCode == null) {
                        console.warn("RAC Manager: subtype has no code/id — skipping:", st);
                        return;
                    }
                    const scDomain = st.domains?.["subcategory"];
                    if (scDomain?.codedValues?.length) {
                        catSubcatOptions[Number(subtypeCode)] = scDomain.codedValues.map((cv: any) => ({
                            code: String(cv.code),
                            name: cv.name
                        }));
                    } else {
                        // Category exists but has no subcategory domain — store empty array
                        // so the dropdown renders "— None —" instead of a stale list.
                        catSubcatOptions[Number(subtypeCode)] = [];
                    }
                });
            } catch (e) { console.error("RAC Manager: Failed to build catSubcatOptions:", e); }

            // ── LayerView for highlight support ──────────────────
            try {
                this.ticketsLayerView = await jmv.view.whenLayerView(ticketsLayer);
            } catch (e) { console.warn("RAC Manager: Could not get layerView — highlight disabled:", e); }

            // ── Guard definitionExpression in detail mode ─────────
            // The FeatureLayer can have its definitionExpression cleared by
            // internal refresh cycles triggered by loadComments/loadPhotos/
            // loadSurvey async queries. This watcher detects any external
            // clearing and immediately reapplies the correct filter while
            // in detail mode.
            ticketsLayer.watch("definitionExpression", () => {
                if (this.state.mode === "detail" &&
                    ticketsLayer.definitionExpression !== this._defExpr) {
                    ticketsLayer.definitionExpression = this._defExpr;
                }
            });

            this.setState(
                { ticketsLayer, commentsTable, photosTable, surveyTable, deptOptions, subcatLookup, catSubcatOptions, ready: true, err: "" },
                () => this.load()
            );

            // Map click → select ticket
            jmv.view.on("click", async (evt: any) => {
                try {
                    const hr = await jmv.view.hitTest(evt);
                    const hit = hr.results?.find((r: any) => r.graphic?.layer === ticketsLayer);
                    if (hit) {
                        const oid = (hit as any).graphic.attributes?.OBJECTID;
                        if (oid != null) this.selectByOid(oid);
                    }
                } catch (e) { }
            });

            // Extent filter — reload on map pan/zoom when active
            let extentTimer: any = null;
            jmv.view.watch("stationary", (stationary: boolean) => {
                if (stationary && this.state.extentFilter && this.state.mode === "list") {
                    clearTimeout(extentTimer);
                    extentTimer = setTimeout(() => this.load(0), 300);
                }
            });

        } catch (e: any) {
            this.setState({ err: "Failed to initialize: " + e.message });
            console.error("RAC Manager init error:", e);
        }
    };

    // ── WHERE clause builder ───────────────────────────────────
    buildWhere = (): string => {
        const { fS, fC, fP, fA, search, fDateFrom, fDateTo, tableColFilters: tcf } = this.state;
        const w: string[] = ["1=1"];

        // Toolbar filter and column filter for the same field combine
        // via intersection (AND semantics): the server returns only
        // rows that satisfy BOTH. If one of the two is empty for a
        // given field, the other applies on its own.
        const intersect = (toolbar: number[], col: number[]): number[] => {
            if (!toolbar.length && !col.length) return [];
            if (!toolbar.length) return col;
            if (!col.length) return toolbar;
            return toolbar.filter(v => col.includes(v));
        };
        const sSet = intersect(fS, tcf.status);
        const cSet = intersect(fC, tcf.category);
        const pSet = intersect(fP, tcf.priority);

        if (sSet.length) w.push(sSet.length === 1 ? `status=${sSet[0]}` : `status IN (${sSet.join(",")})`);
        if (cSet.length) w.push(cSet.length === 1 ? `category=${cSet[0]}` : `category IN (${cSet.join(",")})`);
        if (pSet.length) w.push(pSet.length === 1 ? `priority=${pSet[0]}` : `priority IN (${pSet.join(",")})`);

        // Column-only filters (no toolbar equivalent).
        // Assigned-to: toolbar filter (fA) and column-header filter
        // (tcf.assigned_to) combine via intersection, same AND semantics
        // as the coded-value fields above. Both are department-name
        // string arrays sourced from deptOptions, so values are directly
        // comparable. Empty side defers to the other.
        const intersectStr = (toolbar: string[], col: string[]): string[] => {
            if (!toolbar.length && !col.length) return [];
            if (!toolbar.length) return col;
            if (!col.length) return toolbar;
            return toolbar.filter(v => col.includes(v));
        };
        const aSet = intersectStr(fA, tcf.assigned_to);
        if (aSet.length) {
            const escaped = aSet
                .map(a => `'${String(a).replace(/'/g, "''")}'`)
                .join(",");
            w.push(`assigned_to IN (${escaped})`);
        }
        if (tcf.ticket_number) {
            // Substring match on a numeric column — SQL Server SDE
            // requires CAST. Strip non-digits to keep the LIKE
            // pattern safe.
            const digits = tcf.ticket_number.trim().replace(/[^0-9]/g, "");
            if (digits) {
                w.push(`CAST(ticket_number AS VARCHAR(20)) LIKE '%${digits}%'`);
            }
        }
        if (tcf.created_date) {
            // Single-day match — same TIMESTAMP-literal convention as
            // the toolbar's date range filter below.
            const [yy, mm, dd] = tcf.created_date.split("-").map(Number);
            if (yy && mm && dd) {
                const dayStart = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")} 00:00:00`;
                const dayEnd = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")} 23:59:59`;
                w.push(`created_date >= TIMESTAMP '${dayStart}' AND created_date <= TIMESTAMP '${dayEnd}'`);
            }
        }
        if (tcf.modified_date) {
            const [yy, mm, dd] = tcf.modified_date.split("-").map(Number);
            if (yy && mm && dd) {
                const dayStart = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")} 00:00:00`;
                const dayEnd = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")} 23:59:59`;
                w.push(`modified_date >= TIMESTAMP '${dayStart}' AND modified_date <= TIMESTAMP '${dayEnd}'`);
            }
        }
        if (tcf.resolved_date) {
            const [yy, mm, dd] = tcf.resolved_date.split("-").map(Number);
            if (yy && mm && dd) {
                const dayStart = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")} 00:00:00`;
                const dayEnd = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")} 23:59:59`;
                w.push(`resolved_date >= TIMESTAMP '${dayStart}' AND resolved_date <= TIMESTAMP '${dayEnd}'`);
            }
        }

        if (search.trim()) {
            const s = search.trim().replace(/'/g, "''");
            const numericClause = /^\d+$/.test(s) ? `ticket_number = ${parseInt(s, 10)} OR ` : "";
            w.push(`(${numericClause}description LIKE '%${s}%' OR address_submitted LIKE '%${s}%')`);
        }

        // ArcGIS Enterprise / SQL Server SDE requires TIMESTAMP literals.
        // Append T12:00:00 to prevent local-timezone date shifting for Mountain Time users.
        if (fDateFrom) {
            const d = new Date(fDateFrom + "T12:00:00");
            const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 00:00:00`;
            w.push(`created_date >= TIMESTAMP '${ts}'`);
        }
        if (fDateTo) {
            const d = new Date(fDateTo + "T12:00:00");
            const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 23:59:59`;
            w.push(`created_date <= TIMESTAMP '${ts}'`);
        }

        const { badgeTicketIds } = this.state;
        if (badgeTicketIds !== null) {
            if (badgeTicketIds.length === 0) {
                w.push("1=0");
            } else {
                // Tickets layer stores GUIDs in braced format {XXXXXXXX-...}.
                // normalizeGuid in refreshBadgeFilter strips braces for consistent
                // Set comparisons; re-add braces here for the SQL IN() clause.
                const bracedIds = badgeTicketIds.map((id: string) =>
                    `'{${id.replace(/^\{|\}$/g, "").toUpperCase()}}'`
                ).join(",");
                w.push(`ticket_id IN (${bracedIds})`);
            }
        }
        return w.join(" AND ");
    };

    // ── Data loading ───────────────────────────────────────────
    load = async (off = 0) => {
        const { ticketsLayer, sortOrder, extentFilter, jmv } = this.state;
        if (!ticketsLayer) return;
        this.setState({ loading: true, err: "" });

        try {
            const where = this.buildWhere();
            const q = ticketsLayer.createQuery();
            q.where = where;
            q.outFields = ["*"];
            q.returnGeometry = false;
            q.orderByFields = sortOrder.startsWith("_")
                ? ["created_date DESC"]
                : sortOrder.split(",").map((s: string) => s.trim());
            q.start = off;
            q.num = PG;

            if (extentFilter && jmv?.view?.extent) {
                q.geometry = jmv.view.extent;
                q.spatialRelationship = "intersects";
            }

            const [result, count] = await Promise.all([
                ticketsLayer.queryFeatures(q),
                ticketsLayer.queryFeatureCount(q)
            ]);

            const tickets = (result.features || []).map((f: any) => f.attributes);

            this.setState({ tickets, total: count, off, loading: false }, () => {
                this.loadBadges(tickets);
                const { deepLinkTicketNumber } = this.state;
                if (deepLinkTicketNumber !== null && off === 0) {
                    this.setState({ deepLinkTicketNumber: null });
                    this.selectByTicketNumber(deepLinkTicketNumber);
                }
            });

            this.setDefExpr(where === "1=1" ? "" : where);

        } catch (e: any) {
            this.setState({ err: e.message, loading: false });
        }
    };

    // ── Badge queries ──────────────────────────────────────────
    loadBadges = async (tickets: any[]) => {
        const { commentsTable, photosTable, surveyTable, ticketsLayer } = this.state;
        if (!tickets.length) return;

        const ids = tickets.map(t => `'${t.ticket_id}'`).join(",");
        const where = `ticket_id IN (${ids})`;

        const newBadges: Record<string, { comments: number; photos: number; survey: boolean }> = {};
        tickets.forEach(t => { newBadges[t.ticket_id] = { comments: 0, photos: 0, survey: false }; });

        if (commentsTable) {
            try {
                const q = commentsTable.createQuery();
                q.where = where; q.outFields = ["ticket_id"]; q.returnGeometry = false;
                const r = await commentsTable.queryFeatures(q);
                (r.features || []).forEach((f: any) => { const tid = f.attributes.ticket_id; if (newBadges[tid]) newBadges[tid].comments++; });
            } catch (e) { }
        }
        // Photo badges — query enterprise FeatureServer attachments on the Tickets layer.
        // Photos are stored as attachments (DBO.Tickets__ATTACH in SQL Server).
        // queryAttachments returns counts grouped by parentObjectId; map back to ticket_id.
        if (ticketsLayer) {
            try {
                const oidToTid: Record<number, string> = {};
                tickets.forEach((t: any) => { if (t.OBJECTID != null) oidToTid[t.OBJECTID] = t.ticket_id; });
                const oids = Object.keys(oidToTid);
                if (oids.length > 0) {
                    const layerUrl = `${ticketsLayer.url}/${ticketsLayer.layerId ?? 0}`;
                    const token = await getAgolToken(ticketsLayer.url);
                    const params = new URLSearchParams({
                        f: "json",
                        objectIds: oids.join(","),
                        resultRecordCount: "1000",
                    });
                    if (token) params.set("token", token);
                    const resp = await fetch(`${layerUrl}/queryAttachments?${params}`);
                    const json = await resp.json();
                    (json.attachmentGroups || []).forEach((grp: any) => {
                        const tid = oidToTid[grp.parentObjectId];
                        if (tid && newBadges[tid] !== undefined) {
                            newBadges[tid].photos += (grp.attachmentInfos || []).length;
                        }
                    });
                }
            } catch (e) { }
        }
        if (surveyTable) {
            try {
                const q = surveyTable.createQuery();
                q.where = where; q.outFields = ["ticket_id"]; q.returnGeometry = false;
                const r = await surveyTable.queryFeatures(q);
                (r.features || []).forEach((f: any) => { const tid = f.attributes.ticket_id; if (newBadges[tid]) newBadges[tid].survey = true; });
            } catch (e) { }
        }

        this.setState({ badges: newBadges }, () => {
            // Re-sort the current page if a badge-based sort is active.
            const { sortOrder } = this.state;
            if (sortOrder?.startsWith("_")) {
                this.applyClientSort(sortOrder);
            }

            // definitionExpression is now managed entirely by buildWhere() via
            // badgeTicketIds — no need to override it here. load() already called
            // setDefExpr() with the correct full-dataset badge filter before loadBadges ran.
        });
    };

    // ── Badge-based map filter ────────────────────────────────
    // Updates ticketsLayer.definitionExpression to match the current badge
    // filters (Has Comments / Has Survey / Has Photos).  Called when a badge
    // filter is toggled so the map updates immediately without a full reload.
    applyBadgeMapFilter = () => {
        const { fHasComments, fHasSurvey, fHasPhotos, ticketsLayer, tickets, badges } = this.state;
        if (!ticketsLayer) return;

        if (fHasComments || fHasSurvey || fHasPhotos) {
            const visibleIds = tickets
                .filter((t: any) => {
                    const b = badges[t.ticket_id];
                    if (fHasComments && !(b?.comments > 0)) return false;
                    if (fHasSurvey && !b?.survey) return false;
                    if (fHasPhotos && !(b?.photos > 0)) return false;
                    return true;
                })
                .map((t: any) => `'${t.ticket_id}'`);

            this.setDefExpr(visibleIds.length > 0
                ? `ticket_id IN (${visibleIds.join(",")})`
                : "1=0");
        } else {
            const sqlWhere = this.buildWhere();
            this.setDefExpr(sqlWhere === "1=1" ? "" : sqlWhere);
        }
    };

    // ── Client-side badge sort ─────────────────────────────────
    // Sorts this.state.tickets in-place using resolved badge counts.
    // Only called when a "_"-prefixed sort option is active.
    applyClientSort = (sortOrder: string) => {
        const { tickets, badges } = this.state;
        const [field, dir] = sortOrder.slice(1).split(" ");  // strip leading "_"
        const desc = dir === "DESC";

        const sorted = [...tickets].sort((a, b) => {
            let aVal = 0, bVal = 0;
            if (field === "comments") {
                aVal = badges[a.ticket_id]?.comments || 0;
                bVal = badges[b.ticket_id]?.comments || 0;
            } else if (field === "survey") {
                aVal = badges[a.ticket_id]?.survey ? 1 : 0;
                bVal = badges[b.ticket_id]?.survey ? 1 : 0;
            }
            // Secondary sort: newer tickets first when values are equal.
            if (aVal === bVal) return (b.created_date || 0) - (a.created_date || 0);
            return desc ? bVal - aVal : aVal - bVal;
        });

        this.setState({ tickets: sorted });
    };

    loadComments = async (tid: string) => {
        const { commentsTable } = this.state;
        if (!commentsTable) return;
        try {
            const q = commentsTable.createQuery();
            q.where = `ticket_id='${tid}'`; q.outFields = ["*"]; q.orderByFields = ["created_date DESC"];
            const r = await commentsTable.queryFeatures(q);
            this.setState({ comments: (r.features || []).map((f: any) => f.attributes) });
        } catch (e) { console.error("Comments load failed:", e); }
    };

    loadPhotos = async (tid: string, oid: number) => {
        // Photos are enterprise FeatureServer attachments on the Tickets feature.
        // Fetch the attachment list directly using the Tickets layer URL + OBJECTID.
        const { ticketsLayer } = this.state;
        if (!ticketsLayer || oid == null) { this.setState({ photos: [] }); return; }
        try {
            const layerUrl = `${ticketsLayer.url}/${ticketsLayer.layerId ?? 0}`;
            const token = await getAgolToken(ticketsLayer.url);
            const params = new URLSearchParams({ f: "json" });
            if (token) params.set("token", token);
            const resp = await fetch(`${layerUrl}/${oid}/attachments?${params}`);
            const json = await resp.json();
            if (json.error) { this.setState({ photos: [] }); return; }
            const infos: any[] = json.attachmentInfos || [];
            const photos = infos.map((att: any) => ({
                OBJECTID: att.id,
                att_id: att.id,
                att_name: att.name || "Unnamed",
                att_url: token
                    ? `${layerUrl}/${oid}/attachments/${att.id}?token=${token}`
                    : `${layerUrl}/${oid}/attachments/${att.id}`,
                content_type: att.contentType || "",
                upload_date: att.uploadDate ?? null,
                file_name: att.name || "Unnamed",
                photo_order: null,
            }));
            this.setState({ photos });
        } catch (e) {
            console.warn("RAC Manager loadPhotos error:", e);
            this.setState({ photos: [] });
        }
    };

    loadSurvey = async (tid: string) => {
        const { surveyTable } = this.state;
        if (!surveyTable) { this.setState({ survey: null }); return; }
        try {
            const q = surveyTable.createQuery();
            q.where = `ticket_id='${tid}'`; q.outFields = ["*"];
            const r = await surveyTable.queryFeatures(q);
            this.setState({ survey: r.features?.length ? r.features[0].attributes : null });
        } catch (e) { console.error("Survey load failed:", e); this.setState({ survey: null }); }
    };

    // ── Selection ──────────────────────────────────────────────
    select = (t: any) => {
        if (this.hl) { this.hl.remove(); this.hl = null; }
        if (this.ticketsLayerView && t.OBJECTID != null) {
            this.hl = this.ticketsLayerView.highlight(t.OBJECTID);
        }

        // ── Sanitize edit state on open ──────────────────────────────────────
        // Raw ticket data may contain stale/invalid values (old dept names, migrated
        // subcategories, etc.). Sanitize before populating edit dropdowns so the UI
        // never renders blank selects or silently re-writes bad data.
        const { deptOptions, catSubcatOptions } = this.state;

        // eA: use assigned_to if it's in the domain; fall back to canonical dept
        // for the category; final fallback to empty (Unassigned).
        const rawDept = t.assigned_to || "";
        const canonDept = CAT_DEPT[t.category] || "";
        const sanitizedDept = deptOptions.includes(rawDept)
            ? rawDept
            : (deptOptions.includes(canonDept) ? canonDept : "");
        if (rawDept && rawDept !== sanitizedDept) {
            console.warn(`RAC Manager: assigned_to "${rawDept}" not in domain — fell back to "${sanitizedDept}"`);
        }

        // eC: use ticket category if it's a known code; otherwise first valid cat for dept.
        const rawCat = t.category != null ? Number(t.category) : null;
        const sanitizedCat = (rawCat != null && C[rawCat])
            ? rawCat
            : (validCatsForDept(sanitizedDept)[0] || 1);

        // eSC: use ticket subcategory if valid for the sanitized category; else clear.
        const rawSC = t.subcategory != null ? String(t.subcategory) : "";
        const scOpts = catSubcatOptions[sanitizedCat] || [];
        const sanitizedSC = (scOpts.length === 0 || scOpts.some((o: any) => o.code === rawSC))
            ? rawSC
            : "";
        if (rawSC && rawSC !== sanitizedSC) {
            console.warn(`RAC Manager: subcategory "${rawSC}" not valid for category ${sanitizedCat} — cleared`);
        }

        this.setState({
            sel: t, mode: "detail",
            eS: t.status ?? 1, eP: t.priority ?? 2,
            eA: sanitizedDept, eC: sanitizedCat, eSC: sanitizedSC,
            resolveNote: "", resolveDate: "", nc: "", np: 1, nct: "PUBLIC", tab: "details", ok: "", err: "", survey: null, lightboxIndex: null, attFile: null, attPreview: "", attError: "", attUploading: false
        });

        this.loadComments(t.ticket_id);
        this.loadPhotos(t.ticket_id, t.OBJECTID);
        this.loadSurvey(t.ticket_id);

        // Zoom to ticket geometry at street-level scale.
        const { jmv, ticketsLayer } = this.state;
        if (jmv && ticketsLayer) {
            (async () => {
                try {
                    const gq = ticketsLayer.createQuery();
                    gq.where = `OBJECTID=${t.OBJECTID}`; gq.outFields = []; gq.returnGeometry = true;
                    const gr = await ticketsLayer.queryFeatures(gq);
                    const geom = gr.features?.[0]?.geometry;
                    if (geom) {
                        await jmv.view.goTo({ target: geom, scale: 1128 });
                    } else if (t.longitude && t.latitude) {
                        await jmv.view.goTo({ center: [t.longitude, t.latitude], scale: 1128 });
                    }
                } catch (e) {
                    console.warn("RAC Manager: goTo geometry query failed:", e);
                    if (t.longitude && t.latitude) {
                        await jmv.view.goTo({ center: [t.longitude, t.latitude], scale: 1128 });
                    }
                } finally {
                    // Reapply after goTo — the map animation and ExB re-render
                    // cycle can silently clear definitionExpression.
                    if (this.state.ticketsLayer) {
                        this.state.ticketsLayer.definitionExpression = this._defExpr;
                    }
                }
            })();
        }
    };

    selectByOid = async (oid: number) => {
        const match = this.state.tickets.find(t => t.OBJECTID === oid);
        if (match) { this.select(match); return; }
        const { ticketsLayer } = this.state;
        if (!ticketsLayer) return;
        try {
            const q = ticketsLayer.createQuery();
            q.where = `OBJECTID=${oid}`; q.outFields = ["*"]; q.returnGeometry = false;
            const r = await ticketsLayer.queryFeatures(q);
            if (r.features?.length) this.select(r.features[0].attributes);
        } catch (e) { }
    };

    selectByTicketNumber = async (tn: number) => {
        const { ticketsLayer } = this.state;
        if (!ticketsLayer) return;
        try {
            const q = ticketsLayer.createQuery();
            q.where = `ticket_number=${tn}`; q.outFields = ["*"]; q.returnGeometry = false;
            const r = await ticketsLayer.queryFeatures(q);
            if (r.features?.length) {
                this.select(r.features[0].attributes);
            } else {
                console.warn(`RAC Manager: ticket_number ${tn} not found in layer.`);
            }
        } catch (e) {
            console.warn("RAC Manager: deep link query failed:", e);
        }
    };

    back = () => {
        if (this.hl) { this.hl.remove(); this.hl = null; }
        this.setState({ mode: "list", sel: null, ok: "", err: "", survey: null }, () => {
            // Reapply definitionExpression — returning to list can trigger a
            // re-render that clears it on some ExB versions.
            if (this.state.ticketsLayer) {
                this.state.ticketsLayer.definitionExpression = this._defExpr;
            }
        });
    };

    // ── Filter toggling ────────────────────────────────────────
    toggleFilter = (field: "fS" | "fC" | "fP", val: number) => {
        this.setState(
            (p: St) => ({ [field]: toggleVal(p[field], val), off: 0 } as any),
            () => { this.load(0); this.persistFilters(); }
        );
    };

    // Assigned-to toolbar filter toggles on department-name strings,
    // so it can't reuse toggleFilter (numeric). Same reload+persist flow.
    toggleAssignedFilter = (name: string) => {
        this.setState(
            (p: St) => ({
                fA: p.fA.includes(name) ? p.fA.filter(v => v !== name) : [...p.fA, name],
                off: 0,
            }),
            () => { this.load(0); this.persistFilters(); }
        );
    };

    toggleFilterPanel = (panel: FilterPanel) => {
        this.setState((p: St) => ({ openFilter: p.openFilter === panel ? "none" : panel }));
    };

    // ── Subcategory display helper ─────────────────────────────
    subcatLabel = (code: string | null | undefined): string => {
        if (!code) return "";
        return this.state.subcatLookup[String(code)] || code;
    };

    // ── Save ───────────────────────────────────────────────────
    save = async () => {
        this.beacon?.action('save');
        const { sel, eS, eP, eA, eC, eSC: rawESC, resolveNote, resolveDate, ticketsLayer, commentsTable, catSubcatOptions } = this.state;
        // Guard: ensure eSC is actually valid for eC before writing to DB.
        // If catSubcatOptions has entries for this category, eSC must be one of them or null.
        const validSubcats = catSubcatOptions[eC] || [];
        const eSC = validSubcats.length === 0
            ? rawESC   // no domain defined — pass through as-is
            : (validSubcats.some(opt => opt.code === rawESC) ? rawESC : "");
        if (!sel || !ticketsLayer) return;

        // Block save on any integrity violation — prevents bad data reaching the DB.
        const integrityErr = integrityWarning(eA, eC, eSC, this.state.deptOptions, catSubcatOptions);
        if (integrityErr) {
            this.setState({ err: integrityErr });
            return;
        }

        // Status changes require a comment so submitter knows what's happening.
        const isStatusChange = eS !== sel.status;
        const isNewResolution = eS === 4 && sel.status !== 4;
        const isNewClosure = eS === 5 && sel.status !== 5;
        if (isStatusChange && !resolveNote.trim()) {
            this.setState({ err: `Please add a comment before changing status to ${S[eS]}.` });
            return;
        }

        // Editable resolved/closed date. Manager may backdate to the actual
        // completion date.
        //   - Resolved today (the default, non-backdated case): stamp the full
        //     system time via Date.now() so the field reflects when the work was
        //     actually closed out, not a flat local noon.
        //   - Backdated to a prior day: stamp local noon (matches the date-filter
        //     pattern). A past day has no real completion time, and noon avoids an
        //     off-by-one when the epoch is later rendered in local time.
        // Guardrails: cannot be in the future, cannot predate ticket creation.
        let resolvedEpoch = Date.now();
        if (isNewResolution || isNewClosure) {
            const picked = resolveDate || ymd();
            resolvedEpoch = picked === ymd()
                ? Date.now()
                : new Date(picked + "T12:00:00").getTime();
            const todayEnd = new Date(ymd() + "T23:59:59").getTime();
            const createdFloor = sel.created_date ? new Date(ymd(sel.created_date) + "T00:00:00").getTime() : 0;
            if (resolvedEpoch > todayEnd) {
                this.setState({ err: "Resolved date cannot be in the future." });
                return;
            }
            if (createdFloor && resolvedEpoch < createdFloor) {
                this.setState({ err: "Resolved date cannot be earlier than the date the ticket was created." });
                return;
            }
        }

        this.setState({ saving: true, err: "", ok: "" });
        try {
            const now = Date.now();
            const attrs: any = { OBJECTID: sel.OBJECTID, status: eS, priority: eP, assigned_to: eA, category: eC, subcategory: eSC || null, modified_date: now };
            if (isNewResolution || isNewClosure) { attrs.resolved_date = resolvedEpoch; attrs.internal_notes = resolveNote.trim().slice(0, INTERNAL_NOTES_MAXLEN); }

            const result = await ticketsLayer.applyEdits({ updateFeatures: [{ attributes: attrs }] });
            if (result.updateFeatureResults?.[0]?.error) throw new Error(result.updateFeatureResults[0].error.message);

            // Write a public STATUS comment on every status change so the
            // comment mailer can notify the submitter of the transition.
            // Write an internal ASSIGN comment when routing changes (dept or category)
            // so there is a full audit trail even when status stays the same.
            const portalUser = getAppStore().getState()?.user;
            const author = portalUser?.fullName || portalUser?.username || "Staff";

            if (isStatusChange && commentsTable) {
                const commentGraphic = {
                    attributes: {
                        comment_id: `{${uid()}}`, ticket_id: sel.ticket_id,
                        comment_text: resolveNote.trim(),
                        comment_type: "STATUS",
                        author, author_role: "Staff",
                        created_date: now, is_public: 1
                    }
                };
                const cr = await commentsTable.applyEdits({ addFeatures: [commentGraphic] });
                if (cr.addFeatureResults?.[0]?.error) throw new Error(cr.addFeatureResults[0].error.message);
            }

            // Routing change audit comment — internal only (is_public: 0), does not
            // trigger the comment mailer to the submitter.
            const isRoutingChange = eA !== sel.assigned_to || eC !== sel.category;
            if (isRoutingChange && commentsTable) {
                const prevDept = sel.assigned_to || "Unassigned";
                const prevCat = C[sel.category] || sel.category || "Unknown";
                const newCat = C[eC] || eC;
                const parts: string[] = [];
                if (eA !== sel.assigned_to) parts.push(`Department: ${prevDept} → ${eA || "Unassigned"}`);
                if (eC !== sel.category) parts.push(`Category: ${prevCat} → ${newCat}`);
                const assignCommentGraphic = {
                    attributes: {
                        comment_id: `{${uid()}}`, ticket_id: sel.ticket_id,
                        comment_text: `Ticket routing updated by ${author}. ${parts.join("; ")}.`,
                        comment_type: "ASSIGN",
                        author, author_role: "Staff",
                        created_date: now + 1,   // +1ms ensures ordering after STATUS comment
                        is_public: 0             // internal only — not sent to submitter
                    }
                };
                await commentsTable.applyEdits({ addFeatures: [assignCommentGraphic] });
                // Non-fatal — don't throw on ASSIGN comment failure
            }

            // Resolved-date audit comment — internal only. Logged when a manager
            // backdates the resolved/closed date (differs from today), so there is
            // a record of who set it and to what. No-op when the date is today.
            if ((isNewResolution || isNewClosure) && commentsTable && ymd(resolvedEpoch) !== ymd()) {
                const auditGraphic = {
                    attributes: {
                        comment_id: `{${uid()}}`, ticket_id: sel.ticket_id,
                        comment_text: `${eS === 4 ? "Resolved" : "Closed"} date set to ${fmtDay(resolvedEpoch)} by ${author}.`,
                        comment_type: "ASSIGN",
                        author, author_role: "Staff",
                        created_date: now + 2,   // +2ms ensures ordering after STATUS/ASSIGN comments
                        is_public: 0             // internal only — not sent to submitter
                    }
                };
                await commentsTable.applyEdits({ addFeatures: [auditGraphic] });
                // Non-fatal — don't throw on audit comment failure
            }

            const up = { ...sel, status: eS, priority: eP, assigned_to: eA, category: eC, subcategory: eSC || null, modified_date: now, ...(isNewResolution || isNewClosure ? { resolved_date: resolvedEpoch } : {}) };
            this.setState(p => ({
                sel: up,
                tickets: p.tickets.map(t => t.OBJECTID === up.OBJECTID ? up : t),
                resolveNote: "",
                saving: false, ok: isStatusChange
                    ? `Status changed to ${S[eS]} and submitter notified.`
                    : (eA !== sel.assigned_to || eC !== sel.category)
                        ? "Routing updated — reassignment notification will be sent shortly."
                        : "Ticket updated successfully."
            }));
            if (isStatusChange) this.loadComments(sel.ticket_id);
        } catch (e: any) { this.beacon?.error(e, 'save'); this.setState({ err: e.message, saving: false }); }
    };

    // ── Photo attachment on a comment ────────────────────────
    // Stage one photo for the next comment. Runs the same OWASP validation and
    // canvas re-encode used by the public submit widget (strips EXIF/metadata
    // and any appended payload), then holds the sanitized File in state until
    // the comment is sent.
    processAttachment = async (file: File) => {
        if (!file) return;
        this.setState({ attUploading: true, attError: "" });

        const result = await validateMediaFile(
            file, PHOTO_ALLOWED_EXTS, PHOTO_ALLOWED_MIMES, MAX_PHOTO_SIZE_MB * 1024 * 1024
        );
        if (!result.valid) {
            this.setState({ attError: result.error, attFile: null, attPreview: "", attUploading: false });
            if (this.attInputRef) this.attInputRef.value = "";
            return;
        }

        const encoded = await compressPhoto(file);
        const isHeicAvif = /\.(heic|heif|avif)$/i.test(file.name) ||
            file.type === "image/heic" || file.type === "image/heif" || file.type === "image/avif";
        if (encoded === null && !isHeicAvif) {
            this.setState({ attError: "Could not process image. Try a different photo.", attFile: null, attPreview: "", attUploading: false });
            if (this.attInputRef) this.attInputRef.value = "";
            return;
        }
        const finalFile = encoded ?? file;

        const reader = new FileReader();
        reader.onload = (ev) => {
            this.setState({ attFile: finalFile, attPreview: ev.target?.result as string, attError: "", attUploading: false });
        };
        reader.onerror = () => {
            this.setState({ attFile: finalFile, attPreview: "", attError: "", attUploading: false });
        };
        reader.readAsDataURL(finalFile);
    };

    clearAttachment = () => {
        this.setState({ attFile: null, attPreview: "", attError: "" });
        if (this.attInputRef) this.attInputRef.value = "";
    };

    // POST a staged photo to the Tickets feature as a native FeatureServer
    // attachment, authenticated with the staff Portal token. The raw filename
    // is never sent — a UUID name is generated with a visibility-aware prefix:
    //   staff-     photo attached to a PUBLIC comment; the submit widget's
    //              status view shows these to the citizen
    //   staffint-  photo attached to an INTERNAL note; staff-only, never
    //              surfaced on the public status page
    // Returns true on success.
    uploadCommentPhoto = async (oid: number, file: File, isPublic: number): Promise<boolean> => {
        const { ticketsLayer } = this.state;
        if (!ticketsLayer || oid == null) return false;
        try {
            const writeUrl = `${ticketsLayer.url}/${ticketsLayer.layerId ?? 0}`;
            const token = await getAgolToken(ticketsLayer.url);
            const prefix = isPublic === 1 ? "staff-" : "staffint-";
            const safeName = `${prefix}${getSafeUploadName(file, PHOTO_ALLOWED_EXTS)}`;
            const fd = new FormData();
            fd.append("f", "json");
            fd.append("attachment", file, safeName);
            if (token) fd.append("token", token);
            const resp = await fetch(`${writeUrl}/${oid}/addAttachment`, {
                method: "POST", body: fd, credentials: "same-origin"
            });
            const json = await resp.json().catch(() => null);
            if (!json?.addAttachmentResult?.success) {
                console.warn("[RAC-Manager] addAttachment failed:", JSON.stringify(json));
                return false;
            }
            return true;
        } catch (err) {
            console.warn("[RAC-Manager] uploadCommentPhoto exception:", err);
            return false;
        }
    };

    addComment = async () => {
        this.beacon?.action('add-comment');
        const { sel, nc, np, nct, commentsTable } = this.state;
        if (!sel || !nc.trim()) return;
        if (!commentsTable) { this.setState({ err: "Comments table not found." }); return; }
        this.setState({ saving: true, err: "", ok: "" });

        const portalUser = getAppStore().getState()?.user;
        const author = portalUser?.fullName || portalUser?.username || "Staff";

        try {
            const graphic = {
                attributes: {
                    comment_id: `{${uid()}}`, ticket_id: sel.ticket_id,
                    comment_text: nc.trim(), comment_type: nct,
                    author, author_role: "Staff",
                    created_date: Date.now(), is_public: np
                }
            };
            const result = await commentsTable.applyEdits({ addFeatures: [graphic] });
            if (result.addFeatureResults?.[0]?.error) throw new Error(result.addFeatureResults[0].error.message);

            const now = Date.now();
            await this.state.ticketsLayer.applyEdits({
                updateFeatures: [{ attributes: { OBJECTID: sel.OBJECTID, modified_date: now } }]
            });

            // Upload the staged photo (if any) as a native attachment on the
            // Tickets feature. Non-fatal: the comment is already saved, so a
            // failed upload does not roll it back — it just reports back.
            let okMsg = "Comment added successfully.";
            let photoUploaded = false;
            if (this.state.attFile) {
                photoUploaded = await this.uploadCommentPhoto(sel.OBJECTID, this.state.attFile, np);
                okMsg = photoUploaded
                    ? "Comment and photo added successfully."
                    : "Comment saved. Photo upload failed — try attaching it again.";
            }

            this.setState(p => ({
                sel: { ...p.sel, modified_date: now },
                tickets: p.tickets.map(t => t.OBJECTID === sel.OBJECTID ? { ...t, modified_date: now } : t),
                nc: "", nct: "PUBLIC", np: 1, saving: false, ok: okMsg,
                attFile: null, attPreview: "", attError: "", attUploading: false
            }));
            if (this.attInputRef) this.attInputRef.value = "";
            this.loadComments(sel.ticket_id);
            if (photoUploaded) this.loadPhotos(sel.ticket_id, sel.OBJECTID);
        } catch (e: any) { this.beacon?.error(e, 'add-comment'); this.setState({ err: e.message, saving: false }); }
    };

    // ── Excel export ───────────────────────────────────────────
    // Fetches ALL records matching the current filters (not just the visible page),
    // then builds a formatted multi-sheet workbook and triggers a browser download.
    exportToExcel = async () => {
        this.beacon?.action('export-excel');
        const { ticketsLayer, commentsTable, photosTable, surveyTable,
            sortOrder, extentFilter, jmv,
            fS, fC, fP, fA, search, fDateFrom, fDateTo,
            fHasComments, fHasSurvey, fHasPhotos,
            tableColFilters } = this.state;

        if (!ticketsLayer || this.state.exporting) return;
        this.setState({ exporting: true, err: "", ok: "" });

        try {
            // ── Load ExcelJS from CDN ──────────────────────────────────────────
            // The npm package has Node.js internals that break in webpack browser
            // builds. The CDN UMD bundle is purpose-built for browsers.
            //
            // ExB's Dojo loader exposes a global AMD `define` with a truthy
            // `define.amd` property. ExcelJS's UMD wrapper checks for AMD first
            // and registers itself as an AMD module instead of setting
            // window.ExcelJS — so window.ExcelJS is never assigned.
            // Masking define.amd around the script injection forces the UMD
            // wrapper to fall through to the global (window.ExcelJS) branch.
            const ExcelJS: any = await new Promise((resolve, reject) => {
                if ((window as any).ExcelJS) { resolve((window as any).ExcelJS); return; }

                const win = window as any;
                const hasDef = typeof win.define === "function";
                const savedAmd = hasDef ? win.define.amd : undefined;

                // Mask AMD so the UMD bundle assigns to window.ExcelJS
                if (hasDef) win.define.amd = undefined;

                const s = document.createElement("script");
                s.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
                s.onload = () => {
                    // Restore AMD for the rest of the ExB app
                    if (hasDef) win.define.amd = savedAmd;
                    if (win.ExcelJS) {
                        resolve(win.ExcelJS);
                    } else {
                        reject(new Error("ExcelJS loaded but window.ExcelJS is still undefined."));
                    }
                };
                s.onerror = () => {
                    if (hasDef) win.define.amd = savedAmd;
                    reject(new Error("Could not load ExcelJS from CDN — check network/firewall."));
                };
                document.head.appendChild(s);
            });

            // ── Step 1: Fetch all matching tickets ─────────────────────────────
            // Pages through the layer in batches of 1,000 until all records are
            // collected, capped at 10,000 as a safety limit.
            const where = this.buildWhere();
            const allTickets: any[] = [];
            const FETCH_BATCH = 2000;
            let fetchOffset = 0;

            while (true) {
                const q = ticketsLayer.createQuery();
                q.where = where;
                q.outFields = ["*"];
                q.returnGeometry = false;
                // Badge-based sorts (_comments, _survey) are client-side only —
                // the server doesn't know those field names. Fall back to newest-first
                // for the fetch, matching the same guard used in load().
                q.orderByFields = sortOrder.startsWith("_")
                    ? ["created_date DESC"]
                    : sortOrder.split(",").map((s: string) => s.trim());
                q.start = fetchOffset;
                q.num = FETCH_BATCH;

                if (extentFilter && jmv?.view?.extent) {
                    q.geometry = jmv.view.extent;
                    q.spatialRelationship = "intersects";
                }

                const result = await ticketsLayer.queryFeatures(q);
                const batch = (result.features || []).map((f: any) => f.attributes);
                allTickets.push(...batch);

                if (batch.length < FETCH_BATCH) break;
                fetchOffset += FETCH_BATCH;
            }

            if (allTickets.length === 0) {
                this.setState({ exporting: false, err: "No tickets match the current filters — nothing to export." });
                return;
            }

            // ── Badge filter post-processing ───────────────────────────────────
            // Defensive check only. The toolbar badge filters (fHasComments /
            // fHasSurvey / fHasPhotos) AND the column-header activity filter
            // (tableColFilters.activity) both feed into badgeTicketIds via
            // refreshBadgeFilter(), and buildWhere() injects that as a
            // ticket_id IN(...) clause. So `allTickets` should already exclude
            // any ticket lacking the required badges. This block re-checks the
            // toolbar flags using the per-page badges map as a safety net
            // (e.g. if badges loaded slightly stale relative to refreshBadgeFilter).
            const { badges } = this.state;
            // Always produce a new array via .filter() — if exportTickets were set to
            // `allTickets` directly (same reference), the subsequent `allTickets.length = 0`
            // would empty exportTickets too, resulting in a zero-row export.
            const exportTickets = allTickets.filter((t: any) => {
                if (!fHasComments && !fHasSurvey && !fHasPhotos) return true;
                const b = badges[t.ticket_id];
                // If badges entry is missing (export spans pages beyond current
                // view), trust the SQL pre-filter and include the ticket.
                if (!b) return true;
                if (fHasComments && !(b.comments > 0)) return false;
                if (fHasSurvey && !b.survey) return false;
                if (fHasPhotos && !(b.photos > 0)) return false;
                return true;
            });

            if (exportTickets.length === 0) {
                this.setState({ exporting: false, err: "No tickets match the current filters — nothing to export." });
                return;
            }

            // Replace allTickets with the badge-filtered set for all subsequent steps
            allTickets.length = 0;
            allTickets.push(...exportTickets);

            // ── Step 2: Fetch related records for all exported tickets ──────────
            // Chunk ticket_id GUIDs into groups of 200 to stay within URL length
            // limits when building SQL IN clauses.
            const idChunks: string[][] = [];
            for (let i = 0; i < allTickets.length; i += 200) {
                idChunks.push(allTickets.slice(i, i + 200).map((t: any) => `'${t.ticket_id}'`));
            }

            const queryRelated = async (table: any, orderBy: string): Promise<any[]> => {
                if (!table) return [];
                const rows: any[] = [];
                for (const chunk of idChunks) {
                    try {
                        const q = table.createQuery();
                        q.where = `ticket_id IN (${chunk.join(",")})`;
                        q.outFields = ["*"];
                        q.returnGeometry = false;
                        q.orderByFields = [orderBy];
                        q.num = 5000;
                        const r = await table.queryFeatures(q);
                        rows.push(...(r.features || []).map((f: any) => f.attributes));
                    } catch (e) {
                        // Non-critical — skip chunk and continue.
                        console.warn("RAC export: related query chunk failed:", e);
                    }
                }
                return rows;
            };

            const [allComments, allPhotos, allSurveys] = await Promise.all([
                queryRelated(commentsTable, "created_date ASC"),
                queryRelated(photosTable, "uploaded_date ASC"),
                queryRelated(surveyTable, "submitted_date ASC"),
            ]);

            // ── Step 3: Build workbook ──────────────────────────────────────────
            const orgName = (this.props.config as any)?.orgName || "GIS Division";
            const wb = new ExcelJS.Workbook();
            wb.creator = orgName;
            wb.lastModifiedBy = "RAC Manager";
            wb.created = new Date();
            wb.modified = new Date();

            // ── Excel color palette (ARGB — ExcelJS format) ──────────────────
            const BLUE = "FF1A6DAA";  // City brand blue
            const BLUE_DARK = "FF0D4F82";  // Header bottom border
            const WHITE = "FFFFFFFF";
            const GRAY_BORDER = "FFD1D5DB";
            const STRIPE_ODD = "FFFFFFFF";  // White row
            const STRIPE_EVEN = "FFF5F8FD";  // Very light blue tint

            // Status: fill / font
            const STATUS_FILL: Record<number, string> = { 1: "FFD0E8F7", 2: "FFE9D5FF", 3: "FFFCE8D5", 4: "FFD4EDDA", 5: "FFE5E7EB" };
            const STATUS_FONT: Record<number, string> = { 1: "FF1A4A7A", 2: "FF5B21B6", 3: "FF78350F", 4: "FF14532D", 5: "FF374151" };

            // Priority: fill / font
            const PRIORITY_FILL: Record<number, string> = { 1: "FFF3F4F6", 2: "FFD0E8F7", 3: "FFFCE8D5", 4: "FFFDE8E8" };
            const PRIORITY_FONT: Record<number, string> = { 1: "FF374151", 2: "FF1A4A7A", 3: "FF78350F", 4: "FF7F1D1D" };

            // ── Shared style helpers ──────────────────────────────────────────

            // Apply standard blue header style to a row.
            const styleHeaderRow = (row: any) => {
                row.eachCell((cell: any) => {
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
                    cell.font = { bold: true, color: { argb: WHITE }, size: 11, name: "Calibri" };
                    cell.border = {
                        top: { style: "thin", color: { argb: BLUE_DARK } },
                        bottom: { style: "medium", color: { argb: BLUE_DARK } },
                        left: { style: "thin", color: { argb: BLUE_DARK } },
                        right: { style: "thin", color: { argb: BLUE_DARK } },
                    };
                    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
                });
                row.height = 28;
            };

            // Apply a thin gray border to a single cell.
            const addBorder = (cell: any) => {
                cell.border = {
                    top: { style: "thin", color: { argb: GRAY_BORDER } },
                    bottom: { style: "thin", color: { argb: GRAY_BORDER } },
                    left: { style: "thin", color: { argb: GRAY_BORDER } },
                    right: { style: "thin", color: { argb: GRAY_BORDER } },
                };
            };

            // Format epoch ms → readable date/time string.
            const fmtD = (ts: number | null | undefined): string => {
                if (!ts) return "";
                return new Date(ts).toLocaleString("en-US", {
                    year: "numeric", month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit"
                });
            };

            // Build ticket_id → ticket_number lookup for cross-sheet references.
            const idToNum: Record<string, number | string> = {};
            allTickets.forEach((t: any) => { idToNum[t.ticket_id] = t.ticket_number ?? ""; });

            // ── Sheet 1: Export Summary ───────────────────────────────────────
            const wsSummary = wb.addWorksheet("Summary", {
                properties: { tabColor: { argb: "FF334155" } },  // Slate
            });
            wsSummary.columns = [{ width: 28 }, { width: 64 }];

            // Title block
            wsSummary.mergeCells("A1:B1");
            const titleCell = wsSummary.getCell("A1");
            titleCell.value = "Report A Concern — Ticket Export";
            titleCell.font = { bold: true, size: 18, color: { argb: BLUE }, name: "Calibri" };
            titleCell.alignment = { vertical: "middle", horizontal: "left" };
            wsSummary.getRow(1).height = 38;

            wsSummary.mergeCells("A2:B2");
            const subtitleCell = wsSummary.getCell("A2");
            subtitleCell.value = orgName;
            subtitleCell.font = { italic: true, size: 11, color: { argb: "FF555555" }, name: "Calibri" };
            subtitleCell.alignment = { vertical: "middle", horizontal: "left" };
            wsSummary.getRow(2).height = 20;

            // Spacer
            wsSummary.getRow(3).height = 10;

            // Helper for labeled summary rows.
            let summaryRowNum = 4;
            const addSummaryRow = (label: string, value: string | number) => {
                const lbl = wsSummary.getCell(`A${summaryRowNum}`);
                const val = wsSummary.getCell(`B${summaryRowNum}`);
                lbl.value = label;
                lbl.font = { bold: true, size: 11, name: "Calibri", color: { argb: "FF374151" } };
                lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4FF" } };
                lbl.alignment = { vertical: "middle", indent: 1 };
                val.value = value;
                val.font = { size: 11, name: "Calibri", color: { argb: "FF1A1A1A" } };
                val.alignment = { vertical: "middle", indent: 1 };
                addBorder(lbl);
                addBorder(val);
                wsSummary.getRow(summaryRowNum).height = 22;
                summaryRowNum++;
            };

            // Helper for section divider rows in the summary.
            const addSummaryDivider = (label: string) => {
                summaryRowNum++;  // blank spacer
                wsSummary.mergeCells(`A${summaryRowNum}:B${summaryRowNum}`);
                const cell = wsSummary.getCell(`A${summaryRowNum}`);
                cell.value = label;
                cell.font = { bold: true, size: 11, name: "Calibri", color: { argb: WHITE } };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
                cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
                addBorder(cell);
                wsSummary.getRow(summaryRowNum).height = 22;
                summaryRowNum++;
            };

            // Build human-readable filter description. Mirrors the
            // merging logic in buildWhere() (intersection for shared
            // fields like Status/Priority/Category) and in
            // refreshBadgeFilter() (union of toolbar + column for
            // badge counts), so the Summary reflects exactly what
            // hit the server.
            const tcf = tableColFilters;
            const filterParts: string[] = [];

            // Shared coded-value fields — toolbar AND column-header
            // intersect. If both layers have selections, only the
            // overlap was queried; show the overlap. If only one
            // layer is set, show its values directly.
            const mergedIds = (a: number[], b: number[]): number[] => {
                if (a.length && b.length) return a.filter(v => b.includes(v));
                return a.length ? a : b;
            };
            const sMerged = mergedIds(fS, tcf.status);
            const cMerged = mergedIds(fC, tcf.category);
            const pMerged = mergedIds(fP, tcf.priority);
            if (sMerged.length) filterParts.push(`Status: ${sMerged.map((v: number) => S[v]).join(", ")}`);
            if (cMerged.length) filterParts.push(`Category: ${cMerged.map((v: number) => C[v]).join(", ")}`);
            if (pMerged.length) filterParts.push(`Priority: ${pMerged.map((v: number) => P[v]).join(", ")}`);

            // Column-only fields (no toolbar equivalent).
            if (tcf.ticket_number) filterParts.push(`Ticket # contains: "${tcf.ticket_number}"`);
            // Assigned-to: toolbar (fA) and column-header (tcf.assigned_to)
            // intersect at query time; show the same merged set here.
            const mergeStr = (a: string[], b: string[]): string[] => {
                if (a.length && b.length) return a.filter(v => b.includes(v));
                return a.length ? a : b;
            };
            const aMerged = mergeStr(fA, tcf.assigned_to);
            if (aMerged.length) filterParts.push(`Assigned to: ${aMerged.map(a => a || "(unassigned)").join(", ")}`);
            if (tcf.created_date) filterParts.push(`Created on: ${tcf.created_date}`);
            if (tcf.modified_date) filterParts.push(`Updated on: ${tcf.modified_date}`);
            if (tcf.resolved_date) filterParts.push(`Resolved on: ${tcf.resolved_date}`);

            // Toolbar-only fields.
            if (search.trim()) filterParts.push(`Search: "${search.trim()}"`);
            if (fDateFrom || fDateTo) filterParts.push(`Date Range: ${fDateFrom || "any"} → ${fDateTo || "any"}`);

            // Badge counts — toolbar flag OR column-header activity
            // selection counts as "required" (matches refreshBadgeFilter).
            const reqC = fHasComments || tcf.activity.includes("comments");
            const reqS = fHasSurvey || tcf.activity.includes("survey");
            const reqP = fHasPhotos || tcf.activity.includes("photos");
            if (reqC) filterParts.push("Has Comments");
            if (reqS) filterParts.push("Has Survey");
            if (reqP) filterParts.push("Has Photos");

            // Spatial constraint if active.
            if (extentFilter && jmv?.view?.extent) filterParts.push("Map Extent");

            const filterDesc = filterParts.length ? filterParts.join("  |  ") : "None (all tickets)";

            // Export metadata rows
            addSummaryRow("Export Date / Time", new Date().toLocaleString("en-US"));
            addSummaryRow("Filters Applied", filterDesc);
            addSummaryRow("Ticket Count", allTickets.length.toLocaleString());
            addSummaryRow("Comment Count", allComments.length.toLocaleString());
            addSummaryRow("Photo Count", allPhotos.length.toLocaleString());
            addSummaryRow("Survey Count", allSurveys.length.toLocaleString());

            // ── Ticket statistics ──────────────────────────────────────────────
            // Build counts from the fetched data so the summary reflects the export.
            const statusCounts: Record<number, number> = {};
            const priorityCounts: Record<number, number> = {};
            const categoryCounts: Record<number, number> = {};
            allTickets.forEach((t: any) => {
                statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
                priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
                categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
            });

            addSummaryDivider("Tickets by Status");
            Object.entries(S).forEach(([k, v]) => {
                addSummaryRow(v, (statusCounts[Number(k)] || 0).toLocaleString());
            });

            addSummaryDivider("Tickets by Priority");
            Object.entries(P).forEach(([k, v]) => {
                addSummaryRow(v, (priorityCounts[Number(k)] || 0).toLocaleString());
            });

            addSummaryDivider("Tickets by Category");
            // Sort categories by count descending for easy scanning.
            Object.entries(C)
                .sort(([a], [b]) => (categoryCounts[Number(b)] || 0) - (categoryCounts[Number(a)] || 0))
                .forEach(([k, v]) => {
                    addSummaryRow(v, (categoryCounts[Number(k)] || 0).toLocaleString());
                });

            // ── Sheet 2: Tickets ──────────────────────────────────────────────
            const wsTickets = wb.addWorksheet("Tickets", {
                properties: { tabColor: { argb: BLUE } },
                views: [{ state: "frozen", ySplit: 1 }],
            });

            wsTickets.columns = [
                { width: 10 },  // Ticket #
                { width: 13 },  // Status
                { width: 11 },  // Priority
                { width: 22 },  // Category
                { width: 22 },  // Subcategory
                { width: 55 },  // Description
                { width: 32 },  // Address
                { width: 22 },  // Submitted By
                { width: 30 },  // Email
                { width: 16 },  // Phone
                { width: 14 },  // Source
                { width: 20 },  // Assigned To
                { width: 14 },  // Boundary ID
                { width: 22 },  // Created
                { width: 22 },  // Last Updated
                { width: 22 },  // Resolved
            ];

            const TICKET_COLS = [
                "Ticket #", "Status", "Priority", "Category", "Subcategory",
                "Description", "Address", "Submitted By", "Email", "Phone",
                "Source", "Assigned To", "Boundary ID",
                "Created", "Last Updated", "Resolved",
            ];
            styleHeaderRow(wsTickets.addRow(TICKET_COLS));

            allTickets.forEach((t: any, i: number) => {
                const stripe = i % 2 === 0 ? STRIPE_ODD : STRIPE_EVEN;
                const scLabel = this.subcatLabel(t.subcategory);

                const dataRow = wsTickets.addRow([
                    t.ticket_number ?? "",
                    S[t.status] || t.status || "",
                    P[t.priority] || t.priority || "",
                    C[t.category] || t.category || "",
                    scLabel,
                    t.description || "",
                    t.address_submitted || "",
                    t.submitted_by_name || "Anonymous",
                    t.submitted_by_email || "",
                    t.submitted_by_phone || "",
                    t.source || "",
                    t.assigned_to || "",
                    t.boundary_id || "",
                    fmtD(t.created_date),
                    fmtD(t.modified_date),
                    fmtD(t.resolved_date),
                ]);

                dataRow.height = 15;

                dataRow.eachCell((cell: any, colNumber: number) => {
                    addBorder(cell);
                    cell.font = { size: 10, name: "Calibri", color: { argb: "FF1A1A1A" } };

                    switch (colNumber) {
                        case 1:  // Ticket # — centered, monospace, branded blue
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            cell.font = { size: 10, name: "Courier New", bold: true, color: { argb: BLUE } };
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };
                            break;
                        case 2:  // Status — color-coded fill
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[t.status] || "FFF3F4F6" } };
                            cell.font = { size: 10, name: "Calibri", bold: true, color: { argb: STATUS_FONT[t.status] || "FF374151" } };
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            break;
                        case 3:  // Priority — color-coded fill
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIORITY_FILL[t.priority] || "FFF3F4F6" } };
                            cell.font = { size: 10, name: "Calibri", bold: true, color: { argb: PRIORITY_FONT[t.priority] || "FF374151" } };
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            break;
                        case 6:  // Description — wrap text, top-align
                            cell.alignment = { vertical: "top", wrapText: true };
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };
                            break;
                        default:
                            cell.alignment = { vertical: "middle" };
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };
                            break;
                    }
                });
            });

            // Auto-filter so staff can sort/filter in Excel without extra setup.
            wsTickets.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: TICKET_COLS.length },
            };

            // ── Sheet 3: Comments ─────────────────────────────────────────────
            if (allComments.length > 0) {
                const wsComments = wb.addWorksheet("Comments", {
                    properties: { tabColor: { argb: "FF2563EB" } },  // Bright blue
                    views: [{ state: "frozen", ySplit: 1 }],
                });
                wsComments.columns = [
                    { width: 10 },  // Ticket #
                    { width: 18 },  // Type
                    { width: 24 },  // Author
                    { width: 16 },  // Role
                    { width: 14 },  // Visibility
                    { width: 72 },  // Comment text
                    { width: 22 },  // Date
                ];

                styleHeaderRow(wsComments.addRow(["Ticket #", "Type", "Author", "Role", "Visibility", "Comment", "Date"]));

                allComments.forEach((c: any, i: number) => {
                    const stripe = i % 2 === 0 ? STRIPE_ODD : STRIPE_EVEN;
                    const visLabel = c.is_public === 0 ? "Internal" : "Public";
                    const ctLabel = CT[c.comment_type] || c.comment_type || "";

                    const dataRow = wsComments.addRow([
                        idToNum[c.ticket_id] ?? "",
                        ctLabel,
                        c.author || "",
                        c.author_role || "",
                        visLabel,
                        c.comment_text || "",
                        fmtD(c.created_date),
                    ]);

                    dataRow.height = 15;
                    dataRow.eachCell((cell: any, colNumber: number) => {
                        addBorder(cell);
                        cell.font = { size: 10, name: "Calibri", color: { argb: "FF1A1A1A" } };
                        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };

                        if (colNumber === 1) {
                            // Ticket # — link visually to Tickets sheet
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            cell.font = { size: 10, name: "Courier New", bold: true, color: { argb: BLUE } };
                        } else if (colNumber === 5) {
                            // Visibility — flag internal notes prominently
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            if (c.is_public === 0) {
                                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };
                                cell.font = { size: 10, name: "Calibri", bold: true, color: { argb: "FF7F1D1D" } };
                            }
                        } else if (colNumber === 6) {
                            // Comment text — wrap, top-align
                            cell.alignment = { vertical: "top", wrapText: true };
                        } else {
                            cell.alignment = { vertical: "middle" };
                        }
                    });
                });

                wsComments.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
            }

            // ── Sheet 4: Photos ───────────────────────────────────────────────
            if (allPhotos.length > 0) {
                const wsPhotos = wb.addWorksheet("Photos", {
                    properties: { tabColor: { argb: "FFB5650F" } },  // Amber
                    views: [{ state: "frozen", ySplit: 1 }],
                });
                wsPhotos.columns = [
                    { width: 10 },  // Ticket #
                    { width: 32 },  // Filename
                    { width: 20 },  // Content Type
                    { width: 24 },  // Uploaded By
                    { width: 22 },  // Upload Date
                    { width: 60 },  // URL
                ];

                styleHeaderRow(wsPhotos.addRow(["Ticket #", "Filename", "Content Type", "Uploaded By", "Upload Date", "URL"]));

                allPhotos.forEach((p: any, i: number) => {
                    const stripe = i % 2 === 0 ? STRIPE_ODD : STRIPE_EVEN;
                    const dataRow = wsPhotos.addRow([
                        idToNum[p.ticket_id] ?? "",
                        p.filename || "",
                        p.content_type || "",
                        p.uploaded_by || "",
                        fmtD(p.uploaded_date),
                        p.photo_url || "",
                    ]);

                    dataRow.height = 15;
                    dataRow.eachCell((cell: any, colNumber: number) => {
                        addBorder(cell);
                        cell.font = { size: 10, name: "Calibri", color: { argb: "FF1A1A1A" } };
                        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };

                        if (colNumber === 1) {
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            cell.font = { size: 10, name: "Courier New", bold: true, color: { argb: BLUE } };
                        } else if (colNumber === 6 && p.photo_url) {
                            // Render URL as a clickable hyperlink with the filename as label.
                            cell.value = { text: p.filename || "View Photo", hyperlink: p.photo_url };
                            cell.font = { size: 10, name: "Calibri", color: { argb: BLUE }, underline: true };
                            cell.alignment = { vertical: "middle" };
                        } else {
                            cell.alignment = { vertical: "middle" };
                        }
                    });
                });

                wsPhotos.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };
            }

            // ── Sheet 5: Surveys ──────────────────────────────────────────────
            if (allSurveys.length > 0) {
                const wsSurveys = wb.addWorksheet("Surveys", {
                    properties: { tabColor: { argb: "FF1E7E34" } },  // Green
                    views: [{ state: "frozen", ySplit: 1 }],
                });
                wsSurveys.columns = [
                    { width: 10 },  // Ticket #
                    { width: 14 },  // Rating
                    { width: 60 },  // Comments
                    { width: 22 },  // Submitted Date
                ];

                styleHeaderRow(wsSurveys.addRow(["Ticket #", "Rating (1–5)", "Comments", "Submitted Date"]));

                allSurveys.forEach((sv: any, i: number) => {
                    const stripe = i % 2 === 0 ? STRIPE_ODD : STRIPE_EVEN;
                    const dataRow = wsSurveys.addRow([
                        idToNum[sv.ticket_id] ?? "",
                        sv.satisfaction_rating ?? "",
                        sv.comments || "",
                        fmtD(sv.submitted_date),
                    ]);

                    dataRow.height = 15;
                    dataRow.eachCell((cell: any, colNumber: number) => {
                        addBorder(cell);
                        cell.font = { size: 10, name: "Calibri", color: { argb: "FF1A1A1A" } };
                        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };

                        if (colNumber === 1) {
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            cell.font = { size: 10, name: "Courier New", bold: true, color: { argb: BLUE } };
                        } else if (colNumber === 2) {
                            // Rating — center + traffic-light color based on score.
                            cell.alignment = { vertical: "middle", horizontal: "center" };
                            cell.font = { size: 11, name: "Calibri", bold: true, color: { argb: "FF1A1A1A" } };
                            const rating = sv.satisfaction_rating;
                            if (rating <= 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };
                            else if (rating === 3) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE8D5" } };
                            else cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
                        } else if (colNumber === 3) {
                            cell.alignment = { vertical: "top", wrapText: true };
                        } else {
                            cell.alignment = { vertical: "middle" };
                        }
                    });
                });

                wsSurveys.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };
            }

            // ── Step 4: Write buffer and trigger download ───────────────────────
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            const dateStr = new Date().toISOString().slice(0, 10);
            anchor.href = url;
            anchor.download = `RAC_Export_${dateStr}.xlsx`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);

            this.setState({
                exporting: false,
                ok: `Export complete — ${allTickets.length.toLocaleString()} ticket${allTickets.length !== 1 ? "s" : ""} saved to RAC_Export_${dateStr}.xlsx`
            });

        } catch (e: any) {
            console.error("RAC Manager: Excel export failed:", e);
            this.setState({ exporting: false, err: "Export failed: " + e.message });
        }
    };

    // ── Render: status announcements ───────────────────────────
    renderMsg() {
        const tk = this.tk;
        const { err, ok } = this.state;
        // Banners sit in their own row above the list/detail pane (flexShrink 0),
        // so they push the pane down instead of pushing its bottom out of view.
        const closeBtn = (label: string, onClick: () => void, color: string) => (
            <button type="button" onClick={onClick} aria-label={label} title={label}
                style={{ marginLeft: "auto", flexShrink: 0, minWidth: 24, minHeight: 24, padding: 0, border: "none", background: "transparent", color, fontSize: 16, lineHeight: 1, cursor: "pointer", borderRadius: 4 }}>
                <span aria-hidden="true">&times;</span>
            </button>
        );
        const row = { display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "5px 6px 5px 12px", margin: "4px 8px", borderRadius: 6, fontSize: 12, fontWeight: 500 } as const;
        if (err) return <div role="alert" style={{ ...row, background: "#fff5f5", border: "1px solid #fecaca", borderLeft: `3px solid ${tk.danger}`, color: tk.danger }}><span style={{ minWidth: 0 }}>{err}</span>{closeBtn("Dismiss error", () => this.setState({ err: "" }), tk.danger)}</div>;
        if (ok) return <div role="status" style={{ ...row, background: "#f0fdf4", border: "1px solid #bbf7d0", borderLeft: "3px solid #16a34a", color: "#14532d" }}><span style={{ minWidth: 0 }}>{ok}</span>{closeBtn("Dismiss message", () => this.setState({ ok: "" }), "#14532d")}</div>;
        return null;
    }

    // ── Render: filter checkbox panel ──────────────────────────
    renderFilterButton(label: string, panel: FilterPanel, selected: number[], lookup: Record<number, string>, colors?: Record<number, string>) {
        const tk = this.tk;
        const { openFilter } = this.state;
        const isOpen = openFilter === panel;
        const count = selected.length;
        const field = panel === "status" ? "fS" : panel === "category" ? "fC" : "fP";
        const panelId = `rac-filter-${panel}`;
        const summary = count > 0 ? `${count} selected: ${selected.map(v => lookup[v]).join(", ")}` : "None selected";

        return (
            <div style={{ flex: this.state.compact ? "1 1 calc(50% - 4px)" : 1, minWidth: 90, position: "relative" }}>
                <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-label={`Filter by ${label}. ${summary}`}
                    title={`Filter by ${label} — ${summary}`}
                    onClick={() => this.toggleFilterPanel(panel)}
                    onKeyDown={(e: any) => { if (e.key === "Escape") this.setState({ openFilter: "none" }); }}
                    style={{
                        width: "100%", padding: "4px 10px", fontSize: 12, fontWeight: 600,
                        border: count > 0 ? `1.5px solid ${tk.primary}` : `1px solid ${tk.divider}`,
                        background: count > 0 ? tk.infoBg : tk.surface,
                        color: count > 0 ? tk.primary : tk.text,
                        borderRadius: 99, cursor: "pointer", textAlign: "left", outline: "none",
                        transition: "border-color 0.15s, background 0.15s",
                    }}
                    onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                    onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                >
                    {label}
                    {count > 0 && (
                        <span aria-hidden="true" style={{ background: tk.primary, color: tk.primaryText, borderRadius: 99, padding: "0 5px", fontSize: 10, marginLeft: 4 }}>
                            {count}
                        </span>
                    )}
                    <span aria-hidden="true" style={{ float: "right", fontSize: 9, marginTop: 1 }}>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                    <div
                        id={panelId}
                        role="group"
                        aria-label={`${label} filter options`}
                        style={{
                            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
                            background: tk.surface, border: `1px solid ${tk.divider}`, borderRadius: 8,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.12)", maxHeight: 220,
                            overflowY: "auto",
                        }}
                    >
                        {Object.entries(lookup).map(([k, v]) => {
                            const code = Number(k);
                            const checked = selected.includes(code);
                            const cbId = `rac-cb-${panel}-${k}`;
                            return (
                                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: checked ? tk.infoBg : "transparent" }}>
                                    <input
                                        type="checkbox" id={cbId} checked={checked}
                                        onChange={() => this.toggleFilter(field, code)}
                                        aria-label={`${v}${checked ? " (selected)" : ""}`}
                                        style={{ width: 15, height: 15, cursor: "pointer", accentColor: tk.primary }}
                                    />
                                    {colors && (
                                        <span aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colors[code] || tk.textSecondary, flexShrink: 0 }} />
                                    )}
                                    <label htmlFor={cbId} style={{ fontSize: 12, color: tk.text, cursor: "pointer", flex: 1 }}>{v}</label>
                                </div>
                            );
                        })}
                        {count > 0 && (
                            <div style={{ borderTop: `1px solid ${tk.divider}`, padding: "5px 10px" }}>
                                <button
                                    type="button"
                                    onClick={() => this.setState({ [field]: [] } as any, () => { this.load(0); this.persistFilters(); })}
                                    aria-label={`Clear all ${label.toLowerCase()} filters`}
                                    style={{ fontSize: 11, color: tk.primary, cursor: "pointer", background: "none", border: "none", padding: 0, textDecoration: "underline", outline: "none" }}
                                    onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                    onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                >
                                    Clear {label.toLowerCase()}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    // ── Render: Assigned-to filter checkbox panel ──────────────
    // String-valued sibling of renderFilterButton. Options come from
    // deptOptions (the assigned_to coded-value domain names) — the same
    // source the column-header Assigned filter and the reassign dropdown
    // use, so toolbar and column selections intersect cleanly.
    renderAssignedFilterButton() {
        const tk = this.tk;
        const { openFilter, fA, deptOptions } = this.state;
        const panel: FilterPanel = "assigned";
        const isOpen = openFilter === panel;
        const count = fA.length;
        const panelId = "rac-filter-assigned";
        const summary = count > 0 ? `${count} selected: ${fA.join(", ")}` : "None selected";

        return (
            <div style={{ flex: this.state.compact ? "1 1 calc(50% - 4px)" : 1, minWidth: 90, position: "relative" }}>
                <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-label={`Filter by Assigned. ${summary}`}
                    title={`Filter by Assigned — ${summary}`}
                    onClick={() => this.toggleFilterPanel(panel)}
                    onKeyDown={(e: any) => { if (e.key === "Escape") this.setState({ openFilter: "none" }); }}
                    style={{
                        width: "100%", padding: "4px 10px", fontSize: 12, fontWeight: 600,
                        border: count > 0 ? `1.5px solid ${tk.primary}` : `1px solid ${tk.divider}`,
                        background: count > 0 ? tk.infoBg : tk.surface,
                        color: count > 0 ? tk.primary : tk.text,
                        borderRadius: 99, cursor: "pointer", textAlign: "left", outline: "none",
                        transition: "border-color 0.15s, background 0.15s",
                    }}
                    onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                    onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                >
                    Assigned
                    {count > 0 && (
                        <span aria-hidden="true" style={{ background: tk.primary, color: tk.primaryText, borderRadius: 99, padding: "0 5px", fontSize: 10, marginLeft: 4 }}>
                            {count}
                        </span>
                    )}
                    <span aria-hidden="true" style={{ float: "right", fontSize: 9, marginTop: 1 }}>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                    <div
                        id={panelId}
                        role="group"
                        aria-label="Assigned filter options"
                        style={{
                            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
                            background: tk.surface, border: `1px solid ${tk.divider}`, borderRadius: 8,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.12)", maxHeight: 220,
                            overflowY: "auto",
                        }}
                    >
                        {(deptOptions || []).filter(Boolean).length === 0 && (
                            <div style={{ padding: "8px 10px", fontSize: 12, color: tk.textSecondary }}>No departments available</div>
                        )}
                        {(deptOptions || []).filter(Boolean).map((name: string) => {
                            const checked = fA.includes(name);
                            const cbId = `rac-cb-assigned-${name.replace(/[^a-zA-Z0-9]/g, "_")}`;
                            return (
                                <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: checked ? tk.infoBg : "transparent" }}>
                                    <input
                                        type="checkbox" id={cbId} checked={checked}
                                        onChange={() => this.toggleAssignedFilter(name)}
                                        aria-label={`${name}${checked ? " (selected)" : ""}`}
                                        style={{ width: 15, height: 15, cursor: "pointer", accentColor: tk.primary }}
                                    />
                                    <label htmlFor={cbId} style={{ fontSize: 12, color: tk.text, cursor: "pointer", flex: 1 }}>{name}</label>
                                </div>
                            );
                        })}
                        {count > 0 && (
                            <div style={{ borderTop: `1px solid ${tk.divider}`, padding: "5px 10px" }}>
                                <button
                                    type="button"
                                    onClick={() => this.setState({ fA: [], off: 0 } as any, () => { this.load(0); this.persistFilters(); })}
                                    aria-label="Clear all assigned filters"
                                    style={{ fontSize: 11, color: tk.primary, cursor: "pointer", background: "none", border: "none", padding: 0, textDecoration: "underline", outline: "none" }}
                                    onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                    onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                >
                                    Clear assigned
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    // ── Table column resize ────────────────────────────────────
    // Drag-resize state lives in instance variables (not React state)
    // because we need synchronous access from mousemove handlers fired
    // ~60 times per second. We also update DOM directly during drag —
    // setState on every mousemove would re-render the entire table
    // (potentially hundreds of cells) per frame and feel janky.
    // React state catches up once, on mouseup.
    private colResizeKey: string | null = null;
    private colResizeStartX = 0;
    private colResizeStartW = 0;
    private colResizeStartTableW = 0;
    private colResizeCurrentW = 0;

    startColResize = (e: React.MouseEvent, colKey: string) => {
        e.preventDefault();
        e.stopPropagation();
        let startW = this.state.tableColWidths[colKey];
        if (!startW) startW = COL_DEFAULT_WIDTH[colKey];
        if (!startW) {
            const cell = document.querySelector(`th[data-col-key="${colKey}"]`) as HTMLElement | null;
            if (cell) startW = cell.offsetWidth;
        }
        this.colResizeKey = colKey;
        this.colResizeStartX = e.clientX;
        this.colResizeStartW = startW || 120;
        this.colResizeCurrentW = this.colResizeStartW;
        // Capture the table's current minWidth so we can update it
        // proportionally during the drag. The table itself stays at
        // width: 100% (filling the container); minWidth is what makes
        // it grow beyond the container when columns exceed the visible
        // area.
        this.colResizeStartTableW = this.tableRef.current
            ? parseInt(this.tableRef.current.style.minWidth || "0", 10) || this.tableRef.current.offsetWidth
            : 0;

        this.setState({ colResizing: colKey });

        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        document.addEventListener("mousemove", this.handleColResizeMove);
        document.addEventListener("mouseup", this.handleColResizeEnd);
    };

    handleColResizeMove = (e: MouseEvent) => {
        if (!this.colResizeKey) return;
        const delta = e.clientX - this.colResizeStartX;
        let next = this.colResizeStartW + delta;
        if (next < COL_MIN_WIDTH) next = COL_MIN_WIDTH;
        if (next > COL_MAX_WIDTH) next = COL_MAX_WIDTH;

        // 1. Direct DOM update of the <col> element — this drives the
        //    column's width via tableLayout: fixed.
        const colEl = document.querySelector(
            `col[data-col-key="${this.colResizeKey}"]`
        ) as HTMLElement | null;
        if (colEl) colEl.style.width = `${next}px`;

        // 2. Update the table's minWidth so the table can grow beyond
        //    its container when the dragged column makes the sum of
        //    real columns exceed the visible area. When sum < container,
        //    minWidth has no visible effect and the trailing spacer
        //    column absorbs the slack.
        const widthChange = next - this.colResizeStartW;
        if (this.tableRef.current) {
            this.tableRef.current.style.minWidth = `${this.colResizeStartTableW + widthChange}px`;
        }

        this.colResizeCurrentW = next;
    };

    handleColResizeEnd = () => {
        document.removeEventListener("mousemove", this.handleColResizeMove);
        document.removeEventListener("mouseup", this.handleColResizeEnd);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        const key = this.colResizeKey;
        const finalW = this.colResizeCurrentW;
        this.colResizeKey = null;

        // Clear the inline minWidth the drag handler applied so the
        // table reverts to its width:100% compression model. Without
        // this, a column drag that grew the table past the container
        // would leave style.minWidth set, blocking the table from
        // shrinking when the user later narrows the sidebar.
        if (this.tableRef.current) {
            this.tableRef.current.style.minWidth = "";
        }

        if (key) {
            // Commit the final width to React state (and persist).
            // The component re-renders once here, picking up the
            // new column width and reconstructing the colgroup +
            // table width from state — matches the DOM exactly.
            this.setState(
                (p: St) => ({
                    tableColWidths: { ...p.tableColWidths, [key]: finalW },
                    colResizing: null,
                }),
                () => this.persistFilters()
            );
        } else {
            this.setState({ colResizing: null });
        }
    };

    // Keyboard resize: same clamp as the drag, committed straight to state.
    nudgeColWidth = (colKey: string, delta: number) => {
        this.setState((p: St) => {
            const cur = p.tableColWidths[colKey] || COL_DEFAULT_WIDTH[colKey] || 100;
            const next = Math.min(COL_MAX_WIDTH, Math.max(COL_MIN_WIDTH, cur + delta));
            return { tableColWidths: { ...p.tableColWidths, [colKey]: next } };
        }, () => this.persistFilters());
    };

    resetColWidth = (colKey: string) => {
        this.setState((p: St) => {
            const next = { ...p.tableColWidths };
            delete next[colKey];
            return { tableColWidths: next };
        }, () => this.persistFilters());
    };

    // ── Column-filter popover (table view) ─────────────────────
    // Rendered absolute-positioned inside the column's <th>. Triggered
    // by the funnel icon. Three flavors:
    //   • "text" — single text input (used for the # column)
    //   • "list" — checkbox list (Status, Priority, Category use coded
    //              values; Assigned uses department names; Activity
    //              uses badge-flag strings)
    //   • "date" — single-day date picker (Created column)
    renderColFilterPopover(colKey: string, kind: "text" | "list" | "date") {
        const tk = this.tk;
        const cf = this.state.tableColFilters;

        // The Activity column uses key="badges" in the columns array
        // (matching its display label), but the filter state lives at
        // tableColFilters.activity. All other columns use matching keys.
        const stateKey = colKey === "badges" ? "activity" : colKey;

        // For list-kind columns, build (value, label) pairs in display
        // order so the checkboxes render in a stable, predictable order.
        let listEntries: Array<{ value: any; label: string }> = [];
        if (kind === "list") {
            if (colKey === "status") listEntries = Object.entries(S).map(([k, v]) => ({ value: Number(k), label: v }));
            else if (colKey === "priority") listEntries = Object.entries(P).map(([k, v]) => ({ value: Number(k), label: v }));
            else if (colKey === "category") listEntries = Object.entries(C).map(([k, v]) => ({ value: Number(k), label: v }));
            else if (colKey === "assigned_to") {
                // Pull the canonical department list from state — same one
                // the toolbar reassign dropdown uses. Sorted, deduped.
                listEntries = (this.state.deptOptions || [])
                    .filter(Boolean)
                    .map(name => ({ value: name, label: name }));
            }
            else if (colKey === "badges") {
                // Activity badges — fixed three options, label matches
                // what's shown in the table column.
                listEntries = [
                    { value: "comments", label: "Has comments" },
                    { value: "photos", label: "Has photos" },
                    { value: "survey", label: "Has survey response" },
                ];
            }
        }

        // Close on Escape; click handler at the document level (set up
        // in componentDidMount as handleClickOutside) closes on outside-
        // click for the existing toolbar filters — we extend it below.
        const close = () => this.setState({ openColFilter: null });

        const popoverStyle: React.CSSProperties = {
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 2,
            background: tk.surface,
            border: `1px solid ${tk.divider}`,
            borderRadius: 6,
            boxShadow: "0 6px 16px rgba(0, 0, 0, 0.12)",
            padding: 8,
            minWidth: 200,
            maxWidth: 280,
            zIndex: 50,
            fontSize: 12,
            color: tk.text,
            textTransform: "none",        // override th's uppercase
            letterSpacing: "normal",
            fontWeight: 400,
            cursor: "default",
        };

        // Stop propagation so clicks inside don't close via th's outside-click handler.
        // We need to stop both `click` AND `mousedown` because the
        // document listener at the class level uses mousedown.
        const stop = (e: any) => e.stopPropagation();

        if (kind === "text") {
            const value = (cf as any)[colKey] as string;
            return (
                <div role="dialog" aria-label="Filter" style={popoverStyle} onClick={stop} onMouseDown={stop}>
                    <input
                        type="text"
                        autoFocus
                        value={value}
                        placeholder="Ticket # contains…"
                        aria-label={`Filter ${colKey}`}
                        onChange={(e: any) => this.setState((p: St) => ({
                            tableColFilters: { ...p.tableColFilters, [colKey]: e.target.value } as any,
                        }))}
                        onKeyDown={(e: any) => {
                            if (e.key === "Escape") { e.stopPropagation(); close(); }
                            if (e.key === "Enter") { e.preventDefault(); close(); }
                        }}
                        style={{
                            width: "100%", fontSize: 12, padding: "5px 8px",
                            border: `1px solid ${tk.divider}`, borderRadius: 4,
                            outline: "none", boxSizing: "border-box",
                            fontFamily: "monospace",
                        }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                        {value && (
                            <button
                                type="button"
                                onClick={() => this.setState((p: St) => ({
                                    tableColFilters: { ...p.tableColFilters, [colKey]: "" } as any,
                                }))}
                                style={{ fontSize: 11, padding: "3px 8px", border: "1px solid #fecaca", background: "#fef2f2", color: tk.danger, borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                            >Clear</button>
                        )}
                        <button
                            type="button"
                            onClick={close}
                            style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${tk.primary}`, background: tk.primary, color: tk.primaryText, borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                        >Done</button>
                    </div>
                </div>
            );
        }

        if (kind === "date") {
            const value = (cf as any)[colKey] as string;
            // Format today's date once for the helper button below.
            const todayISO = (() => {
                const d = new Date();
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            })();
            return (
                <div role="dialog" aria-label="Filter by date" style={popoverStyle} onClick={stop} onMouseDown={stop}>
                    <div style={{ fontSize: 11, color: tk.textSecondary, marginBottom: 4 }}>
                        Show tickets {colKey === "modified_date" ? "updated" : colKey === "resolved_date" ? "resolved" : "created"} on:
                    </div>
                    <input
                        type="date"
                        autoFocus
                        value={value}
                        aria-label={`Filter by ${colKey === "modified_date" ? "updated" : colKey === "resolved_date" ? "resolved" : "created"} date`}
                        onChange={(e: any) => this.setState((p: St) => ({
                            tableColFilters: { ...p.tableColFilters, [colKey]: e.target.value } as any,
                        }))}
                        onKeyDown={(e: any) => {
                            if (e.key === "Escape") { e.stopPropagation(); close(); }
                            if (e.key === "Enter") { e.preventDefault(); close(); }
                        }}
                        style={{
                            width: "100%", fontSize: 12, padding: "5px 8px",
                            border: `1px solid ${tk.divider}`, borderRadius: 4,
                            outline: "none", boxSizing: "border-box",
                            colorScheme: "light",
                        }}
                    />
                    {/* Quick "Today" shortcut — common ad-hoc lookup. */}
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button
                            type="button"
                            onClick={() => this.setState((p: St) => ({
                                tableColFilters: { ...p.tableColFilters, [colKey]: todayISO } as any,
                            }))}
                            disabled={value === todayISO}
                            style={{
                                fontSize: 11, padding: "3px 8px",
                                border: "1px solid", borderColor: value === todayISO ? tk.divider : tk.divider,
                                background: value === todayISO ? tk.background : tk.surface,
                                color: value === todayISO ? tk.textSecondary : tk.text,
                                borderRadius: 4,
                                cursor: value === todayISO ? "not-allowed" : "pointer",
                            }}
                        >Today</button>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", borderTop: `1px solid ${tk.divider}`, paddingTop: 8 }}>
                        {value && (
                            <button
                                type="button"
                                onClick={() => this.setState((p: St) => ({
                                    tableColFilters: { ...p.tableColFilters, [colKey]: "" } as any,
                                }))}
                                style={{ fontSize: 11, padding: "3px 8px", border: "1px solid #fecaca", background: "#fef2f2", color: tk.danger, borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                            >Clear</button>
                        )}
                        <button
                            type="button"
                            onClick={close}
                            style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${tk.primary}`, background: tk.primary, color: tk.primaryText, borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                        >Done</button>
                    </div>
                </div>
            );
        }

        // kind === "list" — checkbox list. Values may be numeric codes
        // (status/priority/category) or strings (assigned_to/activity).
        // The toggle helper handles either since it uses .includes() and
        // array filtering, which work generically. We use `stateKey` for
        // state reads/writes because the Activity column has colKey="badges"
        // but lives at tableColFilters.activity (see top of this method).
        const selected = (cf as any)[stateKey] as any[];
        const toggle = (val: any) => {
            this.setState((p: St) => {
                const cur = ((p.tableColFilters as any)[stateKey] as any[]);
                const next = cur.includes(val) ? cur.filter(c => c !== val) : [...cur, val];
                return { tableColFilters: { ...p.tableColFilters, [stateKey]: next } as any };
            });
        };
        const clearAll = () => this.setState((p: St) => ({
            tableColFilters: { ...p.tableColFilters, [stateKey]: [] } as any,
        }));

        return (
            <div role="dialog" aria-label="Filter" style={popoverStyle} onClick={stop} onMouseDown={stop}
                onKeyDown={(e: any) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
                <div style={{ maxHeight: 240, overflowY: "auto", padding: "2px 0" }}>
                    {listEntries.length === 0 && (
                        <div style={{ padding: "8px 6px", color: tk.textSecondary, fontSize: 11, fontStyle: "italic" }}>
                            No values available.
                        </div>
                    )}
                    {listEntries.map(({ value, label }) => {
                        const checked = selected.includes(value);
                        return (
                            <label
                                key={String(value)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "4px 6px", borderRadius: 4, cursor: "pointer",
                                    background: checked ? tk.infoBg : "transparent",
                                }}
                                onMouseEnter={(e: any) => { if (!checked) e.currentTarget.style.background = tk.background; }}
                                onMouseLeave={(e: any) => { if (!checked) e.currentTarget.style.background = "transparent"; }}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(value)}
                                    style={{ width: 14, height: 14, accentColor: tk.primary, cursor: "pointer" }}
                                />
                                {/* Column-specific row styling. Status / Priority
                                    re-use their table chip styles so the filter
                                    list visually mirrors what you'll see in the
                                    rows below; Category and Assigned use plain
                                    text since they have no chip treatment. */}
                                {colKey === "status" && (
                                    <span style={{ fontSize: 10, color: "#fff", padding: "1px 6px", borderRadius: 99, fontWeight: 600, background: SC[value as number] || tk.textSecondary }}>{label}</span>
                                )}
                                {colKey === "priority" && (
                                    <span style={{ fontSize: 10, padding: "1px 6px", border: `1.5px solid ${PC[value as number] || tk.textSecondary}`, borderRadius: 99, fontWeight: 600, color: PC[value as number] || tk.textSecondary }}>{label}</span>
                                )}
                                {colKey === "category" && (
                                    <span style={{ fontSize: 12 }}>{label}</span>
                                )}
                                {colKey === "assigned_to" && (
                                    <span style={{ fontSize: 12, color: tk.text }}>{label}</span>
                                )}
                                {colKey === "badges" && (
                                    <span style={{ fontSize: 12, color: tk.text, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                        {/* Small icon matching the column's emoji
                                            so the row reads at a glance. */}
                                        {value === "comments" && <span aria-hidden="true">💬</span>}
                                        {value === "photos" && <span aria-hidden="true">📷</span>}
                                        {value === "survey" && <span aria-hidden="true">⭐</span>}
                                        {label}
                                    </span>
                                )}
                            </label>
                        );
                    })}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "space-between", borderTop: `1px solid ${tk.divider}`, paddingTop: 8 }}>
                    <button
                        type="button"
                        onClick={clearAll}
                        disabled={selected.length === 0}
                        style={{
                            fontSize: 11, padding: "3px 8px",
                            border: "1px solid", borderColor: selected.length === 0 ? tk.divider : "#fecaca",
                            background: selected.length === 0 ? tk.background : "#fef2f2",
                            color: selected.length === 0 ? tk.textSecondary : tk.danger,
                            borderRadius: 4,
                            cursor: selected.length === 0 ? "not-allowed" : "pointer",
                            fontWeight: 600,
                        }}
                    >Clear</button>
                    <button
                        type="button"
                        onClick={close}
                        style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${tk.primary}`, background: tk.primary, color: tk.primaryText, borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                    >Done</button>
                </div>
            </div>
        );
    }

    // ── Render: ticket table view ─────────────────────────────
    // Alternative to the card view — denser, more data per row,
    // sortable column headers. Operates on the SAME data the cards do
    // (the current loaded page from this.state.tickets), so pagination,
    // search, filters, and badges all carry over without duplication.
    //
    // Sort behavior: header clicks set state.sortOrder (matching the
    // SORT_OPTS values where possible) and re-issue a server query —
    // identical to the existing sort dropdown. This keeps the table
    // sort consistent with the dropdown rather than diverging into a
    // separate client-side-only sort that breaks across pages.
    renderTicketTable(visibleTickets: any[], loading: boolean) {
        const tk = this.tk;
        const { sortOrder, commentsTable, surveyTable, tableColFilters } = this.state;

        // ─── Per-column quick filters ───────────────────────────
        // All field-based column filters are pushed into buildWhere()
        // and applied server-side. The activity filter (comments /
        // photos / survey badges) is also server-side — it routes
        // through refreshBadgeFilter() which pre-computes a
        // ticket_id IN(...) clause. So `visibleTickets` already
        // reflects every active filter; no client-side narrowing
        // happens here. The local copy is kept for symmetry with
        // any future client-only filters.
        const filteredTickets = visibleTickets;
        // `cf` is referenced further below by the funnel-icon active
        // state in each column header (lights up blue when that
        // column's filter has any selections).
        const cf = tableColFilters;

        // ─── Column definitions ────────────────────────────────
        // `sortValue` is the value that would go into state.sortOrder
        // when the user clicks the header. null means the column isn't
        // sortable server-side (e.g. computed columns like badges).
        // Widths come from the module-level COL_DEFAULT_WIDTH map so
        // they share a single source of truth with resetColWidth().
        const w = (k: string): string | undefined => {
            const v = COL_DEFAULT_WIDTH[k];
            return v && v > 0 ? `${v}px` : undefined;
        };
        const columns: Array<{
            key: string;
            label: string;
            sortAsc?: string;
            sortDesc?: string;
            width?: string;
            align?: "left" | "center" | "right";
        }> = [
                { key: "ticket_number", label: "#", sortAsc: "ticket_number ASC", sortDesc: "ticket_number DESC", width: w("ticket_number") },
                { key: "status", label: "Status", sortAsc: "status ASC,created_date DESC", sortDesc: "status DESC,created_date DESC", width: w("status") },
                { key: "priority", label: "Priority", sortAsc: "priority ASC,created_date DESC", sortDesc: "priority DESC,created_date DESC", width: w("priority") },
                { key: "category", label: "Category", sortAsc: "category ASC,created_date DESC", sortDesc: "category DESC,created_date DESC", width: w("category") },
                { key: "assigned_to", label: "Assigned", sortAsc: "assigned_to ASC,created_date DESC", sortDesc: "assigned_to DESC,created_date DESC", width: w("assigned_to") },
                { key: "created_date", label: "Created", sortAsc: "created_date ASC", sortDesc: "created_date DESC", width: w("created_date") },
                { key: "modified_date", label: "Updated", sortAsc: "modified_date ASC", sortDesc: "modified_date DESC", width: w("modified_date") },
                { key: "resolved_date", label: "Resolved", sortAsc: "resolved_date ASC", sortDesc: "resolved_date DESC", width: w("resolved_date") },
                { key: "badges", label: "Activity", width: w("badges"), align: "center" },
            ];

        // Helper: derive (column, direction) tuple from the current
        // sortOrder string so the active header can show its arrow.
        const currentSort = (col: typeof columns[number]): "asc" | "desc" | null => {
            if (col.sortAsc && sortOrder === col.sortAsc) return "asc";
            if (col.sortDesc && sortOrder === col.sortDesc) return "desc";
            return null;
        };

        // Clicking a sortable header: cycle asc → desc → (default).
        // Default = "created_date DESC" since that's our list-load default.
        const cycleSort = (col: typeof columns[number]) => {
            if (!col.sortAsc || !col.sortDesc) return;
            const cur = currentSort(col);
            let next: string;
            if (cur === null) next = col.sortDesc;
            else if (cur === "desc") next = col.sortAsc;
            else next = "created_date DESC";
            this.setState({ sortOrder: next, off: 0 }, () => { this.load(0); this.persistFilters(); });
        };

        const headerCellStyle: React.CSSProperties = {
            position: "sticky", top: 0, zIndex: 2,
            background: tk.background,
            borderBottom: `2px solid ${tk.divider}`,
            padding: "8px 10px",
            fontSize: 10,
            fontWeight: 700,
            color: tk.text,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            textAlign: "left",
            whiteSpace: "nowrap",
            userSelect: "none",
        };

        // Sum of declared column widths. When the container is wider
        // than this, columns sit at their declared widths and a trailing
        // spacer absorbs the slack. When narrower, the min() formula in
        // each <col>'s width clamps that column to its proportional
        // share of the container, giving smooth compression.
        const totalTableWidth = columns.reduce((sum, c) => {
            const saved = this.state.tableColWidths[c.key];
            const w = (typeof saved === "number" && saved > 0)
                ? saved
                : (COL_DEFAULT_WIDTH[c.key] || 100);
            return sum + w;
        }, 0) || 1; // guard against divide-by-zero

        return (
            <div
                style={{
                    flex: 1,
                    overflow: "auto",
                    background: tk.surface,
                    // min-width: 0 lets this flex item shrink below its
                    // content's intrinsic width (default for flex items
                    // is min-content). Without this, the table's column
                    // sum would push the container wider than the
                    // sidebar, defeating the compression.
                    minWidth: 0,
                    // Establish an inline-size container so each <col>
                    // can size relative to this region via cqw units.
                    containerType: "inline-size",
                }}
                role="region"
                aria-label="Ticket table"
                aria-busy={loading}
                onClick={() => { this.setState({ openFilter: "none" }); this.clearHoverHl(); }}
            >
                <style>{`
                    .rac-ttbl th, .rac-ttbl td { border-right: 1px solid ${tk.divider}; }
                    .rac-ttbl th:last-child, .rac-ttbl td:last-child { border-right: none; }
                `}</style>
                <table
                    className="rac-ttbl"
                    role="grid"
                    aria-label="Tickets"
                    aria-rowcount={visibleTickets.length}
                    ref={this.tableRef}
                    style={{
                        // width: 100% of the table region. Each <col>
                        // declares min(declaredPx, share-of-container)
                        // so columns sit at their pixel widths when
                        // space allows and proportionally compress
                        // when the sidebar is narrower than the sum.
                        //
                        // The trailing spacer <col> (no declared width)
                        // absorbs leftover space when the container
                        // exceeds the column sum.
                        //
                        // The column-resize drag handler temporarily
                        // sets style.minWidth so the table can grow
                        // past the container during the drag; that
                        // override is cleared on mouseup
                        // (handleColResizeEnd).
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 12,
                        tableLayout: "fixed",
                    }}
                >
                    <colgroup>
                        {columns.map(c => {
                            const savedW = this.state.tableColWidths[c.key];
                            const w = typeof savedW === "number" && savedW > 0
                                ? savedW
                                : (COL_DEFAULT_WIDTH[c.key] || 100);
                            // Each column's width is the SMALLER of its
                            // declared pixel width or its proportional
                            // share of the container's inline size.
                            //   • container >= totalTableWidth  →
                            //     min() picks ${w}px, column sits at
                            //     its declared width.
                            //   • container <  totalTableWidth  →
                            //     min() picks the cqw value, column
                            //     compresses proportionally with peers.
                            // cqw = 1% of the nearest query container's
                            // inline size; the table region above sets
                            // containerType: 'inline-size' to enable it.
                            const sharePct = (w / totalTableWidth) * 100;
                            // Floor at the column's readable minimum (but never
                            // above the user's own width if they dragged it
                            // smaller). Once floors sum past the container the
                            // table overflows and the region scrolls.
                            const floor = Math.min(COL_FLOOR_WIDTH[c.key] || 60, w);
                            return (
                                <col
                                    key={c.key}
                                    data-col-key={c.key}
                                    style={{ width: `max(${floor}px, min(${w}px, ${sharePct.toFixed(4)}cqw))` }}
                                />
                            );
                        })}
                        {/* Spacer column — no width specified, so with
                            tableLayout:fixed it absorbs any space left over
                            when the container is wider than the sum of real
                            columns. Stays at 0 when the table is at exactly
                            its column sum, scrolls off-screen when wider. */}
                        <col data-col-key="__spacer__" />
                    </colgroup>
                    <thead>
                        <tr>
                            {columns.map(col => {
                                const sortable = !!(col.sortAsc && col.sortDesc);
                                const dir = currentSort(col);

                                // Which columns get a filter icon, and what
                                // kind of popover do they open?
                                //   text   → single text input
                                //   list   → checkbox list (coded values,
                                //            department names, or activity flags)
                                //   date   → single-day date picker
                                const filterKind: "text" | "list" | "date" | null =
                                    col.key === "ticket_number" ? "text"
                                        : col.key === "status" ? "list"
                                            : col.key === "priority" ? "list"
                                                : col.key === "category" ? "list"
                                                    : col.key === "assigned_to" ? "list"
                                                        : col.key === "badges" ? "list"
                                                            : col.key === "created_date" ? "date"
                                                                : col.key === "modified_date" ? "date"
                                                                    : col.key === "resolved_date" ? "date"
                                                                        : null;

                                // Map this column's key to its filter-state
                                // key. Most columns are 1:1; Activity is the
                                // outlier (column key="badges" → state key
                                // "activity"). Created column uses key
                                // "created_date" matching its state key.
                                const stateKey = col.key === "badges" ? "activity" : col.key;

                                // Is this column's filter currently active?
                                let isFiltered = false;
                                if (filterKind === "text" || filterKind === "date") {
                                    isFiltered = (cf as any)[stateKey] !== "";
                                } else if (filterKind === "list") {
                                    isFiltered = ((cf as any)[stateKey] as any[]).length > 0;
                                }
                                const popoverOpen = this.state.openColFilter === col.key;

                                // Is this the last column? The rightmost
                                // column doesn't get a resize handle — there's
                                // nothing to its right to push against, and a
                                // handle on the table's right edge would
                                // conflict with the container scrollbar.
                                const isLastColumn = col === columns[columns.length - 1];

                                return (
                                    <th
                                        key={col.key}
                                        scope="col"
                                        data-col-key={col.key}
                                        aria-sort={
                                            dir === "asc" ? "ascending" :
                                                dir === "desc" ? "descending" :
                                                    sortable ? "none" : undefined
                                        }
                                        style={{
                                            ...headerCellStyle,
                                            textAlign: col.align || "left",
                                            position: "sticky",
                                            // Pad the right edge so the cell's inner content
                                            // (label + funnel icon) never runs under the
                                            // absolute-positioned resize handle in the
                                            // rightmost 8px of the cell.
                                            paddingRight: 14,
                                        }}
                                    >
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "100%", minWidth: 0 }}>
                                            {/* Sortable label area — clickable; cycles sort */}
                                            <span
                                                role={sortable ? "button" : undefined}
                                                tabIndex={sortable ? 0 : -1}
                                                title={sortable ? "Click to sort" : undefined}
                                                onClick={(e: any) => { e.stopPropagation(); if (sortable) cycleSort(col); }}
                                                onKeyDown={(e: any) => {
                                                    if (sortable && (e.key === "Enter" || e.key === " ")) {
                                                        e.preventDefault();
                                                        cycleSort(col);
                                                    }
                                                }}
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 3,
                                                    cursor: sortable ? "pointer" : "default",
                                                    flex: 1,
                                                    minWidth: 0,
                                                    overflow: "hidden",
                                                }}
                                            >
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{col.label}</span>
                                                {sortable && (
                                                    <span aria-hidden="true" style={{ fontSize: 9, opacity: dir ? 1 : 0.3, marginTop: 1, flexShrink: 0 }}>
                                                        {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
                                                    </span>
                                                )}
                                            </span>

                                            {/* Filter icon — only on filterable columns. */}
                                            {filterKind && (
                                                <button
                                                    type="button"
                                                    aria-label={`Filter ${col.label}${isFiltered ? " (filter active)" : ""}`}
                                                    aria-haspopup="dialog"
                                                    aria-expanded={popoverOpen}
                                                    title={isFiltered ? `Filter active — click to edit` : `Filter ${col.label}`}
                                                    onMouseDown={(e: any) => e.stopPropagation()}
                                                    onClick={(e: any) => {
                                                        e.stopPropagation();
                                                        this.setState({ openColFilter: popoverOpen ? null : col.key });
                                                    }}
                                                    style={{
                                                        border: "none",
                                                        background: "transparent",
                                                        cursor: "pointer",
                                                        padding: 2,
                                                        borderRadius: 3,
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        flexShrink: 0,
                                                        opacity: isFiltered ? 1 : 0.45,
                                                        color: isFiltered ? tk.primary : tk.textSecondary,
                                                        outline: "none",
                                                    }}
                                                    onMouseEnter={(e: any) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = tk.divider; }}
                                                    onMouseLeave={(e: any) => { e.currentTarget.style.opacity = isFiltered ? "1" : "0.45"; e.currentTarget.style.background = "transparent"; }}
                                                    onFocus={(e: any) => { e.currentTarget.style.boxShadow = "0 0 0 2px #93c5fd"; }}
                                                    onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                                >
                                                    {/* Funnel icon */}
                                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                                        <path d="M1.5 2.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 .58 1.22L10 8.21V13a.75.75 0 0 1-1.11.66l-2.5-1.38A.75.75 0 0 1 6 11.62V8.21L1.42 2.72A.75.75 0 0 1 1.5 2.25z" />
                                                    </svg>
                                                </button>
                                            )}
                                        </span>

                                        {/* Popover — only the one matching openColFilter renders. */}
                                        {popoverOpen && this.renderColFilterPopover(col.key, filterKind!)}

                                        {/* Column resize handle.
                                            Industry-standard treatment:
                                              • 8px hit zone on the right edge of the cell
                                                (entirely inside this column — never overlaps
                                                the next column's funnel or content)
                                              • 2px visible bar right-aligned within the hit
                                                zone, sitting on the column boundary line
                                              • Default: a clear gray divider so users can
                                                see where the boundaries are at a glance
                                              • Hover: 3px and city-blue
                                              • Drag: 3px and city-blue, persistent throughout */}
                                        {!isLastColumn && (() => {
                                            const isBeingDragged = this.state.colResizing === col.key;
                                            return (
                                                <span
                                                    role="separator"
                                                    aria-orientation="vertical"
                                                    aria-label={`Resize ${col.label} column`}
                                                    aria-valuenow={this.state.tableColWidths[col.key] || COL_DEFAULT_WIDTH[col.key] || 100}
                                                    aria-valuemin={COL_MIN_WIDTH}
                                                    aria-valuemax={COL_MAX_WIDTH}
                                                    title="Drag to resize · double-click to reset · arrow keys with the keyboard"
                                                    tabIndex={0}
                                                    onMouseDown={(e: any) => this.startColResize(e, col.key)}
                                                    onDoubleClick={(e: any) => {
                                                        e.stopPropagation();
                                                        this.resetColWidth(col.key);
                                                    }}
                                                    // Keyboard: left and right arrows change the width by 10px,
                                                    // Home puts the default back (Section 11.4, custom controls).
                                                    onKeyDown={(e: any) => {
                                                        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home") return;
                                                        e.preventDefault(); e.stopPropagation();
                                                        if (e.key === "Home") { this.resetColWidth(col.key); return; }
                                                        this.nudgeColWidth(col.key, e.key === "ArrowLeft" ? -10 : 10);
                                                    }}
                                                    onFocus={(e: any) => { e.currentTarget.style.outline = `2px solid ${tk.primary}`; e.currentTarget.style.outlineOffset = "-2px"; }}
                                                    onBlur={(e: any) => { e.currentTarget.style.outline = "none"; }}
                                                    style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        right: 0,
                                                        bottom: 0,
                                                        width: 8,
                                                        cursor: "col-resize",
                                                        userSelect: "none",
                                                        background: "transparent",
                                                        zIndex: 4,
                                                    }}
                                                    onMouseEnter={(e: any) => {
                                                        const bar = e.currentTarget.firstChild as HTMLElement;
                                                        if (bar) { bar.style.background = tk.primary; bar.style.width = "3px"; }
                                                    }}
                                                    onMouseLeave={(e: any) => {
                                                        if (isBeingDragged) return;
                                                        const bar = e.currentTarget.firstChild as HTMLElement;
                                                        if (bar) { bar.style.background = tk.textSecondary; bar.style.width = "2px"; }
                                                    }}
                                                >
                                                    {/* The visible bar — pinned to the right
                                                        edge of the 8px hit zone, which is also
                                                        the right edge of the column. So users
                                                        see a clean vertical divider on every
                                                        column boundary. */}
                                                    <span
                                                        style={{
                                                            position: "absolute",
                                                            right: 0,
                                                            top: 0,
                                                            bottom: 0,
                                                            width: isBeingDragged ? 3 : 2,
                                                            background: isBeingDragged ? tk.primary : tk.textSecondary,
                                                            pointerEvents: "none",
                                                            transition: "background 80ms, width 80ms",
                                                        }}
                                                    />
                                                </span>
                                            );
                                        })()}
                                    </th>
                                );
                            })}
                            {/* Spacer header cell — empty, with the same
                                visual treatment as other headers so the
                                background bar continues to the right edge
                                of the table when there's slack. */}
                            <th aria-hidden="true" style={headerCellStyle} />
                        </tr>
                    </thead>
                    <tbody>
                        {loading
                            ? Array.from({ length: 8 }, (_, i) => (
                                <tr key={i}>
                                    {columns.map(col => (
                                        <td key={col.key} style={{ padding: "10px", borderBottom: `1px solid ${tk.divider}` }}>
                                            <span style={{
                                                display: "block",
                                                height: 12,
                                                background: "linear-gradient(90deg, #f3f4f6, #e5e7eb, #f3f4f6)",
                                                backgroundSize: "200% 100%",
                                                animation: "rac-shimmer 1.4s linear infinite",
                                                borderRadius: 3,
                                            }} />
                                        </td>
                                    ))}
                                    {/* Spacer cell — matches header spacer */}
                                    <td aria-hidden="true" style={{ borderBottom: `1px solid ${tk.divider}` }} />
                                </tr>
                            ))
                            : filteredTickets.length === 0
                                ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} style={{ padding: 30, textAlign: "center", color: tk.textSecondary, fontStyle: "italic" }}>
                                            No tickets match the current filters.
                                        </td>
                                    </tr>
                                )
                                : filteredTickets.map((t: any) => {
                                    const statusLabel = statusLabelOf(t.status);
                                    const catLabel = categoryLabel(t.category);
                                    const priLabel = priorityLabel(t.priority);
                                    const scLabel = this.subcatLabel(t.subcategory);
                                    const fullCat = catLabel + (scLabel ? ` — ${scLabel}` : "");
                                    const badge = this.state.badges[t.ticket_id];
                                    const rowLabel = `Ticket ${t.ticket_number != null ? "#" + t.ticket_number + ", " : ""}${fullCat}, status ${statusLabel}, priority ${priLabel}`;
                                    return (
                                        <tr
                                            key={t.OBJECTID}
                                            tabIndex={0}
                                            role="row"
                                            aria-label={rowLabel}
                                            onClick={(e: any) => { e.stopPropagation(); this.clearHoverHl(); this.select(t); }}
                                            onKeyDown={(e: any) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); this.clearHoverHl(); this.select(t); } }}
                                            onMouseEnter={(e: any) => {
                                                e.currentTarget.style.background = tk.background;
                                                this.hoverHighlight(t.OBJECTID);
                                            }}
                                            onMouseLeave={(e: any) => {
                                                if (document.activeElement !== e.currentTarget) e.currentTarget.style.background = tk.surface;
                                                this.clearHoverHl();
                                            }}
                                            onFocus={(e: any) => { e.currentTarget.style.background = tk.infoBg; e.currentTarget.style.outline = "2px solid #93c5fd"; e.currentTarget.style.outlineOffset = "-2px"; }}
                                            onBlur={(e: any) => { e.currentTarget.style.background = tk.surface; e.currentTarget.style.outline = "none"; }}
                                            style={{ cursor: "pointer", background: tk.surface, transition: "background 0.12s" }}
                                        >
                                            {/* # */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}`, borderLeft: `3px solid ${SC[t.status] || tk.divider}` }}>
                                                {t.ticket_number != null ? (
                                                    <span style={{ fontFamily: "monospace", fontSize: 12, color: tk.primary, fontWeight: 700 }}>#{t.ticket_number}</span>
                                                ) : (
                                                    <span style={{ color: tk.textSecondary, fontSize: 11 }}>—</span>
                                                )}
                                            </td>
                                            {/* Status chip */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}` }}>
                                                <span style={{ display: "inline-block", fontSize: 10, color: "#fff", padding: "2px 7px", borderRadius: 99, fontWeight: 600, background: SC[t.status] || tk.textSecondary, letterSpacing: "0.02em", whiteSpace: "normal" }}>{statusLabel}</span>
                                            </td>
                                            {/* Priority chip */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}` }}>
                                                <span style={{ display: "inline-block", fontSize: 10, padding: "1px 6px", border: `1.5px solid ${PC[t.priority] || tk.textSecondary}`, borderRadius: 99, fontWeight: 600, color: PC[t.priority] || tk.textSecondary, whiteSpace: "normal" }}>{priLabel}</span>
                                            </td>
                                            {/* Category */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}`, color: tk.text, verticalAlign: "top" }} title={fullCat}>
                                                <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3, whiteSpace: "normal", overflowWrap: "break-word" }}>{catLabel}</div>
                                                {scLabel && <div style={{ fontSize: 11, color: tk.textSecondary, whiteSpace: "normal", overflowWrap: "break-word" }}>{scLabel}</div>}
                                            </td>
                                            {/* Assigned to */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}`, verticalAlign: "top" }} title={t.assigned_to || undefined}>
                                                {t.assigned_to ? (
                                                    <span style={{ fontSize: 12, color: tk.primary, fontWeight: 600, whiteSpace: "normal", overflowWrap: "break-word" }}>{t.assigned_to}</span>
                                                ) : (
                                                    <span style={{ color: tk.textSecondary, fontSize: 11 }}>—</span>
                                                )}
                                            </td>
                                            {/* Created date */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}`, color: tk.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={fmt(t.created_date)}>
                                                {agoDate(t.created_date)}
                                            </td>
                                            {/* Updated date */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}`, color: tk.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={fmt(t.modified_date)}>
                                                {t.modified_date ? agoDate(t.modified_date) : <span style={{ color: tk.divider }}>—</span>}
                                            </td>
                                            {/* Resolved date */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}`, color: tk.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={fmt(t.resolved_date)}>
                                                {t.resolved_date ? agoDate(t.resolved_date) : <span style={{ color: tk.divider }}>—</span>}
                                            </td>
                                            {/* Badges */}
                                            <td style={{ padding: "8px 10px", borderBottom: `1px solid ${tk.divider}`, textAlign: "center" }}>
                                                {badge && (badge.comments > 0 || badge.photos > 0 || badge.survey) ? (
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", justifyContent: "center" }}>
                                                        {badge.comments > 0 && (
                                                            <span title={(badge.comments !== 1 ? t('commentsComments', { comments: badge.comments }) : t('commentsComment', { comments: badge.comments }))} style={{ fontSize: 10, background: tk.infoBg, color: tk.primary, borderRadius: 99, padding: "1px 6px", fontWeight: 600, border: "1px solid #bfdbfe" }}>💬 {badge.comments}</span>
                                                        )}
                                                        {badge.photos > 0 && (
                                                            <span title={(badge.photos !== 1 ? t('photosPhotos', { photos: badge.photos }) : t('photosPhoto', { photos: badge.photos }))} style={{ fontSize: 10, background: tk.warningBg, color: tk.warning, borderRadius: 99, padding: "1px 6px", fontWeight: 600, border: "1px solid #fde68a" }}>📷 {badge.photos}</span>
                                                        )}
                                                        {badge.survey && (
                                                            <span title={t('surveyResponseReceived')} style={{ fontSize: 10, background: "#f0fdf4", color: "#15803d", borderRadius: 99, padding: "1px 6px", fontWeight: 600, border: "1px solid #bbf7d0" }}>⭐</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: tk.divider, fontSize: 11 }}>—</span>
                                                )}
                                            </td>
                                            {/* Spacer cell — absorbs slack
                                                when container > column sum,
                                                stays 0 otherwise. */}
                                            <td aria-hidden="true" style={{ borderBottom: `1px solid ${tk.divider}` }} />
                                        </tr>
                                    );
                                })
                        }
                    </tbody>
                </table>
            </div>
        );
    }

    // ── Render: list ───────────────────────────────────────────
    renderList() {
        const tk = this.tk;
        const { tickets, loading, exporting, total, off, search, fS, fC, fP, fA, fDateFrom, fDateTo,
            fHasComments, fHasSurvey, fHasPhotos, ready, extentFilter, sortOrder, compact } = this.state;

        const visibleTickets = tickets;

        const end = Math.min(off + PG, total);
        // Toolbar filters
        const hasToolbarFilters = fS.length > 0 || fC.length > 0 || fP.length > 0 || fA.length > 0
            || search.trim() !== "" || fDateFrom !== "" || fDateTo !== ""
            || fHasComments || fHasSurvey || fHasPhotos || extentFilter;
        // Table column filters (table view only — checked here so the
        // shared Clear All button can wipe them too in one click)
        const tcf = this.state.tableColFilters;
        const hasTableColFilters =
            tcf.ticket_number !== "" ||
            tcf.status.length > 0 ||
            tcf.priority.length > 0 ||
            tcf.category.length > 0 ||
            tcf.assigned_to.length > 0 ||
            tcf.activity.length > 0 ||
            tcf.created_date !== "";
        const hasFilters = hasToolbarFilters || hasTableColFilters;
        const pageNum = Math.floor(off / PG) + 1;
        const totalPages = Math.max(1, Math.ceil(total / PG));

        if (!ready) return <div role="status" style={{ padding: 20, textAlign: "center", color: tk.textSecondary }}>Connecting to map...</div>;

        return (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }} role="region" aria-label="Ticket list">

                <div ref={this.filterRef} style={{ padding: "10px 10px 0", borderBottom: `1px solid ${tk.divider}`, background: tk.surface }}>

                    {/* Search row */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }} role="search" aria-label="Search tickets">
                        <TextInput
                            style={{ flex: 1 }}
                            placeholder="Search tickets…"
                            value={search}
                            aria-label="Search tickets by number, description, or address"
                            title="Search by ticket number, description, or address"
                            onChange={(e: any) => this.setState({ search: e.target.value })}
                            onKeyDown={(e: any) => { if (e.key === "Enter") this.setState({ off: 0, openFilter: "none" }, () => { this.load(0); this.persistFilters(); }); }}
                        />
                        <Button size="sm" type="primary" onClick={() => this.setState({ off: 0, openFilter: "none" }, () => { this.load(0); this.persistFilters(); })} aria-label="Search">
                            Search
                        </Button>
                        {this.renderHelpButton()}
                    </div>

                    {/* Filter buttons row */}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }} role="toolbar" aria-label="Filter tickets">
                        {this.renderFilterButton("Status", "status", fS, S, SC)}
                        {this.renderFilterButton("Category", "category", fC, C)}
                        {this.renderFilterButton("Priority", "priority", fP, P, PC)}
                        {this.renderAssignedFilterButton()}
                        {hasFilters && (
                            <Button
                                size="sm"
                                style={{ flexShrink: 0 }}
                                title="Clear all filters, search, date range, and column filters"
                                aria-label="Clear all filters"
                                onClick={() => this.setState(
                                    {
                                        // Toolbar filters
                                        search: "", fS: [], fC: [], fP: [], fA: [], fDateFrom: "", fDateTo: "",
                                        fHasComments: false, fHasSurvey: false, fHasPhotos: false,
                                        badgeTicketIds: null, off: 0, openFilter: "none",
                                        // Map extent filter (spatial narrowing toggle)
                                        extentFilter: false,
                                        // Table column filters (transient; only visible in table view)
                                        tableColFilters: {
                                            ticket_number: "",
                                            status: [], priority: [], category: [], assigned_to: [],
                                            activity: [],
                                            created_date: "",
                                            modified_date: "",
                                            resolved_date: "",
                                        },
                                        openColFilter: null,
                                    },
                                    () => { this.load(0); this.persistFilters(); }
                                )}
                            >
                                Clear All
                            </Button>
                        )}
                    </div>

                    {/* Badge filter toggles — client-side, no re-query needed */}
                    {(this.state.commentsTable || this.state.surveyTable) && (
                        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                            {this.state.commentsTable && (
                                <button
                                    type="button"
                                    aria-pressed={fHasComments}
                                    title="Show only tickets that have at least one comment"
                                    onClick={() => this.setState(
                                        (p: St) => ({ fHasComments: !p.fHasComments }),
                                        () => { this.persistFilters(); this.refreshBadgeFilter(); }
                                    )}
                                    style={{
                                        fontSize: 11, fontWeight: 600, padding: "3px 10px",
                                        border: fHasComments ? `1.5px solid ${tk.primary}` : `1px solid ${tk.divider}`,
                                        background: fHasComments ? tk.infoBg : tk.surface,
                                        color: fHasComments ? tk.primary : tk.textSecondary,
                                        borderRadius: 99, cursor: "pointer", outline: "none",
                                        transition: "border-color 0.15s, background 0.15s",
                                    }}
                                    onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                    onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                >
                                    💬 Has Comments
                                </button>
                            )}
                            {this.state.surveyTable && (
                                <button
                                    type="button"
                                    aria-pressed={fHasSurvey}
                                    title="Show only tickets that have a survey response"
                                    onClick={() => this.setState(
                                        (p: St) => ({ fHasSurvey: !p.fHasSurvey }),
                                        () => { this.persistFilters(); this.refreshBadgeFilter(); }
                                    )}
                                    style={{
                                        fontSize: 11, fontWeight: 600, padding: "3px 10px",
                                        border: fHasSurvey ? "1.5px solid #16a34a" : `1px solid ${tk.divider}`,
                                        background: fHasSurvey ? "#f0fdf4" : tk.surface,
                                        color: fHasSurvey ? "#15803d" : tk.textSecondary,
                                        borderRadius: 99, cursor: "pointer", outline: "none",
                                        transition: "border-color 0.15s, background 0.15s",
                                    }}
                                    onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                    onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                >
                                    ⭐ Has Survey
                                </button>
                            )}
                            <button
                                type="button"
                                aria-pressed={fHasPhotos}
                                title="Show only tickets that have photos"
                                onClick={() => this.setState(
                                    (p: St) => ({ fHasPhotos: !p.fHasPhotos }),
                                    () => { this.persistFilters(); this.refreshBadgeFilter(); }
                                )}
                                style={{
                                    fontSize: 11, fontWeight: 600, padding: "3px 10px",
                                    border: fHasPhotos ? `1.5px solid ${tk.warning}` : `1px solid ${tk.divider}`,
                                    background: fHasPhotos ? tk.warningBg : tk.surface,
                                    color: fHasPhotos ? tk.warning : tk.textSecondary,
                                    borderRadius: 99, cursor: "pointer", outline: "none",
                                    transition: "border-color 0.15s, background 0.15s",
                                }}
                                onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                            >
                                📷 Has Photos
                            </button>
                        </div>
                    )}

                    {/* Date range row */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                        <label style={{ fontSize: 11, color: tk.textSecondary, fontWeight: 600, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date</label>
                        <input
                            type="date" value={fDateFrom}
                            aria-label="Filter from date"
                            title="Filter tickets created on or after this date"
                            style={{ fontSize: 12, padding: "3px 8px", border: `1px solid ${tk.divider}`, borderRadius: 6, flex: 1, minWidth: 120, color: tk.text, outline: "none" }}
                            onChange={(e: any) => this.setState({ fDateFrom: e.target.value, off: 0 }, () => { this.load(0); this.persistFilters(); })}
                        />
                        <span style={{ fontSize: 11, color: tk.textSecondary }}>to</span>
                        <input
                            type="date" value={fDateTo}
                            aria-label="Filter to date"
                            title="Filter tickets created on or before this date"
                            style={{ fontSize: 12, padding: "3px 8px", border: `1px solid ${tk.divider}`, borderRadius: 6, flex: 1, minWidth: 120, color: tk.text, outline: "none" }}
                            onChange={(e: any) => this.setState({ fDateTo: e.target.value, off: 0 }, () => { this.load(0); this.persistFilters(); })}
                        />
                    </div>

                    {/* Sort + extent filter row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBottom: 10 }}>
                        <label htmlFor="rac-sort" style={{ fontSize: 11, color: tk.textSecondary, fontWeight: 600, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.05em" }}>Sort</label>
                        <select
                            id="rac-sort"
                            value={sortOrder}
                            aria-label="Sort tickets"
                            title="Choose sort order for ticket list"
                            style={{ fontSize: 12, padding: "3px 8px", border: `1px solid ${tk.divider}`, borderRadius: 6, flex: compact ? "1 1 calc(100% - 50px)" : 1, minWidth: 120, background: tk.surface, color: tk.text, outline: "none" }}
                            onChange={(e: any) => this.setState({ sortOrder: e.target.value, off: 0 }, () => { this.load(0); this.persistFilters(); })}
                        >
                            {SORT_OPTS.filter(o => {
                                if (o.value.startsWith("_comments")) return !!this.state.commentsTable;
                                if (o.value.startsWith("_survey")) return !!this.state.surveyTable;
                                return true;
                            }).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>

                        {/* View-mode toggle — Cards (default) vs Table.
                            Choice persists in localStorage alongside filters
                            and sort, so a user who prefers the table view
                            sees it on every revisit. */}
                        <div
                            role="radiogroup"
                            aria-label="List view style"
                            style={{ display: "inline-flex", border: `1px solid ${tk.divider}`, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}
                        >
                            {(["cards", "table"] as const).map((mode, i) => {
                                const active = this.state.viewMode === mode;
                                const label = mode === "cards" ? "Cards" : "Table";
                                const titleTxt = mode === "cards"
                                    ? "Card view — compact, mobile-friendly list"
                                    : "Table view — sortable columns with all fields visible";
                                return (
                                    <button
                                        key={mode}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        title={titleTxt}
                                        onClick={() => {
                                            if (active) return;
                                            this.setState({ viewMode: mode }, () => this.persistFilters());
                                        }}
                                        style={{
                                            display: "inline-flex", alignItems: "center", gap: 4,
                                            fontSize: 11, fontWeight: 600,
                                            padding: "4px 10px",
                                            background: active ? tk.primary : tk.surface,
                                            color: active ? tk.primaryText : tk.text,
                                            border: "none",
                                            borderLeft: i > 0 ? `1px solid ${tk.divider}` : "none",
                                            cursor: active ? "default" : "pointer",
                                            outline: "none",
                                            letterSpacing: "0.03em",
                                            textTransform: "uppercase",
                                            transition: "background 0.15s",
                                        }}
                                        onMouseEnter={(e: any) => { if (!active) e.currentTarget.style.background = tk.background; }}
                                        onMouseLeave={(e: any) => { if (!active) e.currentTarget.style.background = tk.surface; }}
                                        onFocus={(e: any) => { e.currentTarget.style.boxShadow = "inset 0 0 0 2px #93c5fd"; }}
                                        onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                    >
                                        {/* tiny icon: 3 horizontal bars for cards, grid for table */}
                                        {mode === "cards" ? (
                                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                                <rect x="1" y="2" width="14" height="3" rx="1" />
                                                <rect x="1" y="6.5" width="14" height="3" rx="1" />
                                                <rect x="1" y="11" width="14" height="3" rx="1" />
                                            </svg>
                                        ) : (
                                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                                                <rect x="1.5" y="1.5" width="13" height="13" rx="1" />
                                                <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" />
                                                <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" />
                                                <line x1="5.5" y1="1.5" x2="5.5" y2="14.5" />
                                                <line x1="10.5" y1="1.5" x2="10.5" y2="14.5" />
                                            </svg>
                                        )}
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                        <label
                            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: extentFilter ? tk.primary : tk.textSecondary, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                            title="Only show tickets visible in the current map view"
                        >
                            <input
                                type="checkbox"
                                checked={extentFilter}
                                onChange={() => this.setState((p: St) => ({ extentFilter: !p.extentFilter, off: 0 }), () => this.load(0))}
                                aria-label="Filter by current map extent"
                                style={{ width: 15, height: 15, accentColor: tk.primary }}
                            />
                            Map extent
                        </label>
                    </div>
                </div>

                {/* Result count + export + refresh */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, padding: "5px 10px", borderBottom: `1px solid ${tk.divider}`, background: tk.surface }}>
                    <div role="status" aria-live="polite" style={{ fontSize: 11, color: tk.textSecondary, minWidth: 0 }}>
                        {total > 0
                            ? <><strong style={{ color: tk.text }}>{end - off}</strong> of <strong style={{ color: tk.text }}>{total.toLocaleString()}</strong> tickets &middot; pg {pageNum}/{totalPages}</>
                            : "No tickets found"
                        }
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>

                        {/* Export to Excel button */}
                        <button
                            type="button"
                            title={total > 0 ? `Export all ${total.toLocaleString()} matching tickets to Excel` : "No tickets to export"}
                            aria-label={exporting ? "Exporting to Excel, please wait..." : `Export ${total.toLocaleString()} tickets to Excel`}
                            onClick={this.exportToExcel}
                            disabled={exporting || loading || total === 0}
                            style={{
                                display: "flex", alignItems: "center", gap: 4,
                                fontSize: 12, fontWeight: 500,
                                color: (exporting || loading || total === 0) ? tk.textSecondary : "#15803d",
                                padding: "4px 10px",
                                border: "1px solid",
                                borderColor: (exporting || loading || total === 0) ? tk.divider : "#bbf7d0",
                                borderRadius: 6,
                                background: (exporting || loading || total === 0) ? tk.background : "#f0fdf4",
                                cursor: (exporting || loading || total === 0) ? "not-allowed" : "pointer",
                                outline: "none",
                            }}
                            onMouseEnter={(e: any) => { if (!exporting && !loading && total > 0) e.currentTarget.style.background = "#dcfce7"; }}
                            onMouseLeave={(e: any) => { e.currentTarget.style.background = (exporting || loading || total === 0) ? tk.background : "#f0fdf4"; }}
                            onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                            onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                        >
                            <svg aria-hidden="true" width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M3 3h14v14H3V3zm2 2v10h10V5H5zm2 2h2v2H7V7zm4 0h2v2h-2V7zM7 11h2v2H7v-2zm4 0h2v2h-2v-2z" />
                            </svg>
                            {exporting ? "Exporting…" : "Export"}
                        </button>

                        {/* Refresh button */}
                        <button
                            type="button"
                            title="Refresh ticket list"
                            aria-label="Refresh ticket list"
                            onClick={() => this.load(off)}
                            disabled={loading}
                            style={{
                                display: "flex", alignItems: "center", gap: 4,
                                fontSize: 12, fontWeight: 500, color: loading ? tk.textSecondary : tk.text,
                                padding: "4px 10px", border: `1px solid ${tk.divider}`, borderRadius: 6,
                                background: loading ? tk.background : tk.surface,
                                cursor: loading ? "not-allowed" : "pointer",
                                outline: "none",
                            }}
                            onMouseEnter={(e: any) => { if (!loading) e.currentTarget.style.background = tk.background; }}
                            onMouseLeave={(e: any) => { e.currentTarget.style.background = loading ? tk.background : tk.surface; }}
                            onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                            onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                        >
                            <svg aria-hidden="true" width="11" height="11" viewBox="0 0 18 18" fill="currentColor">
                                <path d="M9 3a6 6 0 1 0 5.66 4h-1.83A4.5 4.5 0 1 1 9 4.5V3z" />
                                <path d="M9 0v5l3.5-2.5L9 0z" />
                            </svg>
                            {loading ? "Loading…" : "Refresh"}
                        </button>
                    </div>
                </div>

                {/* First-run hint (Section 10.5): shown until dismissed once per browser. */}
                {this.helpEnabled() && !this.state.hintDismissed && !loading && (
                    <FirstRunHint
                        title={t("firstRunTitle")} body={t("firstRunBody")} linkLabel={t("firstRunHelpLink")} dismissLabel={t("firstRunDismiss")}
                        onOpenHelp={this.openHelp} onDismiss={this.dismissHint}
                    />
                )}

                {/* Ticket cards OR table — driven by viewMode toggle */}
                {this.state.viewMode === "table"
                    ? this.renderTicketTable(visibleTickets, loading)
                    : (
                        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", background: tk.background }} role="list" aria-label="Tickets" aria-busy={loading} onClick={() => { this.setState({ openFilter: "none" }); this.clearHoverHl(); }}>
                            {loading
                                ? Array.from({ length: 5 }, (_, i) => <SkeletonCard key={i} tk={tk} />)
                                : visibleTickets.map((t: any) => {
                                    const statusLabel = statusLabelOf(t.status);
                                    const catLabel = categoryLabel(t.category);
                                    const priLabel = priorityLabel(t.priority);
                                    const scLabel = this.subcatLabel(t.subcategory);
                                    const fullCat = catLabel + (scLabel ? ` - ${scLabel}` : "");
                                    const cardLabel = `Ticket ${t.ticket_number != null ? "#" + t.ticket_number + ", " : ""}${fullCat}, status ${statusLabel}, priority ${priLabel}, ${agoFull(t.created_date)}`;
                                    const badge = this.state.badges[t.ticket_id];
                                    const leftColor = SC[t.status] || tk.divider;
                                    return (
                                        <div
                                            key={t.OBJECTID}
                                            role="listitem"
                                            tabIndex={0}
                                            aria-label={cardLabel}
                                            title={t('clickToViewFullCat', { fullCat })}
                                            onClick={(e: any) => { e.stopPropagation(); this.clearHoverHl(); this.select(t); }}
                                            onKeyDown={(e: any) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); this.clearHoverHl(); this.select(t); } }}
                                            style={{ padding: "10px 12px", marginBottom: 6, border: `1px solid ${tk.divider}`, borderLeft: `3px solid ${leftColor}`, borderRadius: 6, cursor: "pointer", outline: "none", background: tk.surface, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", transition: "box-shadow 0.15s" }}
                                            onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; e.currentTarget.style.borderColor = "#93c5fd"; }}
                                            onBlur={(e: any) => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor = tk.divider; (e.currentTarget as HTMLElement).style.borderLeftColor = leftColor; }}
                                            onMouseEnter={(e: any) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; this.hoverHighlight(t.OBJECTID); }}
                                            onMouseLeave={(e: any) => { if (document.activeElement !== e.currentTarget) { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; } this.clearHoverHl(); }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                                                <span style={{ fontSize: 10, color: "#fff", padding: "2px 7px", borderRadius: 99, fontWeight: 600, background: SC[t.status] || tk.textSecondary, letterSpacing: "0.02em" }}>{statusLabel}</span>
                                                <span style={{ fontSize: 10, padding: "1px 6px", border: `1.5px solid ${PC[t.priority] || tk.textSecondary}`, borderRadius: 99, fontWeight: 600, color: PC[t.priority] || tk.textSecondary }}>{priLabel}</span>
                                                {t.ticket_number != null && (
                                                    <span style={{ fontSize: 12, color: tk.primary, fontFamily: "monospace", fontWeight: 700 }}>#{t.ticket_number}</span>
                                                )}
                                                <span style={{ marginLeft: "auto", fontSize: 11, color: tk.textSecondary }} title={fmt(t.created_date)}>{ago(t.created_date)}</span>
                                            </div>
                                            <div style={{ fontWeight: 600, fontSize: 13, color: tk.text, marginBottom: 2 }}>{fullCat}</div>
                                            <div style={{ fontSize: 12, color: tk.textSecondary, marginBottom: 4, lineHeight: 1.4 }}>
                                                {(t.description || t('noDescription')).substring(0, 120)}
                                            </div>
                                            <div style={{ display: "flex", gap: 8, fontSize: 11, color: tk.textSecondary, flexWrap: "wrap" }}>
                                                {t.address_submitted && <span>{t.address_submitted}</span>}
                                                {t.assigned_to && <span style={{ color: tk.primary, fontWeight: 600 }}>{t.assigned_to}</span>}
                                            </div>
                                            {badge && (badge.comments > 0 || badge.photos > 0 || badge.survey) && (
                                                <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                                                    {badge.comments > 0 && (
                                                        <span title={(badge.comments !== 1 ? t('commentsComments', { comments: badge.comments }) : t('commentsComment', { comments: badge.comments }))} style={{ fontSize: 10, background: tk.infoBg, color: tk.primary, borderRadius: 99, padding: "1px 7px", fontWeight: 600, border: "1px solid #bfdbfe" }}>💬 {badge.comments}</span>
                                                    )}
                                                    {badge.photos > 0 && (
                                                        <span title={(badge.photos !== 1 ? t('photosPhotos', { photos: badge.photos }) : t('photosPhoto', { photos: badge.photos }))} style={{ fontSize: 10, background: tk.warningBg, color: tk.warning, borderRadius: 99, padding: "1px 7px", fontWeight: 600, border: "1px solid #fde68a" }}>📷 {badge.photos}</span>
                                                    )}
                                                    {badge.survey && (
                                                        <span title={t('surveyResponseReceived')} style={{ fontSize: 10, background: "#f0fdf4", color: "#15803d", borderRadius: 99, padding: "1px 7px", fontWeight: 600, border: "1px solid #bbf7d0" }}>{t('survey')}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            }
                        </div>
                    )}

                {/* Pagination */}
                <nav aria-label="Ticket list pagination" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderTop: `1px solid ${tk.divider}`, background: tk.surface }}>
                    <div style={{ display: "flex", gap: 4 }}>
                        <Button size="sm" disabled={off === 0} onClick={() => this.load(0)} aria-label="First page">« First</Button>
                        <Button size="sm" disabled={off === 0} onClick={() => this.load(Math.max(0, off - PG))} aria-label="Previous page">← Prev</Button>
                    </div>
                    <span style={{ fontSize: 11, color: tk.textSecondary }} aria-live="polite">Page {pageNum} of {totalPages}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                        <Button size="sm" disabled={end >= total} onClick={() => this.load(off + PG)} aria-label="Next page">Next →</Button>
                        <Button size="sm" disabled={end >= total} onClick={() => this.load((totalPages - 1) * PG)} aria-label="Last page">Last »</Button>
                    </div>
                </nav>
            </div>
        );
    }

    // ── Render: detail ─────────────────────────────────────────
    renderDetail() {
        const tk = this.tk;
        const { sel: t, eS, eP, eA, eC, eSC, saving, comments, photos, nc, np, nct, tab, survey, catSubcatOptions, deptOptions, attFile, attPreview, attError, attUploading } = this.state;
        // Compute once — used by banner, save button, and save() method
        const currentIntegrityWarn = integrityWarning(eA, eC, eSC, deptOptions, catSubcatOptions);
        if (!t) return null;

        const scLabel = this.subcatLabel(t.subcategory);
        const detailTitle = (C[t.category] || "Unknown") + (scLabel ? ` \u2014 ${scLabel}` : "");

        const tabDef: { id: TabId; label: string; badge?: string }[] = [
            { id: "details", label: "Details" },
            { id: "comments", label: "Comments", badge: `${comments.length}` },
            { id: "photos", label: "Photos", badge: `${photos.length}` },
            { id: "survey", label: "Survey", badge: survey ? "\u2713" : undefined },
        ];

        return (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }} role="region" aria-label={t('ticketDetail')}>
                {/* Header */}
                <div style={{ padding: "10px 12px", borderBottom: `1px solid ${tk.divider}`, background: tk.surface }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <Button size="sm" onClick={this.back} title={t('returnToTicketList')} aria-label={t('backToTicketList')}>{t('back')}</Button>
                        {this.renderHelpButton()}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: tk.text }}>{detailTitle}</div>
                    <div style={{ fontSize: 13, color: tk.primary, fontFamily: "monospace", fontWeight: 700 }}>#{t.ticket_number}</div>
                </div>

                {/* Tab bar */}
                <div role="tablist" aria-label={t('ticketDetailTabs')} style={{ display: "flex", padding: "0 10px", borderBottom: `1px solid ${tk.divider}`, background: tk.surface, flexWrap: "wrap" }}>
                    {tabDef.map(td => {
                        const active = tab === td.id;
                        return (
                            <button
                                key={td.id} type="button" role="tab"
                                id={`rac-tab-${td.id}`} aria-selected={active} aria-controls={`rac-tabpanel-${td.id}`}
                                title={t('viewLabelBadge', { label: td.label.toLowerCase(), badge: td.badge ? ` (${td.badge})` : "" })}
                                onClick={() => this.setState({ tab: td.id })}
                                style={{
                                    padding: "8px 12px", cursor: "pointer", fontSize: 12,
                                    fontWeight: active ? 600 : 400,
                                    color: active ? tk.primary : tk.textSecondary,
                                    background: "none", border: "none",
                                    borderBottom: active ? `2px solid ${tk.primary}` : "2px solid transparent",
                                    outline: "none",
                                    transition: "color 0.15s, border-color 0.15s",
                                }}
                                onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                            >
                                {td.label}{td.badge && <span aria-label={td.id === "survey" && td.badge === "\u2713" ? t('hasResponse') : t('badgeItems', { badge: td.badge })} style={{ marginLeft: 4, fontSize: 10, background: active ? tk.infoBg : tk.background, color: active ? tk.primary : tk.textSecondary, borderRadius: 99, padding: "0 5px", fontWeight: 600 }}>{td.badge}</span>}
                            </button>
                        );
                    })}
                </div>

                {/* Tab panels */}
                <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", background: tk.background }}>

                    {tab === "details" && (
                        <div role="tabpanel" id="rac-tabpanel-details" aria-labelledby="rac-tab-details">
                            <div style={{ marginBottom: 10, background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}`, padding: "10px 12px" }}>
                                <div style={hdr(tk)}>{t('submitter')}</div>
                                {row(tk, t('name'), t.submitted_by_name || t('anonymous'))}
                                {row(tk, t('email'), t.submitted_by_email || "\u2014")}
                                {row(tk, t('phone'), t.submitted_by_phone || "\u2014")}
                                {row(tk, t('address'), t.address_submitted || "\u2014")}
                                {row(tk, t('source'), t.source || "\u2014")}
                            </div>
                            <div style={{ marginBottom: 10, background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}`, padding: "10px 12px" }}>
                                <div style={hdr(tk)}>{t('description')}</div>
                                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: tk.text }}>{t.description || t('none')}</div>
                            </div>
                            <div style={{ marginBottom: 10, background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}`, padding: "10px 12px" }}>
                                <div style={hdr(tk)}>{t('dates')}</div>
                                {row(tk, t('created'), fmt(t.created_date))}
                                {row(tk, t('updated'), fmt(t.modified_date))}
                                {row(tk, t('resolved'), fmt(t.resolved_date))}
                            </div>

                            {/* ── Manage Ticket ── compact property rows, no card header */}
                            <div style={{ marginBottom: 14, background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}` }}>
                                {/* Property rows */}
                                <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${tk.divider}`, gap: 12 }}>
                                    <label htmlFor="rac-edit-status" style={{ width: 72, flexShrink: 0, fontSize: 12, color: tk.textSecondary, fontWeight: 500 }}>{t('ctlStatus')}</label>
                                    <Select id="rac-edit-status" size="sm" value={eS} onChange={(e: any) => { const ns = Number(e.target.value); this.setState({ eS: ns, resolveNote: "", resolveDate: (ns === 4 || ns === 5) ? ymd() : "" }); }} style={{ flex: 1 }}>
                                        {Object.entries(S).map(([k, v]) => <Option key={k} value={Number(k)}>{v}</Option>)}
                                    </Select>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${tk.divider}`, gap: 12 }}>
                                    <label htmlFor="rac-edit-priority" style={{ width: 72, flexShrink: 0, fontSize: 12, color: tk.textSecondary, fontWeight: 500 }}>{t('ctlPriority')}</label>
                                    <Select id="rac-edit-priority" size="sm" value={eP} onChange={(e: any) => this.setState({ eP: Number(e.target.value) })} style={{ flex: 1 }}>
                                        {Object.entries(P).map(([k, v]) => <Option key={k} value={Number(k)}>{v}</Option>)}
                                    </Select>
                                </div>
                                {/* ── Integrity warning banner ── */}
                                {(() => {
                                    const warn = currentIntegrityWarn;
                                    return warn ? (
                                        <div role="alert" style={{ margin: "0 0 0 0", padding: "8px 12px", background: tk.warningBg, borderBottom: "1px solid #fde68a", fontSize: 12, color: tk.warning, display: "flex", gap: 6, alignItems: "flex-start" }}>
                                            <span aria-hidden="true" style={{ flexShrink: 0 }}>⚠</span>
                                            <span>{warn}</span>
                                        </div>
                                    ) : null;
                                })()}
                                {/* ── Assigned dept ── */}
                                <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", gap: 12, borderBottom: `1px solid ${tk.divider}` }}>
                                    <label htmlFor="rac-edit-dept" style={{ width: 72, flexShrink: 0, fontSize: 12, color: tk.textSecondary, fontWeight: 500 }}>{t('ctlAssigned')}</label>
                                    <Select id="rac-edit-dept" size="sm" value={eA} onChange={(e: any) => {
                                        const newDept = e.target.value;
                                        const validCats = validCatsForDept(newDept);
                                        // If current category is no longer valid for the new dept, reset to first valid cat.
                                        const newCat = validCats.includes(eC) ? eC : (validCats[0] ?? eC);
                                        // Always clear subcategory on dept change — the valid options may differ
                                        // even if the category code stays the same (dept context changed).
                                        this.setState({ eA: newDept, eC: newCat, eSC: "" });
                                    }} style={{ flex: 1 }}>
                                        <Option value="">{t('unassigned')}</Option>
                                        {this.state.deptOptions.map(d => <Option key={d} value={d}>{d}</Option>)}
                                    </Select>
                                </div>
                                {/* ── Category — filtered to dept's valid codes ── */}
                                <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", gap: 12, borderBottom: `1px solid ${tk.divider}` }}>
                                    <label htmlFor="rac-edit-cat" style={{ width: 72, flexShrink: 0, fontSize: 12, color: tk.textSecondary, fontWeight: 500 }}>{t('ctlCategory')}</label>
                                    <Select id="rac-edit-cat" size="sm" value={eC} onChange={(e: any) => {
                                        const newCat = Number(e.target.value);
                                        // Cascade: update eA to the canonical dept for this category.
                                        // Only update if the new canonical dept exists in deptOptions
                                        // (guards against CAT_DEPT / domain name mismatches).
                                        const canonicalDept = CAT_DEPT[newCat] || "";
                                        const newDept = this.state.deptOptions.includes(canonicalDept)
                                            ? canonicalDept
                                            : eA; // keep existing dept if no match
                                        // Always clear subcategory — new category has a different domain.
                                        this.setState({ eC: newCat, eA: newDept, eSC: "" });
                                    }} style={{ flex: 1 }}>
                                        {(() => {
                                            const opts = validCatsForDept(eA).filter((code: number) => C[code]);
                                            // Ensure eC is always present in the list so Select never renders blank.
                                            // Avoid fragment — jimu-ui Select requires flat Option children.
                                            const allCats = opts.includes(eC) ? opts : [eC, ...opts];
                                            return allCats.filter((code: number) => C[code]).map((code: number) =>
                                                <Option key={code} value={code}>{C[code]}</Option>
                                            );
                                        })()}
                                    </Select>
                                </div>
                                {/* ── Subcategory — cascades from category; empty if none defined ── */}
                                <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", gap: 12, borderBottom: eS !== t.status ? `1px solid ${tk.divider}` : "none" }}>
                                    <label htmlFor="rac-edit-subcat" style={{ width: 72, flexShrink: 0, fontSize: 12, color: tk.textSecondary, fontWeight: 500 }}>{t('subcategory')}</label>
                                    <Select id="rac-edit-subcat" size="sm" value={eSC} onChange={(e: any) => this.setState({ eSC: e.target.value })} style={{ flex: 1 }}>
                                        <Option value="">{t('none2')}</Option>
                                        {(catSubcatOptions[eC] || []).map(opt => <Option key={opt.code} value={opt.code}>{opt.name}</Option>)}
                                    </Select>
                                </div>

                                {/* Status change comment — shown whenever status is changing */}
                                {eS !== t.status && (
                                    <div style={{ padding: "10px 12px", borderBottom: `1px solid ${tk.divider}`, background: eS === 4 ? tk.warningBg : eS === 5 ? tk.background : tk.infoBg }}>
                                        {(eS === 4 || eS === 5) && (
                                            <div style={{ marginBottom: 10 }}>
                                                <label htmlFor="rac-resolved-date" style={{ display: "block", fontSize: 12, fontWeight: 600, color: eS === 4 ? tk.warning : tk.text, marginBottom: 5 }}>
                                                    {eS === 4 ? t('resolvedDate') : t('closedDate')}
                                                    <span style={{ fontWeight: 400, color: eS === 4 ? tk.warning : tk.textSecondary, marginLeft: 6, fontSize: 11 }}>
                                                        {t('dateTheWorkWasCompleted')}
                                                    </span>
                                                </label>
                                                <input
                                                    id="rac-resolved-date"
                                                    type="date"
                                                    value={this.state.resolveDate || ymd()}
                                                    min={ymd(t.created_date)}
                                                    max={ymd()}
                                                    onChange={(e: any) => this.setState({ resolveDate: e.target.value })}
                                                    style={{ fontSize: 13, padding: "5px 8px", border: `1px solid ${tk.divider}`, borderRadius: 4 }}
                                                />
                                                <div style={{ fontSize: 11, color: tk.textSecondary, marginTop: 3 }}>{t('defaultsToTodaySetThisTo')}</div>
                                            </div>
                                        )}
                                        <label htmlFor="rac-status-note" style={{ display: "block", fontSize: 12, fontWeight: 600, color: eS === 4 ? tk.warning : tk.text, marginBottom: 5 }}>
                                            {eS === 4 ? t('resolutionNote') : eS === 5 ? t('closureNote') : t('statusChangeComment')} <span aria-hidden="true" style={{ color: tk.danger }}>*</span>
                                            <span style={{ fontWeight: 400, color: eS === 4 ? tk.warning : tk.textSecondary, marginLeft: 6, fontSize: 11 }}>
                                                {eS === 4 ? t('sentWithTheResolutionEmail') : eS === 5 ? t('reasonTicketIsBeingClosed') : t('submitterWillBeNotified')}
                                            </span>
                                        </label>
                                        <TextArea
                                            id="rac-status-note"
                                            value={this.state.resolveNote}
                                            onChange={(e: any) => this.setState({ resolveNote: e.target.value })}
                                            placeholder={eS === 4 ? t('describeWhatWasDoneToResolve') : eS === 5 ? t('explainWhyThisTicketIsBeing') : t('explainTheStatusChangeToS', { S: S[eS] })}
                                            aria-label={t('commentExplainingStatusChangeToS', { S: S[eS] })}
                                            aria-required="true"
                                            maxLength={(eS === 4 || eS === 5) ? INTERNAL_NOTES_MAXLEN : undefined}
                                            style={{ width: "100%", fontSize: 13, borderColor: this.state.resolveNote.trim() ? tk.divider : "#fca5a5" }}
                                        />
                                        {(eS === 4 || eS === 5) && this.state.resolveNote.length >= INTERNAL_NOTES_MAXLEN - 50 && (
                                            <div style={{ fontSize: 11, color: this.state.resolveNote.length >= INTERNAL_NOTES_MAXLEN ? tk.danger : tk.textSecondary, marginTop: 3, textAlign: "right" }}>
                                                {this.state.resolveNote.length} / {INTERNAL_NOTES_MAXLEN}
                                            </div>
                                        )}
                                        {!this.state.resolveNote.trim() && (
                                            <div role="alert" style={{ fontSize: 11, color: tk.danger, marginTop: 3 }}>{t('requiredBeforeChangingStatusToS', { S: S[eS] })}</div>
                                        )}
                                    </div>
                                )}

                                {/* Footer row with right-aligned save */}
                                <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", borderTop: `1px solid ${tk.divider}` }}>
                                    {(() => {
                                        const hasIntegrityErr = !!currentIntegrityWarn;
                                        const needsComment = eS !== t.status && !this.state.resolveNote.trim();
                                        const isDisabled = saving || needsComment || hasIntegrityErr;
                                        const label = saving ? t('savingChanges')
                                            : hasIntegrityErr ? t('fixRoutingErrorsBeforeSaving')
                                                : eS !== t.status ? t('changeStatusToS', { S: S[eS] })
                                                    : t('ctlSaveChanges');
                                        return (
                                            <Button
                                                type="primary" size="sm"
                                                onClick={this.save}
                                                disabled={isDisabled}
                                                aria-label={label}
                                                title={hasIntegrityErr ? t('resolveTheRoutingWarningAboveBefore') : undefined}
                                                style={{ fontWeight: 500, minWidth: 90, opacity: hasIntegrityErr ? 0.5 : 1 }}
                                            >
                                                {saving ? t('saving') : eS !== t.status ? t('changeToS', { S: S[eS] }) : t('ctlSaveChanges')}
                                            </Button>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* ── Add Comment ── compose-style, no card header */}
                            <div style={{ marginBottom: 10, background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}` }}>
                                <TextArea
                                    id="rac-new-comment"
                                    value={nc}
                                    onChange={(e: any) => this.setState({ nc: e.target.value })}
                                    placeholder={t('leaveANote')}
                                    aria-label={t('commentText')}
                                    style={{ width: "100%", fontSize: 13, border: "none", borderBottom: `1px solid ${tk.divider}`, borderRadius: "8px 8px 0 0", resize: "vertical" as const, padding: "10px 12px", boxSizing: "border-box" as const, outline: "none" }}
                                />
                                {/* Staged photo preview + validation error */}
                                {attError && (
                                    <div style={{ padding: "6px 12px", fontSize: 12, color: tk.danger }}>{attError}</div>
                                )}
                                {attPreview && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${tk.divider}` }}>
                                        <img src={attPreview} alt={t('attachedPhotoPreview')} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: `1px solid ${tk.divider}`, flexShrink: 0 }} />
                                        <span style={{ fontSize: 12, color: tk.textSecondary, flex: 1 }}>{t('photoAttachedToThisComment')}</span>
                                        <button type="button" onClick={this.clearAttachment} aria-label={t('removeAttachedPhoto')}
                                            style={{ border: "none", background: "none", color: tk.danger, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 4 }}>
                                            {t('ctlRemove')}
                                        </button>
                                    </div>
                                )}
                                {/* Controls row: selects left, submit right */}
                                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", flexWrap: "wrap" }}>
                                    {/* Attach a photo to this comment (one per comment) */}
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"
                                        ref={(el: HTMLInputElement | null) => { this.attInputRef = el; }}
                                        onChange={(e: any) => { const f = e.target.files?.[0]; if (f) this.processAttachment(f); }}
                                        style={{ display: "none" }}
                                        aria-hidden="true"
                                    />
                                    <Button
                                        size="sm" type="default"
                                        onClick={() => this.attInputRef?.click()}
                                        disabled={saving || attUploading || !!attFile}
                                        aria-label={t('attachAPhotoToThisComment')}
                                        title={t('attachAPhoto')}
                                        style={{ flexShrink: 0, fontWeight: 600, background: tk.surface, color: attFile ? tk.textSecondary : tk.primary, border: `1px solid ${attFile ? tk.divider : tk.primary}` }}
                                    >
                                        {attUploading ? "…" : attFile ? t('attached') : t('photo')}
                                    </Button>
                                    <Select id="rac-comment-type" size="sm" value={nct}
                                        onChange={(e: any) => this.setState({ nct: e.target.value })}
                                        aria-label={t('commentType')} style={{ flex: 1, minWidth: 130 }}>
                                        {np === 0
                                            ? <Option value="INTERNAL">{t('internalNote')}</Option>
                                            : [
                                                <Option key="STATUS" value="STATUS">{t('statusUpdate')}</Option>,
                                                <Option key="ASSIGN" value="ASSIGN">{t('assignmentChange')}</Option>,
                                                <Option key="PUBLIC" value="PUBLIC">{t('publicResponse')}</Option>,
                                            ]
                                        }
                                    </Select>
                                    <Select id="rac-comment-vis" size="sm" value={np}
                                        onChange={(e: any) => {
                                            const v = Number(e.target.value);
                                            // Auto-correct type to match new visibility
                                            const newType = v === 0 ? "INTERNAL" : (nct === "INTERNAL" ? "PUBLIC" : nct);
                                            this.setState({ np: v, nct: newType });
                                        }}
                                        aria-label={t('commentVisibility')} style={{ width: 96 }}>
                                        <Option value={1}>{t('ctlPublic')}</Option>
                                        <Option value={0}>{t('ctlInternal')}</Option>
                                    </Select>
                                    <Button
                                        type="primary" size="sm"
                                        onClick={this.addComment}
                                        disabled={saving || attUploading || !nc.trim()}
                                        aria-label={saving ? t('addingComment') : t('addComment')}
                                        style={{ fontWeight: 500, minWidth: 64, flexShrink: 0 }}
                                    >
                                        {saving ? "…" : t('ctlComment')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {tab === "comments" && (
                        <div role="tabpanel" id="rac-tabpanel-comments" aria-labelledby="rac-tab-comments">
                            <div style={hdr(tk)} id="rac-comment-history">{t('commentHistoryCommentsCount', { commentsCount: comments.length })}</div>
                            {comments.length === 0 && <div style={{ fontSize: 13, color: tk.textSecondary, padding: "12px 0" }}>{t('noCommentsYet')}</div>}
                            <div role="list" aria-labelledby="rac-comment-history">
                                {comments.map((c: any) => {
                                    const isInternal = c.is_public === 0;
                                    return (
                                        <div key={c.OBJECTID} role="listitem" style={{ padding: "10px 12px", marginBottom: 6, background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}`, borderLeft: `3px solid ${isInternal ? tk.danger : tk.primary}`, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                                                <span style={{ fontWeight: 600, fontSize: 12, color: tk.text }}>{c.author || t('unknown')}</span>
                                                {c.author_role && <span style={{ fontSize: 10, color: tk.textSecondary }}>{c.author_role}</span>}
                                                {isInternal && (
                                                    <Tip text={t('onlyVisibleToStaff')}>
                                                        <span style={{ fontSize: 9, background: "#fef2f2", color: tk.danger, border: "1px solid #fecaca", padding: "1px 6px", borderRadius: 99, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{t('ctlInternal')}</span>
                                                    </Tip>
                                                )}
                                                <span style={{ fontSize: 10, color: tk.textSecondary, marginLeft: "auto" }}>{fmt(c.created_date)}</span>
                                            </div>
                                            <div style={{ fontSize: 13, lineHeight: 1.5, color: tk.text }}>{c.comment_text}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {tab === "photos" && (
                        <div role="tabpanel" id="rac-tabpanel-photos" aria-labelledby="rac-tab-photos">
                            <div style={hdr(tk)} id="rac-photo-header">{t('photosPhotosCount', { photosCount: photos.length })}</div>
                            {photos.length === 0 && (
                                <div style={{ fontSize: 13, color: tk.textSecondary, padding: "12px 0" }}>{t('noPhotosFoundForThisTicket')}</div>
                            )}
                            <div role="list" aria-labelledby="rac-photo-header" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {photos.map((p: any, idx: number) => (
                                    <div key={p.OBJECTID ?? idx} role="listitem" style={{ background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}`, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", overflow: "hidden" }}>
                                        {/* Thumbnail — click opens lightbox */}
                                        {p.att_url && (p.content_type || "").startsWith("image/") && (
                                            <button
                                                type="button"
                                                aria-label={t('viewFullSizeAttName', { att_name: p.att_name || t('photoIdx', { idx: idx + 1 }) })}
                                                onClick={() => this.openLightbox(idx)}
                                                style={{ display: "block", width: "100%", padding: 0, border: "none", background: "none", cursor: "zoom-in" }}
                                            >
                                                <img
                                                    src={p.att_url}
                                                    alt={p.att_name || t('photoIdx', { idx: idx + 1 })}
                                                    style={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block" }}
                                                />
                                            </button>
                                        )}
                                        {/* Video — inline player */}
                                        {p.att_url && (p.content_type || "").startsWith("video/") && (
                                            <video
                                                src={p.att_url}
                                                controls
                                                style={{ width: "100%", maxHeight: 280, display: "block", background: "#000" }}
                                                aria-label={t('videoAttName', { att_name: p.att_name || t('videoIdx', { idx: idx + 1 }) })}
                                            />
                                        )}
                                        <div style={{ padding: "6px 12px 8px" }}>
                                            {(() => {
                                                const nm = p.att_name || p.file_name || t('unnamed');
                                                const isStaffInt = /^staffint-/i.test(nm);
                                                const isStaff = isStaffInt || /^staff-/i.test(nm);
                                                const badge = isStaffInt ? t('staffInternal') : isStaff ? t('staffPublic') : t('submitter');
                                                const bg = isStaffInt ? "#fef2f2" : isStaff ? tk.infoBg : tk.background;
                                                const fg = isStaffInt ? tk.danger : isStaff ? tk.primary : tk.textSecondary;
                                                const bd = isStaffInt ? "#fecaca" : isStaff ? "#bfdbfe" : tk.divider;
                                                return (
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                        <span style={{ fontWeight: 600, fontSize: 12, color: tk.text }}>{isStaff ? t('staffPhoto') : nm}</span>
                                                        <Tip text={isStaffInt ? t('attachedToAnInternalNoteNot') : isStaff ? t('attachedToAPublicCommentVisible') : t('uploadedByTheSubmitter')}>
                                                            <span style={{ fontSize: 9, background: bg, color: fg, border: `1px solid ${bd}`, padding: "1px 6px", borderRadius: 99, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{badge}</span>
                                                        </Tip>
                                                    </div>
                                                );
                                            })()}
                                            <div style={{ display: "flex", gap: 10, fontSize: 11, color: tk.textSecondary, marginTop: 2 }}>
                                                {p.upload_date && <span>{fmt(p.upload_date)}</span>}
                                                {p.photo_order && <span>#{p.photo_order}</span>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* ── Lightbox — rendered into document.body via portal ── */}
                            {/* Portal escapes the widget's stacking context so the overlay */}
                            {/* sits above all EB sidebar panels and map components.        */}
                            {this.state.lightboxIndex != null && (() => {
                                const lbIdx = this.state.lightboxIndex!;
                                const lbPhotos = this.state.photos;
                                const lbItem = lbPhotos[lbIdx];
                                if (!lbItem) return null;
                                const total = lbPhotos.length;
                                const hasPrev = lbIdx > 0;
                                const hasNext = lbIdx < total - 1;
                                const isVideo = (lbItem.content_type || "").startsWith("video/");
                                const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
                                    position: "absolute", top: "50%", transform: "translateY(-50%)",
                                    background: disabled ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.18)",
                                    border: t('_1pxSolidRgba255255255'),
                                    borderRadius: "50%", width: 44, height: 44,
                                    cursor: disabled ? "default" : "pointer",
                                    color: disabled ? "rgba(255,255,255,0.25)" : "#fff",
                                    fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center",
                                    transition: t('background015s'), pointerEvents: disabled ? "none" : "auto",
                                    zIndex: 2,
                                });
                                return ReactDOM.createPortal(
                                    <div
                                        role="dialog"
                                        aria-modal="true"
                                        aria-label={t('mediaViewerAttNameLbIdxOf', { att_name: lbItem.att_name || lbItem.file_name, lbIdx: lbIdx + 1, total })}
                                        onKeyDown={(e: any) => {
                                            if (e.key === "Escape") this.closeLightbox();
                                            if (e.key === "ArrowLeft" && hasPrev) this.setState({ lightboxIndex: lbIdx - 1 });
                                            if (e.key === "ArrowRight" && hasNext) this.setState({ lightboxIndex: lbIdx + 1 });
                                        }}
                                        onClick={this.closeLightbox}
                                        tabIndex={-1}
                                        ref={(el: any) => el && el.focus()}
                                        style={{
                                            position: "fixed", inset: 0, zIndex: 999999,
                                            background: "rgba(0,0,0,0.92)",
                                            display: "flex", flexDirection: "column",
                                            alignItems: "center", justifyContent: "center",
                                            cursor: "zoom-out",
                                            outline: "none",
                                        }}
                                    >
                                        {/* Close */}
                                        <button
                                            type="button"
                                            aria-label={t('closeMediaViewer')}
                                            onClick={this.closeLightbox}
                                            style={{
                                                position: "absolute", top: 16, right: 16, zIndex: 3,
                                                background: "rgba(255,255,255,0.15)",
                                                border: "1px solid rgba(255,255,255,0.3)",
                                                borderRadius: "50%", width: 36, height: 36,
                                                cursor: "pointer", color: "#fff",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                fontSize: 18,
                                            }}
                                            onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                            onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                        >✕</button>

                                        {/* Counter */}
                                        {total > 1 && (
                                            <div style={{
                                                position: "absolute", top: 18, left: "50%",
                                                transform: "translateX(-50%)",
                                                color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600,
                                                background: "rgba(0,0,0,0.4)", borderRadius: 99,
                                                padding: "3px 12px", zIndex: 3, pointerEvents: "none",
                                            }}>
                                                {lbIdx + 1} / {total}
                                            </div>
                                        )}

                                        {/* Prev */}
                                        <button
                                            type="button"
                                            aria-label={t('previousMedia')}
                                            aria-disabled={!hasPrev}
                                            disabled={!hasPrev}
                                            onClick={(e: any) => { e.stopPropagation(); this.setState({ lightboxIndex: lbIdx - 1 }); }}
                                            style={{ ...navBtnStyle(!hasPrev), left: 16 }}
                                            onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                            onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                        >‹</button>

                                        {/* Next */}
                                        <button
                                            type="button"
                                            aria-label={t('nextMedia')}
                                            aria-disabled={!hasNext}
                                            disabled={!hasNext}
                                            onClick={(e: any) => { e.stopPropagation(); this.setState({ lightboxIndex: lbIdx + 1 }); }}
                                            style={{ ...navBtnStyle(!hasNext), right: 16 }}
                                            onFocus={(e: any) => { e.currentTarget.style.boxShadow = FOCUS_RING; }}
                                            onBlur={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}
                                        >›</button>

                                        {/* Media */}
                                        {isVideo ? (
                                            <video
                                                key={lbItem.att_url}
                                                src={lbItem.att_url}
                                                controls
                                                autoPlay
                                                onClick={(e: any) => e.stopPropagation()}
                                                style={{
                                                    maxWidth: "86vw", maxHeight: "80vh",
                                                    borderRadius: 4, boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
                                                    background: "#000",
                                                }}
                                                aria-label={lbItem.att_name || lbItem.file_name || t('video')}
                                            />
                                        ) : (
                                            <img
                                                key={lbItem.att_url}
                                                src={lbItem.att_url}
                                                alt={lbItem.att_name || lbItem.file_name || t('photoLbIdx', { lbIdx: lbIdx + 1 })}
                                                onClick={(e: any) => e.stopPropagation()}
                                                style={{
                                                    maxWidth: "86vw", maxHeight: "80vh",
                                                    objectFit: "contain", borderRadius: 4,
                                                    boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
                                                }}
                                            />
                                        )}

                                        {/* Caption */}
                                        <div
                                            onClick={(e: any) => e.stopPropagation()}
                                            style={{
                                                color: "rgba(255,255,255,0.65)", fontSize: 12,
                                                marginTop: 12, textAlign: "center",
                                            }}
                                        >
                                            {lbItem.att_name || lbItem.file_name || ""}
                                            {total > 1 && (
                                                <span style={{ marginLeft: 16, opacity: 0.5 }}>
                                                    {t('keysToNavigateEscToClose')}
                                                </span>
                                            )}
                                            {total === 1 && (
                                                <span style={{ marginLeft: 12, opacity: 0.5 }}>{t('clickOutsideToClose')}</span>
                                            )}
                                        </div>
                                    </div>,
                                    document.body
                                );
                            })()}
                        </div>
                    )}

                    {tab === "survey" && (
                        <div role="tabpanel" id="rac-tabpanel-survey" aria-labelledby="rac-tab-survey">
                            <div style={hdr(tk)}>{t('surveyResponse')}</div>
                            {!survey && <div style={{ fontSize: 13, color: tk.textSecondary, padding: "12px 0" }}>{t('noSurveyResponseForThisTicket')}</div>}
                            {survey && (
                                <div style={{ background: tk.surface, borderRadius: 8, border: `1px solid ${tk.divider}`, padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                                    <div style={{ marginBottom: 12 }}>
                                        <div style={{ ...lbl(tk), marginBottom: 6 }}>{t('satisfactionRating')}</div>
                                        {stars(tk, survey.satisfaction_rating)}
                                    </div>
                                    <div style={{ marginBottom: 12 }}>
                                        <div style={{ ...lbl(tk), marginBottom: 4 }}>{t('ctlComments')}</div>
                                        <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: tk.text }}>{survey.comments || "\u2014"}</div>
                                    </div>
                                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                                        <div>
                                            <div style={{ ...lbl(tk), marginBottom: 2 }}>{t('submitted')}</div>
                                            <div style={{ fontSize: 13, color: tk.text }}>{fmt(survey.submitted_date)}</div>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 10, color: tk.textSecondary, fontFamily: "monospace", marginTop: 12 }}>{t('surveyIdSurveyId', { survey_id: survey.survey_id || "\u2014" })}</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Help button (top right of the list and detail headers) ──
    renderHelpButton() {
        if (!this.helpEnabled()) return null;
        return (
            <Button size="sm" type="tertiary" icon onClick={this.openHelp} title={t("helpTitle")} aria-label={t("helpTitle")} style={{ flexShrink: 0 }}>
                <CalciteIcon icon="question" scale="s" />
            </Button>
        );
    }

    // ── Main render ────────────────────────────────────────────
    // <Themed> reads the theme tokens (a hook, so it cannot run in the class)
    // and stores them on this.tk before the rest of the tree renders.
    render() {
        racIntl = (this.props as any).intl;
        return <Themed>{(tk: Tokens) => { this.tk = tk; return this.renderRoot(); }}</Themed>;
    }

    renderRoot() {
        const tk = this.tk;
        const mid = this.props.config?.useMapWidgetIds?.[0];
        return (
            <div ref={this.rootRef} className={ROOT_CLASS} style={{ width: "100%", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", background: tk.surface, color: tk.text }} role="region" aria-label="Report A Concern Manager">
                {mid && <JimuMapViewComponent useMapWidgetId={mid} onActiveViewChange={this.onView} />}
                {this.renderMsg()}
                {/* The pane fills whatever height the banner leaves, so the
                    bottom of the list/detail (comment box, pager) stays reachable. */}
                <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }}>
                    <div style={{ position: "absolute", inset: 0 }}>
                        {this.state.mode === "list" ? this.renderList() : this.renderDetail()}
                    </div>
                </div>
                {/* One polite live region for results (Section 11.4). Every ok / err message lands here. */}
                <div role="status" aria-live="polite" aria-atomic="true" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
                    {this.state.ok || this.state.err}
                </div>
                {this.helpEnabled() && (
                    <HelpPopup
                        open={this.state.helpOpen}
                        onClose={this.closeHelp}
                        sections={buildHelpSections(t, this.helpFeatures())}
                        title={t("helpTitle")}
                        intro={t("helpIntro")}
                        searchPlaceholder={t("helpSearchPlaceholder")}
                        noMatches={t("helpNoMatches")}
                        closeLabel={t("close")}
                    />
                )}
            </div>
        );
    }
}