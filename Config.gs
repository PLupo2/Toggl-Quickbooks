/**
 * Config.gs - Script Properties helpers and configuration management
 * Provides centralized access to configuration values stored in Script Properties
 * and the Config sheet.
 */

// ============================================================================
// SCRIPT PROPERTIES HELPERS
// ============================================================================

/**
 * Gets a script property value
 * @param {string} key - Property key
 * @param {string} [defaultValue] - Default value if not found
 * @returns {string|null} Property value or default
 */
function getScriptProperty(key, defaultValue = null) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value !== null ? value : defaultValue;
}

/**
 * Sets a script property value
 * @param {string} key - Property key
 * @param {string} value - Property value
 */
function setScriptProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/**
 * Deletes a script property
 * @param {string} key - Property key
 */
function deleteScriptProperty(key) {
  PropertiesService.getScriptProperties().deleteProperty(key);
}

/**
 * Gets all script properties
 * @returns {Object} All properties as key-value pairs
 */
function getAllScriptProperties() {
  return PropertiesService.getScriptProperties().getProperties();
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

const CONFIG = {
  // Sheet names
  SHEETS: {
    CONFIG: 'Config',
    INBOX: 'Inbox_Approvals',
    QUEUE: 'Queue',
    ARCHIVE: 'Synced_Archive',
    MAPPINGS_CLIENTS: 'Mappings_Clients',
    MAPPINGS_PROJECTS: 'Mappings_Projects',
    MAPPINGS_USERS: 'Mappings_Users',
    MAPPINGS_TASKS: 'Mappings_Tasks_Services',
    QBO_CUSTOMERS: 'QBO_Customers_Master',
    QBO_EMPLOYEES: 'QBO_Employees_Master',
    QBO_ITEMS: 'QBO_Items_Service_Master',
    QBO_PROJECTS: 'QBO_Projects_Master'
  },

  // Column definitions for each sheet
  COLUMNS: {
    INBOX: [
      'Toggl Entry ID', 'Toggl User', 'QBO Employee', 'Toggl Client',
      'Toggl Project', 'QBO Customer', 'QBO Project', 'Toggl Task',
      'QBO Service Item', 'Description', 'Date', 'Duration (hrs)',
      'Billable', 'Start Time', 'Stop Time', 'Tags', 'Status',
      'Validation Errors', 'Approved', 'Imported At', 'Notes'
    ],
    QUEUE: [
      'Toggl Entry ID', 'QBO Employee ID', 'QBO Employee Name',
      'QBO Customer ID', 'QBO Customer Name', 'QBO Project ID',
      'QBO Project Name', 'QBO Service Item ID', 'QBO Service Item Name',
      'Description', 'Date', 'Duration (hrs)', 'Billable',
      'Added to Queue At', 'Sync Attempts', 'Last Error'
    ],
    ARCHIVE: [
      'Toggl Entry ID', 'QBO TimeActivity ID', 'QBO Employee Name',
      'QBO Customer Name', 'QBO Project Name', 'QBO Service Item Name',
      'Description', 'Date', 'Duration (hrs)', 'Billable',
      'Synced At', 'Original Import Date', 'Notes'
    ],
    MAPPINGS_CLIENTS: [
      'Toggl Client ID', 'Toggl Client Name', 'QBO Customer ID',
      'QBO Customer Name', 'Auto Matched', 'Last Updated'
    ],
    MAPPINGS_PROJECTS: [
      'Toggl Project ID', 'Toggl Project Name', 'Toggl Client Name',
      'QBO Customer ID', 'QBO Customer Name', 'QBO Project ID',
      'QBO Project Name', 'Last Updated'
    ],
    MAPPINGS_USERS: [
      'Toggl User ID', 'Toggl User Name', 'Toggl Email',
      'QBO Employee ID', 'QBO Employee Name', 'Auto Matched', 'Last Updated'
    ],
    MAPPINGS_TASKS: [
      'Toggl Task ID', 'Toggl Task Name', 'Toggl Project Name',
      'Toggl Client Name', 'QBO Service Item ID', 'QBO Service Item Name',
      'Auto Matched', 'Last Updated'
    ],
    QBO_CUSTOMERS: ['QBO Customer ID', 'QBO Customer Name'],
    QBO_EMPLOYEES: ['QBO Employee ID', 'QBO Employee Name'],
    QBO_ITEMS: ['QBO Service Item ID', 'QBO Service Item Name'],
    QBO_PROJECTS: ['QBO Project ID', 'QBO Project Name']
  },

  // Default configuration values
  DEFAULTS: {
    IMPORT_DAYS: 30,
    QBO_ENV: 'sandbox',
    BATCH_SIZE: 50
  }
};

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

/**
 * Gets QBO environment (sandbox or production)
 * @returns {string} 'sandbox' or 'production'
 */
function getQBOEnvironment() {
  return getScriptProperty('QBO_ENV', CONFIG.DEFAULTS.QBO_ENV);
}

/**
 * Gets QBO API base URL based on environment
 * @returns {string} API base URL
 */
function getQBOBaseURL() {
  const env = getQBOEnvironment();
  return env === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

/**
 * Gets Intuit OAuth base URL
 * @returns {string} OAuth base URL
 */
function getIntuitOAuthURL() {
  return 'https://oauth.platform.intuit.com/oauth2/v1';
}

/**
 * Gets Intuit authorization URL
 * @returns {string} Authorization URL
 */
function getIntuitAuthURL() {
  return 'https://appcenter.intuit.com/connect/oauth2';
}

// ============================================================================
// CREDENTIAL HELPERS
// ============================================================================

/**
 * Gets Toggl API token
 * @returns {string|null} API token
 */
function getTogglApiToken() {
  return getScriptProperty('TOGGL_API_TOKEN');
}

/**
 * Gets Toggl workspace ID
 * @returns {string|null} Workspace ID
 */
function getTogglWorkspaceId() {
  return getScriptProperty('TOGGL_WORKSPACE_ID');
}

/**
 * Gets Intuit Client ID
 * @returns {string|null} Client ID
 */
function getIntuitClientId() {
  return getScriptProperty('INTUIT_CLIENT_ID');
}

/**
 * Gets Intuit Client Secret
 * @returns {string|null} Client secret
 */
function getIntuitClientSecret() {
  return getScriptProperty('INTUIT_CLIENT_SECRET');
}

/**
 * Gets QBO Realm ID (company ID)
 * @returns {string|null} Realm ID
 */
function getQBORealm() {
  return getScriptProperty('QBO_REALM_ID');
}

/**
 * Gets OAuth redirect URI
 * @returns {string|null} Redirect URI
 */
function getOAuthRedirectUri() {
  return getScriptProperty('OAUTH_REDIRECT_URI');
}

// ============================================================================
// CONFIG SHEET HELPERS
// ============================================================================

/**
 * Gets a configuration value from the Config sheet
 * @param {string} key - Configuration key
 * @param {*} [defaultValue] - Default value if not found
 * @returns {*} Configuration value
 */
function getConfigValue(key, defaultValue = null) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(CONFIG.SHEETS.CONFIG);

  if (!configSheet) {
    return defaultValue;
  }

  const data = configSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      return data[i][1] !== '' ? data[i][1] : defaultValue;
    }
  }

  return defaultValue;
}

