# TimeSync (Toggl-Quickbooks)

Syncs time entries from Toggl Track to QuickBooks Online as TimeActivity records, using a tag-based approval workflow. Web UI at timesync.pltheatrical.com.

**Two systems currently exist in this repo.** The Google Apps Script system below is LIVE — it is what's actually serving production traffic right now. A FastAPI replacement (`service/`) is mid-build under Phase 3 (see PHASE 3 section) and is NOT live — no cutover has happened, nothing about the live system has changed. Read this whole file before touching either.

## LIVE SYSTEM — Google Apps Script (serving production now)

### Architecture
- **Runtime**: Google Apps Script (bound to a Google Sheet)
- **APIs**: Toggl Track API v9, QuickBooks Online REST API via OAuth 2.0
- **Web UI**: Static HTML/CSS/JS deployed via GitHub Pages
- **Source control**: GitHub (PLupo2/Toggl-Quickbooks), clasp mirror for Apps Script deployment
- **CI**: GitHub Actions for Pages deployment

### Key files
```
(root — Apps Script files, clasp rootDir)
  Auth.gs           — OAuth 2.0 flow for QuickBooks Online
  Config.gs         — Configuration and script properties
  Mappings.gs       — Mapping lookup: single bulk GET from Back Office per run
                      (buildMappingLookups + abort handler). Post-D2 the
                      in-sheet mapping editor/refresh tooling was removed.
  Menu.gs           — Google Sheets custom menu
  QuickBooks.gs     — QBO API client
  Toggl.gs          — Toggl Track API client + sync engine
  WebAPI.gs         — Web app endpoint (doGet/doPost: OAuth callback + dashboard API)
  appsscript.json   — Apps Script manifest (webapp deployment)
web/
  index.html, css/styles.css, js/api.js, js/app.js, favicon.svg, logo.svg, CNAME
  (this directory is UNCHANGED and reused as-is by the Phase 3 FastAPI service — see below)
docs/
  DEPLOYMENT.md, OAUTH_SETUP.md, TEST_CASES.md
worker/
  src/index.js, wrangler.toml, README.md — Cloudflare Worker proxying /api/* (Phase 2)
```

### Data flow
```
Toggl Track (tag "Approved") → Google Sheets (sync) → QuickBooks Online
                              ↓
              Toggl Track (auto-adds "Synced" tag)
```

### Build and deploy
```bash
clasp pull   # pull current Apps Script state
clasp push   # after editing .gs files locally
# Web UI: git push triggers GitHub Actions → GitHub Pages (no clasp needed)
```
`clasp push` updates HEAD only — it does NOT re-pin the Production deployment (`AKfycbwSEAEDqOrmBvgKhhxvHTkNwbbvY9ss...`) that the Worker/dashboard call. `clasp deploy -i <deployment-id> -d "<desc>"` promotes HEAD to the web path. **Current Production: @33.** Rollback = same command with `--versionNumber <n>`. clasp auth: a plain `clasp login` reports "already logged in" off the stale `~/.clasprc.json` without re-testing — if pushes fail with `invalid_grant`/`invalid_rapt`, run `clasp logout` then `clasp login`, verify with `clasp versions`.

### Key concepts
- **Tag-based workflow**: "Approved" tag in Toggl → sync to QBO → "Synced" tag added back
- **Entity mapping**: Toggl users→QBO employees, clients→QBO customers, projects→QBO sub-customers, tasks→QBO service items — all sourced from Back Office (`backoffice.pltheatrical.com`), not in-sheet, since the D2 cutover
- **Sub-customers as projects**: avoids the $300/mo QBO Projects API tier
- **Deduplication**: `Sync_Log` is the sole idempotency authority (not the Toggl "Synced" tag, which is cosmetic/review-only)

### Web API key / auth (Phase 2 — Cloudflare Access)
```
Browser → Cloudflare Access (@pltheatrical.com email OTP, gates the whole zone)
        → Cloudflare Worker (worker/src/index.js, holds secrets server-side)
        → Apps Script WebAPI.gs (validates origin_secret + api_key, ANYONE_ANONYMOUS but fails closed)
```
Browser holds no secret — only an Access session cookie. Apps Script's `doGet`/`doPost` can't read arbitrary headers, so the Worker's `origin_secret` travels as a request param (`validateOrigin()` in WebAPI.gs), not a literal header, despite the original spec describing one. Fully deployed and live since 2026-08-05. `plupo2.github.io` (GitHub Pages' own domain) bypasses Access entirely — accepted, since the frontend holds no secrets and its relative `/api/*` calls fail off-domain there.

