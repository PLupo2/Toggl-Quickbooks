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
    SYNC_LOG: 'Sync_Log',  // Replaces Inbox/Queue - shows sync history
    MAPPINGS_CLIENTS: 'Mappings_Clients',
    MAPPINGS_PROJECTS: 'Mappings_Projects',
    MAPPINGS_USERS: 'Mappings_Users',
    MAPPINGS_TASKS: 'Mappings_Tasks_Services',
    QBO_CUSTOMERS: 'QBO_Customers_Master',
    QBO_EMPLOYEES: 'QBO_Employees_Master',
    QBO_ITEMS: 'QBO_Items_Service_Master',
    QBO_PROJECTS: 'QBO_Projects_Master'
  },

  // Tag names used for workflow
  TAGS: {
    APPROVED: 'Approved',
    SYNCED: 'Synced'
  },

  // Column definitions for each sheet
  COLUMNS: {
    SYNC_LOG: [
      'Synced At', 'Toggl Entry ID', 'QBO TimeActivity ID',
      'Date', 'Duration', 'Toggl User', 'QBO Employee',
      'Toggl Client', 'Toggl Project', 'QBO Customer', 'QBO Project',
      'Toggl Task', 'QBO Service Item',
      'Description', 'Billable', 'Status', 'Error'
    ],
    MAPPINGS_CLIENTS: [
      'Toggl Client ID', 'Toggl Client Name', 'QBO Customer ID',
      'QBO Customer Name', 'Matched', 'Last Updated'
    ],
    MAPPINGS_PROJECTS: [
      'Toggl Project ID', 'Toggl Client Name', 'Toggl Project Name',
      'QBO Project Name', 'QBO Project ID', 'Status', 'Last Updated'
    ],
    MAPPINGS_USERS: [
      'Toggl User ID', 'Toggl User Name', 'Toggl Email',
      'QBO Employee ID', 'QBO Employee Name', 'Matched', 'Last Updated'
    ],
    MAPPINGS_TASKS: [
      'Toggl Task ID', 'Toggl Task Name', 'Toggl Project Name',
      'Toggl Client Name', 'QBO Service Item ID', 'QBO Service Item Name',
      'Status', 'Matched', 'Last Updated'
    ],
    QBO_CUSTOMERS: ['QBO Customer ID', 'QBO Customer Name'],
    QBO_EMPLOYEES: ['QBO Employee ID', 'QBO Employee Name'],
    QBO_ITEMS: ['QBO Service Item ID', 'QBO Service Item Name'],
    QBO_PROJECTS: ['QBO Project ID', 'QBO Project Name', 'QBO Customer ID', 'QBO Customer Name']
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
  // Use START_DATE and END_DATE for specific date range, or leave blank to use IMPORT_DAYS
  const defaults = [
    ['START_DATE', ''],  // Leave blank to use IMPORT_DAYS, or set YYYY-MM-DD
    ['END_DATE', ''],    // Leave blank for today, or set YYYY-MM-DD
    ['IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS],  // Used only if START_DATE is blank
    ['BATCH_SIZE', CONFIG.DEFAULTS.BATCH_SIZE],
    ['LAST_SYNC_DATE', ''],
    ['SYNC_BILLABLE_ONLY', 'FALSE'],
    ['APPROVED_TAG', CONFIG.TAGS.APPROVED],  // Tag name to look for in Toggl
    ['SYNCED_TAG', CONFIG.TAGS.SYNCED],      // Tag name to add after sync
    ['DEFAULT_SERVICE_ITEM_ID', ''],         // QBO Service Item ID for entries without tasks
    ['DEFAULT_SERVICE_ITEM_NAME', ''],       // QBO Service Item Name (for reference)
    ['TOGGL_API_BUDGET', 180],               // Max API calls per sync (240 limit minus buffer for other tools)
    ['LAST_SYNC_API_CALLS', ''],             // API calls used in last sync
    ['SYNC_STATUS', '']                      // Current sync status (Paused, etc.)
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
 * Formats duration in seconds to h:mm format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "1:30" for 1 hour 30 minutes)
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Parses h:mm duration format to seconds
 * @param {string} duration - Duration in h:mm format
 * @returns {number} Duration in seconds
 */
function parseDuration(duration) {
  if (!duration) return 0;
  const parts = String(duration).split(':');
  if (parts.length === 2) {
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return (hours * 3600) + (minutes * 60);
  }
  // If it's just a number, assume hours
  const hours = parseFloat(duration) || 0;
  return hours * 3600;
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
 * Silently fails when called from web API context (no UI available)
 * @param {string} message - Message to display
 * @param {string} [title] - Optional title
 * @param {number} [timeout] - Optional timeout in seconds
 */
function showToast(message, title = 'Toggl-QBO Sync', timeout = 5) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeout);
  } catch (e) {
    // Silently ignore - likely running from web API context
  }
}

