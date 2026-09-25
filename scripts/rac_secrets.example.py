"""
rac_secrets.example.py  (copy to rac_secrets.py and fill in; rac_secrets.py is git-ignored)

Named rac_secrets (not secrets) so it never shadows the standard-library
secrets module.

Only rac_survey_pull.py needs these. The other scripts use an unauthenticated
SMTP relay and a Windows-authenticated .sde connection.
"""

# ArcGIS Online service account password (AGOL_USERNAME in config.py)
GIS_SERVICE_PASSWORD = ""

# Enterprise Portal account password (PORTAL_USERNAME in config.py).
# Leave empty to skip the per-person resolver lookup.
PORTAL_PASSWORD = ""
