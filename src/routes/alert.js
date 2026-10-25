const express = require('express');
const { getAlerts, resolveAlert } = require('../controllers/alertController');

const router = express.Router();

/**
 * GET /alerts (mounted at /alerts)
 * Query: ?active=true|false (default true)
 */
router.get('/', getAlerts);

/**
 * POST /alerts/:id/resolve
 */
router.post('/:id/resolve', resolveAlert);

module.exports = router;
