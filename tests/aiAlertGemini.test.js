import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- Gemini integration tests with mocked SDK client (dependency injection) ----

function buildFallbackAlertLocal(anomaly) {
  const parts = [anomaly.api_name];
  if (anomaly.anomaly_type === 'failed_request') parts.push(`failed with status ${anomaly.status_code}`);
  if (anomaly.anomaly_type === 'high_response_time') parts.push(`is slow (${anomaly.response_time_ms} ms)`);
  if (anomaly.anomaly_type === 'missing_or_zero_records') {
    const count = anomaly.records_returned === null || anomaly.records_returned === undefined
      ? 'no'
      : String(anomaly.records_returned);
    parts.push(`returned ${count} records`);
  }
  if (anomaly.anomaly_type === 'malformed_data') parts.push('received malformed input data');
  const detail = parts.slice(1).join(' and ') || 'is behaving abnormally';
  const causeMap = {
    failed_request: 'Hypothesis: possible outage or server issue.',
    high_response_time: 'Hypothesis: possible performance degradation.',
    missing_or_zero_records: 'Hypothesis: possible data issue or empty response.',
    malformed_data: 'Hypothesis: possible schema mismatch or corrupted payload.'
  };
  const nextActionMap = {
    failed_request: 'Next action: check upstream service health and recent deployments.',
    high_response_time: 'Next action: investigate slow dependencies and consider scaling.',
    missing_or_zero_records: 'Next action: verify data source and query parameters.',
    malformed_data: 'Next action: review input validation and upstream schema changes.'
  };
  return `${anomaly.api_name} ${detail}. ${causeMap[anomaly.anomaly_type] || 'Investigate the API.'} ${nextActionMap[anomaly.anomaly_type] || ''}`.trim();
}

const mockClientSuccess = {
  models: {
    generateContent: async () => ({
      text: 'ISSUE: AppointmentAPI failed with status 500 and returned 0 records.\nHypothesis: The upstream service may be experiencing an outage.\nNEXT ACTION: Check the AppointmentAPI health endpoint.'
    })
  }
};

const mockClientTransientError = {
  models: {
    generateContent: async () => { throw new Error('rate limit exceeded'); }
  }
};

const mockClientInvalidStructure = {
  models: {
    generateContent: async () => ({ text: 'Just some random text without required sections.' })
  }
};

const mockClientEmptyText = {
  models: {
    generateContent: async () => ({ text: '' })
  }
};

const mockClientNullText = {
  models: {
    generateContent: async () => ({ text: null })
  }
};

test('generateAlert returns mocked Gemini response with ISSUE/Hypothesis/NEXT ACTION', async () => {
  const { generateAlert } = await import('../src/services/aiAlertService.js');
  const alert = await generateAlert(
    {
      api_name: 'AppointmentAPI',
      anomaly_type: 'failed_request',
      status_code: 500,
      response_time_ms: 5500,
      records_returned: 0,
      severity: 'critical'
    },
    mockClientSuccess
  );
  assert.ok(alert.includes('ISSUE'), 'Alert should contain ISSUE section');
  assert.ok(alert.includes('Hypothesis'), 'Alert should contain Hypothesis section');
  assert.ok(alert.includes('NEXT ACTION'), 'Alert should contain NEXT ACTION section');
  assert.ok(alert.includes('AppointmentAPI'), 'Alert should contain API name');
  assert.ok(alert.includes('500'), 'Alert should contain status code');
});

test('generateAlert falls back when Gemini SDK throws transient error', async () => {
  const { generateAlert, buildFallbackAlert } = await import('../src/services/aiAlertService.js');
  const alert = await generateAlert(
    {
      api_name: 'PatientDataAPI',
      anomaly_type: 'missing_or_zero_records',
      status_code: 200,
      response_time_ms: 800,
      records_returned: 0,
      severity: 'low'
    },
    mockClientTransientError
  );
  const expected = buildFallbackAlert({
    api_name: 'PatientDataAPI',
    anomaly_type: 'missing_or_zero_records',
    status_code: 200,
    response_time_ms: 800,
    records_returned: 0,
    severity: 'low'
  });
  assert.strictEqual(alert, expected);
});

