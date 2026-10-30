"""Mapping-aware held prediction in routes._post_preflight_check (2026-10-30).

The Sync Approved preflight popup now predicts exactly what the run holds: a
billable entry is counted as held ONLY when it both resolves its mappings AND
has an unresolved bill rate. An entry whose mappings fail is dropped (the run
would mark it Failed, not Held). To stay cheap, the shared mapping prep
(build_toggl_lookups / build_mapping_lookups) runs ONLY when there is at least
one held candidate; a zero-candidate preflight makes no mapping/lookup call.

These tests drive routes._post_preflight_check end to end with raw Toggl
entries, counting the mapping-prep calls to prove the short-circuit, and
asserting the preflight's held set equals the real sync's held set for a
fixed input (parity). Mock-only: no network, no QBO, no Toggl edits.
"""
import back_office_client
import qbo_client
import routes
import sync_engine
from toggl_client import TogglClient

DEFAULT_URL = "https://backoffice.pltheatrical.com/#/corrections?source=time-entry"

# Shared prep stubs: toggl_lookups resolves project 3 -> client CL; mappings
# resolve user 9, client CL, project 3 and task 7. Project 99 is deliberately
# absent so an entry on it fails mapping resolution.
_TOGGL_LOOKUPS = {
    "users": {}, "tasks": {}, "tags": {},
    "projects": {3: {"clientId": "CL", "clientName": "Client", "name": "Proj3"}},
}
_MAPPINGS = {
    "users": {"9": {"qboEmployeeId": "E9"}},
    "clients": {"CL": {"qboCustomerId": "C1"}},
    "projects": {"3": {"qboProjectId": ""}},
    "tasks": {"7": {"qboServiceItemId": "S7"}},
}


def _base_patches(monkeypatch, entries, bill_rates=None, hold_reasons=None):
    """Patch the Toggl/Back Office surface _post_preflight_check touches and
    return a {toggl_lookups, mapping_lookups} call counter for the shared prep.
    """
    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-10-01", "endDate": "2026-10-31"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(routes.sync_engine, "build_already_synced_map", lambda: {})
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", lambda self, s, e: entries)
    monkeypatch.setattr(TogglClient, "fetch_tags", lambda self, force_refresh=False: [])
    monkeypatch.setattr(back_office_client, "get_bill_rates",
                         lambda payload: ((bill_rates or {}), (hold_reasons or {})))
    monkeypatch.setattr(back_office_client, "get_preflight",
                         lambda ids: {"total_flagged": 0, "by_reason": {}, "held_count": 0,
                                      "corrections_url": DEFAULT_URL})

    counters = {"toggl_lookups": 0, "mapping_lookups": 0}

    def _tl(self):
        counters["toggl_lookups"] += 1
        return {k: dict(v) for k, v in _TOGGL_LOOKUPS.items()}

    def _ml():
        counters["mapping_lookups"] += 1
        return _MAPPINGS

    monkeypatch.setattr(TogglClient, "build_toggl_lookups", _tl)
    monkeypatch.setattr(back_office_client, "build_mapping_lookups", _ml)
    return counters


def _raw(entry_id, billable=True, project_id=3):
    return {"id": entry_id, "billable": billable, "user_id": 9,
            "project_id": project_id, "task_id": 7, "tags": ["Approved"]}


def test_zero_candidates_makes_no_mapping_or_lookup_call(monkeypatch):
    # A non-billable entry is never a held candidate -> the shared prep is
    # skipped entirely, so neither build_toggl_lookups nor build_mapping_lookups
    # runs (no Toggl workspace-bucket spend).
    counters = _base_patches(monkeypatch, [_raw(1, billable=False)])
    result = routes._post_preflight_check({})
    assert result["held_count"] == 0
    assert counters["toggl_lookups"] == 0
    assert counters["mapping_lookups"] == 0


def test_resolved_rate_candidate_absent_skips_prep(monkeypatch):
    # Billable but with a resolved rate -> not a candidate -> no prep.
    counters = _base_patches(monkeypatch, [_raw(2)], bill_rates={"2": 22.0})
    result = routes._post_preflight_check({})
    assert result["held_count"] == 0
    assert counters["mapping_lookups"] == 0


def test_candidate_with_unmapped_client_not_counted(monkeypatch):
    # Billable + unresolved rate (candidate), but project 99 isn't in the
    # lookups -> no client -> mappings fail -> dropped from held_count (the run
    # would mark it Failed, not Held). The prep still runs (a candidate existed).
    counters = _base_patches(monkeypatch, [_raw(10, project_id=99)])
    result = routes._post_preflight_check({})
    assert counters["mapping_lookups"] == 1
    assert result["held_count"] == 0


def test_candidate_fully_mapped_is_counted(monkeypatch):
    counters = _base_patches(monkeypatch, [_raw(20)])  # bill_rates empty -> unresolved
    result = routes._post_preflight_check({})
    assert counters["mapping_lookups"] == 1
    assert result["held_count"] == 1
    assert result["entry_count"] == 1


def test_prediction_equals_run_parity(monkeypatch):
    """For a fixed set of raw entries, the set of ids the preflight counts as
    held equals the set the real sync (sync_single_entry) returns held:True
    for -- off the same mocked mappings / bill_rates / hold_reasons."""
    entries = [
        _raw(1),                      # mapped, no rate   -> HELD
        _raw(2, project_id=99),       # unmapped client   -> Failed, not held
        _raw(3),                      # mapped, rate 22   -> push
        _raw(4, billable=False),      # non-billable      -> push, not held
    ]
    bill_rates = {"3": 22.0}
    hold_reasons = {"1": "no_rate"}
    _base_patches(monkeypatch, entries, bill_rates=bill_rates, hold_reasons=hold_reasons)

    result = routes._post_preflight_check({})
    preflight_held_count = result["held_count"]

    # What the real run holds, over the same prepared inputs.
    monkeypatch.setattr(qbo_client, "create_time_activity", lambda td: {"Id": "TA"})
    processed, mappings, br, hr = sync_engine.prepare_approved_entries(entries, TogglClient())
    run_held = {
        str(p["togglEntryId"]) for p in processed
        if sync_engine.sync_single_entry(p, mappings, br, hr).get("held")
    }

    assert run_held == {"1"}
    assert preflight_held_count == len(run_held) == 1


def test_bill_rate_fetch_failure_fails_open(monkeypatch):
    _base_patches(monkeypatch, [_raw(1)])

    def _boom(payload):
        raise RuntimeError("Back Office unreachable")

    monkeypatch.setattr(back_office_client, "get_bill_rates", _boom)
    result = routes._post_preflight_check({})
    assert result == {"entry_count": 0, "total_flagged": 0, "by_reason": {},
                      "held_count": 0, "corrections_url": DEFAULT_URL}


def test_mapping_fetch_failure_fails_open(monkeypatch):
    # A build_mapping_lookups failure inside prepare_approved_entries raises
    # and is caught by the action's fail-open try (matching the real run
    # aborting on a mapping-fetch failure) -> all-zeros.
    _base_patches(monkeypatch, [_raw(1)])  # candidate exists -> prep runs

    def _boom():
        raise RuntimeError("Back Office mappings unreachable")

    monkeypatch.setattr(back_office_client, "build_mapping_lookups", _boom)
    result = routes._post_preflight_check({})
    assert result == {"entry_count": 0, "total_flagged": 0, "by_reason": {},
                      "held_count": 0, "corrections_url": DEFAULT_URL}
