const Anomaly = require('../models/Anomaly');
const { detectAnomalies, validateBatch } = require('../services/anomalyService');
const { generateAlert } = require('../services/aiAlertService');
const { sendAnomalyReport } = require('../services/emailService');
const { logger } = require('../utils/logger');

/**
 * Resolve the input array from either a JSON body or an uploaded JSON file.
 * @param {Object} req
 * @returns {Array|null}
 */
function resolveInput(req) {
  // Uploaded JSON file takes precedence
  if (req.file && req.file.buffer) {
    try {
      const parsed = JSON.parse(req.file.buffer.toString('utf8'));
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      logger.warn('Failed to parse uploaded JSON file', { error: err.message });
      return null;
    }
  }
  return Array.isArray(req.body) ? req.body : null;
}

/**
 * POST /monitor
 * Accepts a batch of API response objects (JSON array or uploaded JSON file),
 * detects anomalies, generates AI-powered alerts, stores them, and returns results.
 * Email reporting is fire-and-forget and never blocks the response.
 */
async function monitor(req, res, next) {
  try {
    const input = resolveInput(req);

    if (!input) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input',
        message: 'Request body must be a non-empty JSON array, or upload a JSON file via the "file" field.'
      });
    }

    // Validate that we received a non-empty array
    const validation = validateBatch(input);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input',
        message: validation.invalidEntries
          .map((e) => (e.index !== null ? `item[${e.index}]: ${e.error}` : e.error))
          .join('; '),
        invalidEntries: validation.invalidEntries
      });
    }

    // Detect anomalies across the batch (invalid entries are skipped internally)
    const { anomalies, skipped } = detectAnomalies(input);

    const results = [];

    for (const anomaly of anomalies) {
      // Generate AI-powered alert from verified anomaly facts only
      const aiAlert = await generateAlert(anomaly);

      // Store anomaly with AI alert
      const saved = Anomaly.create({
        ...anomaly,
        ai_alert: aiAlert,
        message: anomaly.message
      });

      results.push(saved);
    }

    // Email report: fire-and-forget, never blocks the response
    if (results.length > 0) {
      sendAnomalyReport(results).catch((err) => {
        logger.warn('Email report failed (non-fatal)', { error: err.message });
      });
    }

    logger.info('Monitor request processed', {
      inputs: input.length,
      anomalies: results.length,
      skipped: skipped.length
    });

    return res.status(200).json({
      success: true,
      inputsReceived: input.length,
      anomaliesDetected: results.length,
      skipped: skipped.length,
      anomalies: results,
      skippedEntries: skipped
    });
  } catch (err) {
    logger.error('Monitor endpoint error', { error: err.message, stack: err.stack });
    next(err);
  }
}

module.exports = { monitor };
