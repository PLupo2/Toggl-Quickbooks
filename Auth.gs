/**
 * Auth.gs - OAuth 2.0 flow and token management for QuickBooks Online
 * Handles authorization, token refresh, and secure token storage.
 */

// ============================================================================
// OAUTH CONFIGURATION
// ============================================================================

const OAUTH_SCOPES = [
  'com.intuit.quickbooks.accounting',
  'openid',
  'email',
  'profile'
];

// ============================================================================
// AUTHORIZATION FLOW
// ============================================================================

/**
 * Initiates the OAuth authorization flow
 * Opens a dialog with the authorization URL
 */
function authorizeQuickBooks() {
  const clientId = getIntuitClientId();
  const redirectUri = getOAuthRedirectUri();

  if (!clientId || !redirectUri) {
    showAlert(
      'Missing OAuth configuration. Please set INTUIT_CLIENT_ID and OAUTH_REDIRECT_URI in Script Properties.',
      'Configuration Error'
    );
    return;
  }

  const state = Utilities.getUuid();
  setScriptProperty('OAUTH_STATE', state);

  const authUrl = buildAuthorizationUrl(clientId, redirectUri, state);

  const html = HtmlService.createHtmlOutput(
    `<html>
      <head>
        <base target="_blank">
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h2 { color: #2E7D32; }
          .url-box {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            word-break: break-all;
            margin: 15px 0;
          }
          a { color: #1976D2; }
          .instructions { margin-top: 20px; color: #666; }
        </style>
      </head>
      <body>
        <h2>Connect to QuickBooks Online</h2>
        <p>Click the link below to authorize this application:</p>
        <div class="url-box">
          <a href="${authUrl}" target="_blank">Authorize QuickBooks Access</a>
        </div>
        <div class="instructions">
          <p><strong>After authorizing:</strong></p>
          <ol>
            <li>You'll be redirected to your OAuth callback URL</li>
            <li>Copy the authorization code from the URL</li>
            <li>Run "Complete OAuth" from the menu and paste the code</li>
          </ol>
        </div>
      </body>
    </html>`
  )
    .setWidth(500)
    .setHeight(400);

  SpreadsheetApp.getUi().showModalDialog(html, 'QuickBooks Authorization');
}

/**
 * Builds the authorization URL
 * @param {string} clientId - OAuth client ID
 * @param {string} redirectUri - Redirect URI
 * @param {string} state - State parameter for CSRF protection
 * @returns {string} Authorization URL
 */
function buildAuthorizationUrl(clientId, redirectUri, state) {
  const baseUrl = getIntuitAuthURL();
  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state: state
  };

  const queryString = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  return `${baseUrl}?${queryString}`;
}

/**
 * Completes the OAuth flow by exchanging authorization code for tokens
 * Prompts user for the authorization code
 */
function completeOAuthFlow() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Complete OAuth',
    'Paste the authorization code from the redirect URL:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const authCode = response.getResponseText().trim();
  if (!authCode) {
    showAlert('No authorization code provided.', 'Error');
    return;
  }

  try {
    exchangeCodeForTokens(authCode);
    showAlert('Successfully connected to QuickBooks Online!', 'Success');
  } catch (error) {
    showAlert(`Failed to complete OAuth: ${error.message}`, 'Error');
    logMessage(`OAuth error: ${error.message}`, 'ERROR');
  }
}

/**
 * Exchanges authorization code for access and refresh tokens
 * @param {string} authCode - Authorization code
 */
