"""routes._post_preflight_check -- warns before Sync Approved pushes. As of
2026-11-19 everything is computed LIVE from the raw Toggl entries + ONE Back
Office mapping fetch (no call to Back Office's get_preflight, whose stored
counts can trail reality):
  - held_count: billable + unresolved-rate + mappings-resolve, via the shared
    bill_rate_hold / would_hold the real sync uses (an unmapped entry is Failed
    by the run, not Held).
  - total_flagged / by_reason: live unknown_user / unknown_project / no_task
    counts against that same mapping fetch.
Fails open: any exception returns clean all-zeros -- this only ever gates a
confirm dialog in runSync, never the sync itself.
"""
import back_office_client
import routes
from toggl_client import TogglClient

DEFAULT_URL = "https://backoffice.pltheatrical.com/#/corrections?source=time-entry"
ZEROS = {"entry_count": 0, "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL}

# "Everything maps" prep: toggl_lookups resolves project 3/4 -> client CL;
# mappings resolve user 9, that client, those projects and tasks 7/8. An entry
# carrying user_id 9 / project_id 3|4 / task_id 7|8 is fully mapped (not flagged,
# not Failed); a billable one with no resolved rate is Held.
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


def _mapped(entry_id, **over):
    """A fully-mapped approved entry (not flagged / not Failed by the run)."""
    e = {"id": entry_id, "user_id": 9, "project_id": 3, "task_id": 7,
         "billable": False, "tags": ["Approved"]}
    e.update(over)
    return e


def _patch_common(monkeypatch, approved_entries, already_synced=None,
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

    tl = toggl_lookups if toggl_lookups is not None else _DEFAULT_TOGGL_LOOKUPS
    mp = mappings if mappings is not None else _DEFAULT_MAPPINGS
    monkeypatch.setattr(TogglClient, "build_toggl_lookups",
                         lambda self: {k: dict(v) for k, v in tl.items()})
    # Accepts abort_on_failure -- the zero-candidate correction-count path calls
    # build_mapping_lookups(abort_on_failure=False); prepare_approved_entries
    # calls it with no args.
    monkeypatch.setattr(back_office_client, "build_mapping_lookups", lambda abort_on_failure=True: mp)
    monkeypatch.setattr(back_office_client, "get_bill_rates", _fake_get_bill_rates)
    return captured


def test_registered_as_post_only_action():
    assert routes.POST_ONLY_ACTIONS["preflightCheck"] is routes._post_preflight_check
    assert "preflightCheck" not in routes.READ_ACTIONS


def test_mapped_nonbillable_entries_return_clean_result(monkeypatch):
    entries = [_mapped(101), _mapped(102), {"id": 103, "tags": ["Other"]}]  # 103 not approved
    _patch_common(monkeypatch, entries, already_synced={})

    result = routes._post_preflight_check({})
    assert result == {"entry_count": 2, "total_flagged": 0, "by_reason": {},
                      "held_count": 0, "corrections_url": DEFAULT_URL}


def test_live_correction_counts_from_mappings(monkeypatch):
    # Two approved entries missing identity fields -> each flagged on all three
    # reasons, computed live off the mapping fetch (no Back Office get_preflight).
    entries = [{"id": 111, "tags": ["Approved"]}, {"id": 112, "tags": ["Approved"]}]
    _patch_common(monkeypatch, entries, already_synced={})

    result = routes._post_preflight_check({})
    assert result["entry_count"] == 2
    assert result["by_reason"] == {"unknown_user": 2, "unknown_project": 2, "no_task": 2}
    assert result["total_flagged"] == 6
    assert result["held_count"] == 0


def test_held_count_is_computed_live(monkeypatch):
    """One billable entry with no resolved rate (held) + one whose rate resolves
    live (not held). held_count is 1, computed off would_hold, not Back Office."""
    entries = [_mapped(501, billable=True, task_id=7),
               _mapped(502, billable=True, project_id=4, task_id=8)]
    _patch_common(monkeypatch, entries, already_synced={},
                  bill_rates={"502": 22.0}, hold_reasons={"501": "no_rate"})

    result = routes._post_preflight_check({})
    assert result["held_count"] == 1
    assert result["entry_count"] == 2
    assert result["total_flagged"] == 0  # both fully mapped


def test_live_non_billable_entry_not_held(monkeypatch):
    entries = [_mapped(601, billable=False)]
    captured = _patch_common(monkeypatch, entries, already_synced={})

    result = routes._post_preflight_check({})
    assert result["held_count"] == 0
    assert captured["bill_rate_payload"] == []  # non-billable -> excluded from the payload


def test_billable_resolved_rate_not_held(monkeypatch):
    entries = [_mapped(701, billable=True)]
    _patch_common(monkeypatch, entries, already_synced={}, bill_rates={"701": 0})  # 0 resolved

    result = routes._post_preflight_check({})
    assert result["held_count"] == 0


def test_billable_unresolved_rate_is_held(monkeypatch):
    entries = [_mapped(801, billable=True)]
    _patch_common(monkeypatch, entries, already_synced={}, bill_rates={})  # not in map -> held

    result = routes._post_preflight_check({})
    assert result["held_count"] == 1


def test_bill_rate_fetch_failure_fails_open(monkeypatch):
    entries = [_mapped(901, billable=True)]
    _patch_common(monkeypatch, entries, already_synced={})

    def _raise(payload):
        raise RuntimeError("Back Office unreachable")

    monkeypatch.setattr(back_office_client, "get_bill_rates", _raise)
    assert routes._post_preflight_check({}) == ZEROS


def test_excludes_already_synced_entries(monkeypatch):
    entries = [_mapped(201), _mapped(202)]
    _patch_common(monkeypatch, entries, already_synced={"201": True})

    result = routes._post_preflight_check({})
    assert result["entry_count"] == 1
    assert result["total_flagged"] == 0  # 202 is fully mapped


def test_no_approved_entries_returns_clean_result(monkeypatch):
    """Empty entry set -> early return, no Toggl/Back Office spend at all."""
    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-08-01", "endDate": "2026-08-31"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(routes.sync_engine, "build_already_synced_map", lambda: {})
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", lambda self, s, e: [])
    monkeypatch.setattr(TogglClient, "fetch_tags", lambda self, force_refresh=False: [])

    assert routes._post_preflight_check({}) == ZEROS


def test_toggl_failure_fails_open(monkeypatch):
    def _raise(self, s, e):
        raise RuntimeError("Toggl API budget exhausted")

    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-08-01", "endDate": "2026-08-31"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", _raise)

    assert routes._post_preflight_check({}) == ZEROS


def test_mapping_fetch_failure_fails_open(monkeypatch):
    """build_mapping_lookups returning None (Back Office down) -> all-zeros."""
    entries = [_mapped(301)]
    _patch_common(monkeypatch, entries, already_synced={})
    monkeypatch.setattr(back_office_client, "build_mapping_lookups", lambda abort_on_failure=True: None)

    assert routes._post_preflight_check({}) == ZEROS


def test_dispatch_rejects_get_for_preflight_check():
    resp = routes._dispatch("preflightCheck", {}, is_post=False)
    assert resp.status_code == 405
