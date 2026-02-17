/**
 * gate.js — Simple password gate with 1-hour session
 *
 * To change the password:
 * 1. Open browser console on any page
 * 2. Run: crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_NEW_PASSWORD')).then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('')))
 * 3. Copy the hash and replace PASS_HASH below
 */
const Gate = {
  // Default password: "PLTheatrical2025"
  // To generate a new hash, see instructions above
  PASS_HASH: '115020a798d2d0a6f6216b3d4ee21aede9f21b54dd280d25c4bbb79dbabb4cab',
  SESSION_KEY: 'tqs_session',
  SESSION_DURATION: 60 * 60 * 1000, // 1 hour in ms

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
          <h1>Toggl-QBO Sync</h1>
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
    App.init();
  }
};

document.addEventListener('DOMContentLoaded', () => Gate.init());
