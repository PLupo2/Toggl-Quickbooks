# Phase 2 Cutover Checklist — Cloudflare Access Migration

Spec: doc `1AKjumu4V-Kqqp3z4CBjyFiKiwm5iFGV_HJVBCxvjEuM`, Phase 2 + erratum sections.

**Read this whole checklist before starting any step.** The steps below must
land together, in one sitting, in the order given. Deploying WebAPI.gs
(step 6) before the Cloudflare side (steps 1–4) is live is a self-inflicted
outage: `validateOrigin()` fails closed with no Worker in front to supply
`origin_secret`, so every dashboard call — reads included — starts failing
the moment that deploy goes out. There is no partial-credit ordering here.

All code referenced below is already written and committed in this repo,
just not deployed:
- `WebAPI.gs` — 410s reverted, `validateOrigin()` added (commit pending, staged)
- `worker/src/index.js`, `worker/wrangler.toml` — new
- `web/js/api.js`, `web/js/app.js`, `web/index.html` — gate.js removed, relative `/api` client
- `web/js/gate.js`, `web/netlify.toml` — deleted

---

## Prerequisites (do these first, before touching anything live)

- [ ] **Token selection — no new token needed.** Verified 2026-08-04: three existing tokens in `~/secrets/` cover all three API surfaces. Use the right one per step; do NOT create a combined token (wider blast radius than the job requires).

  | Step | Task | Token file |
  |------|------|-----------|
  | 1 | DNS proxy flip | `cloudflare_api_token.txt` |
  | 2 | Access application | `cloudflare_access_token.txt` |
  | 3 | Worker deploy + secrets | `cloudflare_workers_token.txt` |

  Verified by API probe (200 = allowed, 403 = blocked):
  - `cloudflare_api_token.txt` — DNS 200, Access 403, Workers 403
  - `cloudflare_access_token.txt` — Access 200, DNS 403, Workers 403
  - `cloudflare_workers_token.txt` — Workers 200, Access 403, DNS 403
  - `cloudflare_wrangler_token.txt` — duplicate of workers token; ignore

  Account ID `3a90eb4c3c67a40a1c4432b4dffc774d` · Zone ID `f8560ea50c7d4be88bc51ebfd022c1ea`
- [ ] For step 3, export the Workers token rather than `wrangler login`:
  ```bash
  export CLOUDFLARE_API_TOKEN=$(cat ~/secrets/cloudflare_workers_token.txt)
  ```
  wrangler is not installed locally; `npx` pulls it on demand.
- [ ] Generate `WORKER_SECRET`:
  ```bash
  python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))"
  ```
  Write it down — you need it in two places (step 3 and step 5).
- [ ] **Git hygiene before any push (added 2026-08-04).** The Mac Mini repo is ahead 2 / behind 1 vs `origin/main` — remote has Philip's `.claspignore` commit (`8e86cb2`), local has `4fc4923` (Phase 2) + `1415162` (gitleaks config). Rebase before step 7: `git pull --rebase origin main`. No conflict expected (disjoint files).
- [ ] **Delete `.github/workflows/static.yml` and include it in the step 7 push.** It caused the 2026-08-04 root-404 outage: it deploys the whole repo (`path: '.'`) with no path filter, racing `deploy-pages.yml` on every push. Disabled manually via `gh workflow disable static.yml` on 2026-08-04, but the file should go. If it is ever re-enabled, it will republish repo source (CLAUDE.md, .gs files, docs/) at the domain root.

## Step 1 — DNS: flip `timesync.pltheatrical.com` to proxied

Currently `proxied: false` (plain CNAME to `plupo2.github.io`). Cloudflare Access and Worker routes only apply to proxied (orange-cloud) traffic.

