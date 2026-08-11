# TimeSync (Toggl-Quickbooks)

Google Apps Script system that syncs time entries from Toggl Track to QuickBooks Online as TimeActivity records, using a tag-based approval workflow. Includes a standalone web UI at timesync.pltheatrical.com.

## ARCHITECTURE

- **Runtime**: Google Apps Script (bound to a Google Sheet)
- **APIs**: Toggl Track API v9, QuickBooks Online REST API via OAuth 2.0
- **Web UI**: Static HTML/CSS/JS site deployed via GitHub Pages
- **Source control**: GitHub (PLupo2/Toggl-Quickbooks), clasp mirror for Apps Script deployment
- **CI**: GitHub Actions workflows for Pages deployment

## KEY FILES

```
(root — Apps Script files, clasp rootDir)
  Auth.gs           — OAuth 2.0 flow for QuickBooks Online
  Config.gs         — Configuration and script properties
  Mappings.gs       — Entity mapping logic (Toggl ↔ QBO)
  Menu.gs           — Google Sheets custom menu
  QuickBooks.gs     — QBO API client
  Toggl.gs          — Toggl Track API client
  WebAPI.gs         — Web app endpoint (doGet/doPost for OAuth callback)
  appsscript.json   — Apps Script manifest (webapp deployment)
web/
  index.html        — Web UI entry point
  css/styles.css    — Stylesheet
  js/
    api.js          — API client, talks to /api/* (Cloudflare Worker proxy, Phase 2)
    app.js          — Main application logic
  favicon.svg       — Site icon
  logo.svg          — PLT logo
  CNAME             — GitHub Pages custom domain (timesync.pltheatrical.com)
docs/
  DEPLOYMENT.md     — Deployment guide
  OAUTH_SETUP.md    — OAuth configuration steps
  TEST_CASES.md     — Manual test scenarios
worker/
  src/index.js      — Cloudflare Worker: proxies /api/*, injects server-side secrets (Phase 2)
  wrangler.toml     — Worker config + route binding
  README.md         — Deploy steps, prerequisites
.github/workflows/
  deploy-pages.yml  — GitHub Pages deployment
  static.yml        — Static site checks
```

## DATA FLOW

```
Toggl Track (tag "Approved") → Google Sheets (sync) → QuickBooks Online
                              ↓
              Toggl Track (auto-adds "Synced" tag)
```

## BUILD AND DEPLOY

```bash
# Pull current Apps Script state
clasp pull

# After editing .gs files locally
clasp push

# Web UI changes don't need clasp — just git push, GitHub Actions deploys to Pages
git add -A && git commit -m "description" && git push
```

## KEY CONCEPTS

- **Tag-based workflow**: "Approved" tag in Toggl → sync to QBO → "Synced" tag added back
- **Entity mapping**: Toggl users→QBO employees, Toggl clients→QBO customers, Toggl projects→QBO sub-customers, Toggl tasks→QBO service items
- **Sub-customers as projects**: Uses QBO sub-customers to avoid $300/mo Projects API tier
- **Deduplication**: "Synced" tag prevents double-sync
- **Web UI**: Standalone dashboard at timesync.pltheatrical.com, communicates with Apps Script web app endpoint

## WEB API KEY / AUTH (Phase 2 — Cloudflare Access migration)

**History:** `WEB_API_KEY` used to be a static bearer token embedded directly in `web/js/gate.js`, a public file in a public repo, shipped to any browser that loaded the site — a UX gate, never a real security boundary. On 2026-07-13 this was caught (client JS could trigger real QBO writes) and emergency-patched: `syncApproved`/`updateMapping` returned HTTP 410, forced to the Sheet menu only (commit `2626c24`). That patch broke the dashboard's core workflow by design — it was never meant to be the end state. See spec doc Phase 2 + erratum for the full design record.

**Current (Phase 2) design — deployed and live:**

```
Browser → Cloudflare Access (@pltheatrical.com email OTP, gates the whole zone)
        → Cloudflare Worker (worker/src/index.js, holds secrets server-side)
        → Apps Script WebAPI.gs (validates origin_secret + api_key, ANYONE_ANONYMOUS but fails closed)
```

- The browser holds **no secret at all** — only a Cloudflare Access session cookie. `gate.js` is deleted; `api.js` calls a fixed relative `/api` path.
- The Worker injects `api_key` (`WEB_API_KEY`) and `origin_secret` (`WORKER_SECRET`) from its own env vars on every proxied request. Neither value is ever sent to the browser.
- **Important deviation from a literal reading of the spec:** Apps Script's `doGet`/`doPost` event object has no way to read arbitrary HTTP headers (no `e.headers`). The spec describes an `X-PLT-Origin` *header* — that can't work on this runtime. `origin_secret` is instead a normal request parameter, validated in `WebAPI.gs::validateOrigin()` against a `WORKER_SECRET` Script Property. Same property (secret lives only in Worker env + Script Properties, never in browser JS) — different wire format, because the header transport doesn't exist here.
- `validateOrigin` is checked **before** `validateApiKey` and fails closed if `WORKER_SECRET` is unset — this is what makes it safe for the Apps Script deployment to stay `ANYONE_ANONYMOUS`: a direct hit that skips the Worker (and therefore skips Access) has no way to produce `origin_secret`.
- `syncApproved` and `updateMapping` are restored to full function — reaching them now requires passing through Access + the Worker, not just knowing a static string.

