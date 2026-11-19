"""Single source of fix guidance for every TimeSync failure/hold reason.

Consumed by the Needs Attention endpoint, getSyncLog enrichment, the dashboard
count, and the preflight -- so every surface that tells Philip "this entry
didn't sync" tells him the SAME plain-English fix and points at the SAME place
to fix it, instead of each surface re-deriving (or, worse, only showing a raw
error string / reason code).

remedy_for(status, error, row, mappings=None, workspace_id="") is PURE -- no
network. The caller fetches Back Office mappings ONCE per request
(build_mapping_lookups) and reads the cached Toggl workspace id, then passes
both in; remedy_for only does dict lookups against them. Every link falls back
to a safe registry/list URL when the ids needed for a deep link aren't on the
row (never a broken link).

Link facts (confirmed live 2026-11-19 against build_mapping_lookups + the
cached workspace id):
- Back Office registry = https://backoffice.pltheatrical.com/#/registry
  (NOT #/clients -- no such route).
- The Back Office project mapping value carries only qboProjectId/qboProjectName
  -- there is NO Back Office INTERNAL project-id field, so the no_rate link
  cannot form a #/projects/<id> deep link and falls back to the registry. The
  lookup below is kept (candidate field names) so that if Back Office later adds
  such a field the deep link lights up automatically; until then it degrades to
  the registry, by design, not as a bug.
- Toggl project deep link = https://track.toggl.com/<workspace_id>/projects/<toggl_project_id>;
  without a workspace id or a project id it falls back to the Toggl projects
  list (https://track.toggl.com/projects).
"""
from sync_engine import TIMESYNC_HOLD_REASON_TEXT

REGISTRY_URL = "https://backoffice.pltheatrical.com/#/registry"
BO_PROJECT_URL = "https://backoffice.pltheatrical.com/#/projects/{bo_project_id}"
TOGGL_PROJECTS_LIST_URL = "https://track.toggl.com/projects"
TOGGL_PROJECT_URL = "https://track.toggl.com/{workspace_id}/projects/{project_id}"

# Reverse of TIMESYNC_HOLD_REASON_TEXT: the held error string embeds the reason
# phrase (f"Waiting on bill rate: {phrase}."), so map the phrase back to a code.
_HOLD_PHRASE_TO_CODE = {phrase: code for code, phrase in TIMESYNC_HOLD_REASON_TEXT.items()}

# Candidate field names on a Back Office project mapping value that would hold
# the Back Office INTERNAL project id (for the #/projects/<id> route). None of
# these exist in the live mapping today (only qboProjectId/qboProjectName) --
# deliberately excludes qbo* so a QuickBooks id is never mistaken for a Back
# Office route id -- so no_rate falls back to the registry link.
_BO_PROJECT_ID_FIELDS = ("backOfficeProjectId", "boProjectId", "projectId")


def classify_reason(status, error):
    """Map a sync_log (status, error) pair to a reason code, matching the exact
    strings sync_engine emits.

    resolve_sync_mappings failures:
      "No QBO employee mapping for Toggl user:" -> unknown_user
      "No QBO customer mapping for client:"     -> no_client
      "No QBO service item mapping for task:"   -> no_task
    bill_rate_hold ("Waiting on bill rate: <phrase>."):
      the embedded TIMESYNC_HOLD_REASON_TEXT phrase -> its code
      (unknown_user / unknown_project / unknown_task / no_rate); the generic
      "not yet resolved" fallback phrase -> no_rate.
    anything else -> unknown.
    """
    error = error or ""
    if error.startswith("Waiting on bill rate:"):
        for phrase, code in _HOLD_PHRASE_TO_CODE.items():
            if phrase in error:
                return code
        return "no_rate"  # generic "not yet resolved in Back Office" fallback
    if error.startswith("No QBO employee mapping for Toggl user:"):
        return "unknown_user"
    if error.startswith("No QBO customer mapping for client:"):
        return "no_client"
    if error.startswith("No QBO service item mapping for task:"):
        return "no_task"
    return "unknown"


def _toggl_project_link(row, workspace_id):
    pid = row.get("toggl_project_id")
    if workspace_id and pid:
        return TOGGL_PROJECT_URL.format(workspace_id=workspace_id, project_id=pid)
    return TOGGL_PROJECTS_LIST_URL


def _bo_project_link(row, mappings):
    pid = row.get("toggl_project_id")
    if mappings and pid is not None and str(pid):
        proj = (mappings.get("projects") or {}).get(str(pid))
        if proj:
            for field in _BO_PROJECT_ID_FIELDS:
                value = proj.get(field)
                if value:
                    return BO_PROJECT_URL.format(bo_project_id=value)
    return REGISTRY_URL


def remedy_for(status, error, row, mappings=None, workspace_id=""):
    """Return {reason, instruction, link, link_label} for a failed/held row.

    row carries the sync_log fields (toggl_user, toggl_client, toggl_project,
    toggl_task, toggl_user_id, toggl_project_id, toggl_task_id,
    toggl_entry_id). mappings is one build_mapping_lookups dict (or None);
    workspace_id is the cached Toggl workspace id (or "").
    """
    row = row or {}
    reason = classify_reason(status, error)
    project = row.get("toggl_project") or "(no project)"
    user = row.get("toggl_user") or "(unknown user)"
    role = row.get("toggl_task") or "this role"
    task_name = row.get("toggl_task") or "(no task)"

    if reason == "no_client":
        return {
            "reason": reason,
            "instruction": f"{project}: no client set in Toggl. Set the project's client in Toggl.",
            "link": _toggl_project_link(row, workspace_id),
            "link_label": "Open in Toggl",
        }
    if reason == "no_task":
        return {
            "reason": reason,
            "instruction": f"{project}: set a task on this entry in Toggl first.",
            "link": _toggl_project_link(row, workspace_id),
            "link_label": "Open in Toggl",
        }
    if reason == "no_rate":
        return {
            "reason": reason,
            "instruction": f"{project}: no bill rate for {role}. Set the rate in Back Office.",
            "link": _bo_project_link(row, mappings),
            "link_label": "Open Back Office",
        }
    if reason == "unknown_project":
        return {
            "reason": reason,
            "instruction": f"{project}: project not mapped in Back Office. Map it in the registry.",
            "link": REGISTRY_URL,
            "link_label": "Open registry",
        }
    if reason == "unknown_user":
        return {
            "reason": reason,
            "instruction": f"{user}: person not mapped in Back Office. Map them in the registry.",
            "link": REGISTRY_URL,
            "link_label": "Open registry",
        }
    if reason == "unknown_task":
        return {
            "reason": reason,
            "instruction": f"{project}: task '{task_name}' not mapped in Back Office. Map it in the registry.",
            "link": REGISTRY_URL,
            "link_label": "Open registry",
        }
    return {
        "reason": "unknown",
        "instruction": f"{project}: couldn't resolve this entry. Check the mapping in the Back Office registry.",
        "link": REGISTRY_URL,
        "link_label": "Open registry",
    }
