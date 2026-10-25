const { GoogleGenAI } = require('@google/genai');
const { logger } = require('../utils/logger');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// Retry configuration
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000;

// Lazily initialize the Gemini client only when an API key is present.
let genAI = null;
function getGenAI() {
  if (!genAI && GEMINI_API_KEY) {
    try {
      genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    } catch (err) {
      logger.error('Failed to initialize Gemini client', { error: err.message });
      genAI = false; // sentinel: initialization failed, do not retry
    }
  }
  return genAI || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the prompt sent to Gemini. Contains only verified anomaly facts —
 * no patient-identifying information, no raw API responses, no secrets.
 * @param {Object} anomaly
 * @returns {string}
 */
function buildPrompt(anomaly) {
  const issues = [];

  if (anomaly.anomaly_type === 'failed_request') {
    issues.push(`HTTP status ${anomaly.status_code}`);
  }
  if (anomaly.anomaly_type === 'high_response_time') {
    issues.push(`response time ${anomaly.response_time_ms} ms`);
  }
  if (anomaly.anomaly_type === 'missing_or_zero_records') {
    const count = anomaly.records_returned === null || anomaly.records_returned === undefined
      ? 'missing'
      : String(anomaly.records_returned);
    issues.push(`${count} records returned`);
  }
  if (anomaly.anomaly_type === 'malformed_data') {
    issues.push('malformed or invalid input data');
  }

  const issuesText = issues.length > 0 ? issues.join('; ') : 'unexpected behavior';

  return `You are an expert API monitoring engineer. Generate a concise, human-readable alert for the following verified API anomaly.

VERIFIED FACTS (do not question or re-evaluate these; the rule engine already determined this is an anomaly):
- API name: ${anomaly.api_name}
- Status code: ${anomaly.status_code ?? 'N/A'}
- Response time: ${anomaly.response_time_ms ?? 'N/A'} ms
- Records returned: ${anomaly.records_returned ?? 'N/A'}
- Detected Issue(s): ${issuesText}
- Severity: ${anomaly.severity}

TASK: Write a 2-3 sentence alert with exactly these three labelled parts:
1. ISSUE: State the observed problem using only the verified facts above.
2. Hypothesis: Offer one possible explanation, clearly prefixed with "Hypothesis:". Treat this as uncertain, not a confirmed root cause.
3. NEXT ACTION: Recommend one concrete next step for the on-call engineer.

Do not include any patient-identifying information. Do not include any preamble beyond the three labelled parts. Output plain text only, no markdown formatting.

Alert:`;
}

/**
 * Template-based fallback alert when Gemini is unavailable, rate-limited,
 * misconfigured, or returns invalid content. Persists the anomaly even
 * when LLM generation fails.
 * @param {Object} anomaly
 * @returns {string}
 */
function buildFallbackAlert(anomaly) {
  const parts = [`${anomaly.api_name}`];

  if (anomaly.anomaly_type === 'failed_request') {
    parts.push(`failed with status ${anomaly.status_code}`);
  }
  if (anomaly.anomaly_type === 'high_response_time') {
    parts.push(`is slow (${anomaly.response_time_ms} ms)`);
  }
  if (anomaly.anomaly_type === 'missing_or_zero_records') {
    const count = anomaly.records_returned === null || anomaly.records_returned === undefined
      ? 'no'
      : String(anomaly.records_returned);
    parts.push(`returned ${count} records`);
  }
  if (anomaly.anomaly_type === 'malformed_data') {
    parts.push('received malformed input data');
  }

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

/**
 * Determine whether an error is transient and worth retrying.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  const status = err.status || err.statusCode;
  if (status === 429 || status === 503 || status === 504) return true;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

/**
 * Validate the Gemini response shape and content.
 * @param {Object} response
 * @returns {string} validated text content
 */
function validateGeminiResponse(response) {
  if (!response) {
    throw new Error('Gemini response is null or undefined');
  }
  if (typeof response.text !== 'string' || !response.text.trim()) {
    throw new Error('Gemini response missing text content');
  }
  const content = response.text.trim();

  // Structure validation: must contain the three labelled parts
  const lower = content.toLowerCase();
  if (!lower.includes('issue') || !lower.includes('hypothesis') || !lower.includes('next action')) {
    throw new Error('Gemini response missing required labelled sections');
  }

  return content;
}

/**
 * Single Gemini generateContent call with timeout.
 * @param {Object} anomaly
 * @returns {Promise<string>}
 */
async function generateAlertOnce(anomaly) {
  const client = getGenAI();
  if (!client) {
    throw new Error('Gemini API key not configured or client initialization failed');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await client.models.generateContent(
      {
        model: GEMINI_MODEL,
        contents: buildPrompt(anomaly),
        config: {
          temperature: 0.4,
          maxOutputTokens: 200,
        },
      },
      { signal: controller.signal }
    );

    return validateGeminiResponse(response);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Single Gemini generateContent call with timeout.
 * Accepts an optional client for dependency injection in tests.
 * @param {Object} anomaly
 * @param {Object} [genAIClient]
 * @returns {Promise<string>}
 */
async function generateAlertOnce(anomaly, genAIClient) {
  const client = genAIClient || getGenAI();
  if (!client) {
    throw new Error('Gemini API key not configured or client initialization failed');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await client.models.generateContent(
      {
        model: GEMINI_MODEL,
        contents: buildPrompt(anomaly),
        config: {
          temperature: 0.4,
          maxOutputTokens: 200,
        },
      },
      { signal: controller.signal }
    );

    return validateGeminiResponse(response);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate alert with limited retries for transient errors.
 * Falls back to template alert on any failure.
 * @param {Object} anomaly
 * @param {Object} [genAIClient]
 * @returns {Promise<string>}
 */
async function generateAlertWithRetry(anomaly, genAIClient) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await generateAlertOnce(anomaly, genAIClient);
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === MAX_RETRIES;
      if (!isLastAttempt && isRetryableError(err)) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        logger.warn('Gemini transient error, retrying', {
          attempt: attempt + 1,
          maxAttempts: MAX_RETRIES + 1,
          backoffMs,
          error: err.message
        });
        await sleep(backoffMs);
        continue;
      }

      if (!isRetryableError(err)) {
        logger.warn('Gemini non-retryable error; using fallback', {
          api_name: anomaly.api_name,
          error: err.message
        });
        break;
      }

      logger.warn('Gemini max retries reached; using fallback', {
        api_name: anomaly.api_name,
        error: err.message
      });
      break;
    }
  }

  logger.error('Gemini alert generation failed after retries; using fallback', {
    api_name: anomaly.api_name,
    error: lastError ? lastError.message : 'unknown'
  });
  return buildFallbackAlert(anomaly);
}

/**
 * Generate a human-readable alert for a detected anomaly.
 * The deterministic rule engine is the source of truth for anomaly detection
 * and severity; Gemini only words the verified facts into a readable alert.
 * Persistence of the anomaly is handled by the caller regardless of LLM outcome.
 * @param {Object} anomaly
 * @param {Object} [genAIClient] optional injected client for testing
 * @returns {Promise<string>}
 */
async function generateAlert(anomaly, genAIClient) {
  if (!GEMINI_API_KEY && !genAIClient) {
    logger.debug('No GEMINI_API_KEY configured; using fallback alert', {
      api_name: anomaly.api_name
    });
    return buildFallbackAlert(anomaly);
  }

  try {
    return await generateAlertWithRetry(anomaly, genAIClient);
  } catch (err) {
    logger.error('Gemini alert generation failed; using fallback', {
      api_name: anomaly.api_name,
      error: err.message
    });
    return buildFallbackAlert(anomaly);
  }
}

module.exports = {
  generateAlert,
  generateAlertOnce,
  buildPrompt,
  buildFallbackAlert,
  getGenAI,
  GEMINI_MODEL,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS
};
