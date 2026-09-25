import type { ImmutableObject } from "jimu-core";

/**
 * A single critical-issue alert. When the selected category and (optionally)
 * subcategory match an entry, the widget shows a prominent banner on Step 2
 * and Step 4 prompting the citizen to phone the city instead. Submission is
 * NOT blocked — this is a soft warning.
 */
export interface CriticalAlert {
    /** Category name (human-readable, case-insensitive). Must match the subtype name on the Tickets layer (e.g. "Sewer"). */
    category: string;
    /** Subcategory name (human-readable, case-insensitive). Leave blank to match ALL subcategories of the category. */
    subcategory: string;
    /** Phone number to display. Plain text (e.g. "(970) 244-1577" or "911"). Will be rendered as a clickable tel: link. */
    phone: string;
    /** Optional custom message. If blank, criticalAlertDefaultMessage is used. */
    message?: string;
}

export interface Config {
    useMapWidgetIds?: string[];
    ticketsLayerIndex: number;

    // ── Boundary Layer ──────────────────────────────────────
    /** Sublayer index of Service_Boundaries polygon FC (default 1) */
    boundariesLayerIndex: number;
    /** Standalone REST URL to Service_Boundaries. If blank, uses map service + index. */
    boundariesLayerUrl: string;
    /** Field on Service_Boundaries that uniquely identifies each boundary (matched against Category_Boundary_Lookup) */
    boundaryIdField: string;

    // ── Category ↔ Boundary Lookup ──────────────────────────
    /** Enable category filtering based on which boundary the point falls in */
    enableCategoryFiltering: boolean;
    /** Sublayer index of Category_Boundary_Lookup table in the same map service */
    lookupTableIndex: number;
    /** Standalone REST URL override for Category_Boundary_Lookup. If blank, derived from map service. */
    lookupTableUrl: string;
    /**
     * How to handle categories that are NOT valid (is_valid=0) for the matched boundary:
     *   "hide"         — omit from dropdown entirely
     *   "show_message" — show in dropdown but disabled, with redirect_message below
     */
    invalidCategoryBehavior: "hide" | "show_message";

    // ── Ticket Boundary Population ──────────────────────────
    /** Auto-populate boundary_id on submitted tickets */
    populateBoundaryId: boolean;
    /** Field name on Tickets FC to write the matched boundary identifier into */
    ticketBoundaryIdField: string;

    // ── Write Endpoint (FeatureServer) ──────────────────────
    /**
     * REST URL to the Tickets layer on the FeatureServer for writes.
     * All fields (including PII) must exist here.
     * Configure FeatureServer to allow Create only (no Query) for public.
     * If blank, falls back to the map widget's layer (old behavior).
     */
    writeEndpointUrl: string;

    // ── Geocoder ────────────────────────────────────────────
    enableGeocoder: boolean;
    geocoderUrl: string;

    // ── Labels & Messages ───────────────────────────────────
    submitButtonLabel?: string;
    successMessage?: string;
    headerTitle?: string;
    outsideBoundaryMessage?: string;

    // ── Header Image ────────────────────────────────────────
    /** URL to an image/logo displayed in the widget header (PNG, JPG, or SVG). */
    headerImageUrl?: string;
    /**
     * Alt text for the header image (WCAG 2.1 AA required).
     * Also serves as the accessible name of the link when headerImageLink is set —
     * keep it descriptive (e.g. "City of Example").
     * Use an empty string only if the image is purely decorative and the
     * header title conveys all necessary context.
     */
    headerImageAlt?: string;
    /**
     * Optional URL the header image links to (opens in a new tab).
     * If blank, the image is rendered as a non-interactive element.
     */
    headerImageLink?: string;
    /**
     * Horizontal alignment of the header title text.
     * "left"   — title sits immediately right of the logo (default)
     * "center" — title is centered in the remaining header space
     * "right"  — title is pushed to the far right of the header
     */
    headerTitleAlign?: "left" | "center" | "right";
    /** Font size of the header title in pixels (default 20). */
    headerTitleSize?: number;

