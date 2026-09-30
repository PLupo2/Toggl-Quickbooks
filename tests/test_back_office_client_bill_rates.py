"""back_office_client.get_bill_rates -- degrades to ({}, {}) on any failure
(missing creds, network error, bad response) rather than aborting the sync,
since an unresolved rate already means "hold that entry," not "crash the
run." Network calls are mocked; nothing here talks to a real Back Office.

2026-09-30: get_bill_rates now sends each entry's Toggl-side identity
(user/project/task), not just its bare id, so Back Office can resolve the
rate LIVE instead of reading a stored column that can trail a same-run
rate save or not exist yet for a never-synced entry (real incident:
Dracula 389, Events 408). Returns (bill_rates, hold_reasons) instead of a
bare dict -- hold_reasons carries why a null came back.
"""
import httpx

import back_office_client


def _entry(entry_id, user_id=1, project_id=100, task_id=1000):
    return {
        "toggl_entry_id": entry_id,
        "toggl_user_id": user_id,
        "toggl_project_id": project_id,
        "toggl_task_id": task_id,
        "is_billable": True,
    }


def test_empty_input_short_circuits_with_no_network_call(monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("should not be called for an empty entry list")

    monkeypatch.setattr(httpx, "post", _boom)
    assert back_office_client.get_bill_rates([]) == ({}, {})


def test_missing_credentials_returns_empty_maps(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "")
    assert back_office_client.get_bill_rates([_entry("1")]) == ({}, {})


def test_successful_response_returns_bill_rates(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "bill_rates": {"1": 20.0, "2": 0, "3": None},
                "hold_reasons": {"3": "no_rate"},
            }

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())

    bill_rates, hold_reasons = back_office_client.get_bill_rates(
        [_entry("1"), _entry("2"), _entry("3")]
    )
    assert bill_rates == {"1": 20.0, "2": 0, "3": None}
    assert hold_reasons == {"3": "no_rate"}


def test_successful_response_with_no_hold_reasons_key(monkeypatch):
    """A response that omits hold_reasons entirely (older Back Office
    build) degrades to an empty dict, not a crash."""
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"bill_rates": {"1": 20.0}}

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())

    bill_rates, hold_reasons = back_office_client.get_bill_rates([_entry("1")])
    assert bill_rates == {"1": 20.0}
    assert hold_reasons == {}


def test_request_sends_full_entry_identity(monkeypatch):
    """Confirms the wire format is {"entries": [...]}, not the old bare
    {"toggl_entry_ids": [...]}, and that the identity fields survive."""
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"bill_rates": {}, "hold_reasons": {}}

    def _fake_post(url, headers=None, json=None, timeout=None):
        captured["json"] = json
        return _Resp()

    monkeypatch.setattr(httpx, "post", _fake_post)

    back_office_client.get_bill_rates([_entry("5001", user_id=9001, project_id=408, task_id=77001)])

    assert "entries" in captured["json"]
    assert "toggl_entry_ids" not in captured["json"]
    sent = captured["json"]["entries"][0]
    assert sent["toggl_entry_id"] == "5001"
    assert sent["toggl_user_id"] == 9001
    assert sent["toggl_project_id"] == 408
    assert sent["toggl_task_id"] == 77001
    assert sent["is_billable"] is True


def test_http_error_returns_empty_maps(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    def _raise(*a, **k):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", _raise)
    assert back_office_client.get_bill_rates([_entry("1")]) == ({}, {})


def test_bad_json_returns_empty_maps(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            raise ValueError("not json")

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    assert back_office_client.get_bill_rates([_entry("1")]) == ({}, {})
