# TimeSync API Proxy Worker

Phase 2 (Cloudflare Access migration). Proxies `/api/*` on
`timesync.pltheatrical.com` to the Apps Script backend, injecting the two
server-side secrets that make the write path safe. See `src/index.js` for
the why; see the spec doc (Phase 2 + erratum) for the full architecture.

## Deploy (manual — requires a Cloudflare API token scoped for Workers Scripts
and Access, which the current `~/secrets/cloudflare_api_token.txt` does not
have)

```bash
cd worker
npx wrangler login   # or set CLOUDFLARE_API_TOKEN env var
npx wrangler secret put WEB_API_KEY      # paste: ol9rg7rlTCb4HpHCQJOxQ0JuVsyv5wwT
npx wrangler secret put WORKER_SECRET    # generate a new random value — see below
npx wrangler deploy
```

Generate `WORKER_SECRET` (32-byte random, matches the WEB_API_KEY rotation pattern):

```bash
python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))"
```

Whatever value you generate MUST also be set as the `WORKER_SECRET` Script
Property in the Apps Script project (Apps Script editor → Project Settings →
Script Properties), or every request will fail closed (`validateOrigin`
returns false by design when the property is unset).

## Prerequisites before this Worker does anything useful

1. `timesync.pltheatrical.com` DNS record flipped to proxied (orange cloud) —
   currently `proxied: false`. Access and Worker routes only apply to
   proxied traffic.
2. Cloudflare Access application created for `timesync.pltheatrical.com`,
   policy: allow `@pltheatrical.com` email domain.
3. `WORKER_SECRET` Script Property set in Apps Script (see above).

Until all three are done, do NOT ship the frontend changes that remove
`gate.js` and the client-side key — the dashboard has no other auth at that
point and would be reading real secrets from nowhere.
