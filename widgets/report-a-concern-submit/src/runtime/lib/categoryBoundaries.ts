// Category to boundary fallback map for the Report a Concern submit widget.
// Pure data, no React or Esri imports, so tests/categoryBoundaries.test.js can read it in Node.
// Moved unchanged from widget.tsx; the widget imports it from here.

/**
 * Hardcoded fallback: maps each Tickets subtype code (SHORT) to the
 * boundary_type value in Service_Boundaries that must spatially contain
 * the selected point for that category to be valid.
 *
 * null = accepted anywhere inside any boundary (no spatial restriction).
 *
 * This is used ONLY when the Category_Boundary_Lookup REST table is not
 * configured in widget settings. The primary enforcement path is the
 * lookup table; this is the client-side backstop that fires via
 * checkCategoryGeofence() whenever the user changes their category selection.
 *
 * Server-side enforcement: the RAC_Geofence_Validate constraint attribute
 * rule on DBO.Tickets will also block invalid submissions at insert time.
 *
 * Subtype codes match the geodatabase domain:
 *   1=Water, 2=Sewer, 3=Roads, 4=Signs, 5=Parks, 6=Trees,
 *   7=Drainage & Stormwater, 8=Graffiti, 9=Illegal Dumping,
 *   10=Sidewalks & Curbs, 11=Street Lighting, 12=Other
 */
export const CATEGORY_BOUNDARY_MAP: Record<number, string | null> = {
    1: "WATER_DIST",   // Water, must be inside a water service area
    2: "SEWER_DIST",   // Sewer, must be inside a sewer district
    3: "CITY_LIMITS",  // Roads & Pavement
    4: "CITY_LIMITS",  // Signs & Signals
    5: "CITY_LIMITS",  // Parks & Recreation
    6: "CITY_LIMITS",  // Trees & Vegetation
    7: "CITY_LIMITS",  // Drainage & Stormwater
    8: "CITY_LIMITS",  // Graffiti
    9: "CITY_LIMITS",  // Illegal Dumping
    10: "CITY_LIMITS",  // Sidewalks & Curbs
    11: "CITY_LIMITS",  // Street Lighting
    12: null,           // Other, accepted anywhere inside any boundary
    13: "CITY_LIMITS",  // Code Enforcement
};