### Known issues (live system)
- **D2 cutover COMPLETE (2026-08-11).** Back Office is the sole mapping source of truth (`5dee993`); dashboard's own Mappings editor retired (`4e30f0c`, now a pointer card to Back Office). `Mappings_*` sheet tabs renamed to `ZZ_OLD_*`.
- **Dead-code cleanup DONE (2026-08-11, `35e251e`).** ~1,677 lines of superseded in-sheet mapping tooling removed. Mappings.gs 1611→126 lines.
- **Toggl task names + live sync progress + Settings Save fix** — all shipped 2026-08-11 (`b2c2dd2`, Settings fix same day). Details in spec doc changelog.
- **Transient "Upstream returned non-JSON (HTTP 404)" — expected, mitigated (2026-08-12, `36ebd71`).** Apps Script's `/exec` intermittently 302-redirects to a stale `googleusercontent.com` URL. NOT an outage; verify with `curl -sL "<APPS_SCRIPT_URL>?action=getConfig"` → JSON 401 = healthy. **This exact failure mode is the reason Phase 3 exists** — see below.
- **First production sync verified (2026-08-11, date 08/06).** 19 TimeActivity records cross-checked clean against Back Office + Toggl.

## PHASE 3 — Backend cutover to FastAPI on the Mac Mini (IN PROGRESS, NOT LIVE)

**Motivation:** a 2026-08-12 root-cause diagnosis (spec doc) measured Apps Script's `/exec → googleusercontent.com` serving layer at ~29% first-attempt failure / ~10% hard-fail on dashboard reads, with multi-minute dead windows. Four prior mitigation rounds narrowed but could not fix it. Philip approved a full migration off Apps Script rather than a fifth mitigation (2026-08-12, rulings R1–R5, spec doc).

**Target:** one FastAPI service in Docker (container `timesync`, port 5175) serving both the web UI and API at `timesync.pltheatrical.com`, behind the same (already-existing, hostname-scoped) Cloudflare Access app. `timesync.db` (SQLite) replaces the Google Sheet for `Sync_Log` + `Config`. QBO/Toggl tokens vend from PLT Core. Sandbox toggle retired (Core vends production only). Full rulings/scope/acceptance: Phase 3 entry in the spec doc.

**Status: Phases 3.1–3.4 of 7 complete and verified. Phase 3.5 (cutover) is next, not yet started — this is the big-bang DNS/Worker-route/tunnel step. Nothing has been cut over yet — the Apps Script/Worker/Pages system above is still what's live.**

- ✅ **3.1 Prerequisites**: PLT Core service key issued (`timesync`, scopes `token:qbo`+`token:toggl`, id 40) → `~/secrets/plt_core_timesync_api_key.txt`. CF Access AUD written → `~/secrets/cf_access_timesync_aud.txt`. Both verified live.
- ✅ **3.2 Build**: Full service built at `service/` (11 Python files) + `Dockerfile` + `docker-compose.yml`. Real port-scope audit found most of QuickBooks.gs and large parts of Toggl.gs are dead code with zero reachability — not ported. All 3,200 `Sync_Log` rows imported into `timesync.db` (a real Sheets date/duration serialization bug was caught and correctly reverse-engineered before trusting the import — verified against known QBO ground truth). Every module verified against real live data during the build, not fakes. **Found and fixed mid-build**: routes were initially built as per-resource REST paths before realizing the actual frontend always calls one `/api` endpoint with an `action` field — rewritten to match. Real Docker image built and run; healthy, all 11 actions HTTP-verified.
- ✅ **3.3 Local verification**: real Playwright browser render check (not just curl/TestClient) across all 5 pages. Caught a real bug TestClient testing missed: an exception-handler class mismatch (`fastapi.exceptions.HTTPException` vs `starlette.exceptions.HTTPException` — different classes in the installed version) meant auth failures returned an unnormalized body and crashed the dashboard instead of showing a clean error. Fixed and re-verified.
- ✅ **3.4 Internal parity gate**: (a) `service/parity_check.py` diffed all comparable read actions old-vs-new. Found and fixed two real gaps the 3.2 import missed — Phase 3.2 imported `Sync_Log` history but never the live Config sheet's actual *values*: `TOGGL_API_BUDGET` (live=220, was defaulted 180) and `DEFAULT_SERVICE_ITEM_ID`/`NAME` (live=`1`/`Services`, was blank — functionally significant, the fallback for untasked entries). A third diff (explicit `START_DATE`/`END_DATE` on the live sheet) was confirmed by Philip to be a stale leftover, correctly left unimported. (b) Ran a real `syncApproved` against the new service for the first time — 13 entries (everything approved-and-unsynced in the last 2 weeks). Pre-verified resolution for all 13 before writing. Completed in 28s: 13 synced, 0 failed, 496 already-synced. Independently verified in QBO **by canonical ID** (not name-fuzzy-matching, which gave a false alarm on differently-worded-but-correct item names on the first attempt — caught and redone properly): all 13 exact matches. Confirmed the Toggl-side `Synced` tag landed on all 13 source entries too.
- ⏭️ **3.5 Cutover (next, big-bang)**: add tunnel ingress rule for `timesync.pltheatrical.com` → `localhost:5175` in `~/.cloudflared/config.yml` (absent today), reload via `sudo launchctl kickstart -k system/com.cloudflare.cloudflared` (a different daemon than Stage Manager, safe to restart); final `Sync_Log` delta import; DNS repoint off GitHub Pages to the tunnel **in the same change** as deleting Worker route `ea86f3edffce491cbbdc02a67c6576a1` (`timesync.pltheatrical.com/api*` → `timesync-api-proxy`) — the route must go in the same change as the DNS flip or it keeps intercepting `/api*`; Philip click-through sign-off immediately post-flip.
- ⬜ 3.6 rollback lever armed → 3.7 two-week dormancy then demolition of the Apps Script/Worker/Pages system.

