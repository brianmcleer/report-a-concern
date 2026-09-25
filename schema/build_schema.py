"""
build_schema.py

Builds the Report a Concern (RAC) enterprise geodatabase schema with arcpy.

Target: SQL Server enterprise geodatabase, database ReportAConcern, schema DBO.
The spatial reference is configurable; the default below (WKID 26912,
NAD 1983 UTM Zone 12N) is only an example. Change it to match your area.

What this script creates, in order:
  1. Coded value domains (TicketStatus, Priority, DepartmentAssignment,
     CommentType, YesNo, and one Subcategory_<Category> domain per
     category in scripts/categories.py).
  2. Feature dataset ReportAConcern_Data.
  3. Feature classes Tickets (point) and Service_Boundaries (polygon).
  4. Standalone tables (Ticket_Comments, Ticket_Photos_Meta,
     Survey_Responses, Notification_Log, Category_Boundary_Lookup,
     Ticket_Routing, Routing_Lookup, Redirect_Contacts, and the three
     Ticket_Retention_* tables).
  5. Subtypes on Tickets.category with a per-subtype subcategory domain.
  6. Relationship classes Tickets_Comments, Tickets_Photos_Meta,
     Tickets_Survey_Responses (composite, cascade delete, one-to-many).
  7. Attribute indexes.
  8. Attachments (Tickets__ATTACH) and editor tracking on Tickets.
  9. Versioning and archiving registration.

Every helper is idempotent: it checks arcpy.Exists / ListFields / Describe
and skips work that is already done, so the script can be re-run safely
after a partial failure.

DRY_RUN = True (the default) prints every step and creates nothing. Set it
to False only after reviewing the printed plan.

How to run
----------
Open the "ArcGIS Pro Python Command Prompt (regular user)" and run:

    propy build_schema.py

The .sde connection file named in SDE_CONNECTION must connect as the data
owner (the user that owns the DBO schema objects), not as the sde
administrator and not as a read-only viewer.

Not created here: the SQL Server sequence used by the RAC_TicketNumber_Sequence
attribute rule and the Arcade attribute rules themselves. See
notification_log.sql and attribute_rules.md.
"""

import os
import sys
import traceback

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Path to an .sde connection file that connects as the data owner.
SDE_CONNECTION = r"C:\GIS\Connections\ReportAConcern_owner.sde"

# Spatial reference for the feature dataset and feature classes.
# 26912 = NAD 1983 UTM Zone 12N. Replace with the WKID your organization uses.
SPATIAL_REFERENCE_WKID = 26912

# When True, every step is printed and nothing is created or changed.
DRY_RUN = True

# Seed values for the DepartmentAssignment domain. Replace with the
# departments that actually receive tickets in your organization.
EXAMPLE_DEPARTMENTS = [
    "Public Works",
    "Utilities",
    "Parks",
    "Code Enforcement",
    "Unknown",
]

FEATURE_DATASET = "ReportAConcern_Data"

# ---------------------------------------------------------------------------
# Import the shared category / subcategory definitions from ../scripts
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_SCRIPTS_DIR = os.path.normpath(os.path.join(_HERE, "..", "scripts"))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

import categories  # noqa: E402  (scripts/categories.py)

# arcpy is only available inside the ArcGIS Pro Python environment. Import
# it lazily so the module can at least be compiled and inspected elsewhere.
try:
    import arcpy  # noqa: E402
except ImportError:  # pragma: no cover
    arcpy = None


# ---------------------------------------------------------------------------
# Domain, subtype, and table definitions
# ---------------------------------------------------------------------------

# Domain name -> (field type, {code: label})
SIMPLE_DOMAINS = {
    "TicketStatus": ("SHORT", {1: "Open", 2: "Received", 3: "In Progress",
                               4: "Resolved", 5: "Closed"}),
    "Priority": ("SHORT", {1: "Low", 2: "Medium", 3: "High", 4: "Critical"}),
    "YesNo": ("SHORT", {0: "No", 1: "Yes"}),
    "CommentType": ("TEXT", {"STATUS": "Status Update",
                             "PUBLIC": "Public Comment",
                             "UPDATE": "Update",
                             "RESOLUTION": "Resolution",
                             "INTERNAL": "Internal Note"}),
    "DepartmentAssignment": ("TEXT", {d: d for d in EXAMPLE_DEPARTMENTS}),
}


