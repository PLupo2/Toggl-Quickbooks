"""alerts.discord_alert -- Discord's Cloudflare blocks urllib's default
User-Agent (verified 2026-11-18: a webhook GET with the default UA gets
403/1010, with "DiscordBot (https://pltheatrical.com, 1.0)" it gets 200).
urlopen is mocked; nothing here posts to a real webhook.
"""
import urllib.request

import alerts


def test_sends_discordbot_user_agent(monkeypatch):
    monkeypatch.setattr(alerts, "_read_secret", lambda *a, **k: "https://discord.example/webhook")
    captured = {}

    def _fake_urlopen(req, timeout=None):
        captured["req"] = req

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    alerts.discord_alert("Title", "message")

    # urllib.request.Request stores header keys via str.capitalize(), and
    # get_header() does a bare dict lookup with no normalization -- "User-Agent"
    # is stored (and must be looked up) as "User-agent".
    assert captured["req"].get_header("User-agent") == "DiscordBot (https://pltheatrical.com, 1.0)"


def test_missing_webhook_short_circuits_with_no_request(monkeypatch):
    monkeypatch.setattr(alerts, "_read_secret", lambda *a, **k: "")

    def _boom(*a, **k):
        raise AssertionError("should not be called when no webhook is configured")

    monkeypatch.setattr(urllib.request, "urlopen", _boom)

    alerts.discord_alert("Title", "message")  # must not raise


def test_urlopen_failure_is_swallowed(monkeypatch):
    monkeypatch.setattr(alerts, "_read_secret", lambda *a, **k: "https://discord.example/webhook")

    def _raise(req, timeout=None):
        raise OSError("403")

    monkeypatch.setattr(urllib.request, "urlopen", _raise)

    alerts.discord_alert("Title", "message")  # must not raise -- best-effort
