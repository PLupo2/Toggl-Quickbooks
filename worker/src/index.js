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
      // dashboard reports an opaque "Unexpected token '<'". Not retried —
      // this is a different failure mode than the documented transient
      // below (a completed response that happens to be 404/5xx HTML), and
      // retrying it is outside what was measured and asked for.
      return jsonError(
        `Upstream request failed (${merged.action}): ${err && err.message ? err.message : String(err)}`,
        502
      );
    }

    // Apps Script's /exec redirects to a temporary googleusercontent.com
    // URL to actually serve the response; that target intermittently 404s
    // with a Google Docs HTML page instead of data.
    //
    // CORRECTED 2026-08-05 (the original measurement here was wrong): this
    // is not a per-request coin flip. It's a sustained dead window — one
    // observed failure persisted 133s, with each individual failing
    // request hanging 46-59s before even returning. At the original 3
    // attempts / 250ms+750ms backoff, all 3 could land inside the same
    // window and total ~150s+ — turning a fast failure into a Cloudflare
    // edge timeout (~100s) that wouldn't otherwise have happened. Retrying
    // more can make the failure worse, not better.
    //
    // So: at most ONE extra attempt, not two. Even that isn't free — two
    // requests at 46-59s each can still approach or exceed the ~100s edge
    // ceiling — but it's the bounded bet the spec calls for, not a
    // guarantee this can't still time out during a long dead window.
    //
    // Retry only for exactly this shape — non-JSON body on a 404 or 5xx —
    // and nothing wider:
    //   - A 200 with valid JSON is a real answer, including an app-level
    //     JSON error from WebAPI.gs — never retried.
    //   - Any other 4xx (400/401/403/...) is a real auth or request fault;
    //     retrying would hide it, not fix it.
    // Safe to retry: a 404 here means Apps Script never executed, so there
    // is nothing to duplicate. (Not the reason this is scoped so narrowly,
    // just why it's safe to be this direct about retrying rather than
    // needing a broader idempotency argument.)
    const MAX_ATTEMPTS = 2; // 1 extra attempt, at most
    const RETRY_DELAY_MS = 250; // before the one retry

    let looksJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    let attempt = 1;

    while (!looksJson && (upstream.status === 404 || upstream.status >= 500) && attempt < MAX_ATTEMPTS) {
      console.log(`[retry] ${merged.action}: attempt ${attempt} got HTTP ${upstream.status} non-JSON (likely a stale googleusercontent.com redirect target) — retrying in ${RETRY_DELAY_MS}ms`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      attempt++;

      try {
        upstream = await fetch(upstreamUrl, init);
        text = await upstream.text();
      } catch (err) {
        console.log(`[retry] ${merged.action}: attempt ${attempt} threw a network error, not retrying further: ${err && err.message ? err.message : String(err)}`);
        return jsonError(
          `Upstream request failed on retry ${attempt} (${merged.action}): ${err && err.message ? err.message : String(err)}`,
          502
        );
      }

      looksJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    }

    if (attempt > 1) {
      console.log(`[retry] ${merged.action}: ${looksJson ? `recovered on attempt ${attempt}` : `still failing after ${attempt} attempts (HTTP ${upstream.status})`}`);
    }

    // Apps Script returns HTML for sign-in walls, quota pages, and some
    // redirect states. Relaying that verbatim breaks JSON.parse in the
    // browser with no clue as to the cause. Detect and describe it instead.
    if (!looksJson) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 200);
      return jsonError(
        `Upstream returned non-JSON (HTTP ${upstream.status}) for action "${merged.action}" after ${attempt} attempt(s). ` +
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
