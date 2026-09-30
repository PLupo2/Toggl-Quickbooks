"""Bill-rate-aware QBO pushes (2026-09-28).

create_time_activity previously sent no HourlyRate at all, so QBO fell back
to the service item's UnitPrice (0 for most items) -- confirmed live against
~100 Nosferatu 2026 entries that landed at $0 with real Back Office rates of
$20/$22. These tests cover the three rate cases end to end at the
sync_engine.sync_single_entry level (where the hold-vs-push decision is
made) and the HourlyRate wire format at the qbo_client level.
"""
import qbo_client
import sync_engine

ENTRY_ID = "123456789"


def _entry(billable=True):
    return {
        "togglEntryId": ENTRY_ID,
        "togglUser": "Diego Ford",
        "togglUserId": 1,
        "togglClient": "Nosferatu",
        "togglClientId": 10,
        "togglProject": "Nosferatu 2026",
        "togglProjectId": 100,
        "togglTask": "Lighting Design",
        "togglTaskId": 1000,
        "description": "Focus session",
        "date": "2026-09-28",
        "durationSeconds": 3600,
        "durationFormatted": "1:00",
        "billable": billable,
        "tags": "",
    }


MAPPINGS = {
    "users": {"1": {"qboEmployeeId": "E1"}},
    "clients": {"10": {"qboCustomerId": "C1"}},
    "projects": {"100": {"qboProjectId": ""}},
    "tasks": {"1000": {"qboServiceItemId": "S1"}},
}


def _mock_create_time_activity(monkeypatch):
    calls = []

    def _fake(time_data):
        calls.append(time_data)
        return {"Id": "TA-1"}

    monkeypatch.setattr(qbo_client, "create_time_activity", _fake)
    return calls


# --- Case 1: rate set -------------------------------------------------------

def test_resolved_rate_pushes_with_hourly_rate(monkeypatch):
    calls = _mock_create_time_activity(monkeypatch)
    bill_rates = {ENTRY_ID: 20.0}

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, bill_rates)

    assert result["success"] is True
    assert len(calls) == 1
    assert calls[0]["hourlyRate"] == 20.0


# --- Case 2: rate is 0 (valid, distinct from unresolved) --------------------

def test_zero_rate_pushes_with_zero_not_held(monkeypatch):
    calls = _mock_create_time_activity(monkeypatch)
    bill_rates = {ENTRY_ID: 0}

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, bill_rates)

    assert result["success"] is True
    assert not result.get("held")
    assert len(calls) == 1
    assert calls[0]["hourlyRate"] == 0
    assert calls[0]["hourlyRate"] is not None


# --- Case 3: rate missing / unresolved --------------------------------------

def test_missing_rate_is_held_and_never_pushed(monkeypatch):
    calls = _mock_create_time_activity(monkeypatch)
    bill_rates = {}  # entry not present at all

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, bill_rates)

    assert result["success"] is False
    assert result["held"] is True
    assert "bill rate" in result["error"].lower()
    assert calls == []  # never reached QBO


def test_explicit_null_rate_is_held_and_never_pushed(monkeypatch):
    calls = _mock_create_time_activity(monkeypatch)
    bill_rates = {ENTRY_ID: None}  # Back Office resolved the row but bill_rate is NULL

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, bill_rates)

    assert result["success"] is False
    assert result["held"] is True
    assert calls == []


# --- Hold message says why (2026-09-30) -------------------------------------

def test_held_message_reports_no_rate_reason(monkeypatch):
    calls = _mock_create_time_activity(monkeypatch)
    bill_rates = {ENTRY_ID: None}
    hold_reasons = {ENTRY_ID: "no_rate"}

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, bill_rates, hold_reasons)

    assert result["held"] is True
    assert "no bill rate set" in result["error"].lower()
    assert calls == []


def test_held_message_reports_unknown_user_reason(monkeypatch):
    _mock_create_time_activity(monkeypatch)
    bill_rates = {}
    hold_reasons = {ENTRY_ID: "unknown_user"}

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, bill_rates, hold_reasons)

    assert result["held"] is True
    assert "toggl user not mapped" in result["error"].lower()


