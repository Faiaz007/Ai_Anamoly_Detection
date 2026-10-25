import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAnomalies,
  validateEntry,
  validateBatch,
  classifySeverity,
  HIGH_RESPONSE_TIME_MS,
  CRITICAL_RESPONSE_TIME_MS
} from '../src/services/anomalyService.js';
import { buildFallbackAlert, buildPrompt } from '../src/services/aiAlertService.js';

// ---- anomalyService: validateEntry ----

test('validateEntry accepts a valid entry', () => {
  const r = validateEntry({ api_name: 'API', response_time_ms: 100, status_code: 200, records_returned: 5 });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.error, null);
});

test('validateEntry rejects missing api_name', () => {
  const r = validateEntry({ response_time_ms: 100, status_code: 200, records_returned: 5 });
  assert.strictEqual(r.valid, false);
  assert.ok(r.error.includes('api_name'));
});

test('validateEntry rejects empty api_name', () => {
  const r = validateEntry({ api_name: '   ', response_time_ms: 100, status_code: 200, records_returned: 5 });
  assert.strictEqual(r.valid, false);
});

test('validateEntry rejects non-object', () => {
  assert.strictEqual(validateEntry(null).valid, false);
  assert.strictEqual(validateEntry('string').valid, false);
  assert.strictEqual(validateEntry([1, 2]).valid, false);
});

test('validateEntry rejects negative response_time_ms', () => {
  const r = validateEntry({ api_name: 'A', response_time_ms: -1, status_code: 200, records_returned: 5 });
  assert.strictEqual(r.valid, false);
});

test('validateEntry rejects out-of-range status_code', () => {
  const r = validateEntry({ api_name: 'A', response_time_ms: 100, status_code: 600, records_returned: 5 });
  assert.strictEqual(r.valid, false);
  const r2 = validateEntry({ api_name: 'A', response_time_ms: 100, status_code: 99, records_returned: 5 });
  assert.strictEqual(r2.valid, false);
});

test('validateEntry rejects negative records_returned', () => {
  const r = validateEntry({ api_name: 'A', response_time_ms: 100, status_code: 200, records_returned: -1 });
  assert.strictEqual(r.valid, false);
});

test('validateEntry allows null numeric fields', () => {
  const r = validateEntry({ api_name: 'A', response_time_ms: null, status_code: null, records_returned: null });
  assert.strictEqual(r.valid, true);
});

// ---- anomalyService: validateBatch ----

test('validateBatch rejects non-array', () => {
  const r = validateBatch({ not: 'array' });
  assert.strictEqual(r.valid, false);
});

test('validateBatch rejects empty array', () => {
  const r = validateBatch([]);
  assert.strictEqual(r.valid, false);
});

test('validateBatch accepts valid array', () => {
  const r = validateBatch([{ api_name: 'A', response_time_ms: 100, status_code: 200, records_returned: 5 }]);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.invalidEntries.length, 0);
});

test('validateBatch reports invalid entries with index', () => {
  const r = validateBatch([
    { api_name: 'A', response_time_ms: 100, status_code: 200, records_returned: 5 },
    { response_time_ms: 100, status_code: 200, records_returned: 5 } // missing api_name
  ]);
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.invalidEntries.length, 1);
  assert.strictEqual(r.invalidEntries[0].index, 1);
});

// ---- anomalyService: detectAnomalies ----

test('detectAnomalies returns empty for healthy input', () => {
  const r = detectAnomalies([{ api_name: 'HealthyAPI', response_time_ms: 200, status_code: 200, records_returned: 10 }]);
  assert.deepStrictEqual(r.anomalies, []);
  assert.strictEqual(r.skipped.length, 0);
});

test('detectAnomalies flags failed request (500) as critical', () => {
  const r = detectAnomalies([{ api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 }]);
  assert.ok(r.anomalies.some((a) => a.anomaly_type === 'failed_request' && a.severity === 'critical'));
});

test('detectAnomalies flags failed request (400) as high', () => {
  const r = detectAnomalies([{ api_name: 'API', response_time_ms: 200, status_code: 400, records_returned: 5 }]);
  assert.ok(r.anomalies.some((a) => a.anomaly_type === 'failed_request' && a.severity === 'high'));
});

test('detectAnomalies flags high response time', () => {
  const r = detectAnomalies([{ api_name: 'SlowAPI', response_time_ms: 5500, status_code: 200, records_returned: 10 }]);
  assert.ok(r.anomalies.some((a) => a.anomaly_type === 'high_response_time'));
});

