# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](../../security/advisories/new) on this
repository. Do not open a public issue for anything that could expose a
deployment. You should hear back within a week.

## Supported versions

Only the latest release is supported. Fixes are not backported to earlier
tags.

## Things that must never be committed

This repository is public. The following files hold credentials or
organization-specific endpoints and are listed in `.gitignore`:

- `*.sde` (ArcGIS database connection files)
- `scripts/config.py`
- `scripts/rac_secrets.py`
- `proxy/proxy_config.py`

Commit only the `*.example.py` templates. `publish.ps1` refuses to push if
any of these files are present in the working tree or if organization
specific hostnames or addresses are found in tracked files.