    // ── Photos ─────────────────────────────────────────────
    /** Max photo file size in MB (default 15). Enforced client-side before upload. */
    maxPhotoSizeMB?: number;
    /** Max number of photos per submission (default 3). */
    maxPhotos?: number;
    // ── Mobile Mode ─────────────────────────────────────────
    /**
     * When true, the Location step hides the "Place Pin on Map" button
     * and promotes GPS / address search as the primary input methods.
     * Recommended for deployments where the widget is used on mobile devices.
     */
    mobileMode?: boolean;

    // ── Critical Issue Alerts ─────────────────────────────────
    /**
     * Category/subcategory combinations that should prompt the citizen to
     * call instead of submitting a web ticket (e.g. sewer overflow, traffic
     * signal outage). Submission is still allowed — this is a soft warning.
     */
    criticalAlerts?: CriticalAlert[];
    /**
     * Default message shown above the phone number when an alert's own
     * `message` field is blank. Edit per-deployment in the settings panel.
     */
    criticalAlertDefaultMessage?: string;
    /**
     * REST URL to the Tickets layer used by the settings panel to populate
     * the Category/Subcategory pickers in this Critical Alerts editor.
     * Should be a full FeatureServer/MapServer layer URL (NOT the Flask
     * proxy). Example:
     *   https://gis.example.gov/arcgis/rest/services/RAC/ReportAConcern_Reporter/FeatureServer/0
     */
    categoryMetadataUrl?: string;

    // ── Ticket Status Deep Link (public ?ticket= status view) ──
    /** Public read-only REST URL to the Tickets layer used by the status view. If blank, derived from the map widget's layer. */
    statusQueryUrl?: string;
    /** Explicit REST URL to the Ticket Comments table. Overrides name/index resolution. */
    commentsTableUrl?: string;
    /** Comments table display name to match when resolving from the web map (default "Ticket Comments"). */
    commentsTableName?: string;
    /** Sublayer/table index of the Ticket Comments table on the FeatureServer (default 6). */
    commentsTableIndex?: number;

}

export type IMConfig = ImmutableObject<Config>;

export const defaultConfig: Config = {
    useMapWidgetIds: [],
    ticketsLayerIndex: 0,

    // Boundary layer
    boundariesLayerIndex: 1,
    boundariesLayerUrl: "",
    boundaryIdField: "boundary_id",

    // Category ↔ Boundary lookup
    enableCategoryFiltering: true,
    lookupTableIndex: 2,
    lookupTableUrl: "",
    invalidCategoryBehavior: "show_message",

    // Ticket boundary population
    populateBoundaryId: true,
    ticketBoundaryIdField: "boundary_id",

    // Write endpoint
    writeEndpointUrl: "",

    // Geocoder
    enableGeocoder: true,
    geocoderUrl: "",

    // Labels
    submitButtonLabel: "Submit Report",
    successMessage:
        "Thank you! Your concern has been submitted and a confirmation email will be sent shortly.",
    headerTitle: "Report A Concern",
    outsideBoundaryMessage:
        "This location is outside the service area. Please select a location within the service boundary.",

    // Header image
    headerImageUrl: "",
    headerImageAlt: "",
    headerImageLink: "",
    headerTitleAlign: "left",
    headerTitleSize: 20,

    // Photos
    maxPhotoSizeMB: 15,
    maxPhotos: 3,

    // Mobile mode
    mobileMode: false,

    // Critical Issue Alerts
    criticalAlerts: [],
    criticalAlertDefaultMessage:
        "For the fastest response, please call the number below. You may still submit this report online, but a phone call ensures someone responds immediately.",
    categoryMetadataUrl: "",

    // Ticket status deep link
    statusQueryUrl: "",
    commentsTableUrl: "",
    commentsTableName: "Ticket Comments",
    commentsTableIndex: 6,
};