**Deployment status (2026-08-05):** Fully deployed and live. DNS is proxied, Cloudflare Access gates the zone (confirmed via live 302 to `pltheatrical.cloudflareaccess.com` on both `/` and `/api/*`), the Worker is deployed with `WORKER_SECRET`/`api_key` env vars, `WebAPI.gs` (with `validateOrigin`) is pushed, `WORKER_SECRET` Script Property is set, and `web/js/gate.js` has been deleted from the frontend. Post-cutover commits (`b659b43` onward: async sync, worker retry resilience, dashboard perf) confirm the system has been stable in production since.

**Cutover ordering matters:** deploying the new WebAPI.gs alone (before the Worker/Access/frontend are live) breaks the current dashboard completely — `validateOrigin` fails closed with no Worker to supply the secret. DNS proxy flip, Access app, Worker deploy + secrets, `WORKER_SECRET` Script Property, `clasp push`, and the frontend `git push` must land together in one sitting, not incrementally.

`plupo2.github.io` (GitHub Pages' own domain) remains directly reachable and bypasses Cloudflare Access entirely — documented and accepted, since post-Phase-2 the static frontend holds no secrets and its relative `/api/*` calls fail off-domain (no Worker routing there).

## TESTING

No automated tests. Manual test cases documented in docs/TEST_CASES.md.

## CONVENTIONS

- Apps Script files are at repo root (not in src/) — clasp rootDir is "."
- Web UI is a separate static site in web/ — deployed independently via GitHub Pages
- OAuth tokens stored in Script Properties
- The Apps Script project is deployed as a Web App (for OAuth callback + API endpoint)
- CNAME file maps to timesync.pltheatrical.com via GitHub Pages

## MODEL ROUTING

- L1 for config changes, menu items, CSS tweaks
- L2 for mapping logic, sync workflow, API client changes
- L3 for OAuth flow changes or web UI architecture changes
- Opus for changes touching both Apps Script and web UI simultaneously

TimeSync is actively used in production, so changes are deliberate and verified before deploy. THE MAC MINI IS THE PRIMARY AND ONLY DEVELOPMENT PATH for this repo, as it is for every other project. The MacBook is a LAST RESORT ONLY — use it solely when a task is physically impossible on the Mini (e.g. an Xcode iOS build). Earlier guidance naming the MacBook as the primary path for TimeSync was wrong and is removed (corrected 2026-08-07, Philip). clasp push from the Mac Mini is permitted. NOTE: clasp auth on the Mini currently fails with invalid_grant / invalid_rapt and needs an interactive `clasp login` from Philip before a push will succeed — that is a broken credential, not a policy restriction.

## CURRENT STATE

- Apps Script: clasp push deploys immediately — changes are live instantly
- Web UI: git push to main triggers GitHub Actions → GitHub Pages deployment
- OAuth callback URL must match the deployed Web App URL exactly
- Two environments: QBO Sandbox (testing) and QBO Production (live)


## SPEC DOC
- Doc ID: `1AKjumu4V-Kqqp3z4CBjyFiKiwm5iFGV_HJVBCxvjEuM` ("Toggl-QuickBooks Sync — Spec & Changelog"). Created 2026-03-16; Phase 2 (Cloudflare Access migration) + hosting erratum appended 2026-07-13.
- The "no dedicated spec doc" line that used to be here was itself stale (dated to the 2026-03-25 batch update, never corrected when this doc was created). The global project index row (`~/Projects/stage-manager/GLOBAL_CLAUDE.md`) needs the same correction — Stage Manager's registry `spec_doc_id` was committed (`f30997f`) but is inert until the daemon restarts, so the index table may still show `—` until then.

## KNOWN ISSUES
- **D2 cutover COMPLETE (2026-08-11).** Back Office is now the sole mapping source of truth. `buildMappingLookups()` reads from Back Office's `/api/mappings/all` (commit `5dee993`); the dashboard's own Mappings editor was retired (`4e30f0c`, nav now links to Back Office). All three former manual steps are done: the three `BACK_OFFICE_*` Script Properties are set, the D2 dry-run comparison ran clean, and "D2: Rename Old Mapping Tabs" retired the `Mappings_*` tabs to `ZZ_OLD_*`. The Production deployment was redeployed to pick up the new code — `clasp push` updates HEAD only, it does NOT re-pin the Production deployment, so a `clasp deploy -i <deployment-id>` was required for the web dashboard's sync path (now @30; rollback = same command with `--versionNumber 29`).
- **No production sync observed through the new path yet.** First live Toggl→QBO sync after cutover should have its QBO TimeActivity records spot-checked against Back Office mappings before treating the path as proven.
- **Decommission candidate (not blocking):** post-rename, `refreshTogglMappings()` and its Menu items (Refresh Toggl Mappings, Wire Dropdowns, Cleanup Orphaned Mappings, Apply Mapping Highlights) still target the old `Mappings_*` sheet names — running Refresh Toggl Mappings would recreate empty `Mappings_*` tabs nothing reads. `buildMappingLookupsFromSheets()` and `dryRunCompareMappingSources()` are now spent (they look sheets up by pre-rename names). Safe to leave; cleaner to remove.

- Status: Active (Apps Script project). Phase 2 (Cloudflare Access migration) deployed and live — see WEB API KEY / AUTH.
- QuickBooks/Toggl time sync via Google Apps Script