test('detectAnomalies flags missing records', () => {
  const r = detectAnomalies([{ api_name: 'EmptyAPI', response_time_ms: 200, status_code: 200, records_returned: null }]);
  assert.ok(r.anomalies.some((a) => a.anomaly_type === 'missing_or_zero_records'));
});

test('detectAnomalies flags zero records', () => {
  const r = detectAnomalies([{ api_name: 'EmptyAPI', response_time_ms: 200, status_code: 200, records_returned: 0 }]);
  assert.ok(r.anomalies.some((a) => a.anomaly_type === 'missing_or_zero_records'));
});

test('detectAnomalies skips invalid entries and processes valid ones', () => {
  const r = detectAnomalies([
    { api_name: 'GoodAPI', response_time_ms: 200, status_code: 200, records_returned: 5 },
    { response_time_ms: 100, status_code: 200, records_returned: 5 }, // invalid: missing api_name
    { api_name: 'BadAPI', response_time_ms: 9999, status_code: 500, records_returned: 0 }
  ]);
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].index, 1);
  assert.ok(r.anomalies.length > 0);
  assert.ok(r.anomalies.some((a) => a.api_name === 'BadAPI'));
});

test('detectAnomalies on non-array returns empty', () => {
  const r = detectAnomalies('not array');
  assert.deepStrictEqual(r.anomalies, []);
  assert.deepStrictEqual(r.skipped, []);
});

// ---- anomalyService: classifySeverity ----

test('classifySeverity critical for 500', () => {
  assert.strictEqual(classifySeverity(['failed_request'], 500, 200), 'critical');
});

test('classifySeverity high for 400', () => {
  assert.strictEqual(classifySeverity(['failed_request'], 400, 200), 'high');
});

test('classifySeverity high for critical latency', () => {
  assert.strictEqual(classifySeverity(['high_response_time'], 200, CRITICAL_RESPONSE_TIME_MS), 'high');
});

test('classifySeverity medium for normal latency anomaly', () => {
  assert.strictEqual(classifySeverity(['high_response_time'], 200, HIGH_RESPONSE_TIME_MS + 100), 'medium');
});

test('classifySeverity low for missing records', () => {
  assert.strictEqual(classifySeverity(['missing_or_zero_records'], 200, 200), 'low');
});

test('classifySeverity medium for malformed data', () => {
  assert.strictEqual(classifySeverity(['malformed_data'], null, null), 'medium');
});

// ---- thresholds ----

test('HIGH_RESPONSE_TIME_MS default is 3000', () => {
  assert.strictEqual(HIGH_RESPONSE_TIME_MS, 3000);
});

test('CRITICAL_RESPONSE_TIME_MS default is 5000', () => {
  assert.strictEqual(CRITICAL_RESPONSE_TIME_MS, 5000);
});

// ---- aiAlertService: buildFallbackAlert ----

test('buildFallbackAlert includes api name and issue', () => {
  const alert = buildFallbackAlert({
    api_name: 'AppointmentAPI',
    anomaly_type: 'failed_request',
    status_code: 500,
    response_time_ms: 5500,
    records_returned: 0,
    severity: 'critical'
  });
  assert.ok(alert.includes('AppointmentAPI'));
  assert.ok(alert.includes('500'));
});

test('buildFallbackAlert handles high response time', () => {
  const alert = buildFallbackAlert({
    api_name: 'SlowAPI',
    anomaly_type: 'high_response_time',
    status_code: 200,
    response_time_ms: 5500,
    records_returned: 10,
    severity: 'medium'
  });
  assert.ok(alert.includes('SlowAPI'));
  assert.ok(alert.includes('5500 ms'));
});

test('buildFallbackAlert handles missing records', () => {
  const alert = buildFallbackAlert({
    api_name: 'EmptyAPI',
    anomaly_type: 'missing_or_zero_records',
    status_code: 200,
    response_time_ms: 200,
    records_returned: null,
    severity: 'low'
  });
  assert.ok(alert.includes('EmptyAPI'));
  assert.ok(alert.includes('no'));
});

// ---- aiAlertService: buildPrompt ----

test('buildPrompt includes verified facts only', () => {
  const prompt = buildPrompt({
    api_name: 'AppointmentAPI',
    anomaly_type: 'missing_or_zero_records',
    status_code: 500,
    response_time_ms: 5500,
    records_returned: 0,
    severity: 'critical'
  });
  assert.ok(prompt.includes('AppointmentAPI'));
  assert.ok(prompt.includes('500'));
  assert.ok(prompt.includes('5500'));
  assert.ok(prompt.includes('0 records'));
  assert.ok(prompt.includes('critical'));
  // LLM must not decide anomaly existence - facts are pre-determined
  assert.ok(prompt.includes('Detected Issue(s):'));
});