/**
 * Sets a configuration value in the Config sheet
 * @param {string} key - Configuration key
 * @param {*} value - Configuration value
 */
function setConfigValue(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = ss.getSheetByName(CONFIG.SHEETS.CONFIG);

  if (!configSheet) {
    configSheet = createConfigSheet(ss);
  }

  const data = configSheet.getDataRange().getValues();
  let found = false;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      configSheet.getRange(i + 1, 2).setValue(value);
      found = true;
      break;
    }
  }

  if (!found) {
    const lastRow = configSheet.getLastRow();
    configSheet.getRange(lastRow + 1, 1, 1, 2).setValues([[key, value]]);
  }
}

/**
 * Creates the Config sheet with default values
 * @param {Spreadsheet} ss - Spreadsheet object
 * @returns {Sheet} Config sheet
 */
function createConfigSheet(ss) {
  let configSheet = ss.getSheetByName(CONFIG.SHEETS.CONFIG);

  if (configSheet) {
    configSheet.clear();
  } else {
    configSheet = ss.insertSheet(CONFIG.SHEETS.CONFIG);
  }

  // Set headers
  configSheet.getRange('A1:B1').setValues([['Key', 'Value']]);
  configSheet.getRange('A1:B1').setFontWeight('bold');

  // Set default configuration values
  const defaults = [
    ['IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS],
    ['BATCH_SIZE', CONFIG.DEFAULTS.BATCH_SIZE],
    ['LAST_IMPORT_DATE', ''],
    ['LAST_SYNC_DATE', ''],
    ['AUTO_APPROVE', 'FALSE'],
    ['SYNC_BILLABLE_ONLY', 'FALSE']
  ];

  configSheet.getRange(2, 1, defaults.length, 2).setValues(defaults);

  // Format
  configSheet.setColumnWidth(1, 200);
  configSheet.setColumnWidth(2, 300);

  return configSheet;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Gets the active spreadsheet
 * @returns {Spreadsheet} Active spreadsheet
 */
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Gets or creates a sheet by name
 * @param {string} sheetName - Sheet name
 * @param {string[]} [headers] - Optional headers to set
 * @returns {Sheet} Sheet object
 */
function getOrCreateSheet(sheetName, headers = null) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }

  return sheet;
}

/**
 * Formats a date for display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Formats a datetime for display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted datetime string
 */
function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Converts duration in seconds to hours
 * @param {number} seconds - Duration in seconds
 * @returns {number} Duration in hours (rounded to 2 decimal places)
 */
function secondsToHours(seconds) {
  return Math.round((seconds / 3600) * 100) / 100;
}

/**
 * Converts duration in hours to minutes (for QBO)
 * @param {number} hours - Duration in hours
 * @returns {number} Duration in minutes
 */
function hoursToMinutes(hours) {
  return Math.round(hours * 60);
}

/**
 * Shows a toast notification
 * @param {string} message - Message to display
 * @param {string} [title] - Optional title
 * @param {number} [timeout] - Optional timeout in seconds
 */
function showToast(message, title = 'Toggl-QBO Sync', timeout = 5) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeout);
}

/**
 * Shows an alert dialog
 * @param {string} message - Message to display
 * @param {string} [title] - Optional title
 */
function showAlert(message, title = 'Toggl-QBO Sync') {
  SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Logs a message with timestamp
 * @param {string} message - Message to log
 * @param {string} [level] - Log level (INFO, WARN, ERROR)
 */
function logMessage(message, level = 'INFO') {
  const timestamp = formatDateTime(new Date());
  console.log(`[${timestamp}] [${level}] ${message}`);
}
