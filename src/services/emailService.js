const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    logger.warn('SMTP not fully configured; email alerts are disabled');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: parseInt(SMTP_PORT, 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

/**
 * Send an anomaly report email (optional feature).
 * @param {Array} anomalies - list of anomaly records
 * @returns {Promise<Object>}
 */
async function sendAnomalyReport(anomalies) {
  if (!ALERT_EMAIL_TO) {
    logger.warn('ALERT_EMAIL_TO not set; skipping email report');
    return { sent: false, reason: 'ALERT_EMAIL_TO not configured' };
  }

  const transport = getTransporter();
  if (!transport) {
    return { sent: false, reason: 'SMTP not configured' };
  }

  const summary = anomalies
    .map(
      (a) => `- [${a.severity.toUpperCase()}] ${a.api_name}: ${a.ai_alert || a.message}`
    )
    .join('\n');

  try {
    const info = await transport.sendMail({
      from: SMTP_FROM,
      to: ALERT_EMAIL_TO,
      subject: `[API Monitor] ${anomalies.length} Anomaly(ies) Detected`,
      text: `The following API anomalies were detected:\n\n${summary}\n\nGenerated at ${new Date().toISOString()}`,
      html: `<h2>API Anomaly Report</h2><p>${anomalies.length} anomaly(ies) detected.</p><ul>${anomalies.map((a) => `<li><strong>[${a.severity.toUpperCase()}]</strong> ${a.api_name}: ${a.ai_alert || a.message}</li>`).join('')}</ul>`
    });

    logger.info('Anomaly report email sent', {
      to: ALERT_EMAIL_TO,
      count: anomalies.length,
      messageId: info.messageId
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error('Failed to send anomaly report email', { error: err.message });
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendAnomalyReport, getTransporter };
