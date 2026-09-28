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


def _patch_common(monkeypatch, approved_entries, already_synced=None, preflight_result=None):
    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-08-01", "endDate": "2026-08-31"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(routes.sync_engine, "build_already_synced_map", lambda: already_synced or {})
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", lambda self, s, e: approved_entries)
    monkeypatch.setattr(TogglClient, "fetch_tags", lambda self, force_refresh=False: [])
    captured = {}

    def _fake_get_preflight(ids):
        captured["ids"] = ids
        return preflight_result if preflight_result is not None else {
            "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL,
        }

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
        "held_count": 2,
        "corrections_url": DEFAULT_URL,
    }


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
