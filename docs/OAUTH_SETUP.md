# OAuth Setup Guide

Detailed guide for setting up OAuth 2.0 authentication with QuickBooks Online.

## Overview

The Toggl-QBO Sync system uses OAuth 2.0 to securely connect to QuickBooks Online. This requires:

1. An Intuit Developer app with OAuth credentials
2. A Web App deployment to handle the OAuth callback
3. Proper scope configuration

## OAuth Flow Diagram

```
┌─────────────┐     1. Click Auth Link     ┌─────────────────┐
│   Google    │ ─────────────────────────> │  Intuit OAuth   │
│   Sheet     │                            │    Server       │
└─────────────┘                            └────────┬────────┘
                                                    │
                                           2. User logs in
                                              and authorizes
                                                    │
┌─────────────┐     3. Redirect with code  ┌───────▼────────┐
│   Web App   │ <───────────────────────── │  Intuit OAuth   │
│  (Callback) │                            │    Server       │
└──────┬──────┘                            └─────────────────┘
       │
       │ 4. Exchange code for tokens
       │
       ▼
┌─────────────┐     5. Store tokens        ┌─────────────────┐
│   Apps      │ ─────────────────────────> │    Script       │
│   Script    │                            │   Properties    │
└─────────────┘                            └─────────────────┘
```

## Create Intuit Developer App

### 1. Access Developer Portal

1. Go to https://developer.intuit.com
2. Click **Sign In** (create account if needed)
3. Accept the developer terms

### 2. Create New App

1. Click **Dashboard** in the top menu
2. Click **Create an app**
3. Select **QuickBooks Online and Payments**
4. Enter app name: `Toggl Time Sync` (or your preference)
5. Select scope: **Accounting**
6. Click **Create app**

### 3. Get Credentials

1. In your app, go to **Keys & credentials**
2. You'll see two sets of keys:
   - **Development** (for Sandbox)
   - **Production** (for live data)
3. Copy these values:
   - **Client ID**
   - **Client Secret**

### 4. Configure Redirect URIs

1. In **Redirect URIs** section
2. Click **Add URI**
3. Add your Web App URL (get this from Step 5 of deployment)
4. Format: `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`

### 5. Configure Scopes

Required scope:
- `com.intuit.quickbooks.accounting` - Access to accounting data

Optional scopes (already included):
- `openid` - User identity
- `email` - User email
- `profile` - User profile

**Note**: The `project-management.project` scope is not available to standard apps. The script uses GraphQL as a fallback for Projects.

## Script Properties Configuration

Set these in Apps Script > Project Settings > Script Properties:

```
INTUIT_CLIENT_ID = ABcdefGHijklMNop123456789...
INTUIT_CLIENT_SECRET = xyzABC123...
OAUTH_REDIRECT_URI = https://script.google.com/macros/s/.../exec
QBO_ENV = sandbox
QBO_REALM_ID = (leave empty - set automatically after auth)
```

### Environment Values

| QBO_ENV | API Base URL |
|---------|--------------|
| `sandbox` | https://sandbox-quickbooks.api.intuit.com |
| `production` | https://quickbooks.api.intuit.com |

## Authorization Process

### Method 1: Automatic Callback (Recommended)

1. **Toggl-QBO Sync > Setup > Connect to QuickBooks**
2. Click the authorization link
3. Log in to Intuit (use Sandbox or Production account)
4. Click **Connect**
5. You'll be redirected to your Web App
6. Page shows "Successfully Connected!"

The Web App's `doGet()` function handles the callback:
- Receives the authorization code
- Exchanges it for tokens
- Stores tokens in Script Properties

### Method 2: Manual Code Entry

If the callback doesn't work:

1. After clicking **Connect**, note the redirect URL
2. Copy the `code` parameter from the URL
3. Go to **Setup > Complete OAuth**
4. Paste the authorization code
5. Click OK

## Token Management

### Access Token

- Valid for 1 hour
- Automatically refreshed when expired
- Used for all API calls

### Refresh Token

- Valid for 100 days
- Used to get new access tokens
- Automatically renewed when used

### Token Storage

Tokens are stored in Script Properties:
- `INTUIT_ACCESS_TOKEN`
- `INTUIT_REFRESH_TOKEN`
- `INTUIT_TOKEN_EXPIRES`

## Sandbox vs Production

### Sandbox Environment

- Test with fake data
- No real transactions
- Use Sandbox company account
- Developer portal: https://developer.intuit.com/app/sandbox

### Production Environment

1. Your app must pass a security review (for published apps)
2. Or use for internal apps without review
3. Update `QBO_ENV` to `production`
4. Re-authorize with production credentials

### Switching Environments

1. Update `QBO_ENV` in Script Properties
2. Run **Setup > Disconnect QuickBooks**
3. Run **Setup > Connect to QuickBooks**
4. Authorize with appropriate account

## Troubleshooting OAuth

### "Invalid client_id"

- Verify `INTUIT_CLIENT_ID` is correct
- Check you're using the right environment's credentials
- Ensure no extra spaces in the property value

### "Redirect URI mismatch"

- URL must match exactly (including trailing slash)
- Check for `http` vs `https`
- Verify the deployment ID hasn't changed

### "Access denied"

- User declined authorization
- Or the Intuit account doesn't have access to any companies

### "Token refresh failed"

```javascript
// Check if refresh token exists
const refreshToken = PropertiesService.getScriptProperties()
  .getProperty('INTUIT_REFRESH_TOKEN');
Logger.log('Refresh token exists: ' + !!refreshToken);
```

If no refresh token:
1. **Setup > Disconnect QuickBooks**
2. **Setup > Connect to QuickBooks**

### "Company not found" or "Invalid realm"

- `QBO_REALM_ID` may be incorrect
- Re-authorize to get the correct realm ID
- Check you're connected to the right company

## Security Best Practices

### Protect Your Credentials

1. Never share Client Secret
2. Don't commit credentials to source control
3. Use Script Properties (not hard-coded values)

### Token Handling

1. Tokens are stored server-side in Script Properties
2. Not accessible to spreadsheet viewers
3. Only the script owner can see them

### Revoke Access

To revoke access:
1. Go to Intuit Developer dashboard
2. Select your app
3. Go to **Keys & credentials**
4. Click **Revoke tokens**

Or from the script:
1. **Setup > Disconnect QuickBooks**
2. This clears local tokens

### Audit Access

Check who has authorized your app:
1. Intuit Developer dashboard
2. Your app > **Connected apps**

## Advanced Configuration

### Custom OAuth State

The script generates a random state parameter to prevent CSRF attacks:

```javascript
const state = Utilities.getUuid();
setScriptProperty('OAUTH_STATE', state);
```

### Manual Token Refresh

Force a token refresh:

```javascript
function forceTokenRefresh() {
  const newToken = refreshAccessToken();
  Logger.log('New token obtained: ' + newToken.substring(0, 20) + '...');
}
```

### Check Token Expiration

```javascript
function checkTokenExpiration() {
  const expiresAt = parseInt(getScriptProperty('INTUIT_TOKEN_EXPIRES') || '0', 10);
  const now = new Date().getTime();
  const minutesRemaining = Math.round((expiresAt - now) / 60000);

  Logger.log('Token expires in ' + minutesRemaining + ' minutes');
  return minutesRemaining > 0;
}
```