def subcategory_domain_name(category_code):
    """Domain name for one category: Subcategory_<Name>, e.g. Subcategory_Water.

    The name is derived from categories.CATEGORY_LABELS by dropping every
    character that is not a letter or digit, so "Roads & Pavement" becomes
    Subcategory_RoadsPavement.
    """
    label = categories.CATEGORY_LABELS[category_code]
    compact = "".join(ch for ch in label if ch.isalnum())
    return "Subcategory_" + compact


# Field tuples: (name, type, length_or_None, alias, domain_or_None, default_or_None)
# Type is one of TEXT, SHORT, LONG, DOUBLE, DATE, GUID.

TICKETS_FIELDS = [
    ("ticket_id", "GUID", None, "Ticket ID", None, None),
    ("ticket_number", "LONG", None, "Ticket Number", None, None),
    ("category", "SHORT", None, "Category", None, None),
    ("subcategory", "TEXT", 50, "Subcategory", None, None),
    ("description", "TEXT", 1000, "Description", None, None),
    ("status", "SHORT", None, "Status", "TicketStatus", 1),
    ("priority", "SHORT", None, "Priority", "Priority", None),
    ("assigned_to", "TEXT", 100, "Assigned To", "DepartmentAssignment", None),
    ("last_notified_assignee", "TEXT", 100, "Last Notified Assignee", None, None),
    ("boundary_id", "TEXT", 50, "Boundary ID", None, None),
    ("submitted_by_name", "TEXT", 200, "Submitted By (Name)", None, None),
    ("submitted_by_email", "TEXT", 254, "Submitted By (Email)", None, None),
    ("submitted_by_phone", "TEXT", 30, "Submitted By (Phone)", None, None),
    ("address_submitted", "TEXT", 255, "Address Submitted", None, None),
    ("notification_sent", "SHORT", None, "Notification Sent", "YesNo", 0),
    ("survey_sent", "SHORT", None, "Survey Sent", "YesNo", 0),
    ("created_date", "DATE", None, "Created Date", None, None),
    ("modified_date", "DATE", None, "Modified Date", None, None),
    ("resolved_date", "DATE", None, "Resolved Date", None, None),
    ("lat", "DOUBLE", None, "Latitude (WGS84)", None, None),
    ("lon", "DOUBLE", None, "Longitude (WGS84)", None, None),
    ("internal_notes", "TEXT", 2000, "Internal Notes", None, None),
    ("resolution_text", "TEXT", 2000, "Resolution", None, None),
]

SERVICE_BOUNDARIES_FIELDS = [
    ("boundary_id", "TEXT", 50, "Boundary ID", None, None),
    ("boundary_name", "TEXT", 100, "Boundary Name", None, None),
    ("is_active", "SHORT", None, "Is Active", "YesNo", 1),
]

