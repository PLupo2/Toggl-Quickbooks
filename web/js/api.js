/**
 * api.js — API client for communicating with the Google Apps Script Web API
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
   * Fixed relative path — Phase 2 (Cloudflare Access migration). The
   * Cloudflare Worker at /api/* holds the real credentials server-side
   * and injects them; this page never has, requests, or stores a key.
   * Auth is Cloudflare Access (email OTP), enforced before this page
   * even loads.
   */
  baseUrl: '/api',

  /** No-op — kept so index.html's bootstrap call doesn't need to change. */
  init() {},

  /**
   * Make a GET request to the API
   * @param {string} action - API action name
   * @param {Object} [params] - Additional query parameters
   */
  async get(action, params = {}) {
    const url = new URL(this.baseUrl, window.location.origin);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const resp = await fetch(url.toString());
    return this._parse(resp, action);
  },

  /**
   * Make a POST request to the API
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
