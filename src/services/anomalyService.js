const { logger } = require('../utils/logger');

// Default thresholds (overridable via environment variables)
const HIGH_RESPONSE_TIME_MS = parseInt(process.env.HIGH_RESPONSE_TIME_MS, 10) || 3000;
const CRITICAL_RESPONSE_TIME_MS = parseInt(process.env.CRITICAL_RESPONSE_TIME_MS, 10) || 5000;

const VALID_ANOMALY_TYPES = [
  'failed_request',
  'high_response_time',
  'missing_or_zero_records',
  'malformed_data'
];

/**
 * Validation result for a single API response entry.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string|null} error
 */

/**
 * Validate a single API response entry structure.
 * @param {Object} entry
 * @returns {ValidationResult}
 */
function validateEntry(entry) {
  if (entry === null || entry === undefined || typeof entry !== 'object' || Array.isArray(entry)) {
    return { valid: false, error: 'Entry must be a non-null object' };
  }

  const { api_name, response_time_ms, status_code, records_returned } = entry;

  if (api_name === null || api_name === undefined || String(api_name).trim() === '') {
    return { valid: false, error: 'api_name is required and must be a non-empty string' };
  }

  if (response_time_ms !== null && response_time_ms !== undefined) {
    if (typeof response_time_ms !== 'number' || !Number.isFinite(response_time_ms) || response_time_ms < 0) {
      return { valid: false, error: 'response_time_ms must be a non-negative number' };
    }
  }

  if (status_code !== null && status_code !== undefined) {
    if (
      typeof status_code !== 'number' ||
      !Number.isInteger(status_code) ||
      status_code < 100 ||
      status_code > 599
    ) {
      return { valid: false, error: 'status_code must be an integer between 100 and 599' };
    }
  }

  if (records_returned !== null && records_returned !== undefined) {
    if (typeof records_returned !== 'number' || !Number.isFinite(records_returned) || records_returned < 0) {
      return { valid: false, error: 'records_returned must be a non-negative number' };
    }
  }

  return { valid: true, error: null };
}

/**
 * Classify severity based on detected anomaly conditions.
 * @param {Array<string>} types
 * @param {number|null} statusCode
 * @param {number|null} responseTime
 * @returns {string} one of: critical, high, medium, low
 */
function classifySeverity(types, statusCode, responseTime) {
  if (types.includes('failed_request') && (statusCode === null || statusCode >= 500)) {
    return 'critical';
  }
  if (types.includes('failed_request') && statusCode !== null && statusCode >= 400) {
    return 'high';
  }
  if (types.includes('malformed_data')) {
    return 'medium';
  }
  if (types.includes('high_response_time') && responseTime !== null && responseTime >= CRITICAL_RESPONSE_TIME_MS) {
    return 'high';
  }
  if (types.includes('high_response_time')) {
    return 'medium';
  }
  if (types.includes('missing_or_zero_records')) {
    return 'low';
  }
  return 'medium';
}

/**
 * Detect anomalies for a single API response entry.
 * Returns anomaly condition objects (may be empty).
 * @param {Object} apiResponse
 * @returns {Array<Object>}
 */
function detectAnomaliesForEntry(apiResponse) {
  const anomalies = [];
  const {
    api_name,
    response_time_ms,
    status_code,
    records_returned
  } = apiResponse;

  // 1. Failed request (server error)
  if (status_code !== null && status_code !== undefined && status_code >= 500) {
    anomalies.push({
      anomaly_type: 'failed_request',
      message: `Server error: received HTTP ${status_code}.`
    });
  }

  // 2. Failed request (client error)
  if (status_code !== null && status_code !== undefined && status_code >= 400 && status_code < 500) {
    anomalies.push({
      anomaly_type: 'failed_request',
      message: `Client error: received HTTP ${status_code}.`
    });
  }

  // 3. High response time
  if (response_time_ms !== null && response_time_ms !== undefined && response_time_ms > HIGH_RESPONSE_TIME_MS) {
    anomalies.push({
      anomaly_type: 'high_response_time',
      message: `Response time ${response_time_ms}ms exceeds threshold ${HIGH_RESPONSE_TIME_MS}ms.`
    });
  }

  // 4. Missing or zero records
  if (records_returned === null || records_returned === undefined) {
    anomalies.push({
      anomaly_type: 'missing_or_zero_records',
      message: 'No records returned (missing).'
    });
  } else if (records_returned === 0) {
    anomalies.push({
      anomaly_type: 'missing_or_zero_records',
      message: 'No records returned (0).'
    });
  }

  // Attach context to each anomaly
  return anomalies.map((a) => ({
    ...a,
    api_name,
    status_code,
    response_time_ms,
    records_returned,
    detected_at: new Date().toISOString()
  }));
}

/**
 * Validate a batch of API responses.
 * Returns { valid: boolean, invalidEntries: Array<{index, entry, error}> }.
 * @param {Array} apiResponses
 * @returns {Object}
 */
function validateBatch(apiResponses) {
  if (!Array.isArray(apiResponses)) {
    return { valid: false, invalidEntries: [{ index: null, entry: apiResponses, error: 'Request body must be a non-empty array' }] };
  }

  if (apiResponses.length === 0) {
    return { valid: false, invalidEntries: [{ index: null, entry: null, error: 'Request body must be a non-empty array' }] };
  }

  const invalidEntries = [];
  apiResponses.forEach((entry, index) => {
    const result = validateEntry(entry);
    if (!result.valid) {
      invalidEntries.push({ index, entry, error: result.error });
    }
  });

  return { valid: invalidEntries.length === 0, invalidEntries };
}

/**
 * Batch-detect anomalies across multiple API responses.
 * Skips structurally invalid entries (logged) and processes the rest.
 * @param {Array} apiResponses
 * @returns {Object} { anomalies: Array<Object>, skipped: Array<{index, error}> }
 */
function detectAnomalies(apiResponses) {
  if (!Array.isArray(apiResponses)) {
    logger.warn('detectAnomalies received non-array input', { type: typeof apiResponses });
    return { anomalies: [], skipped: [] };
  }

  const allAnomalies = [];
  const skipped = [];

  for (let i = 0; i < apiResponses.length; i++) {
    const entry = apiResponses[i];
    const validation = validateEntry(entry);

    if (!validation.valid) {
      logger.warn('Skipping invalid entry', { index: i, error: validation.error, entry });
      skipped.push({ index: i, error: validation.error });
      continue;
    }

    const entryAnomalies = detectAnomaliesForEntry(entry);
    for (const a of entryAnomalies) {
      a.severity = classifySeverity(
        [a.anomaly_type],
        a.status_code,
        a.response_time_ms
      );
      allAnomalies.push(a);
    }
  }

  logger.info('Anomaly detection complete', {
    inputs: apiResponses.length,
    anomaliesDetected: allAnomalies.length,
    skipped: skipped.length
  });

  return { anomalies: allAnomalies, skipped };
}

module.exports = {
  detectAnomalies,
  detectAnomaliesForEntry,
  validateEntry,
  validateBatch,
  classifySeverity,
  HIGH_RESPONSE_TIME_MS,
  CRITICAL_RESPONSE_TIME_MS,
  VALID_ANOMALY_TYPES
};
