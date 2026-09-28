"""back_office_client.get_bill_rates -- degrades to {} on any failure
(missing creds, network error, bad response) rather than aborting the sync,
since an unresolved rate already means "hold that entry," not "crash the
run." Network calls are mocked; nothing here talks to a real Back Office.
"""
import httpx

import back_office_client


def test_empty_input_short_circuits_with_no_network_call(monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("should not be called for an empty id list")

    monkeypatch.setattr(httpx, "post", _boom)
    assert back_office_client.get_bill_rates([]) == {}


def test_missing_credentials_returns_empty_map(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "")
    assert back_office_client.get_bill_rates(["1"]) == {}


def test_successful_response_returns_bill_rates(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"bill_rates": {"1": 20.0, "2": 0, "3": None}}

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())

    assert back_office_client.get_bill_rates(["1", "2", "3"]) == {"1": 20.0, "2": 0, "3": None}


def test_http_error_returns_empty_map(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    def _raise(*a, **k):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", _raise)
    assert back_office_client.get_bill_rates(["1"]) == {}


def test_bad_json_returns_empty_map(monkeypatch):
    monkeypatch.setattr(back_office_client, "_read_secret", lambda *a, **k: "x")

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            raise ValueError("not json")

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    assert back_office_client.get_bill_rates(["1"]) == {}
