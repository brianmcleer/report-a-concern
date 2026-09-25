# Report a Concern: Geodatabase Schema

This folder defines the enterprise geodatabase that backs Report a Concern (RAC).

- Platform: SQL Server enterprise geodatabase, database `ReportAConcern`, schema `DBO`.
- Spatial reference: configurable. The scripts default to WKID 26912 (NAD 1983 UTM Zone 12N) as an example; change it to your projection before running.
- Category and subcategory codes come from `../scripts/categories.py`, which is the single source of truth shared with the automation scripts.

| File | What it is |
|------|------------|
| `build_schema.py` | arcpy script that creates the whole schema (domains, feature dataset, feature classes, tables, subtypes, relationship classes, indexes, attachments, editor tracking, versioning). Idempotent, `DRY_RUN = True` by default. |
| `notification_log.sql` | T-SQL for the SQL-only pieces: the ticket number sequence, a reference definition of `Notification_Log`, and the recommended indexes. |
| `export_schema_xml.py` | Exports a schema-only XML workspace document from a live geodatabase and scrubs connection details before saving. |
| `attribute_rules.md` | The five Arcade attribute rules on `Tickets`: purpose, routing pseudo-code, indexes, and the procedure for editing rules on a versioned dataset. |

## Contents

1. [Data dictionary](#data-dictionary)
2. [Domains](#domains)
3. [Subtypes](#subtypes)
4. [Relationship classes](#relationship-classes)
5. [Indexes](#indexes)
6. [Versioning matrix](#versioning-matrix)
7. [Running build_schema.py](#running-build_schemapy)
8. [XML workspace document](#xml-workspace-document)
9. [Seeding lookup tables](#seeding-lookup-tables)

## Data dictionary

Types are geodatabase field types. `TEXT n` is a text field of length n. Every feature class and table also has the geodatabase-managed `OBJECTID`; the feature classes have `SHAPE`.

### Tickets (point feature class, in `ReportAConcern_Data`)

System of record. One row per citizen submission.

| Field | Type | Purpose |
|-------|------|---------|
| `ticket_id` | GUID (GlobalID) | Primary key. Foreign key in every related table. Populated by the geodatabase. |
| `ticket_number` | LONG | Human-readable number starting at 10000. Set by the `RAC_TicketNumber_Sequence` attribute rule. |
| `category` | SHORT (subtype) | Codes 1 through 13; see `categories.CATEGORY_LABELS`. Subtype field. |
| `subcategory` | TEXT 50 | Per-subtype domain `Subcategory_<Category>`. Optional. |
| `description` | TEXT 1000 | Free-text description from the citizen. |
| `status` | SHORT | `TicketStatus` domain. Default 1 (Open). 4 and 5 are terminal. |
| `priority` | SHORT | `Priority` domain. Optional; set by staff. |
| `assigned_to` | TEXT 100 | `DepartmentAssignment` domain. Set by `RAC_Geofence_Route` on insert; editable by staff. |
| `last_notified_assignee` | TEXT 100 | Last department that received an assignment e-mail. Compared with `assigned_to` to detect reassignment. |
| `boundary_id` | TEXT 50 | Service boundary the point fell in. Set by `RAC_Geofence_Route`. |
| `submitted_by_name` | TEXT 200 | Citizen name (PII). |
| `submitted_by_email` | TEXT 254 | Citizen e-mail (PII). Used for status and survey e-mails. |
| `submitted_by_phone` | TEXT 30 | Citizen phone (PII). Optional. |
| `address_submitted` | TEXT 255 | Address text as typed or geocoded in the widget. |
| `notification_sent` | SHORT | `YesNo`, default 0. Polled by the new-ticket notifier. |
| `survey_sent` | SHORT | `YesNo`, default 0. Polled by the survey mailer after Resolved. |
| `created_date` | DATE | Editor tracking creation date (UTC). |
| `modified_date` | DATE | Editor tracking last edit date (UTC). |
| `resolved_date` | DATE | Set by staff or the admin app when status becomes Resolved. |
| `lat` | DOUBLE | WGS84 latitude convenience copy of the geometry. |
| `lon` | DOUBLE | WGS84 longitude convenience copy of the geometry. |
| `internal_notes` | TEXT 2000 | Staff-only notes. Never shown to the citizen. |
| `resolution_text` | TEXT 2000 | Public resolution summary sent with the Resolved e-mail. |
| `creator` | TEXT | Added by editor tracking. |
| `last_edited_user` | TEXT | Added by editor tracking. |

Attachments are enabled on `Tickets`, which creates `Tickets__ATTACH` and the `Tickets__ATTACHREL` relationship class. Photos are stored there; `Ticket_Photos_Meta` carries the sidecar metadata.

### Ticket_Comments (table)

Threaded comment history. `is_public = 1` rows are visible to the citizen and are e-mailed by the comments mailer.

| Field | Type | Purpose |
|-------|------|---------|
| `comment_id` | GUID (GlobalID) | Primary key. |
| `ticket_id` | GUID | Foreign key to `Tickets.ticket_id`. |
| `comment_text` | TEXT 2000 | Comment body. |
| `comment_type` | TEXT 20 | `CommentType` domain: STATUS, PUBLIC, UPDATE, RESOLUTION, INTERNAL. |
| `author` | TEXT 100 | Staff user or department that wrote the comment. |
| `is_public` | SHORT | `YesNo`. Citizen visibility. |
| `email_sent` | SHORT | `YesNo`, default 0. Set to 1 by the comments mailer. |
| `created_date` | DATE | When the comment was written (UTC). |

### Ticket_Photos_Meta (table)

Metadata sidecar for each attachment.

| Field | Type | Purpose |
|-------|------|---------|
| `photo_id` | GUID (GlobalID) | Primary key. |
| `ticket_id` | GUID | Foreign key to `Tickets.ticket_id`. |
| `original_filename` | TEXT 255 | Filename as uploaded. |
| `content_type` | TEXT 100 | MIME type. |
| `exif_stripped` | SHORT | `YesNo`. 1 when the proxy removed EXIF metadata before upload. |
| `created_date` | DATE | Upload time (UTC). |

### Survey_Responses (table)

Satisfaction survey results pulled from the survey platform.

| Field | Type | Purpose |
|-------|------|---------|
| `response_id` | GUID (GlobalID) | Primary key. |
| `ticket_id` | GUID | Foreign key to `Tickets.ticket_id`. |
| `satisfaction_rating` | SHORT | 1 through 5. |
| `comments` | TEXT 2000 | Free-text response. |
| `submitted_date` | DATE | When the survey was completed. |
| `survey_id` | TEXT 50 | Identifier of the survey form or response in the survey platform. |
| `staff_followup` | SHORT | `YesNo`. Respondent asked for a callback. |

### Notification_Log (table, not versioned)

Append-only audit of every e-mail and proxy event. Written by the scripts and the proxy with direct SQL (`OBJECTID = MAX + 1`). Must never be registered as versioned. See `notification_log.sql`.

| Field | Type | Purpose |
|-------|------|---------|
| `log_id` | GUID | Row identifier. |
| `ticket_id` | GUID | Related ticket, when there is one. |
| `script_name` | TEXT 100 | Writer: script file name or proxy endpoint. |
| `recipient_email` | TEXT 254 | Addressee. |
| `email_subject` | TEXT 255 | Subject line sent. |
| `send_status` | TEXT 20 | SENT, FAILED, SKIPPED, INFO, and similar. |
| `error_message` | TEXT 500 | Exception text on failure. |
| `sent_date` | DATE | Event time (UTC). |
| `retry_count` | SHORT | Number of send attempts. |

### Service_Boundaries (polygon feature class, in `ReportAConcern_Data`)

Service area polygons: city limits, utility districts, maintenance zones, and similar.

| Field | Type | Purpose |
|-------|------|---------|
| `boundary_id` | TEXT 50 | Stable key referenced by the lookup tables. |
| `boundary_name` | TEXT 100 | Display name. |
| `is_active` | SHORT | `YesNo`. Only active boundaries take part in geofencing. |

### Category_Boundary_Lookup (table)

Which categories are accepted inside which boundaries.

| Field | Type | Purpose |
|-------|------|---------|
| `category` | SHORT | Category code 1 through 13. |
| `boundary_id` | TEXT 50 | Foreign key to `Service_Boundaries.boundary_id`. |
| `is_valid` | SHORT | `YesNo`. 1 = category offered in this boundary. |
| `redirect_message` | TEXT 500 | Message shown when the category is not offered here. |

### Ticket_Routing (table)

Maps a submission to a default department and its inbox. A row with `subcategory` NULL is the catch-all for the category within that boundary.

| Field | Type | Purpose |
|-------|------|---------|
| `category` | SHORT | Category code. |
| `subcategory` | TEXT 50 | Subcategory code, or NULL for the category catch-all row. |
| `boundary_id` | TEXT 50 | Foreign key to `Service_Boundaries.boundary_id`. |
| `default_assignee` | TEXT 100 | Value written into `Tickets.assigned_to`. Must be a `DepartmentAssignment` code. |
| `assignee_email` | TEXT 254 | Inbox that receives the new-ticket e-mail. |
| `escalation_contact` | TEXT 254 | Address for overdue or unrouted tickets. |
| `is_active` | SHORT | `YesNo`. Inactive rows are ignored by routing. |

### Routing_Lookup (table)

Flat, human-readable copy of the routing matrix (category label, subcategory label, department, e-mail) used by the dashboard's routing helper page. Refreshed from the routing spreadsheet; not used by the attribute rules.

| Field | Type | Purpose |
|-------|------|---------|
| `category_label` | TEXT 100 | Category display name. |
| `subcategory_label` | TEXT 100 | Subcategory display name. |
| `department` | TEXT 100 | Responsible department. |
| `email` | TEXT 254 | Department inbox. |

### Redirect_Contacts (table)

Citizen-facing contact information returned when a constraint rule blocks a submission.

| Field | Type | Purpose |
|-------|------|---------|
| `boundary_id` | TEXT 50 | Boundary the message applies to. |
| `category` | SHORT | Category code, or NULL for a boundary-wide message. |
| `contact_name` | TEXT 100 | Organization or office to contact instead. |
| `contact_phone` | TEXT 30 | Phone number. |
| `contact_url` | TEXT 255 | Web address. |
| `message` | TEXT 500 | Full message shown in the widget. |

### Ticket_Retention_Summary (table, not versioned)

Permanent de-identified ledger written before each retention purge. One row per (closed year/month, created year/month, category, subcategory, final status, responsible unit). No ticket IDs, free text, or PII. Never purged.

| Field | Type | Purpose |
|-------|------|---------|
| `closed_year`, `closed_month` | SHORT | Month the tickets were resolved or closed. |
| `created_year`, `created_month` | SHORT | Month the tickets were submitted. |
| `category` | SHORT | Category code. |
| `subcategory` | TEXT 50 | Subcategory code. |
| `final_status` | SHORT | `TicketStatus` code (4 or 5). |
| `responsible_unit` | TEXT 100 | `assigned_to` at closure. |
| `ticket_count` | LONG | Tickets in the bucket. |
| `resolution_days_total` | DOUBLE | Sum of resolution days (average = total / count). |
| `survey_response_count` | LONG | Survey responses in the bucket. |
| `survey_rated_count` | LONG | Responses with a rating. |
| `survey_rating_sum` | LONG | Sum of ratings (average = sum / rated count). |
| `rating_1_count` through `rating_5_count` | LONG | Rating histogram. |
| `written_date` | DATE | When the row was written. |

### Ticket_Retention_Control (table, not versioned)

Per closure-month state machine that makes the purge idempotent and resumable.

| Field | Type | Purpose |
|-------|------|---------|
| `closed_year`, `closed_month` | SHORT | Closure month. |
| `ticket_count` | LONG | Tickets found in the month at summarization time. |
| `summarized_at` | DATE | Set once the summary rows are written. |
| `purged_at` | DATE | Set once the raw records are deleted. |
| `last_error` | TEXT 500 | Last failure for this month, if any. |

### Ticket_Retention_Audit (table, not versioned)

One row per purge run. Retained for the life of the system.

| Field | Type | Purpose |
|-------|------|---------|
| `run_id` | GUID | Run identifier. |
| `run_started`, `run_finished` | DATE | Run window. |
| `months_processed` | SHORT | Closure months handled in this run. |
| `resolved_date_min`, `resolved_date_max` | DATE | Range of `resolved_date` purged. |
| `tickets_deleted`, `comments_deleted`, `photos_deleted`, `surveys_deleted` | LONG | Records removed per table. |
| `executed_by` | TEXT 100 | Process name or operator. |
| `run_status` | TEXT 20 | COMPLETED, FAILED, PARTIAL. |
| `notes` | TEXT 500 | Free-form operator notes (no PII). |

## Domains

All domains are coded value domains.

| Domain | Field type | Codes |
|--------|-----------|-------|
| `TicketStatus` | SHORT | 1 Open, 2 Received, 3 In Progress, 4 Resolved, 5 Closed |
| `Priority` | SHORT | 1 Low, 2 Medium, 3 High, 4 Critical |
| `YesNo` | SHORT | 0 No, 1 Yes |
| `CommentType` | TEXT | STATUS Status Update, PUBLIC Public Comment, UPDATE Update, RESOLUTION Resolution, INTERNAL Internal Note |
| `DepartmentAssignment` | TEXT | Seeded with `EXAMPLE_DEPARTMENTS` in `build_schema.py`: Public Works, Utilities, Parks, Code Enforcement, Unknown. Replace with your departments. Code and label are the same string. |
| `Subcategory_<Category>` | TEXT | One domain per category; codes and labels from `categories.SUBCATEGORY_LABELS`. |

The subcategory domain names are derived from the category label with non-alphanumeric characters removed:

| Category code | Label | Domain |
|---|---|---|
| 1 | Water | `Subcategory_Water` |
| 2 | Sewer | `Subcategory_Sewer` |
| 3 | Roads & Pavement | `Subcategory_RoadsPavement` |
| 4 | Signs & Signals | `Subcategory_SignsSignals` |
| 5 | Parks & Recreation | `Subcategory_ParksRecreation` |
| 6 | Trees & Vegetation | `Subcategory_TreesVegetation` |
| 7 | Drainage & Stormwater | `Subcategory_DrainageStormwater` |
| 8 | Graffiti | `Subcategory_Graffiti` |
| 9 | Illegal Dumping | `Subcategory_IllegalDumping` |
| 10 | Sidewalks & Curbs | `Subcategory_SidewalksCurbs` |
| 11 | Street Lighting | `Subcategory_StreetLighting` |
| 12 | Other | `Subcategory_Other` |
| 13 | Code Enforcement | `Subcategory_CodeEnforcement` |

## Subtypes

`Tickets.category` is the subtype field with codes 1 through 13 (labels from `categories.CATEGORY_LABELS`). Each subtype assigns the matching `Subcategory_<Category>` domain to the `subcategory` field, so the submit widget and ArcGIS Pro show only the subcategories that belong to the chosen category. The default subtype is 12 (Other).

## Relationship classes

All three are composite, one-to-many, cascade delete, keyed on `ticket_id` at both ends. Deleting a ticket deletes its comments, photo metadata, and survey responses. Attachments are cascade-deleted through the attachment relationship the geodatabase creates.

| Relationship class | Origin | Destination |
|--------------------|--------|-------------|
| `Tickets_Comments` | `Tickets.ticket_id` | `Ticket_Comments.ticket_id` |
| `Tickets_Photos_Meta` | `Tickets.ticket_id` | `Ticket_Photos_Meta.ticket_id` |
| `Tickets_Survey_Responses` | `Tickets.ticket_id` | `Survey_Responses.ticket_id` |

## Indexes

Spatial indexes are created automatically with each feature class. Attribute indexes:

| Object | Fields | Used by |
|--------|--------|---------|
| `Service_Boundaries` | `is_active, boundary_id` | Geofence rules |
| `Category_Boundary_Lookup` | `category, boundary_id, is_valid` | Geofence rules |
| `Ticket_Routing` | `category, subcategory, boundary_id, is_active` | Routing rule, notifier scripts |
| `Tickets` | `ticket_number` | Status page, scripts |
| `Ticket_Comments` | `is_public, email_sent` | Comments mailer |

## Versioning matrix

| Object | Versioned | Archived | Notes |
|--------|-----------|----------|-------|
| `Tickets` | Yes | Yes | Edits through feature services and edit sessions. |
| `Tickets__ATTACH` | With parent | With parent | Managed by the geodatabase. |
| `Ticket_Comments` | Yes | Yes | |
| `Ticket_Photos_Meta` | Yes | Yes | |
| `Survey_Responses` | Yes | Yes | |
| `Ticket_Routing` | Yes | No | Edit through an edit session or the direct-SQL base path. |
| `Routing_Lookup` | Yes | No | Rebuilt from the routing spreadsheet. |
| `Service_Boundaries` | No | No | Lookup; edit directly. |
| `Category_Boundary_Lookup` | No | No | Lookup; edit directly. |
| `Redirect_Contacts` | No | No | Lookup; edit directly. |
| `Notification_Log` | No | No | Direct SQL writers. Never version. |
| `Ticket_Retention_Summary` | No | No | Plain table. |
| `Ticket_Retention_Control` | No | No | Plain table. |
| `Ticket_Retention_Audit` | No | No | Plain table. |

Attribute rules cannot be edited while `Tickets` is versioned; see the procedure in `attribute_rules.md`.

## Running build_schema.py

Prerequisites:

- ArcGIS Pro (arcpy) on the machine that runs the script.
- An enterprise geodatabase named `ReportAConcern` already created with `Create Enterprise Geodatabase`.
- A `.sde` connection file that connects as the **data owner** (the login that will own the DBO objects). Do not run as the `sde` administrator.
- `../scripts/categories.py` present (the script imports it by relative path).

Steps:

1. Edit the constants at the top of `build_schema.py`: `SDE_CONNECTION`, `SPATIAL_REFERENCE_WKID`, `EXAMPLE_DEPARTMENTS`.
2. Open the **ArcGIS Pro Python Command Prompt (regular user)** and run the dry run:

   ```text
   propy build_schema.py
   ```

   With `DRY_RUN = True` (the default) every step is printed and nothing is created. Review the plan.
3. Set `DRY_RUN = False` and run it again. The script is idempotent: re-running after a failure skips everything that already exists.
4. Run `notification_log.sql` in SQL Server Management Studio as the data owner to create the ticket number sequence.
5. Add the five Arcade attribute rules in ArcGIS Pro following `attribute_rules.md`, before registering `Tickets` as versioned if you are doing this by hand (the script registers versioning in its last step; unregister first if you add rules afterwards).
6. Seed the lookup tables (see below), then publish the feature services.

## XML workspace document

An XML workspace document lets you recreate the schema in a file or enterprise geodatabase without running arcpy step by step. Because the export includes connection properties and may contain organization names in metadata, export through `export_schema_xml.py`, which scrubs those before saving.

Produce it (from the ArcGIS Pro Python Command Prompt):

1. Set `SDE_CONNECTION` and add your organization strings to `SCRUB_STRINGS` in `export_schema_xml.py`.
2. Run `propy export_schema_xml.py` once with `DRY_RUN = True` to see the plan, then set `DRY_RUN = False` and run again.
3. The script calls `ExportXMLWorkspaceDocument(SDE_CONNECTION, raw, "SCHEMA_ONLY", "BINARY", "METADATA")`, scrubs the result, and writes `ReportAConcern_schema.xml`. Inspect the file before committing it.

Import it into a target geodatabase:

```python
import arcpy
arcpy.management.ImportXMLWorkspaceDocument(
    target_dataset=r"C:\GIS\Connections\ReportAConcern_owner.sde",
    in_file=r"ReportAConcern_schema.xml",
    import_type="SCHEMA_ONLY",
)
```

The import recreates domains, feature dataset, feature classes, tables, subtypes, relationship classes, and attribute rules, but not versioning, archiving, indexes on SQL-only tables, or the SQL sequence. After importing, run `notification_log.sql` and the versioning step of `build_schema.py` (or re-run the whole script; it skips what exists).

## Seeding lookup tables

Lookup tables are not versioned, so you can insert into them directly with T-SQL. `OBJECTID` is supplied explicitly as `MAX + 1` because the geodatabase, not SQL Server, normally assigns it. The `example.gov` addresses and boundary ids below are placeholders.

```sql
USE ReportAConcern;

-- Service_Boundaries: attributes only. Load the polygons through ArcGIS Pro
-- (Append or Load Data) and then set boundary_id / boundary_name / is_active.
UPDATE dbo.Service_Boundaries SET boundary_id = 'CITY', boundary_name = 'City Limits', is_active = 1 WHERE OBJECTID = 1;
UPDATE dbo.Service_Boundaries SET boundary_id = 'WATER_DISTRICT', boundary_name = 'Water Service District', is_active = 1 WHERE OBJECTID = 2;
UPDATE dbo.Service_Boundaries SET boundary_id = 'PARKS_DISTRICT', boundary_name = 'Parks and Recreation District', is_active = 1 WHERE OBJECTID = 3;

-- Category_Boundary_Lookup: which categories are accepted where.
INSERT INTO dbo.Category_Boundary_Lookup (OBJECTID, category, boundary_id, is_valid, redirect_message)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 3, 'CITY', 1, NULL FROM dbo.Category_Boundary_Lookup;      -- Roads inside city
INSERT INTO dbo.Category_Boundary_Lookup (OBJECTID, category, boundary_id, is_valid, redirect_message)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 1, 'WATER_DISTRICT', 1, NULL FROM dbo.Category_Boundary_Lookup;  -- Water inside district
INSERT INTO dbo.Category_Boundary_Lookup (OBJECTID, category, boundary_id, is_valid, redirect_message)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 1, 'CITY', 0,
       'Water service at this address is provided by another utility. Please contact them directly.'
FROM dbo.Category_Boundary_Lookup;                                                              -- Water outside district
INSERT INTO dbo.Category_Boundary_Lookup (OBJECTID, category, boundary_id, is_valid, redirect_message)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 5, 'PARKS_DISTRICT', 1, NULL FROM dbo.Category_Boundary_Lookup;  -- Parks

-- Ticket_Routing: subcategory-specific rows first, then a catch-all
-- (subcategory NULL) row per category and boundary.
INSERT INTO dbo.Ticket_Routing (OBJECTID, category, subcategory, boundary_id, default_assignee, assignee_email, escalation_contact, is_active)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 1, 'MAIN_BREAK', 'WATER_DISTRICT', 'Utilities',
       'water-emergency@example.gov', 'utilities-director@example.gov', 1 FROM dbo.Ticket_Routing;
INSERT INTO dbo.Ticket_Routing (OBJECTID, category, subcategory, boundary_id, default_assignee, assignee_email, escalation_contact, is_active)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 1, NULL, 'WATER_DISTRICT', 'Utilities',
       'utilities@example.gov', 'utilities-director@example.gov', 1 FROM dbo.Ticket_Routing;
INSERT INTO dbo.Ticket_Routing (OBJECTID, category, subcategory, boundary_id, default_assignee, assignee_email, escalation_contact, is_active)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 3, 'POTHOLE', 'CITY', 'Public Works',
       'streets@example.gov', 'publicworks-director@example.gov', 1 FROM dbo.Ticket_Routing;
INSERT INTO dbo.Ticket_Routing (OBJECTID, category, subcategory, boundary_id, default_assignee, assignee_email, escalation_contact, is_active)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 3, NULL, 'CITY', 'Public Works',
       'publicworks@example.gov', 'publicworks-director@example.gov', 1 FROM dbo.Ticket_Routing;
INSERT INTO dbo.Ticket_Routing (OBJECTID, category, subcategory, boundary_id, default_assignee, assignee_email, escalation_contact, is_active)
SELECT ISNULL(MAX(OBJECTID), 0) + 1, 5, NULL, 'PARKS_DISTRICT', 'Parks',
       'parks@example.gov', 'parks-director@example.gov', 1 FROM dbo.Ticket_Routing;
```

Notes:

- `Ticket_Routing` is registered as versioned. Direct inserts into the base table are visible in the default version only after the next Reconcile/Compress cycle, or immediately if no edits to that table are pending in delta tables. Inserting through an edit session in ArcGIS Pro avoids the question entirely.
- Every `default_assignee` value must be a code in the `DepartmentAssignment` domain.
- Keep one catch-all row (`subcategory` NULL) per category and boundary so that new subcategories route somewhere until a specific row is added.
