"""Cloudflare Access verification (Phase 3 / R1).

Replaces the old two-layer Apps Script scheme (validateOrigin's WORKER_SECRET
+ validateApiKey's WEB_API_KEY) entirely. Under Phase 3 there is no Worker in
front injecting a shared secret -- Cloudflare Access gates
timesync.pltheatrical.com directly (its existing Access app is
hostname-scoped, confirmed unaffected by the origin change), and this is the
service's own belt-and-suspenders check that the request actually came
through Access, matching what the Worker used to do at the edge. A human OTP
session and the existing "TimeSync API Service Token" bypass BOTH produce a
valid Cf-Access-Jwt-Assertion once Access mediates the request, so one check
covers both paths -- no separate machine-auth branch needed.

Pattern ported directly from back-office/auth.py (JWT verified against
Cloudflare's JWKS, audience-scoped to this app's own AUD).
"""
import os

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

SECRETS_DIR = os.environ.get("SECRETS_DIR", "/run/secrets")
CF_ACCESS_TEAM_DOMAIN = os.environ.get("CF_ACCESS_TEAM_DOMAIN", "pltheatrical.cloudflareaccess.com")


def _read_aud():
    try:
        with open(os.path.join(SECRETS_DIR, "cf_access_timesync_aud.txt")) as f:
            return f.read().strip()
    except OSError:
        return ""


CF_ACCESS_TIMESYNC_AUD = _read_aud()
_JWKS_URL = f"https://{CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs"
_ISSUER = f"https://{CF_ACCESS_TEAM_DOMAIN}"
_jwk_client = None


def _client():
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(_JWKS_URL, cache_keys=True, lifespan=3600)
    return _jwk_client


def _extract_token(request: Request) -> str:
    token = request.headers.get("Cf-Access-Jwt-Assertion")
    if not token:
        token = request.cookies.get("CF_Authorization")
    if not token:
        raise HTTPException(status_code=401, detail="No Cloudflare Access assertion — request did not come through Access.")
    return token


def require_access(request: Request) -> str:
    """FastAPI dependency: verifies the CF Access JWT, returns the caller's
    email (or 'service-token' for a machine caller, which carries no email
    claim). Fails closed if the AUD isn't configured."""
    if not CF_ACCESS_TIMESYNC_AUD:
        raise HTTPException(status_code=500, detail="CF Access AUD not configured; refusing to serve gated routes.")

    token = _extract_token(request)
    try:
        signing_key = _client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token, signing_key.key, algorithms=["RS256"],
            audience=CF_ACCESS_TIMESYNC_AUD, issuer=_ISSUER,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=403, detail=f"Invalid Access token: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Cannot verify Access token") from exc

    return (claims.get("email") or "service-token").lower()
