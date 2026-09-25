"""
categories.py

Category (subtype) codes and subcategory (per-subtype domain) labels for the
Tickets feature class. These mirror the geodatabase subtypes and domains that
schema/build_schema.py creates. If you change categories in the geodatabase,
change them here too; the report scripts use these as a static fallback when
they cannot read the domains live.

Category code = Tickets subtype code. Subcategory keys = domain codes.
"""

CATEGORY_LABELS = {
    1: "Water", 2: "Sewer", 3: "Roads & Pavement", 4: "Signs & Signals",
    5: "Parks & Recreation", 6: "Trees & Vegetation", 7: "Drainage & Stormwater",
    8: "Graffiti", 9: "Illegal Dumping", 10: "Sidewalks & Curbs",
    11: "Street Lighting", 12: "Other", 13: "Code Enforcement",
}

ALL_CATEGORIES = list(CATEGORY_LABELS.keys())

# Subcategory domain codes and labels, keyed by category code.
SUBCATEGORY_LABELS = {
    # Subcategory_Water (category 1)
    1: {
        "MAIN_BREAK": "Main Break",
        "LEAK":       "Service Leak",
        "PRESSURE":   "Low Pressure",
        "QUALITY":    "Water Quality",
        "METER":      "Meter Issue",
        "HYDRANT":    "Fire Hydrant",
        "OTHER":      "Other",
    },
    # Subcategory_Sewer (category 2)
    2: {
        "BACKUP":     "Sewer Backup",
        "ODOR":       "Odor",
        "OVERFLOW":   "Overflow / Spill",
        "MANHOLE":    "Manhole Issue",
        "BLOCKAGE":   "Line Blockage",
        "OTHER":      "Other",
    },
    # Subcategory_Roads (category 3)
    3: {
        "POTHOLE":    "Pothole",
        "CRACK":      "Pavement Crack",
        "WASHOUT":    "Washout",
        "GRADING":    "Grading / Gravel",
        "EDGE_BREAK": "Edge Break",
        "ALLEY":      "Alley Issue",
        "OTHER":      "Other",
    },
    # Subcategory_Signs (category 4)
    4: {
        "MISSING":    "Missing Sign",
        "BROKEN":     "Broken / Damaged Sign",
        "SIGNAL_OUT": "Signal Outage",
        "TIMING":     "Signal Timing",
        "STRIPING":   "Pavement Striping",
        "OTHER":      "Other",
    },
    # Subcategory_Parks (category 5)
    5: {
        "MOWING":     "Mowing / Landscaping",
        "EQUIP_DMG":  "Equipment Damage",
        "LITTER":     "Litter / Debris",
        "IRRIGATION": "Irrigation Issue",
        "AMENITY":    "Amenity / Facility",
        "BIKE_TRAIL": "Bike Trail",
        "OTHER":      "Other",
    },
    # Subcategory_Trees (category 6)
    6: {
        "FALLEN":     "Fallen Tree",
        "TRIM":       "Trim Request",
        "DEAD":       "Dead / Hazard Tree",
        "ROOTS":      "Root Damage",
        "STUMP":      "Stump Removal",
        "WEED":       "Weeds",
        "OTHER":      "Other",
    },
    # Subcategory_Drainage (category 7)
    7: {
        "FLOODING":   "Flooding",
        "INLET":      "Blocked Inlet",
        "EROSION":    "Erosion",
        "DITCH":      "Ditch / Channel Issue",
        "CULVERT":    "Culvert Blockage",
        "OTHER":      "Other",
    },
    # Subcategory_Graffiti (category 8)
    8: {
        "PUBLIC":     "Public Property",
        "BRIDGE":     "Bridge / Underpass",
        "SIGN_BOX":   "Sign / Signal Box",
        "OTHER":      "Other",
    },
    # Subcategory_IllegalDump (category 9)
    9: {
        "HOUSEHOLD":  "Household Waste",
        "CONSTRUCT": "Construction Debris",
        "HAZMAT":     "Hazardous Material",
        "APPLIANCE":  "Appliance / Furniture",
        "OTHER":      "Other",
    },
    # Subcategory_Sidewalks (category 10)
    10: {
        "CRACK_SW":   "Cracked Sidewalk",
        "TRIP":       "Trip Hazard",
        "MISSING_SW": "Missing Sidewalk",
        "ADA":        "ADA Accessibility",
        "CURB_CUT":   "Curb Cut Issue",
        "OTHER":      "Other",
    },
    # Subcategory_Streetlight (category 11)
    11: {
        "LIGHT_OUT":  "Light Out",
        "DIM":        "Dim / Flickering",
        "POLE_DMG":   "Pole Damage",
        "WIRING":     "Wiring / Electrical",
        "OTHER":      "Other",
    },
    # Subcategory_Other (category 12)
    12: {
        "DEAD_ANIMAL": "Dead Animal Removal",
        "CODE_ENF":    "Code Enforcement Related",
        "GRAFFITI":    "Graffiti",
        "HOUSING":     "Housing/Homelessness",
        "PARK_TREE":   "Park/Tree Related",
        "RIDGES_IRR":  "Ridges Irrigation (Ridges Only)",
        "ROAD_SIDE":   "Road/Sidewalk/Streetlight Related",
        "SEWER":       "Sewer Related",
        "SNOW_ICE":    "Snow/Ice Related",
        "WATER":       "Water Related",
        "WEEDS":       "Weeds Related",
        "OTHER":       "Other",
    },
    # Subcategory_CodeEnforcement (category 13)
    13: {
        "ANIMAL":     "Animal Regulation",
        "JUNK":       "Junk / Outdoor Storage",
        "BUSHES":     "Overhanging Bushes / Shrubs",
        "TRAILER":    "Trailer / RV Storage",
        "WEEDS":      "Weed Abatement",
        "OTHER":      "Other",
    },
}


STATUS_LABELS = {1: "Open", 2: "Received", 3: "In Progress", 4: "Resolved", 5: "Closed"}
TERMINAL_STATUSES = (4, 5)

COMMENT_TYPE_LABELS = {
    "STATUS":     "Status Update",
    "PUBLIC":     "Public Comment",
    "UPDATE":     "Update",
    "RESOLUTION": "Resolution",
    "INTERNAL":   "Internal Note",
}


def category_label(code):
    try:
        return CATEGORY_LABELS.get(int(code), str(code))
    except (TypeError, ValueError):
        return str(code) if code is not None else ""


def subcategory_label(category_code, subcategory_code):
    if subcategory_code is None:
        return ""
    try:
        return SUBCATEGORY_LABELS.get(int(category_code), {}).get(subcategory_code, str(subcategory_code))
    except (TypeError, ValueError):
        return str(subcategory_code)
