"""back_office_client.get_preflight -- degrades to the same shape a clean
run returns (total_flagged=0, held_count=0) on any failure (missing creds,
network error, bad response), matching get_bill_rates' fail-open pattern.
routes._post_preflight_check passes this straight through, so a Back Office
outage must never block Sync Approved. Network calls are mocked; nothing
here talks to a real Back Office.
"""
import httpx

import back_office_client

DEFAULT_URL = "https://backoffice.pltheatrical.com/#/corrections?source=time-entry"
DEFAULT = {"total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": DEFAULT_URL}


def test_empty_input_short_circuits_with_no_network_call(monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("should not be called for an empty id list")

    monkeypatch.setattr(httpx, "post", _boom)
    assert back_office_client.get_preflight([]) == DEFAULT


def test_missing_credentials_returns_default(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "")
    assert back_office_client.get_preflight(["1"]) == DEFAULT


def test_successful_response_returns_preflight_data(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "total_flagged": 2,
                "by_reason": {"no_task": 2},
                "held_count": 1,
                "corrections_url": DEFAULT_URL,
            }

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())

    assert back_office_client.get_preflight(["1", "2"]) == {
        "total_flagged": 2,
        "by_reason": {"no_task": 2},
        "held_count": 1,
        "corrections_url": DEFAULT_URL,
    }


def test_http_error_returns_default(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    def _raise(*a, **k):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", _raise)
    assert back_office_client.get_preflight(["1"]) == DEFAULT


def test_bad_json_returns_default(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            raise ValueError("not json")

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    assert back_office_client.get_preflight(["1"]) == DEFAULT
