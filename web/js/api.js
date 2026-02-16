/**
 * api.js — API client for communicating with the Google Apps Script Web API
 */

const API = {
  /** Base URL for the deployed Google Apps Script web app */
  baseUrl: '',

  /** API key for authentication */
  apiKey: '',

  /** Initialize from localStorage */
  init() {
    this.baseUrl = localStorage.getItem('tqs_api_url') || '';
    this.apiKey = localStorage.getItem('tqs_api_key') || '';
  },

  /** Check if configured */
  isConfigured() {
    return !!(this.baseUrl && this.apiKey);
  },

  /** Save configuration */
  configure(url, key) {
    // Remove trailing slash
    this.baseUrl = url.replace(/\/+$/, '');
    this.apiKey = key;
    localStorage.setItem('tqs_api_url', this.baseUrl);
    localStorage.setItem('tqs_api_key', this.apiKey);
  },

  /** Clear configuration */
  disconnect() {
    this.baseUrl = '';
    this.apiKey = '';
    localStorage.removeItem('tqs_api_url');
    localStorage.removeItem('tqs_api_key');
  },

  /**
   * Make a GET request to the API
   * @param {string} action - API action name
   * @param {Object} [params] - Additional query parameters
   */
  async get(action, params = {}) {
    const url = new URL(this.baseUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('api_key', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const resp = await fetch(url.toString());
    const data = await resp.json();

    if (data.status && data.status >= 400) {
      throw new Error(data.error || `API error ${data.status}`);
    }
    return data;
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
      body: JSON.stringify({ action, api_key: this.apiKey, ...body })
    });
    const data = await resp.json();

    if (data.status && data.status >= 400) {
      throw new Error(data.error || `API error ${data.status}`);
    }
    return data;
  }
};
