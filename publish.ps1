<#
  publish.ps1  -  One-command publish/update for the report-a-concern mono-repo.

  1. Mirrors both Experience Builder widgets from the EB source folders into widgets\<name>
     (skips node_modules, .vs, "Claude outputs", zips). The EB folder is the single source of
     truth for widget code; never edit the repo copy, /MIR reverts it.
  2. Refuses to publish if a secrets or connection file is anywhere in the tree, or if any
     organization-specific string is found (hostnames, IP ranges, real addresses).
  3. Commits and pushes.
  4. (Optional) -Release vX.Y.Z tags the repo and creates a GitHub Release with one zip per
     widget, built from a staging copy with the editor-only files in $ReleaseOnlyExclude
     removed (Visual Studio type shims). Each zip is named <widget>-<widgetVersion>.zip.
     The dashboard folder is zipped as rac-dashboard-<release>.zip.

  The dashboard\ folder is NOT mirrored. It is a sanitized copy of the deployed dashboard
  (example.gov placeholders, no logo, no OAuth app id), rebuilt by hand when the deployed
  pages change. The organization-string gate below covers it like everything else.

  This repo is published on its own, not by publish-all.ps1 (that script expects one widget per
  repo and reads $WidgetName; this file defines none on purpose, so publish-all skips it).

  RUN in PowerShell (regular user) from this folder:
    Normal update:    powershell -ExecutionPolicy Bypass -File .\publish.ps1 -CommitMessage "Subject`n`nBody"
    Update + release: powershell -ExecutionPolicy Bypass -File .\publish.ps1 -CommitMessage "..." -Release v1.0.0
    Skip the mirror:  add -NoMirror (docs-only change, EB not available on this machine)

  REDO A RELEASE (the tag must not already exist on GitHub):
    gh release delete v1.0.0 --cleanup-tag --yes
#>

param(
    [Parameter(Mandatory = $true)][string]$CommitMessage,
    [string]$Release = "",
    [switch]$NoMirror
)

$ErrorActionPreference = "Stop"

# ----- EDIT THESE PER MACHINE -----------------------------------------------
$RepoName       = "report-a-concern"
$RepoVisibility = "public"      # only used by gh repo create on the very first run
$ExbWidgets     = "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets"
$Widgets        = @("rac-manager", "report-a-concern-submit")
$RepoDescription = "Citizen service request (311 style) system on ArcGIS Enterprise: Experience Builder submit and manager widgets, geodatabase schema, Flask proxy, notification and report scripts."
$RepoTopics      = @("arcgis", "arcgis-enterprise", "arcgis-experience-builder", "exb-widget", "experience-builder", "python", "arcpy", "service-requests", "311")
# ----------------------------------------------------------------------------

$ExcludeDirs  = @("node_modules", ".vs", "Claude outputs")
$ExcludeFiles = @("*.user", "*.suo", "*.zip")

# Editor-only files that stay in the GitHub repo but never go in a release zip. Ambient
# `declare module 'react' | 'jimu-*' | 'esri/*'` blocks are not file-scoped: dropped into
# someone's your-extensions folder they rewrite those types for every widget there.
$ReleaseOnlyExclude = @(
    "src\exb-editor-shims*.d.ts",
    "src\*-shims.d.ts",
    "src\editor-shims.d.ts",
    "src\runtime\esri.d.ts",
    "tools"
)

# Files that must never be committed. .gitignore covers them, but a rename or a copy with a
# different extension would slip past it, so the tree is checked by name as well.
$ForbiddenFiles = @("config.py", "rac_secrets.py", "proxy_config.py", "*.sde", "password.py", "secrets.py")

# Strings that identify a specific deployment. Extend the list when a new one is noticed.
$ForbiddenPattern = "gjcity|grand junction|198\.204\.|internal22|external22|external25|portal22|hosting22|ArcGIS-DB"

$RepoPath = $PSScriptRoot
Write-Host "==> Repo: $RepoPath"

