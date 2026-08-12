/**
 * api.js — API client for communicating with the Google Apps Script Web API
 * (via the Cloudflare Worker at /api/*).
 */

const API = {
  /**
   * Parse a response as JSON, or throw an error that actually says what
   * came back. Calling resp.json() blindly turns any HTML response --
   * Cloudflare error page, Access sign-in wall, Apps Script quota page --
   * into "Unexpected token '<'", which is useless for diagnosis.
   */
  async _parse(resp, action) {
    const text = await resp.text();
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      const kind = resp.status === 302 || /cloudflareaccess/i.test(text)
        ? 'Your session expired. Reload the page to sign in again.'
        : `Server returned a web page instead of data (HTTP ${resp.status}).`;
      throw new Error(`${action}: ${kind}`);
    }
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`${action}: response was not valid JSON (HTTP ${resp.status}).`);
    }
    if (data.status && data.status >= 400) {
      throw new Error(data.error || `API error ${data.status}`);
    }
    return data;
  },

  /**
   * Is this error a transient worth retrying? Apps Script's /exec
   * intermittently 302-redirects to a googleusercontent.com URL that 404s
   * (and can hang) for a stretch; the Worker relays that as a 502 with an
   * "Upstream returned non-JSON / Upstream request failed" body. A dropped
   * fetch or our own per-attempt timeout (AbortError) is the same class of
   * blip. NOT retryable: an expired Access session (needs a real reload) or
   * any real app-level error (bad action, validation, auth) — retrying those
   * just hides them.
   */
  _isRetryable(err) {
    if (err && err.name === 'AbortError') return true; // our per-attempt timeout
    const m = (err && err.message ? err.message : '').toLowerCase();
    if (m.includes('session expired')) return false;
    return (
      m.includes('upstream returned non-json') ||
      m.includes('upstream request failed') ||
      m.includes('web page instead of data') ||
      m.includes('was not valid json') ||
      m.includes('failed to fetch') || // Chrome/Firefox network error
      m.includes('load failed') ||     // Safari network error
      m.includes('networkerror')
    );
  },

  /**
   * Fixed relative path — Phase 2 (Cloudflare Access migration). The
   * Cloudflare Worker at /api/* holds the real credentials server-side
   * and injects them; this page never has, requests, or stores a key.
   * Auth is Cloudflare Access (email OTP), enforced before this page
   * even loads.
   */
  baseUrl: '/api',

  // Read-retry tuning. The Worker already retries the upstream once; this is
  // a second, client-side line of defense for the SHORT transient windows so
  // a page load self-heals instead of showing an error the user has to
  // dismiss. Per-attempt timeout keeps a sustained window from hanging the
  // page for ~100s (the Cloudflare edge ceiling) — we fail fast and friendly
  // instead. 25s is comfortably above a legitimately slow read (e.g. a
  // preview that fans out to Toggl + Back Office) so we don't abort good work.
  _readMaxAttempts: 2,
  _readAttemptTimeoutMs: 25000,
  _readRetryDelayMs: 1000,

  /** No-op — kept so index.html's bootstrap call doesn't need to change. */
  init() {},

  /**
   * Make a GET (read) request to the API, with a bounded retry for transient
   * upstream/network blips. Reads only — POST (writes) never auto-retry.
   * @param {string} action - API action name
   * @param {Object} [params] - Additional query parameters
   * @param {Object} [opts]
   * @param {boolean} [opts.retry=true] Set false for heavy reads that can
   *   legitimately run longer than the per-attempt timeout (e.g. a preview
   *   that fans out to Toggl + Back Office) — those do a single attempt with
   *   no abort, so a slow-but-valid response is never cut off and retried.
   */
  async get(action, params = {}, opts = {}) {
    const url = new URL(this.baseUrl, window.location.origin);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const retry = opts.retry !== false; // default on
    const maxAttempts = retry ? this._readMaxAttempts : 1;

    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Only impose the per-attempt abort when retrying: a non-retry heavy
      // read keeps the old behavior (no client-side timeout; the browser /
      // Cloudflare edge is the only ceiling).
      let controller, timer;
      if (retry) {
        controller = new AbortController();
        timer = setTimeout(() => controller.abort(), this._readAttemptTimeoutMs);
      }
      try {
        const resp = await fetch(url.toString(), controller ? { signal: controller.signal } : undefined);
        return await this._parse(resp, action);
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts && this._isRetryable(err)) {
          await new Promise(resolve => setTimeout(resolve, this._readRetryDelayMs));
          continue;
        }
        // Exhausted (or non-retryable): surface a friendlier message for the
        // transient class so the UI doesn't show a raw "Upstream returned
        // non-JSON (HTTP 404)". Real errors pass through unchanged.
        if (this._isRetryable(err)) {
          throw new Error(
            `Couldn't reach the sync backend (a brief Apps Script/network hiccup). ` +
            `It usually clears in a few seconds — hit Retry.`
          );
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr;
  },

  /**
   * Make a POST (write) request to the API. Deliberately NOT retried — a
   * write that appears to fail may have succeeded upstream, and the sync
   * start is guarded server-side (LockService + job dedup), so a blind
   * client retry could double-submit.
   * @param {string} action - API action name
   * @param {Object} [body] - Request body
   */
  async post(action, body = {}) {
    const resp = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body })
    });
    return this._parse(resp, action);
  }
};
