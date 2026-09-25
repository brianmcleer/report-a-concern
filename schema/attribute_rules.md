# Attribute Rules (Arcade)

Five Arcade attribute rules run on the `Tickets` feature class. All of them fire on **insert** only; staff edits after submission do not re-run them. Together they validate the submission point against the service boundaries, assign the ticket to a department, and stamp a human-readable ticket number.

The full Arcade bodies are organization specific (boundary names, wording of redirect messages, which fields are required) and are not included in this repo. This page describes what each rule does, gives pseudo-code for the routing logic, and includes one complete skeleton (the ticket number rule) because it is short and generic.

## Rule inventory

| Rule | Type | Trigger | Field | Purpose |
|------|------|---------|-------|---------|
| `RAC_Geofence_Validate` | Constraint | Insert | (none) | Rejects a submission whose point is outside every active service boundary, or whose category is not valid in the boundary it falls in. Returns the citizen-facing message from `Redirect_Contacts`. |
| `RAC_Geofence_Route` | Calculation | Insert | `boundary_id` | Two-tier routing. Finds the boundary, then looks up `Ticket_Routing` for (category + subcategory + boundary) and falls back to (category + NULL subcategory + boundary). Writes `boundary_id` and, in the same return, `assigned_to`. |
| `RAC_TicketNumber_Sequence` | Calculation | Insert | `ticket_number` | Pulls the next value from the SQL Server sequence `RAC_TicketNumber_Sequence` (starts at 10000). |
| `RAC_FieldPresence_Validate` | Constraint | Insert | (none) | Required-field enforcement: category, description, geometry, and a reachable contact (email or phone). |
| `RAC_BusinessLogic_Validate` | Constraint | Insert | (none) | Invariants: category is 1 through 13, subcategory (when present) belongs to that category's domain, status defaults to Open, lengths are within field limits. |

Rule evaluation order matters. Constraints run before calculations, and `RAC_Geofence_Route` must have a lower evaluation order than anything that reads `assigned_to`. In ArcGIS Pro, set the evaluation order so that the three constraint rules come first, then `RAC_Geofence_Route`, then `RAC_TicketNumber_Sequence`.

## Routing logic (pseudo-code)

This is the logic behind `RAC_Geofence_Validate` and `RAC_Geofence_Route`. It is deliberately not full Arcade; use it as the specification when writing the rules for your organization.

```text
# Inputs available in the rule: $feature (the new ticket), $datastore
point       = Geometry($feature)
category    = $feature.category          # SHORT, 1..13
subcategory = $feature.subcategory       # TEXT or null

# Step 1: active boundaries that contain the point
boundaries = FeatureSetByName($datastore, "Service_Boundaries", ["boundary_id"], true)
active     = Filter(boundaries, "is_active = 1")
hits       = Intersects(active, point)          # uses the spatial index

if Count(hits) == 0:
    # RAC_Geofence_Validate: fail with the generic out-of-area message
    #   look up Redirect_Contacts where boundary_id IS NULL (default row), or
    #   use a hard-coded fallback sentence
    return { "errorMessage": <redirect message> }

# Step 2: first boundary where the category is valid
lookup = FeatureSetByName($datastore, "Category_Boundary_Lookup",
                          ["category", "boundary_id", "is_valid", "redirect_message"], false)
matched_boundary = null
redirect = null
for b in hits:                                   # boundary order = draw order; keep it deterministic
    rows = Filter(lookup, "category = @category AND boundary_id = @b.boundary_id AND is_valid = 1")
    if Count(rows) > 0:
        matched_boundary = b.boundary_id
        break
    else:
        row = First(Filter(lookup, "category = @category AND boundary_id = @b.boundary_id"))
        if row != null: redirect = row.redirect_message

if matched_boundary == null:
    # RAC_Geofence_Validate: category not offered here
    #   prefer Redirect_Contacts (boundary_id = hits[0].boundary_id, category = @category)
    #   then Redirect_Contacts (boundary_id = hits[0].boundary_id, category IS NULL)
    #   then the redirect_message captured above
    return { "errorMessage": <redirect message> }

# Step 3 (RAC_Geofence_Route): subcategory-specific routing row
routing = FeatureSetByName($datastore, "Ticket_Routing",
                           ["category", "subcategory", "boundary_id", "default_assignee", "is_active"], false)
assignee = null
if !IsEmpty(subcategory):
    row = First(Filter(routing,
        "category = @category AND subcategory = @subcategory AND boundary_id = @matched_boundary AND is_active = 1"))
    if row != null: assignee = row.default_assignee

# Step 4: catch-all row (subcategory IS NULL)
if assignee == null:
    row = First(Filter(routing,
        "category = @category AND subcategory IS NULL AND boundary_id = @matched_boundary AND is_active = 1"))
    if row != null: assignee = row.default_assignee

# Step 5: no match leaves assigned_to null. This is a routing gap that
# the admin app should surface (tickets with boundary_id set but no assignee).

return {
    "result": {
        "attributes": {
            "boundary_id": matched_boundary,
            "assigned_to": assignee            # may be null
        }
    }
}
```