TABLES = {
    "Ticket_Comments": [
        ("comment_id", "GUID", None, "Comment ID", None, None),
        ("ticket_id", "GUID", None, "Ticket ID", None, None),
        ("comment_text", "TEXT", 2000, "Comment", None, None),
        ("comment_type", "TEXT", 20, "Comment Type", "CommentType", None),
        ("author", "TEXT", 100, "Author", None, None),
        ("is_public", "SHORT", None, "Is Public", "YesNo", 0),
        ("email_sent", "SHORT", None, "Email Sent", "YesNo", 0),
        ("created_date", "DATE", None, "Created Date", None, None),
    ],
    "Ticket_Photos_Meta": [
        ("photo_id", "GUID", None, "Photo ID", None, None),
        ("ticket_id", "GUID", None, "Ticket ID", None, None),
        ("original_filename", "TEXT", 255, "Original Filename", None, None),
        ("content_type", "TEXT", 100, "Content Type", None, None),
        ("exif_stripped", "SHORT", None, "EXIF Stripped", "YesNo", 0),
        ("created_date", "DATE", None, "Created Date", None, None),
    ],
    "Survey_Responses": [
        ("response_id", "GUID", None, "Response ID", None, None),
        ("ticket_id", "GUID", None, "Ticket ID", None, None),
        ("satisfaction_rating", "SHORT", None, "Satisfaction Rating (1-5)", None, None),
        ("comments", "TEXT", 2000, "Comments", None, None),
        ("submitted_date", "DATE", None, "Submitted Date", None, None),
        ("survey_id", "TEXT", 50, "Survey ID", None, None),
        ("staff_followup", "SHORT", None, "Staff Follow-up Requested", "YesNo", 0),
    ],
    # Notification_Log is NOT registered as versioned. Scripts and the proxy
    # write to it with direct SQL (OBJECTID = MAX + 1). See notification_log.sql.
    "Notification_Log": [
        ("log_id", "GUID", None, "Log ID", None, None),
        ("ticket_id", "GUID", None, "Ticket ID", None, None),
        ("script_name", "TEXT", 100, "Script Name", None, None),
        ("recipient_email", "TEXT", 254, "Recipient Email", None, None),
        ("email_subject", "TEXT", 255, "Email Subject", None, None),
        ("send_status", "TEXT", 20, "Send Status", None, None),
        ("error_message", "TEXT", 500, "Error Message", None, None),
        ("sent_date", "DATE", None, "Sent Date", None, None),
        ("retry_count", "SHORT", None, "Retry Count", None, 0),
    ],
    "Category_Boundary_Lookup": [
        ("category", "SHORT", None, "Category", None, None),
        ("boundary_id", "TEXT", 50, "Boundary ID", None, None),
        ("is_valid", "SHORT", None, "Is Valid", "YesNo", 1),
        ("redirect_message", "TEXT", 500, "Redirect Message", None, None),
    ],
    # subcategory NULL = category catch-all row (tier 2 of routing).
    "Ticket_Routing": [
        ("category", "SHORT", None, "Category", None, None),
        ("subcategory", "TEXT", 50, "Subcategory", None, None),
        ("boundary_id", "TEXT", 50, "Boundary ID", None, None),
        ("default_assignee", "TEXT", 100, "Default Assignee", None, None),
        ("assignee_email", "TEXT", 254, "Assignee Email", None, None),
        ("escalation_contact", "TEXT", 254, "Escalation Contact", None, None),
        ("is_active", "SHORT", None, "Is Active", "YesNo", 1),
    ],
    "Routing_Lookup": [
        ("category_label", "TEXT", 100, "Category", None, None),
        ("subcategory_label", "TEXT", 100, "Subcategory", None, None),
        ("department", "TEXT", 100, "Department", None, None),
        ("email", "TEXT", 254, "Email", None, None),
    ],
    "Redirect_Contacts": [
        ("boundary_id", "TEXT", 50, "Boundary ID", None, None),
        ("category", "SHORT", None, "Category (NULL = any)", None, None),
        ("contact_name", "TEXT", 100, "Contact Name", None, None),
        ("contact_phone", "TEXT", 30, "Contact Phone", None, None),
        ("contact_url", "TEXT", 255, "Contact URL", None, None),
        ("message", "TEXT", 500, "Message", None, None),
    ],
    # Retention tables: plain, not versioned, not archived. De-identified.
    "Ticket_Retention_Summary": [
        ("closed_year", "SHORT", None, "Closed Year", None, None),
        ("closed_month", "SHORT", None, "Closed Month", None, None),
        ("created_year", "SHORT", None, "Created Year", None, None),
        ("created_month", "SHORT", None, "Created Month", None, None),
        ("category", "SHORT", None, "Category", None, None),
        ("subcategory", "TEXT", 50, "Subcategory", None, None),
        ("final_status", "SHORT", None, "Final Status", "TicketStatus", None),
        ("responsible_unit", "TEXT", 100, "Responsible Unit", None, None),
        ("ticket_count", "LONG", None, "Ticket Count", None, 0),
        ("resolution_days_total", "DOUBLE", None, "Total Resolution Days", None, 0),
        ("survey_response_count", "LONG", None, "Survey Responses", None, 0),
        ("survey_rated_count", "LONG", None, "Survey Rated Count", None, 0),
        ("survey_rating_sum", "LONG", None, "Survey Rating Sum", None, 0),
        ("rating_1_count", "LONG", None, "1-Star Count", None, 0),
        ("rating_2_count", "LONG", None, "2-Star Count", None, 0),
        ("rating_3_count", "LONG", None, "3-Star Count", None, 0),
        ("rating_4_count", "LONG", None, "4-Star Count", None, 0),
        ("rating_5_count", "LONG", None, "5-Star Count", None, 0),
        ("written_date", "DATE", None, "Written Date", None, None),
    ],
    "Ticket_Retention_Control": [
        ("closed_year", "SHORT", None, "Closed Year", None, None),
        ("closed_month", "SHORT", None, "Closed Month", None, None),
        ("ticket_count", "LONG", None, "Tickets In Month", None, None),
        ("summarized_at", "DATE", None, "Summarized At", None, None),
        ("purged_at", "DATE", None, "Purged At", None, None),
        ("last_error", "TEXT", 500, "Last Error", None, None),
    ],
    "Ticket_Retention_Audit": [
        ("run_id", "GUID", None, "Run ID", None, None),
        ("run_started", "DATE", None, "Run Started", None, None),
        ("run_finished", "DATE", None, "Run Finished", None, None),
        ("months_processed", "SHORT", None, "Months Processed", None, 0),
        ("resolved_date_min", "DATE", None, "Purged resolved_date From", None, None),
        ("resolved_date_max", "DATE", None, "Purged resolved_date To", None, None),
        ("tickets_deleted", "LONG", None, "Tickets Deleted", None, 0),
        ("comments_deleted", "LONG", None, "Comments Deleted", None, 0),
        ("photos_deleted", "LONG", None, "Photos Deleted", None, 0),
        ("surveys_deleted", "LONG", None, "Survey Responses Deleted", None, 0),
        ("executed_by", "TEXT", 100, "Executing Process / Operator", None, None),
        ("run_status", "TEXT", 20, "Run Status", None, None),
        ("notes", "TEXT", 500, "Notes", None, None),
    ],
}

