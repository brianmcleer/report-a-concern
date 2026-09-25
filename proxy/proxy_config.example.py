"""
proxy_config.example.py - configuration template for rac_proxy.py

Copy this file to proxy_config.py (git-ignored) in the same folder and edit
the values for your environment. rac_proxy.py imports proxy_config at
startup and exits with a message if the file is missing.
"""

# Port the Flask/waitress process listens on (loopback only is fine; IIS
# reverse-proxies to it).
PORT = 5000

# The public submission layer. The proxy forwards validated applyEdits and
# addAttachment calls here over localhost.
FEATURE_SERVER_BASE = (
    "https://localhost:6443/arcgis/rest/services/RAC"
    "/ReportAConcern_Reporter/FeatureServer/0"
)

# Origins allowed to call the proxy from a browser. Must match the scheme and
# host of the page hosting the Experience Builder app exactly.
CORS_ORIGINS = [
    "https://gis.example.gov",
]

# Submissions per client IP per window.
RATE_LIMIT_MAX = 20
RATE_LIMIT_WINDOW_S = 3600

# Field length caps.
MAX_DESCRIPTION_LEN = 2000
MAX_NAME_LEN = 200

# Coded values accepted for the category field.
VALID_CATEGORIES = set(range(1, 14))

# Bounding box for accepted geometry, in the projected coordinates of the
# ticket layer's spatial reference. The example values below are for a UTM
# zone; replace them with the extent of your service area.
BBOX_X_MIN = 680000
BBOX_X_MAX = 810000
BBOX_Y_MIN = 4270000
BBOX_Y_MAX = 4375000

# Attachment size cap in bytes.
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

# ArcGIS Server on localhost usually presents a self-signed certificate, so
# TLS verification is off by default. Set True if the cert chain is trusted.
VERIFY_FEATURE_SERVER_TLS = False

# pyodbc connection string for the database that holds the Notification_Log
# table. Windows authentication is used; the account running the proxy needs
# INSERT on the log table.
DB_CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=<sql-server-host>;"
    "DATABASE=ReportAConcern;"
    "Trusted_Connection=yes;"
)

# Fully qualified name of the log table.
NOTIF_LOG_TABLE = "DBO.Notification_Log"