function exchangeCodeForTokens(authCode) {
  const clientId = getIntuitClientId();
  const clientSecret = getIntuitClientSecret();
  const redirectUri = getOAuthRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing OAuth credentials in Script Properties');
  }

  const tokenUrl = `${getIntuitOAuthURL()}/tokens/bearer`;
  const credentials = Utilities.base64Encode(`${clientId}:${clientSecret}`);

  const options = {
    method: 'post',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    payload: {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(tokenUrl, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    logMessage(`Token exchange failed: ${responseBody}`, 'ERROR');
    throw new Error(`Token exchange failed: ${responseCode}`);
  }

  const tokens = JSON.parse(responseBody);
  storeTokens(tokens);

  logMessage('OAuth tokens obtained successfully', 'INFO');
}

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

/**
 * Stores OAuth tokens securely in Script Properties
 * @param {Object} tokens - Token response from Intuit
 */
function storeTokens(tokens) {
  const now = new Date().getTime();

  setScriptProperty('INTUIT_ACCESS_TOKEN', tokens.access_token);
  setScriptProperty('INTUIT_REFRESH_TOKEN', tokens.refresh_token);
  setScriptProperty('INTUIT_TOKEN_EXPIRES', String(now + (tokens.expires_in * 1000)));

  if (tokens.id_token) {
    setScriptProperty('INTUIT_ID_TOKEN', tokens.id_token);
  }

  // Store realm ID if provided in response
  if (tokens.realmId) {
    setScriptProperty('QBO_REALM_ID', tokens.realmId);
  }
}

/**
 * Gets a valid access token, refreshing if necessary
 * @returns {string} Valid access token
 */
function getValidAccessToken() {
  const accessToken = getScriptProperty('INTUIT_ACCESS_TOKEN');
  const expiresAt = parseInt(getScriptProperty('INTUIT_TOKEN_EXPIRES') || '0', 10);
  const now = new Date().getTime();

  // Refresh if token expires in less than 5 minutes
  if (!accessToken || now > (expiresAt - 300000)) {
    logMessage('Access token expired or expiring soon, refreshing...', 'INFO');
    return refreshAccessToken();
  }

  return accessToken;
}

/**
 * Refreshes the access token using the refresh token
 * @returns {string} New access token
 */
function refreshAccessToken() {
  const refreshToken = getScriptProperty('INTUIT_REFRESH_TOKEN');

  if (!refreshToken) {
    throw new Error('No refresh token available. Please re-authorize with QuickBooks.');
  }

  const clientId = getIntuitClientId();
  const clientSecret = getIntuitClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('Missing OAuth credentials in Script Properties');
  }

  const tokenUrl = `${getIntuitOAuthURL()}/tokens/bearer`;
  const credentials = Utilities.base64Encode(`${clientId}:${clientSecret}`);

  const options = {
    method: 'post',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    payload: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(tokenUrl, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    logMessage(`Token refresh failed: ${responseBody}`, 'ERROR');

    // If refresh token is invalid, clear tokens
    if (responseCode === 400 || responseCode === 401) {
      clearTokens();
      throw new Error('Refresh token invalid. Please re-authorize with QuickBooks.');
    }

    throw new Error(`Token refresh failed: ${responseCode}`);
  }

  const tokens = JSON.parse(responseBody);
  storeTokens(tokens);

  logMessage('Access token refreshed successfully', 'INFO');
  return tokens.access_token;
}

/**
 * Clears all stored OAuth tokens
 */
function clearTokens() {
  deleteScriptProperty('INTUIT_ACCESS_TOKEN');
  deleteScriptProperty('INTUIT_REFRESH_TOKEN');
  deleteScriptProperty('INTUIT_TOKEN_EXPIRES');
  deleteScriptProperty('INTUIT_ID_TOKEN');
  deleteScriptProperty('OAUTH_STATE');

  logMessage('OAuth tokens cleared', 'INFO');
}

/**
 * Disconnects from QuickBooks by clearing tokens
 */
function disconnectQuickBooks() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Disconnect QuickBooks',
    'Are you sure you want to disconnect from QuickBooks Online? You will need to re-authorize to sync again.',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    clearTokens();
    showAlert('Disconnected from QuickBooks Online.', 'Disconnected');
  }
}

// ============================================================================
// CONNECTION STATUS
// ============================================================================

/**
 * Checks if we have a valid connection to QuickBooks
 * @returns {boolean} True if connected
 */
function isConnectedToQBO() {
  const accessToken = getScriptProperty('INTUIT_ACCESS_TOKEN');
  const refreshToken = getScriptProperty('INTUIT_REFRESH_TOKEN');

  return !!(accessToken && refreshToken);
}

/**
 * Shows the current connection status
 */
function showConnectionStatus() {
  const connected = isConnectedToQBO();
  const realmId = getQBORealm();
  const env = getQBOEnvironment();

  let message;
  if (connected) {
    message = `Connected to QuickBooks Online\n\nEnvironment: ${env}\nCompany ID: ${realmId || 'Not set'}`;

    // Check token expiration
    const expiresAt = parseInt(getScriptProperty('INTUIT_TOKEN_EXPIRES') || '0', 10);
    const now = new Date().getTime();
    if (expiresAt > now) {
      const minutesRemaining = Math.round((expiresAt - now) / 60000);
      message += `\nToken expires in: ${minutesRemaining} minutes`;
    } else {
      message += '\nToken expired (will auto-refresh)';
    }
  } else {
    message = 'Not connected to QuickBooks Online.\n\nUse "Connect to QuickBooks" to authorize.';
  }

  showAlert(message, 'Connection Status');
}

