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


@app.exception_handler(404)
async def spa_fallback(request: Request, exc):
    # Anything under /api that isn't a real route is a real 404 (matches
    # handleApiRequest's own "Unknown action" contract for malformed calls
    # that don't even reach dispatch, e.g. a typoed path). Everything else
    # falls through to index.html so client-side navigation isn't broken by
    # a hard reload on a deep link.
    if request.url.path.startswith("/api"):
        return JSONResponse(content={"status": 404, "error": "Not found"}, status_code=404)
    return FileResponse(WEB_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
