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
    api.js          — API client for Apps Script web app
    app.js          — Main application logic
    gate.js         — Auth gate / access control
  favicon.svg       — Site icon
  logo.svg          — PLT logo
  CNAME             — GitHub Pages custom domain (timesync.pltheatrical.com)
  netlify.toml      — Netlify config (may be legacy)
docs/
  DEPLOYMENT.md     — Deployment guide
  OAUTH_SETUP.md    — OAuth configuration steps
  TEST_CASES.md     — Manual test scenarios
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

## WEB API KEY

`WEB_API_KEY` (Script Property, checked in `WebAPI.gs::validateApiKey`) is a **UX gate for the read-only dashboard, not a security boundary.** It — and the webapp URL — live in `web/js/gate.js`, a public static file in a public repo, served to any browser that loads timesync.pltheatrical.com. Client-side code cannot hold a real secret; treat this key as public by design, not as a leak.

Because of that, `syncApproved` (writes real QBO TimeActivity records) and `updateMapping` (arbitrary single-cell write to any mapping sheet) are **not** reachable via the web API — they return HTTP 410 if requested. Both actions live only on the bound Sheet's `Toggl-QBO Sync` menu, which is gated by real Google account access. The dashboard's "Sync Now" button and inline mapping editor point users there instead of calling the API.

Everything else on `handleApiRequest` (dashboard reads, mapping reads, config reads, `previewApproved`, the bulk refresh actions, `setConfig`) stays behind the static key — low-consequence if the key is read by someone outside the org, since none of it mutates QBO state or performs unvalidated writes.

Plan (not yet live, 2026-07-13): front `timesync.pltheatrical.com` with Cloudflare Access (email OTP) as a real auth boundary on the dashboard page itself, matching PLT Core's `/admin`. Blocked on two things: the DNS record is currently unproxied (`proxied: false`, plain CNAME to `plupo2.github.io`) so Cloudflare can't apply Access to it yet, and the `~/secrets/cloudflare_api_token.txt` token lacks Access API scope. Once live, Access gates page load only — it does not gate the Apps Script endpoint itself, which stays `ANYONE_ANONYMOUS` and reachable directly by anyone holding the (public) key and URL. If a future feature needs a real write surface on the web API, it needs real per-caller auth (e.g. routed through PLT Core), not this key.

Rotating the key: update `API_KEY` in `web/js/gate.js` AND the `WEB_API_KEY` Script Property together — they must match or the dashboard breaks. Do this as part of the same `clasp push` + `git push` that ships any related code change; a stale rotation looks like an outage, not a security fix.

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

TimeSync is actively used in production. Until Phase 1.5.4 (cutover validation) is complete, this repo on the Mac Mini is a clone — the MacBook Claude Code workflow remains the primary development path. Do not clasp push from the Mac Mini until cutover is explicitly authorized.

## CURRENT STATE

- Apps Script: clasp push deploys immediately — changes are live instantly
- Web UI: git push to main triggers GitHub Actions → GitHub Pages deployment
- OAuth callback URL must match the deployed Web App URL exactly
- Two environments: QBO Sandbox (testing) and QBO Production (live)


## SPEC DOC
- No dedicated spec doc. Architecture documented in this CLAUDE.md.

## KNOWN ISSUES
- None currently tracked.

## CURRENT STATE
- Status: Active (Apps Script project)
- QuickBooks/Toggl time sync via Google Apps Script
