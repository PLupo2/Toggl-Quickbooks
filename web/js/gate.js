/**
 * gate.js — Simple password gate with 1-hour session
 *
 * To change the password:
 * 1. Open browser console on any page
 * 2. Run: crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_NEW_PASSWORD')).then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('')))
 * 3. Copy the hash and replace PASS_HASH below
 */
const Gate = {
  // Password: "-PLTheatrical757!-ts"
  // To generate a new hash, see instructions above
  PASS_HASH: 'd251ab356f9720eff1b9bc9d970fb82ef8fbf78b1bfb8ecda22f8da69c9abc36',
  SESSION_KEY: 'tqs_session',
  SESSION_DURATION: 60 * 60 * 1000, // 1 hour in ms

  // Pre-configured API credentials (set automatically after password auth)
  // This key is a public UX gate for read-only dashboard actions, not a
  // security boundary — see CLAUDE.md "Web API Key" note. It is
  // necessarily visible to anyone who loads this page; do not treat its
  // exposure here as an incident. Rotating it requires updating BOTH this
  // value and the WEB_API_KEY Script Property in the same deploy, or the
  // dashboard breaks.
  API_URL: 'https://script.google.com/macros/s/AKfycbwSEAEDqOrmBvgKhhxvHTkNwbbvY9ss_w3CsWr625al3scJg_nqKgNGPASqHRyMxska/exec',
  API_KEY: 'ol9rg7rlTCb4HpHCQJOxQ0JuVsyv5wwT',

  async init() {
    if (this.hasValidSession()) {
      this.proceed();
      return;
    }
    this.showPrompt();
  },

  hasValidSession() {
    const session = localStorage.getItem(this.SESSION_KEY);
    if (!session) return false;
    try {
      const { expires } = JSON.parse(session);
      if (Date.now() < expires) return true;
      localStorage.removeItem(this.SESSION_KEY);
      return false;
    } catch {
      localStorage.removeItem(this.SESSION_KEY);
      return false;
    }
  },

  showPrompt(error) {
    document.getElementById('app').innerHTML = `
      <div class="setup-screen">
        <div class="setup-card">
          <div style="margin-bottom:16px">
            <img src="logo.svg" alt="PL Theatrical TimeSync" style="width:144px;height:144px">
          </div>
          <p>Enter the access password to continue.</p>
          ${error ? `<p style="color:var(--danger);font-size:13px;margin-bottom:16px">${error}</p>` : ''}
          <input type="password" id="gate-password" placeholder="Password"
                 onkeydown="if(event.key==='Enter')Gate.submit()">
          <button class="btn btn-primary" style="width:100%;justify-content:center"
                  onclick="Gate.submit()">Unlock</button>
        </div>
      </div>`;
    document.getElementById('gate-password').focus();
  },

  async submit() {
    const input = document.getElementById('gate-password').value;
    if (!input) {
      this.showPrompt('Please enter a password.');
      return;
    }

    const hash = await this.hash(input);
    if (hash === this.PASS_HASH) {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify({
        expires: Date.now() + this.SESSION_DURATION
      }));
      this.proceed();
    } else {
      this.showPrompt('Incorrect password.');
    }
  },

  async hash(str) {
    const buf = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  },

  lock() {
    localStorage.removeItem(this.SESSION_KEY);
    this.showPrompt();
  },

  proceed() {
    // Pre-fill API credentials so user skips setup screen
    localStorage.setItem('tqs_api_url', this.API_URL);
    localStorage.setItem('tqs_api_key', this.API_KEY);
    App.init();
  }
};

document.addEventListener('DOMContentLoaded', () => Gate.init());