test('generateAlert falls back when Gemini returns invalid structure', async () => {
  const { generateAlert, buildFallbackAlert } = await import('../src/services/aiAlertService.js');
  const alert = await generateAlert(
    {
      api_name: 'TestAPI',
      anomaly_type: 'failed_request',
      status_code: 500,
      response_time_ms: 200,
      records_returned: 10,
      severity: 'critical'
    },
    mockClientInvalidStructure
  );
  const expected = buildFallbackAlert({
    api_name: 'TestAPI',
    anomaly_type: 'failed_request',
    status_code: 500,
    response_time_ms: 200,
    records_returned: 10,
    severity: 'critical'
  });
  assert.strictEqual(alert, expected);
});

test('generateAlert falls back when Gemini returns empty text', async () => {
  const { generateAlert, buildFallbackAlert } = await import('../src/services/aiAlertService.js');
  const alert = await generateAlert(
    {
      api_name: 'EmptyAPI',
      anomaly_type: 'failed_request',
      status_code: 500,
      response_time_ms: 200,
      records_returned: 10,
      severity: 'critical'
    },
    mockClientEmptyText
  );
  const expected = buildFallbackAlert({
    api_name: 'EmptyAPI',
    anomaly_type: 'failed_request',
    status_code: 500,
    response_time_ms: 200,
    records_returned: 10,
    severity: 'critical'
  });
  assert.strictEqual(alert, expected);
});

test('generateAlert falls back when Gemini returns null text', async () => {
  const { generateAlert, buildFallbackAlert } = await import('../src/services/aiAlertService.js');
  const alert = await generateAlert(
    {
      api_name: 'NullAPI',
      anomaly_type: 'failed_request',
      status_code: 500,
      response_time_ms: 200,
      records_returned: 10,
      severity: 'critical'
    },
    mockClientNullText
  );
  const expected = buildFallbackAlert({
    api_name: 'NullAPI',
    anomaly_type: 'failed_request',
    status_code: 500,
    response_time_ms: 200,
    records_returned: 10,
    severity: 'critical'
  });
  assert.strictEqual(alert, expected);
});

test('generateAlert falls back when no API key and no client provided', async () => {
  const { generateAlert } = await import('../src/services/aiAlertService.js');
  const origKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const alert = await generateAlert({
      api_name: 'NoKeyAPI',
      anomaly_type: 'failed_request',
      status_code: 500,
      response_time_ms: 200,
      records_returned: 10,
      severity: 'critical'
    });
    assert.ok(alert.includes('NoKeyAPI'));
    assert.ok(alert.includes('500'));
    assert.ok(alert.includes('Hypothesis:'));
    assert.ok(alert.includes('Next action:'));
  } finally {
    process.env.GEMINI_API_KEY = origKey;
  }
});

test('buildFallbackAlert contains labelled hypothesis and next action', () => {
  const alert = buildFallbackAlertLocal({
    api_name: 'BillingAPI',
    anomaly_type: 'high_response_time',
    status_code: 200,
    response_time_ms: 5500,
    records_returned: 50,
    severity: 'medium'
  });
  assert.ok(alert.includes('BillingAPI'));
  assert.ok(alert.includes('5500 ms'));
  assert.ok(alert.includes('Hypothesis:'));
  assert.ok(alert.includes('Next action:'));
});

// Static import test for buildFallbackAlert (pure function, no mocking needed)
import { buildFallbackAlert } from '../src/services/aiAlertService.js';

test('buildFallbackAlert (module export) includes api name and status', () => {
  const alert = buildFallbackAlert({
    api_name: 'StaticAPI',
    anomaly_type: 'failed_request',
    status_code: 500,
    response_time_ms: 200,
    records_returned: 10,
    severity: 'critical'
  });
  assert.ok(alert.includes('StaticAPI'));
  assert.ok(alert.includes('500'));
  assert.ok(alert.includes('Hypothesis:'));
  assert.ok(alert.includes('Next action:'));
});