// ============================================================================
// WEB APP CALLBACK HANDLER
// ============================================================================

/**
 * Handles the OAuth callback as a Web App
 * This function is called when Intuit redirects back after authorization
 * @param {Object} e - Event object containing query parameters
 * @returns {HtmlOutput} HTML response
 */
function doGet(e) {
  const params = e.parameter;

  if (params.code) {
    return handleOAuthCallback(params);
  }

  return HtmlService.createHtmlOutput(
    '<html><body><h2>Toggl-QBO Sync</h2><p>OAuth callback endpoint ready.</p></body></html>'
  );
}

/**
 * Handles the OAuth callback with authorization code
 * @param {Object} params - Query parameters
 * @returns {HtmlOutput} HTML response
 */
function handleOAuthCallback(params) {
  try {
    const code = params.code;
    const state = params.state;
    const realmId = params.realmId;

    // Verify state parameter
    const storedState = getScriptProperty('OAUTH_STATE');
    if (state && storedState && state !== storedState) {
      return HtmlService.createHtmlOutput(
        '<html><body><h2>Error</h2><p>Invalid state parameter. Please try authorizing again.</p></body></html>'
      );
    }

    // Store realm ID if provided
    if (realmId) {
      setScriptProperty('QBO_REALM_ID', realmId);
    }

    // Exchange code for tokens
    exchangeCodeForTokens(code);

    return HtmlService.createHtmlOutput(
      `<html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
            .success { color: #2E7D32; }
            .info { color: #666; margin-top: 20px; }
          </style>
        </head>
        <body>
          <h2 class="success">Successfully Connected!</h2>
          <p>QuickBooks Online authorization complete.</p>
          <p class="info">Company ID: ${realmId || 'Unknown'}</p>
          <p class="info">You can close this window and return to the spreadsheet.</p>
        </body>
      </html>`
    );
  } catch (error) {
    logMessage(`OAuth callback error: ${error.message}`, 'ERROR');

    return HtmlService.createHtmlOutput(
      `<html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
            .error { color: #C62828; }
            .details { color: #666; margin-top: 20px; font-size: 12px; }
          </style>
        </head>
        <body>
          <h2 class="error">Authorization Failed</h2>
          <p>There was an error completing the authorization.</p>
          <p class="details">Error: ${error.message}</p>
          <p>Please try again from the spreadsheet menu.</p>
        </body>
      </html>`
    );
  }
}

// ============================================================================
// TOGGL AUTHENTICATION
// ============================================================================

/**
 * Gets the Toggl API authentication header (Basic Auth)
 * @returns {string} Base64 encoded auth string
 */
function getTogglAuthHeader() {
  const apiToken = getTogglApiToken();

  if (!apiToken) {
    throw new Error('Toggl API token not configured. Please set TOGGL_API_TOKEN in Script Properties.');
  }

  // Toggl uses API token as username with 'api_token' as password
  return Utilities.base64Encode(`${apiToken}:api_token`);
}

/**
 * Validates Toggl API connection
 * @returns {boolean} True if valid
 */
function validateTogglConnection() {
  try {
    const authHeader = getTogglAuthHeader();
    const response = UrlFetchApp.fetch('https://api.track.toggl.com/api/v9/me', {
      method: 'get',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    return response.getResponseCode() === 200;
  } catch (error) {
    logMessage(`Toggl validation error: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Shows Toggl connection status
 */
function showTogglStatus() {
  const apiToken = getTogglApiToken();

  if (!apiToken) {
    showAlert('Toggl API token not configured.\n\nPlease set TOGGL_API_TOKEN in Script Properties.', 'Toggl Status');
    return;
  }

  const valid = validateTogglConnection();
  if (valid) {
    const workspaceId = getTogglWorkspaceId();
    showAlert(
      `Connected to Toggl Track\n\nWorkspace ID: ${workspaceId || 'Auto-detect'}`,
      'Toggl Status'
    );
  } else {
    showAlert('Failed to connect to Toggl Track.\n\nPlease verify your API token.', 'Toggl Status');
  }
}