def test_held_message_reports_unknown_project_reason(monkeypatch):
    _mock_create_time_activity(monkeypatch)
    hold_reasons = {ENTRY_ID: "unknown_project"}

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, {}, hold_reasons)

    assert result["held"] is True
    assert "toggl project not mapped" in result["error"].lower()


def test_held_message_reports_unknown_task_reason(monkeypatch):
    _mock_create_time_activity(monkeypatch)
    hold_reasons = {ENTRY_ID: "unknown_task"}

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, {}, hold_reasons)

    assert result["held"] is True
    assert "toggl task not mapped" in result["error"].lower()


def test_held_message_falls_back_to_generic_text_when_reason_unknown(monkeypatch):
    """No hold_reasons entry at all (e.g. a total fetch failure degraded to
    {}) -- the message stays the original generic text, not a KeyError or
    'None'."""
    _mock_create_time_activity(monkeypatch)

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, {}, {})

    assert result["held"] is True
    assert result["error"] == "Waiting on bill rate: not yet resolved in Back Office for this entry."


def test_held_message_defaults_when_hold_reasons_omitted(monkeypatch):
    """Backward compatible: a caller that doesn't pass hold_reasons at all
    (the pre-2026-09-30 call shape) still works."""
    _mock_create_time_activity(monkeypatch)

    result = sync_engine.sync_single_entry(_entry(), MAPPINGS, {})

    assert result["held"] is True
    assert "bill rate" in result["error"].lower()


# --- Non-billable entries bypass the gate entirely --------------------------

def test_non_billable_entry_pushes_regardless_of_bill_rates(monkeypatch):
    calls = _mock_create_time_activity(monkeypatch)

    result = sync_engine.sync_single_entry(_entry(billable=False), MAPPINGS, {})

    assert result["success"] is True
    assert len(calls) == 1
    assert "hourlyRate" not in calls[0]


# --- qbo_client wire format --------------------------------------------------

def test_qbo_client_includes_hourly_rate_when_set(monkeypatch):
    captured = {}

    def _fake_request(endpoint, method="get", payload=None):
        import json
        captured["payload"] = json.loads(payload)
        return {"TimeActivity": {"Id": "TA-1"}}

    monkeypatch.setattr(qbo_client, "qbo_request", _fake_request)

    qbo_client.create_time_activity({
        "employeeId": "E1", "customerId": "C1", "serviceItemId": "S1",
        "date": "2026-09-28", "hours": 1.0, "description": "x", "billable": True,
        "hourlyRate": 22.0,
    })

    assert captured["payload"]["HourlyRate"] == 22.0


def test_qbo_client_includes_zero_hourly_rate(monkeypatch):
    captured = {}

    def _fake_request(endpoint, method="get", payload=None):
        import json
        captured["payload"] = json.loads(payload)
        return {"TimeActivity": {"Id": "TA-1"}}

    monkeypatch.setattr(qbo_client, "qbo_request", _fake_request)

    qbo_client.create_time_activity({
        "employeeId": "E1", "customerId": "C1", "serviceItemId": "S1",
        "date": "2026-09-28", "hours": 1.0, "description": "x", "billable": True,
        "hourlyRate": 0,
    })

    assert "HourlyRate" in captured["payload"]
    assert captured["payload"]["HourlyRate"] == 0


def test_qbo_client_omits_hourly_rate_when_absent(monkeypatch):
    captured = {}

    def _fake_request(endpoint, method="get", payload=None):
        import json
        captured["payload"] = json.loads(payload)
        return {"TimeActivity": {"Id": "TA-1"}}

    monkeypatch.setattr(qbo_client, "qbo_request", _fake_request)

    qbo_client.create_time_activity({
        "employeeId": "E1", "customerId": "C1", "serviceItemId": "S1",
        "date": "2026-09-28", "hours": 1.0, "description": "x", "billable": False,
    })

    assert "HourlyRate" not in captured["payload"]
