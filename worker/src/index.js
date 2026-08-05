/**
 * TimeSync API proxy — Phase 2 (Cloudflare Access migration).
 *
 * Sits in front of the Apps Script web app at /api/*. Cloudflare Access
 * gates the whole timesync.pltheatrical.com zone (see wrangler.toml route)
 * with an @pltheatrical.com email-domain policy, so by the time a request
 * reaches this Worker, Access has already verified the caller's identity.
 *
 * This Worker holds the two secrets that make the write path safe:
 *   - WEB_API_KEY: legacy secondary check, kept for defense in depth.
 *   - WORKER_SECRET: the real gate. Apps Script's doGet/doPost cannot read
 *     arbitrary HTTP headers (no e.headers), so this travels as a normal
 *     request param (origin_secret), not a literal header, despite the
 *     spec's "X-PLT-Origin header" framing. Same property — a secret that
 *     never reaches the browser — different wire format, because Apps
 *     Script's runtime doesn't expose headers to read the other kind.
 *
 * Neither secret is ever sent to or readable by the browser. The browser
 * only ever holds a Cloudflare Access session cookie.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api')) {
      return new Response('Not found', { status: 404 });
    }

    // Belt-and-suspenders: Access already gates this whole route at the
    // edge (see wrangler.toml). If a routing change ever let a request
    // reach this Worker without going through Access, this catches it.
    if (!request.headers.get('Cf-Access-Jwt-Assertion')) {
      return jsonError('Missing Access assertion', 401);
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return jsonError('Method not allowed', 405);
    }

    let body = {};
    if (request.method === 'POST') {
      try {
        body = await request.json();
      } catch (err) {
        return jsonError('Invalid JSON body', 400);
      }
    }

    const queryParams = Object.fromEntries(url.searchParams);
    const merged = { ...queryParams, ...body };

    if (!merged.action) {
      return jsonError('Missing action parameter', 400);
    }

    // Inject both secrets server-side. The client never sets or sees these.
    merged.api_key = env.WEB_API_KEY;
    merged.origin_secret = env.WORKER_SECRET;

    const init = {
      method: request.method,
      redirect: 'follow', // mirrors the existing browser->Apps Script behavior in api.js
    };

    let upstreamUrl = env.APPS_SCRIPT_URL;
    if (request.method === 'GET') {
      const qs = new URLSearchParams(merged);
      upstreamUrl = `${env.APPS_SCRIPT_URL}?${qs.toString()}`;
    } else {
      // text/plain avoids a CORS preflight against Apps Script; doPost
      // parses the raw body as JSON regardless of Content-Type (see api.js).
      init.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      init.body = JSON.stringify(merged);
    }

    let upstream;
    let text;
    try {
      upstream = await fetch(upstreamUrl, init);
      text = await upstream.text();
    } catch (err) {
      // Network-level failure talking to Apps Script (timeout, DNS, reset).
      // Without this the runtime returns a Cloudflare HTML error page and the
      // dashboard reports an opaque "Unexpected token '<'".
      return jsonError(
        `Upstream request failed (${merged.action}): ${err && err.message ? err.message : String(err)}`,
        502
      );
    }

    // Apps Script returns HTML for sign-in walls, quota pages, and some
    // redirect states. Relaying that verbatim breaks JSON.parse in the
    // browser with no clue as to the cause. Detect and describe it instead.
    const looksJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    if (!looksJson) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 200);
      return jsonError(
        `Upstream returned non-JSON (HTTP ${upstream.status}) for action "${merged.action}". ` +
          `This usually means Apps Script answered with an HTML page rather than data. ` +
          `First 200 chars: ${snippet}`,
        502
      );
    }

    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ status, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
