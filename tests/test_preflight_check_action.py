"""routes._post_preflight_check -- collects the same approved-not-yet-synced
entry IDs _preview_approved would push and asks Back Office for a preflight
verdict via back_office_client.get_preflight. Registered as a POST_ONLY
action so app.js's `API.post('preflightCheck')` (previously 404, the bug
this fixes) resolves. Fails open: any exception in the Toggl walk itself
returns a clean, non-blocking result -- this only ever gates a confirm()
dialog in runSync, never the sync itself.
"""
import back_office_client
import routes
from toggl_client import TogglClient

DEFAULT_URL = "https://backoffice.pltheatrical.com/#/corrections?source=time-entry"


# Default "everything maps" prep so a billable+unresolved candidate is held
# (the held_count here is now mapping-aware: an entry whose mappings fail is
# NOT held, it would be Failed by the real run). The default toggl_lookups
# resolves project_id 3/4 to a client; the default mappings resolve user 9,
# that client, those projects and tasks 7/8.
_DEFAULT_TOGGL_LOOKUPS = {
    "users": {}, "tasks": {}, "tags": {},
    "projects": {
        3: {"clientId": "CL", "clientName": "Client", "name": "Proj3"},
        4: {"clientId": "CL", "clientName": "Client", "name": "Proj4"},
    },
}
_DEFAULT_MAPPINGS = {
    "users": {"9": {"qboEmployeeId": "E9"}},
    "clients": {"CL": {"qboCustomerId": "C1"}},
    "projects": {"3": {"qboProjectId": ""}, "4": {"qboProjectId": ""}},
    "tasks": {"7": {"qboServiceItemId": "S7"}, "8": {"qboServiceItemId": "S8"}},
}


def _patch_common(monkeypatch, approved_entries, already_synced=None, preflight_result=None,
                  bill_rates=None, hold_reasons=None, toggl_lookups=None, mappings=None):
    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-08-01", "endDate": "2026-08-31"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(routes.sync_engine, "build_already_synced_map", lambda: already_synced or {})
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", lambda self, s, e: approved_entries)
    monkeypatch.setattr(TogglClient, "fetch_tags", lambda self, force_refresh=False: [])
    captured = {}

    def _fake_get_bill_rates(payload):
        captured["bill_rate_payload"] = payload
        return (bill_rates or {}), (hold_reasons or {})

    def _fake_get_preflight(ids):
        captured["ids"] = ids
        return preflight_result if preflight_result is not None else {
            "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL,
        }

    # Shared mapping prep (only reached when held candidates exist) -- fresh
    # copies per call so the task-name merge can't mutate across tests.
    tl = toggl_lookups if toggl_lookups is not None else _DEFAULT_TOGGL_LOOKUPS
    mp = mappings if mappings is not None else _DEFAULT_MAPPINGS
    monkeypatch.setattr(TogglClient, "build_toggl_lookups",
                         lambda self: {k: dict(v) for k, v in tl.items()})
    monkeypatch.setattr(back_office_client, "build_mapping_lookups", lambda: mp)

    monkeypatch.setattr(back_office_client, "get_bill_rates", _fake_get_bill_rates)
    monkeypatch.setattr(back_office_client, "get_preflight", _fake_get_preflight)
    return captured


def test_registered_as_post_only_action():
    assert routes.POST_ONLY_ACTIONS["preflightCheck"] is routes._post_preflight_check
    assert "preflightCheck" not in routes.READ_ACTIONS


def test_collects_approved_not_yet_synced_ids_and_passes_through_result(monkeypatch):
    entries = [
        {"id": 101, "tags": ["Approved"]},
        {"id": 102, "tags": ["Approved"]},
        {"id": 103, "tags": ["Other"]},  # not approved -- excluded
    ]
    # Back Office returns held_count=2, but it is IGNORED -- held_count is
    # computed live and these entries are non-billable, so live held_count=0.
    captured = _patch_common(
        monkeypatch, entries, already_synced={},
        preflight_result={"total_flagged": 1, "by_reason": {"no_task": 1}, "held_count": 2, "corrections_url": DEFAULT_URL},
    )

    result = routes._post_preflight_check({})

    assert sorted(captured["ids"]) == [101, 102]
    assert result == {
        "entry_count": 2,
        "total_flagged": 1,
        "by_reason": {"no_task": 1},
        "held_count": 0,  # live-computed, NOT Back Office's 2
        "corrections_url": DEFAULT_URL,
    }


