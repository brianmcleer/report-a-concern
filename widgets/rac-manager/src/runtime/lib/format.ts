// Pure date and text helpers, moved out of widget.tsx unchanged so they can be
// tested with node --test (tests/format.test.js). No React, no esri, no DOM.

/** Full date and time, or an em dash placeholder when the epoch is empty. */
export function fmt(e: number) { if (!e) return "\u2014"; return new Date(e).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }
/** Short relative age ("5m ago", "3h ago"), falling back to fmt() after a day. */
export function ago(e: number) { if (!e) return ""; const d = Date.now() - e, m = Math.floor(d / 60000); if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; return fmt(e); }
/** Spoken relative age for aria labels ("5 minutes ago", "3 days ago"). */
export function agoFull(e: number) { if (!e) return ""; const d = Date.now() - e, m = Math.floor(d / 60000); if (m < 60) return m + " minutes ago"; const h = Math.floor(m / 60); if (h < 24) return h + " hours ago"; const dy = Math.floor(h / 24); return dy < 30 ? dy + " days ago" : fmt(e) }
/** Relative age for table cells, falling back to a long date after a day. */
export function agoDate(e: number) { if (!e) return ""; const d = Date.now() - e, m = Math.floor(d / 60000); if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; return new Date(e).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }
// Local YYYY-MM-DD for a given epoch ms (or today if omitted). Used for the
// editable resolved-date input, which is date-only and local to the manager.
export function ymd(e?: number) { const d = e ? new Date(e) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
/** Date only, or an em dash placeholder when the epoch is empty. */
export function fmtDay(e: number) { if (!e) return "\u2014"; return new Date(e).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
/** True when every token appears in the haystack (case folded, underscores as spaces). Used to match table names from settings. */
export function matchAll(haystack: string, tokens: string[]): boolean { const h = haystack.toLowerCase().replace(/_/g, " "); return tokens.every(t => h.includes(t)); }
/** Splits a configured table name into the lowercase tokens matchAll() expects. */
export function nameTokens(name: string): string[] { return name.toLowerCase().replace(/_/g, " ").split(/\s+/); }
