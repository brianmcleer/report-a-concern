# Scheduled tasks

Windows Task Scheduler import files for every RAC job. Each file is a
Task Scheduler XML document (Task version 1.4) with placeholder paths and a
placeholder service account. Import them once on the automation server; the
`WHY` comment at the top of each file explains the Python environment choice.

## Before you import

Open each XML file in a text editor and change these values to match the
server:

| Element                         | Placeholder                              | Set it to                                   |
|---------------------------------|------------------------------------------|---------------------------------------------|
| `Principals/Principal/UserId`   | `DOMAIN\svc_gis`                         | The service account that runs the jobs      |
| `Actions/Exec/Command`          | `C:\envs\arcgispro-py3-rac\python.exe`   | `python.exe` in a **cloned** ArcGIS Pro env |
| `Actions/Exec/Arguments`        | `D:\RAC\scripts\<script>.py`             | Where the repo scripts live                 |
| `Actions/Exec/WorkingDirectory` | `D:\RAC\scripts` (proxy: `D:\RAC\proxy`) | Same folder as the script                   |

Use a cloned ArcGIS Pro environment, not the base `arcgispro-py3`. On
Windows Server 2025 the base environment fails with `0x800700C1` when Task
Scheduler launches it. Clone it in ArcGIS Pro (Package Manager) and point
`Command` at the clone.

The service account needs Log on as a batch job rights, read access to the
scripts and templates, and an `.sde` connection file that it can open
(`config.py` points at it). You will be prompted for the account password on
import because `LogonType` is `Password`.

## Importing

**Task Scheduler GUI**: open Task Scheduler, create a `RAC` folder under
Task Scheduler Library, right-click it, choose **Import Task...**, pick the
XML file, confirm the account under **Change User or Group...**, and enter
the password when prompted.

**PowerShell** (run as administrator, from this folder):

```powershell
Register-ScheduledTask -Xml (Get-Content .\RAC_Proxy.xml -Raw) -TaskName "RAC Proxy" -TaskPath "\RAC\"
```

Add `-User "DOMAIN\svc_gis" -Password "<password>"` to register with the
account in one step; without them the task is created with the XML principal
and you set the password afterwards in the GUI (Properties, Change User or
Group).

Or all of them at once:

```powershell
$cred = Get-Credential -UserName "DOMAIN\svc_gis" -Message "Service account"
Get-ChildItem .\RAC_*.xml | ForEach-Object {
    $name = $_.BaseName -replace "_", " "
    Register-ScheduledTask -Xml (Get-Content $_.FullName -Raw) -TaskName $name -TaskPath "\RAC\" `
        -User $cred.UserName -Password $cred.GetNetworkCredential().Password
}
```

After import, right-click each task and **Run** it once, then check
**History** and the script's log file to confirm it ran cleanly.

## Schedule

| File                         | Task name              | Script                     | Schedule                                | Time limit |
|------------------------------|------------------------|----------------------------|-----------------------------------------|------------|
| `RAC_Proxy.xml`              | RAC Proxy              | `proxy\rac_proxy.py`       | At boot, restart on failure every 30 s  | None       |
| `RAC_Notify_New_Ticket.xml`  | RAC Notify New Ticket  | `rac_notify_new_ticket.py` | Every 5 minutes                         | 30 min     |
| `RAC_Reassign_Notify.xml`    | RAC Reassign Notify    | `rac_reassign_notify.py`   | Every 5 minutes                         | 30 min     |
| `RAC_Comments_Mailer.xml`    | RAC Comments Mailer    | `rac_comments_mailer.py`   | Every 30 minutes                        | 30 min     |
| `RAC_Survey_Mailer.xml`      | RAC Survey Mailer      | `rac_survey_mailer.py`     | Every 30 minutes                        | 30 min     |
| `RAC_Survey_Pull.xml`        | RAC Survey Pull        | `rac_survey_pull.py`       | Every 30 minutes                        | 30 min     |
| `RAC_Directors_Report.xml`   | RAC Directors Report   | `rac_directors_report.py`  | Monday to Friday at 12:00               | 30 min     |
| `RAC_Monthly_Report.xml`     | RAC Monthly Report     | `rac_all_dept_report.py`   | 1st of every month at 09:00             | 30 min     |

Common settings on every task: runs whether the user is logged on or not,
least privilege, `IgnoreNew` if the previous run is still going,
`StartWhenAvailable` so a missed run catches up, not hidden.

The repeating tasks use a daily calendar trigger with a repetition interval,
which is how the Task Scheduler GUI represents "every N minutes,
indefinitely". The `StartBoundary` date only has to be in the past.