def test_held_count_ignores_back_office_and_is_computed_live(monkeypatch):
    """One billable entry with no resolved rate (held) + one billable entry
    whose rate resolves live (not held). Back Office claims held_count=99;
    the live count is 1."""
    entries = [
        {"id": 501, "billable": True, "user_id": 9, "project_id": 3, "task_id": 7, "tags": ["Approved"]},
        {"id": 502, "billable": True, "user_id": 9, "project_id": 4, "task_id": 8, "tags": ["Approved"]},
    ]
    _patch_common(
        monkeypatch, entries, already_synced={},
        preflight_result={"total_flagged": 0, "by_reason": {}, "held_count": 99, "corrections_url": DEFAULT_URL},
        bill_rates={"502": 22.0},  # 501 unresolved -> held; 502 resolved -> not held
        hold_reasons={"501": "no_rate"},
    )

    result = routes._post_preflight_check({})
    assert result["held_count"] == 1
    assert result["entry_count"] == 2


def test_live_non_billable_entry_with_stored_history_not_held(monkeypatch):
    """An entry that is non-billable LIVE in Toggl is never counted as held,
    even if Back Office's stored held_count would include it -- the preflight
    reads the live billable flag off the raw Toggl entry, not stored state."""
    entries = [{"id": 601, "billable": False, "user_id": 9, "project_id": 3, "task_id": 7, "tags": ["Approved"]}]
    captured = _patch_common(
        monkeypatch, entries, already_synced={},
        preflight_result={"total_flagged": 0, "by_reason": {}, "held_count": 1, "corrections_url": DEFAULT_URL},
    )

    result = routes._post_preflight_check({})
    assert result["held_count"] == 0
    # non-billable -> excluded from the bill-rate payload entirely
    assert captured["bill_rate_payload"] == []


def test_billable_resolved_rate_not_held(monkeypatch):
    entries = [{"id": 701, "billable": True, "user_id": 9, "project_id": 3, "task_id": 7, "tags": ["Approved"]}]
    _patch_common(monkeypatch, entries, already_synced={}, bill_rates={"701": 0})  # 0 is a resolved rate

    result = routes._post_preflight_check({})
    assert result["held_count"] == 0


def test_billable_unresolved_rate_is_held(monkeypatch):
    entries = [{"id": 801, "billable": True, "user_id": 9, "project_id": 3, "task_id": 7, "tags": ["Approved"]}]
    _patch_common(monkeypatch, entries, already_synced={}, bill_rates={})  # not in map -> held

    result = routes._post_preflight_check({})
    assert result["held_count"] == 1


def test_bill_rate_fetch_failure_fails_open(monkeypatch):
    """A get_bill_rates exception inside the try block returns all-zeros."""
    entries = [{"id": 901, "billable": True, "user_id": 9, "project_id": 3, "task_id": 7, "tags": ["Approved"]}]
    _patch_common(monkeypatch, entries, already_synced={})

    def _raise(payload):
        raise RuntimeError("Back Office unreachable")

    monkeypatch.setattr(back_office_client, "get_bill_rates", _raise)
    result = routes._post_preflight_check({})
    assert result == {"entry_count": 0, "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL}


def test_excludes_already_synced_entries(monkeypatch):
    entries = [
        {"id": 201, "tags": ["Approved"]},
        {"id": 202, "tags": ["Approved"]},
    ]
    captured = _patch_common(monkeypatch, entries, already_synced={"201": True})

    result = routes._post_preflight_check({})

    assert captured["ids"] == [202]
    assert result["entry_count"] == 1


def test_no_approved_entries_returns_clean_result(monkeypatch):
    """back_office_client.get_preflight itself short-circuits on an empty id
    list with no network call (covered in test_back_office_client_preflight.py)
    -- this only verifies the action's own contract on an empty entry set."""
    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-08-01", "endDate": "2026-08-31"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(routes.sync_engine, "build_already_synced_map", lambda: {})
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", lambda self, s, e: [])
    monkeypatch.setattr(TogglClient, "fetch_tags", lambda self, force_refresh=False: [])

    result = routes._post_preflight_check({})
    assert result == {"entry_count": 0, "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL}


def test_toggl_failure_fails_open(monkeypatch):
    """A Toggl API error (rate limit, network, budget exhausted) must not
    block the sync -- same fail-open contract as a Back Office failure."""
    def _raise(self, s, e):
        raise RuntimeError("Toggl API budget exhausted")

    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-08-01", "endDate": "2026-08-31"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", _raise)

    result = routes._post_preflight_check({})
    assert result == {"entry_count": 0, "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL}


def test_back_office_failure_fails_open(monkeypatch):
    entries = [{"id": 301, "tags": ["Approved"]}]
    _patch_common(monkeypatch, entries, already_synced={}, preflight_result={
        "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL,
    })

    result = routes._post_preflight_check({})
    assert result["total_flagged"] == 0
    assert result["entry_count"] == 1


def test_dispatch_rejects_get_for_preflight_check():
    resp = routes._dispatch("preflightCheck", {}, is_post=False)
    assert resp.status_code == 405