function Get-JsonVersion([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    try { return (Get-Content $path -Raw | ConvertFrom-Json).version } catch { return $null }
}

# ---------------------------------------------------------------- 1. mirror widgets
if (-not $NoMirror) {
    foreach ($w in $Widgets) {
        $src  = Join-Path $ExbWidgets $w
        $dest = Join-Path $RepoPath "widgets\$w"
        if (-not (Test-Path $src)) { throw "Cannot find the EB widget folder: $src (use -NoMirror for a docs-only publish)" }

        $mv = Get-JsonVersion (Join-Path $src "manifest.json")
        $pv = Get-JsonVersion (Join-Path $src "package.json")
        Write-Host "==> $w : manifest.json $mv, package.json $pv"
        if ($mv -and $pv -and ($mv -ne $pv)) { throw "$w : manifest.json is $mv but package.json is $pv. Bump both together, in the EB folder." }

        $xd = @("/XD") + $ExcludeDirs
        $xf = @("/XF") + $ExcludeFiles
        robocopy "$src" "$dest" /MIR @xd @xf /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $w with exit code $LASTEXITCODE" }
        foreach ($dir in $ExcludeDirs) {
            $stale = Join-Path $dest $dir
            if (Test-Path $stale) { Remove-Item $stale -Recurse -Force }
        }
        if (-not (Test-Path (Join-Path $dest "manifest.json"))) { throw "manifest.json is not directly inside $dest" }
        if (-not (Test-Path (Join-Path $dest "icon.svg"))) { Write-Warning "$w has no icon.svg; Experience Builder shows a blank tile for it." }
    }
}

# ---------------------------------------------------------------- 1b. .github bootstrap
# Files under .github cannot be written remotely by Cowork, so they ship in github-templates
# and are moved into place here on the first run. The folder is deleted once copied.
$tpl = Join-Path $RepoPath "github-templates"
if (Test-Path $tpl) {
    $gh_dir = Join-Path $RepoPath ".github"
    if (-not (Test-Path $gh_dir)) { New-Item -ItemType Directory -Path $gh_dir | Out-Null }
    robocopy "$tpl" "$gh_dir" /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy (.github bootstrap) failed with exit code $LASTEXITCODE" }
    Remove-Item $tpl -Recurse -Force
    Write-Host "==> .github populated from github-templates"
}

# ---------------------------------------------------------------- 2. gates
$bad = @()
foreach ($pattern in $ForbiddenFiles) {
    $bad += Get-ChildItem -Path $RepoPath -Recurse -File -Filter $pattern -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "\\node_modules\\|\\\.git\\" }
}
if ($bad.Count -gt 0) { throw "Refusing to publish, secret or connection files present:`n  " + (($bad | ForEach-Object { $_.FullName }) -join "`n  ") }

