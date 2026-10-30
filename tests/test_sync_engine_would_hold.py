"""sync_engine.would_hold -- the single held-prediction path shared by the
real sync (sync_single_entry) and the preflight predictor
(routes._post_preflight_check). It must hold an entry ONLY when the entry's
mappings resolve AND bill_rate_hold holds (resolve first, then rate --
matching sync_single_entry's order). A billable entry whose mappings FAIL is
NOT held: the real run marks it Failed via resolve_sync_mappings, never Held,
so the preflight must agree.
"""
import sync_engine

MAPPINGS = {
    "users": {"1": {"qboEmployeeId": "E1"}},
    "clients": {"10": {"qboCustomerId": "C1"}},
    "projects": {"100": {"qboProjectId": ""}},
    "tasks": {"1000": {"qboServiceItemId": "S1"}},
}


def _processed(billable=True, entry_id="123", client_id=10):
    """A normalized/processed entry dict (process_time_entry's output shape)."""
    return {
        "togglEntryId": entry_id,
        "togglUser": "Diego Ford", "togglUserId": 1,
        "togglClient": "Nosferatu", "togglClientId": client_id,
        "togglProject": "Nosferatu 2026", "togglProjectId": 100,
        "togglTask": "Lighting Design", "togglTaskId": 1000,
        "description": "Focus session", "date": "2026-10-30",
        "durationSeconds": 3600, "durationFormatted": "1:00",
        "billable": billable, "tags": "",
    }


def test_billable_no_rate_mapping_fails_not_held():
    # client_id 99 has no QBO customer mapping -> resolve_sync_mappings fails
    # -> the run would mark this Failed, not Held -> would_hold False.
    entry = _processed(client_id=99)
    assert sync_engine.would_hold(entry, MAPPINGS, {}, {}) is False


def test_billable_no_rate_fully_mapped_is_held():
    entry = _processed()  # maps cleanly, no bill rate -> held
    assert sync_engine.would_hold(entry, MAPPINGS, {}, {}) is True
    # reason text is irrelevant to the bool, but hold_reasons must not break it
    assert sync_engine.would_hold(entry, MAPPINGS, {}, {"123": "no_rate"}) is True


def test_non_billable_never_held_even_when_unmapped():
    # Non-billable + unmapped + no rate: still not held.
    assert sync_engine.would_hold(_processed(billable=False, client_id=99), MAPPINGS, {}, {}) is False
    # Non-billable + mapped: bill_rate_hold returns None -> not held.
    assert sync_engine.would_hold(_processed(billable=False), MAPPINGS, {}, {}) is False


def test_billable_resolved_rate_mapped_not_held():
    entry = _processed()
    assert sync_engine.would_hold(entry, MAPPINGS, {"123": 25.0}, {}) is False
    # 0 is a resolved rate, not unresolved -> not held.
    assert sync_engine.would_hold(entry, MAPPINGS, {"123": 0}, {}) is False