/**
 * Shows an alert dialog
 * Silently fails when called from web API context (no UI available)
 * @param {string} message - Message to display
 * @param {string} [title] - Optional title
 */
function showAlert(message, title = 'Toggl-QBO Sync') {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Silently ignore - likely running from web API context
  }
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

/**
 * Gets the date range for import based on Config settings
 * Uses START_DATE/END_DATE if set, otherwise calculates from IMPORT_DAYS
 * @returns {Object} Object with startDate and endDate as YYYY-MM-DD strings
 */
function getImportDateRange() {
  let startDateValue = getConfigValue('START_DATE', '');
  let endDateValue = getConfigValue('END_DATE', '');

  let startDateStr = '';
  let endDateStr = '';

  // Handle START_DATE - could be a Date object, string, or empty
  if (startDateValue) {
    if (startDateValue instanceof Date) {
      startDateStr = formatDate(startDateValue);
    } else if (typeof startDateValue === 'string' && startDateValue.trim() !== '') {
      // Ensure it's in YYYY-MM-DD format
      startDateStr = formatDate(new Date(startDateValue));
    }
  }

  // If START_DATE is still blank, calculate from IMPORT_DAYS
  if (!startDateStr) {
    const importDays = parseInt(getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS), 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - importDays);
    startDateStr = formatDate(startDate);
  }

  // Handle END_DATE - could be a Date object, string, or empty
  if (endDateValue) {
    if (endDateValue instanceof Date) {
      endDateStr = formatDate(endDateValue);
    } else if (typeof endDateValue === 'string' && endDateValue.trim() !== '') {
      endDateStr = formatDate(new Date(endDateValue));
    }
  }

  // If END_DATE is still blank, use today
  if (!endDateStr) {
    endDateStr = formatDate(new Date());
  }

  logMessage(`Date range: ${startDateStr} to ${endDateStr}`, 'INFO');

  return {
    startDate: startDateStr,
    endDate: endDateStr
  };
}

/**
 * Gets the configured tag name for approved entries
 * @returns {string} Approved tag name
 */
function getApprovedTagName() {
  return getConfigValue('APPROVED_TAG', CONFIG.TAGS.APPROVED);
}

/**
 * Gets the configured tag name for synced entries
 * @returns {string} Synced tag name
 */
function getSyncedTagName() {
  return getConfigValue('SYNCED_TAG', CONFIG.TAGS.SYNCED);
}

/**
 * Adds any missing config keys to the Config sheet without overwriting existing values.
 * Run this after updating the script to add new config options.
 */
function syncMissingConfigKeys() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = ss.getSheetByName(CONFIG.SHEETS.CONFIG);

  if (!configSheet) {
    // No config sheet exists, create it fresh
    createConfigSheet(ss);
    showToast('Config sheet created with all default values');
    return;
  }

  // Define all expected config keys with their default values
  const expectedConfigs = [
    ['START_DATE', ''],
    ['END_DATE', ''],
    ['IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS],
    ['BATCH_SIZE', CONFIG.DEFAULTS.BATCH_SIZE],
    ['LAST_SYNC_DATE', ''],
    ['SYNC_BILLABLE_ONLY', 'FALSE'],
    ['APPROVED_TAG', CONFIG.TAGS.APPROVED],
    ['SYNCED_TAG', CONFIG.TAGS.SYNCED],
    ['DEFAULT_SERVICE_ITEM_ID', ''],
    ['DEFAULT_SERVICE_ITEM_NAME', ''],
    ['TOGGL_API_BUDGET', 180],              // Max Toggl API calls per sync (180 leaves buffer from 240 limit)
    ['LAST_SYNC_API_CALLS', ''],            // API calls used in last sync (for reference)
    ['SYNC_STATUS', '']                     // Current sync status (Paused, etc.)
  ];

  // Get existing keys
  const data = configSheet.getDataRange().getValues();
  const existingKeys = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      existingKeys.add(data[i][0]);
    }
  }

  // Find missing keys
  const missingConfigs = expectedConfigs.filter(([key]) => !existingKeys.has(key));

  if (missingConfigs.length === 0) {
    showToast('All config keys are present');
    return;
  }

  // Add missing keys at the end
  const lastRow = configSheet.getLastRow();
  configSheet.getRange(lastRow + 1, 1, missingConfigs.length, 2).setValues(missingConfigs);

  showToast(`Added ${missingConfigs.length} missing config key(s): ${missingConfigs.map(c => c[0]).join(', ')}`);
}