# (table, index name, [fields])
INDEXES = [
    ("Service_Boundaries", "IX_SB_Active_Boundary", ["is_active", "boundary_id"]),
    ("Category_Boundary_Lookup", "IX_CBL_Cat_Boundary_Valid",
     ["category", "boundary_id", "is_valid"]),
    ("Ticket_Routing", "IX_TR_Cat_Sub_Boundary_Active",
     ["category", "subcategory", "boundary_id", "is_active"]),
    ("Tickets", "IX_Tickets_Number", ["ticket_number"]),
    ("Ticket_Comments", "IX_TC_Public_EmailSent", ["is_public", "email_sent"]),
]

# (relationship name, origin table, destination table)
RELATIONSHIPS = [
    ("Tickets_Comments", "Tickets", "Ticket_Comments"),
    ("Tickets_Photos_Meta", "Tickets", "Ticket_Photos_Meta"),
    ("Tickets_Survey_Responses", "Tickets", "Survey_Responses"),
]

VERSIONED = ["Tickets", "Ticket_Comments", "Ticket_Photos_Meta",
             "Survey_Responses", "Ticket_Routing", "Routing_Lookup"]
ARCHIVED = ["Tickets", "Ticket_Comments", "Ticket_Photos_Meta", "Survey_Responses"]


# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------

def log(msg):
    prefix = "[DRY RUN] " if DRY_RUN else ""
    print(prefix + msg)


