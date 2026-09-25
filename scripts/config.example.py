"""
config.example.py  (copy to config.py and edit; config.py is git-ignored)

Every environment-specific value used by the Report a Concern scripts lives
here. Nothing in the scripts themselves needs to change between deployments.

Passwords do NOT go in this file. Put them in rac_secrets.py (see
rac_secrets.example.py).
"""

from os import path

# ── Organization branding (injected into every email template) ────────────────
ORG_NAME       = "City of Example"
ORG_WEBSITE    = "https://www.example.gov/"
ORG_LOGO_URL   = "https://www.example.gov/images/seal.png"
ORG_LOGO_ALT   = "City of Example official seal"
ORG_ADDRESS    = "123 Main Street, Example, ST 00000"
PROGRAM_NAME   = "Report a Concern"          # public name of the system
CONTACT_NAME   = "GIS Division"              # shown in report email footers
CONTACT_EMAIL  = "gis@example.gov"
LOCAL_TIMEZONE = "America/Denver"            # IANA zone for display dates

# ── SMTP relay (port 25, no auth is typical for an internal relay) ────────────
SMTP_HOST = "smtp.example.gov"
SMTP_PORT = 25
FROM_ADDR = "noreply@example.gov"
FROM_NAME = ORG_NAME

# ── Failure alerts ────────────────────────────────────────────────────────────
# Every script collects failures during a run and emails them once at exit.
# If SHARED_SCRIPTS_DIR contains an EmailService.py exposing
#   EmailService().sendEmail(to, subject=..., body=...)
# it is used first; otherwise (or on error) alerts go straight to SMTP_HOST.
# Leave SHARED_SCRIPTS_DIR empty to always use direct SMTP.
ALERT_RECIPIENTS   = ["gis@example.gov"]
ALERT_FROM         = "gisbot@example.gov"
SHARED_SCRIPTS_DIR = ""

# ── Enterprise geodatabase ────────────────────────────────────────────────────
# .sde connection file for the ReportAConcern database. Keep the file next to
# the scripts on the server that runs them; never commit it.
SDE_CONNECTION  = r"D:\RAC\ReportAConcern.sde"
DB_NAME         = "ReportAConcern"
DB_SCHEMA       = "DBO"
FEATURE_DATASET = "ReportAConcern_Data"

def _q(name):
    """Fully qualified geodatabase object name, e.g. ReportAConcern.DBO.Tickets."""
    return f"{DB_NAME}.{DB_SCHEMA}.{name}"

TICKETS_FC        = path.join(SDE_CONNECTION, _q(FEATURE_DATASET), _q("Tickets"))
COMMENTS_TABLE    = path.join(SDE_CONNECTION, _q("Ticket_Comments"))
NOTIF_LOG_TABLE   = path.join(SDE_CONNECTION, _q("Notification_Log"))
ROUTING_TABLE     = path.join(SDE_CONNECTION, _q("Ticket_Routing"))
SURVEY_RESP_TABLE = path.join(SDE_CONNECTION, _q("Survey_Responses"))
NOTIF_LOG_SQL     = f"{DB_SCHEMA}.Notification_Log"   # name used in direct SQL

# ── Application URLs ──────────────────────────────────────────────────────────
SUBMIT_APP_URL  = "https://gis.example.gov/ReportAConcern"            # public submit app
STATUS_URL_BASE = "https://gis.example.gov/ReportAConcern/"           # public status lookup
MANAGER_URL     = "https://gis-internal.example.gov/ReportAConcernManager/"  # staff app

# ── Templates ─────────────────────────────────────────────────────────────────
# Folder holding the HTML email templates (repo: ../email-templates).
TEMPLATE_DIR = path.join(path.dirname(path.abspath(__file__)), "..", "email-templates")

# ── Routing fallbacks ─────────────────────────────────────────────────────────
# A routing row whose department is UNKNOWN_ASSIGNEE routes to TRIAGE_EMAIL.
# A ticket with no routing row at all goes to NO_MATCH_FALLBACK.
UNKNOWN_ASSIGNEE  = "Unknown"
TRIAGE_EMAIL      = "triage@example.gov"
NO_MATCH_FALLBACK = "gis@example.gov"

# ── Testing switch ────────────────────────────────────────────────────────────
# True: every outbound email (citizen and staff) is redirected to TESTING_EMAIL.
# Ships True on purpose. Set False to go live.
TESTING_MODE  = True
TESTING_EMAIL = "you@example.gov"

# ── Survey123 ─────────────────────────────────────────────────────────────────
SURVEY_BASE_URL = "https://survey123.arcgis.com/share/<survey-form-item-id>"  # no trailing ? or &
SURVEY_ITEM_ID  = "<survey-hosted-feature-layer-item-id>"
AGOL_PORTAL     = "https://<yourorg>.maps.arcgis.com"
AGOL_USERNAME   = "gis_service"                     # password in rac_secrets.py

# Optional Enterprise Portal lookup so survey follow-ups go to the resolver
# personally. Leave PORTAL_USERNAME empty to route to the department email.
PORTAL_URL        = "https://portal.example.gov/portal"
PORTAL_USERNAME   = ""                              # password in rac_secrets.py
PORTAL_VERIFY_SSL = True

# Survey follow-up recipient resolution: resolver's Portal email, then the
# assigned department's routing email, then FOLLOWUP_FALLBACK_EMAIL if set.
# Leave empty so production never silently routes a follow-up to a developer.
FOLLOWUP_FALLBACK_EMAIL = ""

# Survey123 field holding "Would you like a staff member to follow up?".
# Survey123 truncates long question names; first match on the response wins.
SURVEY_FOLLOWUP_FIELD_CANDIDATES = [
    "would_you_like_a_staff_member_t",
    "would_you_like_a_staff_member",
    "staff_followup",
    "follow_up",
]
SURVEY_RATING_FIELD   = "how_satisfied_were_you_with_how"
SURVEY_COMMENTS_FIELD = "additional_comments"

# ── Reports ───────────────────────────────────────────────────────────────────
# Directors report: recipient email -> list of category codes they oversee.
# Use ALL_CATEGORIES (from categories.py) for oversight recipients.
DIRECTOR_DICT = {
    # "public.works.director@example.gov": [3, 4, 7, 10, 11],
    # "utilities.director@example.gov":    [1, 2],
}
# Monthly all-department report recipients.
MONTHLY_REPORT_RECIPIENTS = [
    # "city.manager@example.gov",
]
# Age thresholds for the directors report (ticket counts as overdue past these).
from datetime import timedelta
THRESHOLD_OPEN        = timedelta(hours=24)
THRESHOLD_RECEIVED    = timedelta(days=7)
THRESHOLD_IN_PROGRESS = timedelta(days=30)

# ── Batch limits ──────────────────────────────────────────────────────────────
MAX_BATCH        = 100   # tickets/comments per run for the mailers
SURVEY_MAX_BATCH = 200   # survey responses per run
