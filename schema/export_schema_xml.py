"""
export_schema_xml.py

Exports a schema-only XML workspace document from an existing Report a
Concern enterprise geodatabase and scrubs it before writing
ReportAConcern_schema.xml, so the file is safe to share or commit.

Requires arcpy (ArcGIS Pro Python environment). Run from the
"ArcGIS Pro Python Command Prompt (regular user)":

    propy export_schema_xml.py

Steps:
  1. arcpy.management.ExportXMLWorkspaceDocument(
         SDE_CONNECTION, raw_file, "SCHEMA_ONLY", "BINARY", "METADATA")
  2. Scrub the result:
       - blank the values inside <ConnectionProperties> ... </ConnectionProperties>
         and any <Server>, <Instance>, <Database>, <User>, <Password>,
         <DB_CONNECTION_PROPERTIES>, <AuthenticationMode> elements
       - replace every occurrence of the strings in SCRUB_STRINGS
         (organization names, host names, addresses) with a placeholder
       - replace text that looks like an e-mail address with the placeholder
  3. Write the scrubbed text to OUTPUT_FILE and delete the raw export.

DRY_RUN = True (default) only prints what would happen and touches nothing.

Import the document elsewhere with:
    arcpy.management.ImportXMLWorkspaceDocument(
        target_workspace, "ReportAConcern_schema.xml", "SCHEMA_ONLY")
"""

import os
import re
import sys

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SDE_CONNECTION = r"C:\GIS\Connections\ReportAConcern_owner.sde"
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "ReportAConcern_schema.xml")
DRY_RUN = True

# Organization-specific strings to remove from the export. Add your
# organization name, domain, server host names, and IP prefixes here.
SCRUB_STRINGS = [
    "example-city",
    "Example City",
    "example.gov",
    "gis-server-01",
    "gis-server-02",
    "10.0.0.",
]
PLACEHOLDER = "REDACTED"

# Elements whose text content is always blanked, regardless of value.
CONNECTION_ELEMENTS = [
    "Server", "Instance", "Database", "User", "Password",
    "DB_CONNECTION_PROPERTIES", "AuthenticationMode", "Version",
    "Historical", "Branch", "ProjectInstance",
]

try:
    import arcpy
except ImportError:  # pragma: no cover
    arcpy = None


# ---------------------------------------------------------------------------
# Scrubbing
# ---------------------------------------------------------------------------

def scrub(xml_text):
    """Return a copy of xml_text with connection details and org strings removed."""
    out = xml_text

    # 1. Empty the whole <ConnectionProperties> block (it holds server, db,
    #    user, and sometimes the connection string).
    out = re.sub(r"(<ConnectionProperties\b[^>]*>).*?(</ConnectionProperties>)",
                 r"\1\2", out, flags=re.DOTALL | re.IGNORECASE)

    # 2. Blank the text of individual connection-related elements wherever
    #    they appear (workspace definitions, dataset definitions, metadata).
    for tag in CONNECTION_ELEMENTS:
        out = re.sub(rf"(<{tag}\b[^>]*>)[^<]*(</{tag}>)", r"\1\2", out,
                     flags=re.IGNORECASE)

    # 3. Replace organization strings.
    for s in SCRUB_STRINGS:
        if s:
            out = re.sub(re.escape(s), PLACEHOLDER, out, flags=re.IGNORECASE)

    # 4. Replace anything that still looks like an e-mail address.
    out = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
                 PLACEHOLDER + "@example.gov", out)

    return out


def leftover_hits(xml_text):
    """Report scrub strings that still appear after scrubbing (should be none)."""
    return [s for s in SCRUB_STRINGS if s and s.lower() in xml_text.lower()]


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    raw_file = OUTPUT_FILE + ".raw.xml"
    print(f"source workspace : {SDE_CONNECTION}")
    print(f"raw export       : {raw_file}")
    print(f"scrubbed output  : {OUTPUT_FILE}")
    print(f"scrub strings    : {SCRUB_STRINGS}")

    if DRY_RUN:
        print("[DRY RUN] would call ExportXMLWorkspaceDocument(SDE_CONNECTION, "
              "raw_file, 'SCHEMA_ONLY', 'BINARY', 'METADATA')")
        print("[DRY RUN] would scrub connection properties and org strings")
        print("[DRY RUN] would write ReportAConcern_schema.xml and delete the raw file")
        return 0

    if arcpy is None:
        print("arcpy is required. Run from the ArcGIS Pro Python environment.")
        return 1

    if os.path.exists(raw_file):
        os.remove(raw_file)

    print("exporting ...")
    arcpy.management.ExportXMLWorkspaceDocument(SDE_CONNECTION, raw_file,
                                                "SCHEMA_ONLY", "BINARY", "METADATA")

    with open(raw_file, "r", encoding="utf-8", errors="replace") as fh:
        raw = fh.read()

    cleaned = scrub(raw)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        fh.write(cleaned)
    os.remove(raw_file)

    hits = leftover_hits(cleaned)
    if hits:
        print(f"WARNING: these strings still appear in the output: {hits}")
        return 2

    print(f"wrote {OUTPUT_FILE} ({len(cleaned):,} characters)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"export_schema_xml.py FAILED: {exc}")
        if arcpy is not None:
            print(arcpy.GetMessages(2))
        sys.exit(1)
