"""FastAPI entrypoint (Phase 3 / R1). Serves both the web UI (static files,
unchanged from the GitHub Pages version -- its asset paths are already
relative) and the API, at the same origin, behind Cloudflare Access.
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
# Starlette's base HTTPException, NOT fastapi.exceptions.HTTPException -- in
# this FastAPI/Starlette version they are DIFFERENT classes (fastapi's is a
# subclass). StaticFiles' internal 404 raises the Starlette one directly;
# registering the handler on fastapi's class silently never catches it
# (confirmed live: verified via python -c that the two are not `is`-identical,
# then that fastapi's IS an issubclass of this one -- so registering here
# catches both auth.py's fastapi.HTTPException(401/403) AND StaticFiles' own
# starlette.HTTPException(404), since Starlette's ExceptionMiddleware
# dispatches by isinstance, not exact type).
from starlette.exceptions import HTTPException

from auth import require_access
from db import init_db
from routes import router as api_router
from sync_engine import mark_orphaned_jobs_failed

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    mark_orphaned_jobs_failed()  # a job left 'running' means the previous instance died mid-sync
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    # No CF Access dependency -- this is hit directly on localhost by
    # Docker's healthcheck and Stage Manager's auto-heal probe, neither of
    # which traverses Cloudflare.
    return {"status": "ok"}


# CF Access verification applied here, once, ahead of every /api/* route --
# not per-route -- so routes.py's dispatch logic stays a direct mirror of
# handleApiRequest without the auth concern mixed in.
app.include_router(api_router, dependencies=[Depends(require_access)])


@app.exception_handler(HTTPException)
async def api_exception_handler(request: Request, exc: HTTPException):
    """Catches EVERY HTTPException raised anywhere in the app -- crucially
    including auth.require_access's 401/403/500 (a Depends() failure never
    reaches routes.py's own _error()/_resp() envelope). FastAPI's default
    handler returns {"detail": ...}; web/js/api.js's _parse() only checks
    `data.status >= 400` to detect an error, so an un-normalized auth
    failure was silently treated as a SUCCESSFUL response and crashed the
    dashboard trying to read fields off it (caught live via a real browser
    render check, not just curl/TestClient status-code checks — the bug
    only shows up once something actually tries to read the body).

    For /api/* this returns the same {status, error} envelope routes.py
    uses everywhere else. For everything else (a bad static path), a 404
    falls through to index.html so client-side navigation survives a hard
    reload on a deep link; any other non-API HTTPException is returned as
    the plain status/detail it actually is.
    """
    if request.url.path.startswith("/api"):
        return JSONResponse(content={"status": exc.status_code, "error": exc.detail}, status_code=exc.status_code)
    if exc.status_code == 404:
        return FileResponse(WEB_DIR / "index.html")
    return JSONResponse(content={"detail": exc.detail}, status_code=exc.status_code)


app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
