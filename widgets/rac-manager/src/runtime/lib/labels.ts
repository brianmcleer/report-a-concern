import { __t } from '../i18n-t'
// Coded value lookups and label helpers, moved out of widget.tsx unchanged so
// they can be tested with node --test (tests/labels.test.js). No React, no esri.
// The codes mirror the Tickets layer domains; keep them in step with the schema.

/** Status codes to labels. */
export const S: Record<number, string> = { 1: "Open", 2: "Received", 3: "In Progress", 4: "Resolved", 5: "Closed" };
/** Priority codes to labels. */
export const P: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High", 4: "Critical" };
/** Category codes to labels. */
export const C: Record<number, string> = { 1: "Water", 2: "Sewer", 3: "Roads & Pavement", 4: "Signs & Signals", 5: "Parks & Recreation", 6: "Trees & Vegetation", 7: "Drainage & Stormwater", 8: "Graffiti", 9: "Illegal Dumping", 10: "Sidewalks & Curbs", 11: "Street Lighting", 12: "Other", 13: "Code Enforcement" };

// Comment type coded values
export const CT: Record<string, string> = {
    "INTERNAL": "Internal Note",
    "STATUS": "Status Update",
    "ASSIGN": "Assignment Change",
    "PUBLIC": "Public Response",
};

/** Label for a status code, "Unknown" when the code is not in the domain. */
export function statusLabel(code: number | null | undefined): string { return S[code as number] || __t("unknown"); }
/** Label for a priority code, "Unknown" when the code is not in the domain. */
export function priorityLabel(code: number | null | undefined): string { return P[code as number] || __t("unknown"); }
/** Label for a category code, "Unknown" when the code is not in the domain. */
export function categoryLabel(code: number | null | undefined): string { return C[code as number] || __t("unknown"); }

/** Adds or removes a value from a numeric filter array (used by the toolbar filters). */
export function toggleVal(arr: number[], val: number): number[] { return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]; }
