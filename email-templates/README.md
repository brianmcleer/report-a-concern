# Email templates

HTML email bodies used by the notification scripts in `scripts/`. Each script
reads its template from `TEMPLATE_DIR` (see `scripts/config.example.py`) and
substitutes `{token}` placeholders with plain string replacement, so a token
that is not filled is sent as-is.

The organization tokens below are injected into every template by
`scripts/rac_common.py` (`ORG_TOKENS`) from `config.py`; the script-specific
tokens are supplied by the script that sends the email.

## Organization tokens (available in every template)

| Token              | Source in config.py | Used for                                   |
|--------------------|---------------------|--------------------------------------------|
| `{org_name}`       | `ORG_NAME`          | Organization name in headings and footers  |
| `{org_website}`    | `ORG_WEBSITE`       | Footer link target                         |
| `{org_logo_url}`   | `ORG_LOGO_URL`      | `src` of every logo image                  |
| `{org_logo_alt}`   | `ORG_LOGO_ALT`      | `alt` text of every logo image             |
| `{org_address}`    | `ORG_ADDRESS`       | Postal address line in the footer          |
| `{program_name}`   | `PROGRAM_NAME`      | Injected but not referenced by any template |
| `{submit_app_url}` | `SUBMIT_APP_URL`    | Public "Report a Concern" app link         |
| `{manager_url}`    | `MANAGER_URL`       | Internal Manager app link                  |

`{contact_email}` and `{contact_name}` (directors and monthly reports) are not
yet in `ORG_TOKENS`; add `CONTACT_EMAIL` and `CONTACT_NAME` to config and to
`rac_common.ORG_TOKENS`, or fill them in the report scripts.

The "Report another concern" tile in the external and survey templates uses a
text arrow (`&rarr;`) instead of an external image so the email has no
third-party image dependency; the logo is the only remote image.

## Templates

### comment_email_template.html

Used by `scripts/rac_comments_mailer.py` (public comment or status update sent
to the submitter).

Tokens: `{Name_req}`, `{category_label}`, `{comment_author}`,
`{comment_date}`, `{comment_text}`, `{comment_type_label}`, `{org_logo_alt}`,
`{org_logo_url}`, `{org_name}`, `{org_website}`, `{status_line}`,
`{ticket_number}`, `{ticket_url}`

### email_template_directors.html

Used by `scripts/rac_directors_report.py` (overdue ticket report to
department directors).

Tokens: `{Date}`, `{Year}`, `{assigned_categories}`, `{contact_email}`,
`{contact_name}`, `{manager_url}`, `{org_logo_alt}`, `{org_logo_url}`,
`{org_name}`, `{org_website}`

### directors_report_preview.html

Static preview of the directors report with sample rows, for layout review in
a browser. Not sent by any script. Renamed from
`RaC_Report_Directors_Preview.html`.

Tokens: `{Date}`, `{assigned_categories}`, `{contact_email}`,
`{contact_name}`, `{manager_url}`, `{org_logo_alt}`, `{org_logo_url}`,
`{org_name}`, `{org_website}`

### email_template_monthly.html

Used by `scripts/rac_all_dept_report.py` (monthly all-department summary).

Tokens: `{Year}`, `{closed_count}`, `{contact_email}`, `{contact_name}`,
`{month}`, `{oldest_open_table}`, `{open_by_dept_table}`, `{open_count}`,
`{org_logo_alt}`, `{org_logo_url}`, `{org_name}`, `{org_website}`,
`{submitted_count}`, `{top_depts_table}`, `{top_types_table}`, `{year}`

### rac_external_new_template.html

Used by `scripts/rac_notify_new_ticket.py` (confirmation to the person who
submitted the request).

Tokens: `{category}`, `{description}`, `{org_address}`, `{org_logo_alt}`,
`{org_logo_url}`, `{org_name}`, `{org_website}`, `{rac_app_url}`,
`{subcategory}`, `{submitted_by_name}`, `{submitted_date}`,
`{ticket_number}`, `{ticket_url}`

`{rac_app_url}` is a legacy alias for `{submit_app_url}`; the script fills
both.

### rac_internal_new_template.html

Used by `scripts/rac_notify_new_ticket.py` (routing notice to the assigned
staff group).

Tokens: `{address_submitted}`, `{assigned_to}`, `{category}`,
`{description}`, `{manager_ticket_url}`, `{org_logo_alt}`, `{org_logo_url}`,
`{org_name}`, `{org_website}`, `{subcategory}`, `{submitted_by_email}`,
`{submitted_by_name}`, `{submitted_by_phone}`, `{submitted_date}`,
`{ticket_number}`

### rac_reassign_template.html

Used by `scripts/rac_reassign_notify.py` (notice when a ticket moves to a
different assignee).

Tokens: `{address}`, `{assigned_to}`, `{category}`, `{description}`,
`{manager_url}`, `{modified_date}`, `{org_logo_alt}`, `{org_logo_url}`,
`{org_name}`, `{org_website}`, `{previously_assigned}`, `{status}`,
`{subcategory}`, `{submitted_date}`, `{submitter_name}`, `{ticket_number}`

The script overrides `{manager_url}` with a link to the specific ticket.

### survey_email_template.html

Used by `scripts/rac_survey_mailer.py` (satisfaction survey after a ticket is
resolved).

Tokens: `{category}`, `{created_date}`, `{description}`, `{org_address}`,
`{org_logo_alt}`, `{org_logo_url}`, `{org_name}`, `{org_website}`,
`{resolution}`, `{resolved_date}`, `{submit_app_url}`, `{submitted_by_name}`,
`{survey_link}`, `{ticket_number}`

## Accessibility

Templates keep `lang` on `<html>`, `role="presentation"` on layout tables,
alt text on images, a single `h1`, and 12px minimum footer text. Preserve
these when editing.
