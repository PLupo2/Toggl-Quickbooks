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
  API_URL: 'https://script.google.com/macros/s/AKfycbwSEAEDqOrmBvgKhhxvHTkNwbbvY9ss_w3CsWr625al3scJg_nqKgNGPASqHRyMxska/exec',
  API_KEY: '6qjNK88mLvU7ksRuLaB3AwBbBtoX7RZa',

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
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:64px;height:64px;color:var(--text)">
              <circle cx="22" cy="24" r="18" fill="var(--surface)" stroke="currentColor" stroke-width="3"/>
              <circle cx="22" cy="24" r="14" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 4"/>
              <circle cx="22" cy="10" r="2" fill="currentColor"/>
              <circle cx="22" cy="38" r="2" fill="currentColor"/>
              <circle cx="8" cy="24" r="2" fill="currentColor"/>
              <circle cx="36" cy="24" r="2" fill="currentColor"/>
              <line x1="22" y1="24" x2="22" y2="14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <line x1="22" y1="24" x2="30" y2="28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              <circle cx="22" cy="24" r="3" fill="var(--primary)"/>
              <path d="M32 8 C44 12, 46 28, 38 38" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" fill="none"/>
              <polygon points="35,41 42,38 38,32" fill="var(--primary)"/>
            </svg>
          </div>
          <h1>PL Theatrical TimeSync</h1>
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