def path_in_dataset(name):
    """Full path of a feature class inside the feature dataset."""
    return os.path.join(SDE_CONNECTION, FEATURE_DATASET, name)


def path_standalone(name):
    """Full path of a standalone table at the workspace root."""
    return os.path.join(SDE_CONNECTION, name)


def dataset_path(name):
    """Resolve any dataset name to its full path (feature dataset or root)."""
    if name in ("Tickets", "Service_Boundaries"):
        return path_in_dataset(name)
    return path_standalone(name)


def exists(path):
    if DRY_RUN and arcpy is None:
        return False
    return arcpy.Exists(path)


def existing_field_names(path):
    if not exists(path):
        return set()
    return {f.name.lower() for f in arcpy.ListFields(path)}


def existing_domain_names():
    if DRY_RUN and arcpy is None:
        return set()
    return {d.name for d in arcpy.da.ListDomains(SDE_CONNECTION)}


# ---------------------------------------------------------------------------
# Idempotent helpers
# ---------------------------------------------------------------------------

def ensure_domain(name, field_type, codes, description=""):
    """Create a coded value domain and its codes if the domain is missing."""
    if name in existing_domain_names():
        log(f"domain {name}: exists, skipping")
        return
    log(f"domain {name}: create ({field_type}, {len(codes)} codes)")
    if DRY_RUN:
        for code, label in codes.items():
            log(f"    {code!r} -> {label}")
        return
    arcpy.management.CreateDomain(SDE_CONNECTION, name, description or name,
                                  field_type, "CODED")
    for code, label in codes.items():
        arcpy.management.AddCodedValueToDomain(SDE_CONNECTION, name, code, label)


def add_field(table_path, name, ftype, length=None, alias=None,
              domain=None, default=None):
    """Add one field if it does not already exist, then domain and default."""
    if name.lower() in existing_field_names(table_path):
        log(f"  field {name}: exists, skipping")
        return
    desc = f"{ftype}" + (f"({length})" if length else "")
    extra = ""
    if domain:
        extra += f" domain={domain}"
    if default is not None:
        extra += f" default={default!r}"
    log(f"  field {name}: add {desc}{extra}")
    if DRY_RUN:
        return
    arcpy.management.AddField(table_path, name, ftype,
                              field_length=length if ftype == "TEXT" else None,
                              field_alias=alias or name,
                              field_is_nullable="NULLABLE")
    if domain:
        arcpy.management.AssignDomainToField(table_path, name, domain)
    if default is not None:
        arcpy.management.AssignDefaultToField(table_path, name, default)


def create_table(name, fields):
    """Create a standalone table at the workspace root and add its fields."""
    path = path_standalone(name)
    if exists(path):
        log(f"table {name}: exists, checking fields")
    else:
        log(f"table {name}: create")
        if not DRY_RUN:
            arcpy.management.CreateTable(SDE_CONNECTION, name)
    for f in fields:
        add_field(path, *f)
    return path


def create_fc(name, geometry_type, fields, spatial_ref):
    """Create a feature class inside the feature dataset and add its fields."""
    path = path_in_dataset(name)
    if exists(path):
        log(f"feature class {name}: exists, checking fields")
    else:
        log(f"feature class {name}: create {geometry_type} in {FEATURE_DATASET}")
        if not DRY_RUN:
            arcpy.management.CreateFeatureclass(
                os.path.join(SDE_CONNECTION, FEATURE_DATASET), name,
                geometry_type, spatial_reference=spatial_ref)
    for f in fields:
        add_field(path, *f)
    return path


def ensure_feature_dataset(spatial_ref):
    path = os.path.join(SDE_CONNECTION, FEATURE_DATASET)
    if exists(path):
        log(f"feature dataset {FEATURE_DATASET}: exists, skipping")
        return
    log(f"feature dataset {FEATURE_DATASET}: create (WKID {SPATIAL_REFERENCE_WKID})")
    if not DRY_RUN:
        arcpy.management.CreateFeatureDataset(SDE_CONNECTION, FEATURE_DATASET,
                                              spatial_ref)