Notes on the design:

- The constraint rule and the calculation rule repeat the same boundary and category lookups. Keep both consistent; if you change how ties between overlapping boundaries are resolved, change both rules.
- `assigned_to` uses the `DepartmentAssignment` domain. Every `default_assignee` value in `Ticket_Routing` must be a code in that domain or the calculation will be rejected by the geodatabase.
- `last_notified_assignee` is left null on insert. The reassignment notifier fills it after the first e-mail and compares it with `assigned_to` on later runs.
- `lat` and `lon` (WGS84 convenience copies) can be filled by a sixth calculation rule or by the submit widget; they are not part of the five rules above.

## Ticket number rule (skeleton)

Calculation rule on `Tickets`, field `ticket_number`, trigger Insert, exclude from application evaluation unchecked. The sequence is created by `notification_log.sql`.

```js
// RAC_TicketNumber_Sequence
// Assign the next human-readable ticket number on insert.
// The database sequence RAC_TicketNumber_Sequence must exist and be owned
// by the data owner (see notification_log.sql).

if (!IsEmpty($feature.ticket_number)) {
    // A value was supplied (for example a migration or a re-import). Keep it.
    return $feature.ticket_number;
}

return NextSequenceValue("RAC_TicketNumber_Sequence");
```

## Field presence and business logic (what they check)

`RAC_FieldPresence_Validate` returns an error when any of these is missing:

- geometry (a point is required)
- `category`
- `description` (after trimming whitespace)
- at least one of `submitted_by_email` or `submitted_by_phone`

`RAC_BusinessLogic_Validate` returns an error when:

- `category` is outside 1 through 13 (compare with the subtype codes in `scripts/categories.py`)
- `subcategory` is set but is not a code in the `Subcategory_<Category>` domain for that subtype
- `status` is set to anything other than Open (1) on insert
- `satisfaction`-style fields that only exist on related tables are present in the payload (defensive; the public submit widget should never send them)

Keep the error messages short and citizen-facing; the submit widget shows the constraint message verbatim.

## Performance indexes the rules depend on

The rules issue attribute filters against three lookup tables on every submission. Without these indexes, submission latency grows with table size and the constraint rule can time out under load.

| Object | Index | Why |
|--------|-------|-----|
| `Tickets` | spatial index (created with the feature class) | Insert path |
| `Service_Boundaries` | spatial index (created with the feature class) | `Intersects` in step 1 |
| `Service_Boundaries` | `(is_active, boundary_id)` | `is_active = 1` filter in step 1 |
| `Category_Boundary_Lookup` | `(category, boundary_id, is_valid)` | step 2 |
| `Ticket_Routing` | `(category, subcategory, boundary_id, is_active)` | steps 3 and 4 |

`build_schema.py` creates all of the attribute indexes; `notification_log.sql` has the same indexes as T-SQL.

## Editing rules on a versioned dataset

Attribute rules cannot be added, altered, or deleted while the feature class is registered as versioned. The safe sequence, which mirrors what the maintenance scripts do, is:

1. Stop the feature services that reference `Tickets` (or at least stop edits) and disconnect users: `arcpy.DisconnectUser(sde, "ALL")`.
2. Block new connections: `arcpy.AcceptConnections(sde, False)`.
3. `arcpy.management.DisableArchiving(tickets)`.
4. `arcpy.management.UnregisterAsVersioned(tickets, "KEEP_EDIT", "NO_COMPRESS")`.
5. `arcpy.management.AlterAttributeRule(...)`, `AddAttributeRule(...)`, or `DeleteAttributeRule(...)` as needed. Validate with `arcpy.management.EvaluateRules` or a test insert.
6. `arcpy.management.RegisterAsVersioned(tickets, "NO_EDITS_TO_BASE")`.
7. `arcpy.management.EnableArchiving(tickets)`.
8. In a `finally` block, always restore connections: `arcpy.AcceptConnections(sde, True)` and restart services.

Wrap steps 3 through 7 in `try/except` so a failure in step 5 still re-registers versioning and re-enables archiving; otherwise the dataset is left unversioned and the feature services fail on the next edit. Unregistering with `KEEP_EDIT` preserves edits in the default version; `NO_COMPRESS` skips the compress so the operation is fast. Take a database backup first regardless.

Sequence-backed rules are the one exception where re-registering does not change behavior: `NextSequenceValue` reads the SQL sequence directly and works the same whether or not the table is versioned.
