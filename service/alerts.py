"""Best-effort Discord alerting for sync job outcomes -- posts to PLT's
#ops channel (docker-compose.yml mounts ~/secrets/discord_ops_webhook.txt,
the same webhook plt-core and gusto-ynab-sync already use). Alerting must
never break the sync path it reports on: every call swallows its own
errors and no-ops if the webhook isn't mounted, matching this service's
existing best-effort pattern (back_office_client._send_pushover).
"""
import json
import logging
import os
import urllib.request

SECRETS_DIR = os.environ.get("SECRETS_DIR", "/run/secrets")
logger = logging.getLogger("timesync.alerts")


def _read_secret(filename):
    try:
        with open(os.path.join(SECRETS_DIR, filename)) as f:
            return f.read().strip()
    except OSError:
        return ""


def discord_alert(title, message):
    webhook_url = _read_secret("discord_ops_webhook.txt")
    if not webhook_url:
        return
    body = json.dumps({"content": f"**{title}**\n```\n{message}\n```"}).encode()
    try:
        req = urllib.request.Request(
            webhook_url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as exc:  # noqa: BLE001 -- alerting is best-effort
        logger.warning("Discord alert failed: %s", exc)
