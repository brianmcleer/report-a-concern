# Contributing

Issues and pull requests are welcome. This project runs a production
citizen-facing service, so small, well-explained changes are easiest to
review.

## Before you open a pull request

- Run `python -m py_compile <file>` on every script you changed.
- Keep organization-specific values out of the code. Hostnames, paths,
  email addresses, layer names and credentials all come from `config.py`,
  `rac_secrets.py` or `proxy_config.py`. If you need a new setting, add it
  to the matching `*.example.py` file with a comment.
- Keep the `WHY` comments. They explain decisions that are not obvious from
  the code (workarounds for ArcGIS behavior, ordering that matters, and so
  on). Update them if you change the reason; do not delete them.
- Never commit `config.py`, `rac_secrets.py`, `proxy_config.py` or `.sde`
  files. See `SECURITY.md`.

## Reporting bugs

Use the bug report issue template and include the script name, the log
excerpt and the ArcGIS Pro / Enterprise versions involved.
