"""Tests for the shared remedy-guidance helper -- one case per reason code,
plus the generic/unknown fallback and the id-missing fallback-link case.
remedy_for is pure (no network), so these call it directly with hand-built
rows/mappings."""
import remedy
from sync_engine import TIMESYNC_HOLD_REASON_TEXT

WS = "4056428"
# A live-shaped mappings dict: the project value carries only qbo* fields, so
# the no_rate link cannot form a #/projects/<id> deep link (matches live).
MAPPINGS = {
    "users": {}, "clients": {}, "tasks": {},
    "projects": {"199999595": {"qboProjectId": "459", "qboProjectName": "Atlanta:Admin"}},
}


def _row(**over):
    row = {
        "toggl_user": "Jane Tech", "toggl_client": "Orlando Shakes",
        "toggl_project": "HTS", "toggl_task": "Electrics",
        "toggl_user_id": "5499537", "toggl_project_id": "199999595",
        "toggl_task_id": "240569251", "toggl_entry_id": "111",
    }
    row.update(over)
    return row


# ---- classify_reason: exact sync_engine error strings ----

def test_classify_resolve_errors():
    assert remedy.classify_reason("Failed", "No QBO employee mapping for Toggl user: Jane") == "unknown_user"
    assert remedy.classify_reason("Failed", "No QBO customer mapping for client: (no client)") == "no_client"
    assert remedy.classify_reason("Failed", "No QBO service item mapping for task: (no task). Set DEFAULT...") == "no_task"


def test_classify_hold_phrases_back_to_codes():
    for code, phrase in TIMESYNC_HOLD_REASON_TEXT.items():
        err = f"Waiting on bill rate: {phrase}."
        assert remedy.classify_reason("Held", err) == code


def test_classify_hold_generic_fallback_is_no_rate():
    err = "Waiting on bill rate: not yet resolved in Back Office for this entry."
    assert remedy.classify_reason("Held", err) == "no_rate"


def test_classify_unknown():
    assert remedy.classify_reason("Failed", "QBO 500 boom") == "unknown"
    assert remedy.classify_reason("Failed", "") == "unknown"


# ---- remedy_for: one per reason ----

def test_no_client_links_to_toggl_project():
    r = remedy.remedy_for("Failed", "No QBO customer mapping for client: (no client)", _row(),
                          mappings=MAPPINGS, workspace_id=WS)
    assert r["reason"] == "no_client"
    assert "HTS" in r["instruction"] and "Toggl" in r["instruction"]
    assert r["link"] == f"https://track.toggl.com/{WS}/projects/199999595"
    assert r["link_label"] == "Open in Toggl"


def test_no_task_links_to_toggl_project():
    r = remedy.remedy_for("Failed", "No QBO service item mapping for task: (no task). Set DEFAULT...", _row(),
                          mappings=MAPPINGS, workspace_id=WS)
    assert r["reason"] == "no_task"
    assert "HTS" in r["instruction"]
    assert r["link"] == f"https://track.toggl.com/{WS}/projects/199999595"


def test_no_rate_names_role_and_falls_back_to_registry():
    r = remedy.remedy_for("Held", "Waiting on bill rate: no bill rate set in Back Office for this role on this project.",
                          _row(), mappings=MAPPINGS, workspace_id=WS)
    assert r["reason"] == "no_rate"
    assert "HTS" in r["instruction"] and "Electrics" in r["instruction"]
    # No BO internal project-id field in the mapping -> registry fallback.
    assert r["link"] == remedy.REGISTRY_URL
    assert r["link_label"] == "Open Back Office"


def test_unknown_project():
    r = remedy.remedy_for("Held", "Waiting on bill rate: Toggl project not mapped in Back Office.",
                          _row(), mappings=MAPPINGS, workspace_id=WS)
    assert r["reason"] == "unknown_project"
    assert "HTS" in r["instruction"] and "registry" in r["instruction"].lower()
    assert r["link"] == remedy.REGISTRY_URL


def test_unknown_user_names_person():
    r = remedy.remedy_for("Held", "Waiting on bill rate: Toggl user not mapped in Back Office.",
                          _row(), mappings=MAPPINGS, workspace_id=WS)
    assert r["reason"] == "unknown_user"
    assert "Jane Tech" in r["instruction"]
    assert r["link"] == remedy.REGISTRY_URL


def test_unknown_task_names_task():
    r = remedy.remedy_for("Held", "Waiting on bill rate: Toggl task not mapped in Back Office.",
                          _row(), mappings=MAPPINGS, workspace_id=WS)
    assert r["reason"] == "unknown_task"
    assert "Electrics" in r["instruction"]
    assert r["link"] == remedy.REGISTRY_URL


def test_unknown_generic_fallback():
    r = remedy.remedy_for("Failed", "QBO 500 boom", _row(), mappings=MAPPINGS, workspace_id=WS)
    assert r["reason"] == "unknown"
    assert r["link"] == remedy.REGISTRY_URL
    assert r["link_label"] == "Open registry"


# ---- id-missing fallback link ----

def test_missing_project_id_falls_back_to_toggl_list():
    r = remedy.remedy_for("Failed", "No QBO customer mapping for client: (no client)",
                          _row(toggl_project_id="", toggl_project=""),
                          mappings=MAPPINGS, workspace_id=WS)
    assert r["link"] == remedy.TOGGL_PROJECTS_LIST_URL


def test_missing_workspace_id_falls_back_to_toggl_list():
    r = remedy.remedy_for("Failed", "No QBO customer mapping for client: (no client)",
                          _row(), mappings=MAPPINGS, workspace_id="")
    assert r["link"] == remedy.TOGGL_PROJECTS_LIST_URL


def test_no_mappings_no_workspace_still_safe_links():
    r = remedy.remedy_for("Held", "Waiting on bill rate: no bill rate set in Back Office for this role on this project.",
                          _row(), mappings=None, workspace_id="")
    assert r["link"] == remedy.REGISTRY_URL  # no_rate always safe-falls to registry