def add_index(table_name, index_name, fields):
    """Add an attribute index unless one with that name already exists."""
    path = dataset_path(table_name)
    if exists(path):
        have = {i.name.lower() for i in arcpy.ListIndexes(path)}
        if index_name.lower() in have:
            log(f"index {index_name} on {table_name}: exists, skipping")
            return
    log(f"index {index_name} on {table_name}: add ({', '.join(fields)})")
    if not DRY_RUN:
        arcpy.management.AddIndex(path, fields, index_name, "NON_UNIQUE",
                                  "NON_ASCENDING")


def add_relationship(name, origin, destination):
    """Composite one-to-many relationship, cascade delete, keyed on ticket_id."""
    rel_path = path_standalone(name)
    if exists(rel_path):
        log(f"relationship {name}: exists, skipping")
        return
    log(f"relationship {name}: {origin}.ticket_id -> {destination}.ticket_id "
        f"(COMPOSITE, ONE_TO_MANY, cascade delete)")
    if DRY_RUN:
        return
    arcpy.management.CreateRelationshipClass(
        origin_table=dataset_path(origin),
        destination_table=dataset_path(destination),
        out_relationship_class=rel_path,
        relationship_type="COMPOSITE",
        forward_label=destination,
        backward_label=origin,
        message_direction="FORWARD",
        cardinality="ONE_TO_MANY",
        attributed="NONE",
        origin_primary_key="ticket_id",
        origin_foreign_key="ticket_id",
    )


def register_versioned(table_name):
    path = dataset_path(table_name)
    if exists(path) and arcpy.Describe(path).isVersioned:
        log(f"versioning {table_name}: already registered, skipping")
        return
    log(f"versioning {table_name}: RegisterAsVersioned (NO_EDITS_TO_BASE)")
    if not DRY_RUN:
        arcpy.management.RegisterAsVersioned(path, "NO_EDITS_TO_BASE")


def enable_archiving(table_name):
    path = dataset_path(table_name)
    if exists(path) and arcpy.Describe(path).isArchived:
        log(f"archiving {table_name}: already enabled, skipping")
        return
    log(f"archiving {table_name}: EnableArchiving")
    if not DRY_RUN:
        arcpy.management.EnableArchiving(path)


def ensure_global_ids(table_name):
    path = dataset_path(table_name)
    if exists(path) and arcpy.Describe(path).hasGlobalID:
        log(f"GlobalIDs {table_name}: present, skipping")
        return
    log(f"GlobalIDs {table_name}: AddGlobalIDs")
    if not DRY_RUN:
        arcpy.management.AddGlobalIDs(path)


def ensure_subtypes():
    """Set Tickets.category as the subtype field, add codes 1..13, and assign
    the matching Subcategory_<Name> domain to the subcategory field per subtype."""
    path = dataset_path("Tickets")
    have = {}
    if exists(path):
        have = arcpy.da.ListSubtypes(path)
        # A table with no subtype field reports a single default entry keyed 0.
        if 0 in have and len(have) == 1 and not have[0].get("SubtypeField"):
            have = {}
    if not have:
        log("subtypes Tickets: SetSubtypeField category")
        if not DRY_RUN:
            arcpy.management.SetSubtypeField(path, "category")
    for code, label in categories.CATEGORY_LABELS.items():
        if code in have:
            log(f"  subtype {code} {label}: exists, skipping")
        else:
            log(f"  subtype {code}: add '{label}'")
            if not DRY_RUN:
                arcpy.management.AddSubtype(path, code, label)
        domain = subcategory_domain_name(code)
        log(f"  subtype {code}: subcategory domain -> {domain}")
        if not DRY_RUN:
            arcpy.management.AssignDomainToField(path, "subcategory", domain,
                                                 [str(code)])
    log("subtypes Tickets: SetDefaultSubtype 12 (Other)")
    if not DRY_RUN:
        arcpy.management.SetDefaultSubtype(path, 12)


