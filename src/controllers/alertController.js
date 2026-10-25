const Anomaly = require('../models/Anomaly');
const { logger } = require('../utils/logger');

/**
 * GET /alerts
 * Fetch all active (unresolved) anomalies.
 * Query param ?active=false returns all anomalies including resolved.
 */
async function getAlerts(req, res, next) {
  try {
    const activeOnly = req.query.active !== 'false';
    const anomalies = Anomaly.findAll(activeOnly);

    logger.info('Alerts fetched', { activeOnly, count: anomalies.length });

    return res.status(200).json({
      success: true,
      activeOnly,
      count: anomalies.length,
      alerts: anomalies
    });
  } catch (err) {
    logger.error('Alerts endpoint error', { error: err.message, stack: err.stack });
    next(err);
  }
}

/**
 * POST /alerts/:id/resolve
 * Mark an anomaly as resolved.
 */
async function resolveAlert(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid alert id' });
    }

    const changed = Anomaly.resolve(id);
    if (!changed) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    logger.info('Alert resolved via API', { id });

    return res.status(200).json({ success: true, message: 'Alert resolved', id });
  } catch (err) {
    logger.error('Resolve alert error', { error: err.message, id: req.params.id });
    next(err);
  }
}

module.exports = { getAlerts, resolveAlert };