Push-Location $RepoPath
try {
    if (-not (Test-Path ".git")) { Write-Host "==> git init"; git init | Out-Null }

    git add -A | Out-Null

    # Search the staged tree (what would be pushed), not the working folder, and leave this
    # script out of it because it carries the pattern itself.
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $hits = & git grep --cached -i -n -E $ForbiddenPattern -- . ":(exclude)publish.ps1" 2>$null
    $ErrorActionPreference = $prevEap
    # The copyright holder is the City; that line is allowed everywhere. Everything else is not.
    $hits = @($hits | Where-Object { $_ -notmatch "Copyright 2026 City of Grand Junction" })
    if ($hits.Count -gt 0) {
        git reset -q
        throw "Refusing to publish, organization-specific strings found:`n" + ($hits -join "`n")
    }

    $pending = git status --porcelain
    if ([string]::IsNullOrWhiteSpace($pending)) {
        Write-Host "==> No changes to commit."
    } else {
        Write-Host "==> Committing: $($CommitMessage.Split("`n")[0])"
        git commit -m "$CommitMessage" | Out-Null
    }

    $hasOrigin = (git remote) -contains "origin"
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $hasOrigin) {
        if (-not $gh) { Write-Host "==> No origin and gh not installed. Publish once via GitHub Desktop, then re-run."; return }
        Write-Host "==> First run: creating GitHub repo ($RepoVisibility) and pushing..."
        gh repo create $RepoName "--$RepoVisibility" --source="." --remote="origin" --push
    } else {
        # Bring in anything that landed on GitHub since the last run (Dependabot, web edits,
        # merged pull requests) so the push is a fast-forward.
        $branch = (git rev-parse --abbrev-ref HEAD).Trim()
        Write-Host "==> Pulling origin/$branch (rebase)..."
        git pull --rebase origin $branch
        if ($LASTEXITCODE -ne 0) { throw "git pull --rebase failed. Resolve the conflict, then re-run." }
        Write-Host "==> Pushing..."
        git push
        if ($LASTEXITCODE -ne 0) { throw "git push failed." }
    }

    # Repo metadata and security settings, idempotent, same as the other repos.
    if ($gh) {
        $owner = (gh api user -q .login).Trim()
        $full  = "$owner/$RepoName"
        gh repo edit $full --description $RepoDescription --enable-issues --enable-wiki=false 2>$null | Out-Null
        foreach ($t in $RepoTopics) { gh repo edit $full --add-topic $t 2>$null | Out-Null }
        gh api -X PUT "repos/$full/vulnerability-alerts" 2>$null | Out-Null
        gh api -X PUT "repos/$full/automated-security-fixes" 2>$null | Out-Null
        $secJson = Join-Path $env:TEMP "rac-security.json"
        Set-Content -Path $secJson -Value '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}' -Encoding ascii
        gh api -X PATCH "repos/$full" --input $secJson 2>$null | Out-Null
        Remove-Item $secJson -Force -ErrorAction SilentlyContinue
        Write-Host "==> Description, topics, Dependabot alerts, secret scanning and push protection set on $full"
    }

    # ---------------------------------------------------------------- 3. release
    if ($Release -ne "") {
        if (-not $gh) { Write-Host "==> Skipping release: gh not installed."; return }
        if ($Release -notmatch '^v\d+\.\d+\.\d+$') { throw "Release tag must look like v1.2.3. Received: $Release" }
        $existing = @(gh release list --limit 200 --json tagName -q ".[].tagName")
        if ($existing -contains $Release) { throw "Release $Release already exists. gh release delete $Release --cleanup-tag --yes, then re-run." }

        $assets = @()
        foreach ($w in $Widgets) {
            $dest    = Join-Path $RepoPath "widgets\$w"
            $wv      = Get-JsonVersion (Join-Path $dest "manifest.json")
            $zipName = if ($wv) { "$w-$wv.zip" } else { "$w.zip" }
            $zip     = Join-Path $env:TEMP $zipName
            if (Test-Path $zip) { Remove-Item $zip -Force }

            $stage     = Join-Path $env:TEMP "$w-release-stage"
            $stageCopy = Join-Path $stage $w
            if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
            New-Item -ItemType Directory -Path $stage | Out-Null
            robocopy "$dest" "$stageCopy" /E /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy (release stage) failed for $w" }

            foreach ($pattern in $ReleaseOnlyExclude) {
                $rel    = Split-Path $pattern -Parent
                $parent = if ([string]::IsNullOrEmpty($rel)) { $stageCopy } else { Join-Path $stageCopy $rel }
                $leaf   = Split-Path $pattern -Leaf
                if (Test-Path $parent) {
                    Get-ChildItem -Path $parent -Filter $leaf -Force -ErrorAction SilentlyContinue | ForEach-Object {
                        Write-Host "    $w : leaving out of zip: $($_.FullName.Substring($stageCopy.Length + 1))"
                        Remove-Item $_.FullName -Recurse -Force
                    }
                }
            }
            $leaked = Get-ChildItem -Path $stageCopy -Recurse -File -Filter "*.d.ts" |
                Where-Object { Select-String -Path $_.FullName -Pattern "declare module ['`"](react|jimu-|esri/)" -Quiet }
            if ($leaked) { throw "Editor shim still in release stage for $w : $($leaked.FullName -join ', '). Add it to `$ReleaseOnlyExclude." }

            Compress-Archive -Path $stageCopy -DestinationPath $zip
            Remove-Item $stage -Recurse -Force
            $assets += $zip
        }

        $dash = Join-Path $RepoPath "dashboard"
        if (Test-Path $dash) {
            $dzip   = Join-Path $env:TEMP "rac-dashboard-$Release.zip"
            $dstage = Join-Path $env:TEMP "rac-dashboard-release-stage"
            if (Test-Path $dzip)   { Remove-Item $dzip -Force }
            if (Test-Path $dstage) { Remove-Item $dstage -Recurse -Force }
            New-Item -ItemType Directory -Path $dstage | Out-Null
            robocopy "$dash" (Join-Path $dstage "rac-dashboard") /E /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy (dashboard release stage) failed" }
            Compress-Archive -Path (Join-Path $dstage "rac-dashboard") -DestinationPath $dzip
            Remove-Item $dstage -Recurse -Force
            $assets += $dzip
        }

        $notes = "Report a Concern $Release. Dashboard zip: extract, fill in the CONFIG block in each page, copy the folder (with fonts) to the internal web server; see dashboard/README.md. Widget zips: extract and drop the widget folder into client\your-extensions\widgets so manifest.json sits directly inside it, then pnpm install in the client folder and restart. Visual Studio type shims are left out of the zips on purpose. Scripts, proxy, schema and docs are in the repository."
        $branch = (git rev-parse --abbrev-ref HEAD).Trim()
        Write-Host "==> Creating release $Release with $($assets.Count) zip(s)..."
        gh release create $Release @assets --title "$RepoName $Release" --notes $notes --target $branch
    }

    Write-Host "==> Finished."
}
finally {
    Pop-Location
}