def ensure_attachments():
    path = dataset_path("Tickets")
    if exists(path):
        rels = arcpy.Describe(path).relationshipClassNames or []
        if any(r.upper().endswith("TICKETS__ATTACHREL") for r in rels):
            log("attachments Tickets: enabled, skipping")
            return
    log("attachments Tickets: EnableAttachments (creates Tickets__ATTACH)")
    if not DRY_RUN:
        arcpy.management.EnableAttachments(path)


def ensure_editor_tracking():
    path = dataset_path("Tickets")
    if exists(path) and arcpy.Describe(path).editorTrackingEnabled:
        log("editor tracking Tickets: enabled, skipping")
        return
    log("editor tracking Tickets: EnableEditorTracking "
        "(creator/created_date, last_edited_user/modified_date, UTC)")
    if not DRY_RUN:
        arcpy.management.EnableEditorTracking(
            path,
            creator_field="creator",
            creation_date_field="created_date",
            last_editor_field="last_edited_user",
            last_edit_date_field="modified_date",
            add_fields="ADD_FIELDS",
            record_dates_in="UTC",
        )


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    if arcpy is None and not DRY_RUN:
        raise RuntimeError("arcpy is required. Run this from the ArcGIS Pro "
                           "Python environment: propy build_schema.py")
    if arcpy is None:
        log("arcpy not available; printing the plan only.")

    spatial_ref = arcpy.SpatialReference(SPATIAL_REFERENCE_WKID) if arcpy else None

    log(f"workspace: {SDE_CONNECTION}")
    log(f"spatial reference WKID: {SPATIAL_REFERENCE_WKID}")

    # 1. Domains
    log("== 1. Domains ==")
    for name, (ftype, codes) in SIMPLE_DOMAINS.items():
        ensure_domain(name, ftype, codes)
    for code in categories.ALL_CATEGORIES:
        ensure_domain(subcategory_domain_name(code), "TEXT",
                      categories.SUBCATEGORY_LABELS[code],
                      f"Subcategories for {categories.CATEGORY_LABELS[code]}")

    # 2. Feature dataset
    log("== 2. Feature dataset ==")
    ensure_feature_dataset(spatial_ref)

    # 3. Feature classes
    log("== 3. Feature classes ==")
    create_fc("Tickets", "POINT", TICKETS_FIELDS, spatial_ref)
    ensure_global_ids("Tickets")
    create_fc("Service_Boundaries", "POLYGON", SERVICE_BOUNDARIES_FIELDS, spatial_ref)

    # 4. Tables
    log("== 4. Tables ==")
    for name, fields in TABLES.items():
        create_table(name, fields)
    for name in ("Ticket_Comments", "Ticket_Photos_Meta", "Survey_Responses"):
        ensure_global_ids(name)

    # 5. Subtypes and subtype-domain assignment
    log("== 5. Subtypes ==")
    ensure_subtypes()

    # 6. Relationship classes
    log("== 6. Relationship classes ==")
    for name, origin, dest in RELATIONSHIPS:
        add_relationship(name, origin, dest)

    # 7. Indexes
    log("== 7. Attribute indexes ==")
    for table, idx, fields in INDEXES:
        add_index(table, idx, fields)

    # 8. Attachments and editor tracking
    log("== 8. Attachments and editor tracking ==")
    ensure_attachments()
    ensure_editor_tracking()

    # 9. Versioning and archiving
    log("== 9. Versioning and archiving ==")
    for name in VERSIONED:
        register_versioned(name)
    for name in ARCHIVED:
        enable_archiving(name)
    log("not versioned (by design): Service_Boundaries, Category_Boundary_Lookup, "
        "Redirect_Contacts, Notification_Log, Ticket_Retention_*")

    log("== Done ==")
    log("Next: run notification_log.sql for the ticket number sequence, then "
        "add the Arcade attribute rules described in attribute_rules.md.")


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001
        print("build_schema.py FAILED")
        traceback.print_exc()
        if arcpy is not None:
            msgs = arcpy.GetMessages(2)
            if msgs:
                print("arcpy messages:")
                print(msgs)
        sys.exit(1)