- [ ] Cloudflare dashboard → DNS → `timesync.pltheatrical.com` → toggle proxy status on.
- [ ] Confirm SSL/TLS mode is **Full** (not Flexible, not Full Strict unless GitHub Pages' cert is verified compatible) so the GitHub Pages origin cert doesn't cause a handshake failure through the proxy.
- [ ] Load `https://timesync.pltheatrical.com` in a browser — should still resolve to the current (old) dashboard at this point. No Access prompt yet — that's step 2.

## Step 2 — Cloudflare Access application

- [ ] Zero Trust dashboard → Access → Applications → Add an application → Self-hosted.
- [ ] Name: `TimeSync`. Domain: `timesync.pltheatrical.com`.
- [ ] Policy: Allow, Include → email domain → `pltheatrical.com`.
- [ ] Session duration: 24 hours (low-risk read/write tool, per spec).
- [ ] Save. Reload `https://timesync.pltheatrical.com` — you should now get an Access email-OTP prompt. **The dashboard behind it is still the OLD gate.js version at this point** — that's expected, don't be alarmed that it still shows the password screen after the OTP. Frontend cutover is step 7.

## Step 3 — Cloudflare Worker

```bash
cd worker
npx wrangler secret put WEB_API_KEY
# paste: ol9rg7rlTCb4HpHCQJOxQ0JuVsyv5wwT
npx wrangler secret put WORKER_SECRET
# paste the value you generated in Prerequisites
npx wrangler deploy
```

- [ ] Confirm deploy succeeded and the route `timesync.pltheatrical.com/api/*` shows in the Worker's triggers.
- [ ] Do NOT test `/api/*` yet — Apps Script doesn't know about `WORKER_SECRET` until step 5, so every call will 401 until then. That's expected.

## Step 4 — MacBook: pull latest and clasp push

- [ ] `git pull` on the MacBook to get the staged `WebAPI.gs`, `worker/`, and frontend changes from this session.
- [ ] Review `WebAPI.gs` diff once more before pushing — this reopens `syncApproved`/`updateMapping`, gated by `validateOrigin`.
- [ ] `clasp push`.
- [ ] Apps Script editor → Deploy → Manage deployments → select the existing deployment (do **not** create a new one — the URL must stay the same, the Worker forwards to it by exact URL) → New version → Deploy.

## Step 5 — Script Properties

- [ ] Apps Script editor → Project Settings → Script Properties.
- [ ] Add `WORKER_SECRET` = the same value you put in `wrangler secret put WORKER_SECRET` (step 3). Must match exactly or every request fails.
- [ ] Confirm `WEB_API_KEY` is still `ol9rg7rlTCb4HpHCQJOxQ0JuVsyv5wwT` (should already be set from the earlier emergency fix).

## Step 6 — Verify the API path end-to-end before touching the frontend

- [ ] From a browser already past the Access OTP, open dev tools and manually hit `https://timesync.pltheatrical.com/api?action=getDashboard` — should return real dashboard JSON, not a 401.
- [ ] Confirm a direct hit to the Apps Script `/exec` URL (bypassing the Worker) is rejected — `origin_secret` will be missing, `validateOrigin` should fail closed with 401. This is the actual security property Phase 2 buys; confirm it before declaring done.

## Step 7 — Ship the frontend

- [ ] `git push` (already committed locally, per this session) — GitHub Actions redeploys Pages with `gate.js` removed and `api.js` pointed at relative `/api`.
- [ ] Reload `https://timesync.pltheatrical.com` — should go: Access OTP → dashboard loads directly, no password prompt, no setup screen.
- [ ] Confirm "Sync Now" and the mapping editor's dropdowns work (writes restored).
- [ ] Confirm "Sign out" (replaces the old Lock/Disconnect buttons) hits `/cdn-cgi/access/logout` and re-prompts for Access OTP on reload.

## Step 8 — Confirm the bypass is understood, not a bug

- [ ] Load `https://plupo2.github.io/Toggl-Quickbooks/` (or whatever the raw Pages URL is) directly. It will load — GitHub Pages' own domain isn't behind Cloudflare and never will be. Confirm its `/api/*` calls fail (relative path resolves to `plupo2.github.io/api/...`, which doesn't exist) rather than silently working. This is the documented, accepted gap from the erratum — the static frontend holds no secrets, so this bypass has no write capability, only a broken read-only page.

## Step 9 — Confirm Sheet menu is unaffected

- [ ] From the Google Sheet, run **Toggl-QBO Sync → Sync Operations → Sync Approved Entries**. Should work exactly as before — this path never touches `WebAPI.gs`.

## Rollback

If step 6 or 7 fails and you need the dashboard back immediately: Access application can be paused/deleted (traffic falls back to Access-free proxied GitHub Pages, still not the OLD dashboard behavior since `WebAPI.gs` already requires `origin_secret`). Faster rollback: revert the Apps Script deployment to the previous version (Deploy → Manage deployments → select prior version) — this restores the emergency-fix behavior (410s, no `validateOrigin` requirement) instantly without touching Cloudflare at all.