**Full narrative handoff** (what was done, exact commands/commits, what remains, blockers): `~/Projects/stage-manager/state/timesync-handoff.json` — written 2026-08-12 specifically so a Stage Manager daemon restart can't lose continuity on this build. Read it before resuming Phase 3 work in a new session.

**Service architecture reference** (`service/`):
```
app.py              — FastAPI entrypoint; mounts web/ static, registers routes, /health unauthenticated
auth.py             — Cloudflare Access JWT verification (ported from Back Office's pattern)
core_client.py      — QBO + Toggl token vending from PLT Core
db.py               — SQLite schema: settings, sync_log, sync_job, disagreement_snapshot, connection_status_cache
back_office_client.py — mapping fetch (ported from Mappings.gs)
toggl_client.py     — Toggl API v9 + Reports v3 client (ported from Toggl.gs)
qbo_client.py       — qboRequest + createTimeActivity only (ported from QuickBooks.gs — the rest was dead)
sync_engine.py      — sync logic + D1-D4 idempotency guard + D5 async job. R4 simplification: the Apps
                      Script trigger-relaunch pause/resume machinery is replaced by an in-process wait in
                      a background thread (a native process has no execution-time ceiling to work around)
routes.py           — all 11 actions behind a SINGLE /api endpoint (action as GET param / POST body field),
                      mirroring handleApiRequest's dispatch, NOT per-resource REST paths
scheduler.py        — built, deliberately NOT wired into app.py — inert until Phase 3's scheduler is enabled
import_sync_log.py  — one-time Sheet-export → timesync.db import (already run for the initial 3,200 rows)
```
Container: `docker-compose up -d --build` from the repo root. `./data/timesync.db` and `~/secrets/*` are mounted, both gitignored (real business data / credentials, never committed). Currently reachable only at `localhost:5175` — not yet behind Cloudflare, not yet publicly routable.

## SPEC DOC
- Doc ID: `1AKjumu4V-Kqqp3z4CBjyFiKiwm5iFGV_HJVBCxvjEuM` ("Toggl-QuickBooks Sync — Spec & Changelog"). Phase 2 (2026-07-13), D2 cutover + cleanup (2026-08-11), root-cause diagnosis + Phase 3 approval (2026-08-12) all recorded there.

## CONVENTIONS
- Apps Script files at repo root (clasp rootDir `.`); Phase 3 service code under `service/`; both currently coexist
- `web/` is shared, unchanged, between both systems
- THE MAC MINI IS THE PRIMARY AND ONLY DEVELOPMENT PATH for this repo. MacBook is last resort only (physically-impossible-elsewhere tasks).
- TimeSync is actively used in production (real payroll-adjacent QBO writes) — changes are deliberate and verified before deploy. Phase 3 build discipline: verify every module against real live data, do a real browser check before trusting API-level tests alone, stop for explicit review at every phase boundary.

## MODEL ROUTING
- L1 for config changes, menu items, CSS tweaks
- L2 for mapping logic, sync workflow, API client changes
- L3 for OAuth flow changes, web UI architecture changes, or Phase 3 service work
- Opus for changes touching both Apps Script and web UI simultaneously, or any Phase 3 cutover step
