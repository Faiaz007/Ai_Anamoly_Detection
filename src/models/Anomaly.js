const { getDb, persistDb } = require('../config/db');
const { logger } = require('../utils/logger');

const Anomaly = {
  /**
   * Insert a new anomaly record.
   * @param {Object} anomaly
   * @returns {Object} the inserted record with id
   */
  create(anomaly) {
    const db = getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO anomalies
      (api_name, status_code, response_time_ms, records_returned, anomaly_type,
       severity, message, ai_alert, detected_at, resolved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    stmt.run([
      anomaly.api_name,
      anomaly.status_code !== undefined ? anomaly.status_code : null,
      anomaly.response_time_ms !== undefined ? anomaly.response_time_ms : null,
      anomaly.records_returned !== undefined ? anomaly.records_returned : null,
      anomaly.anomaly_type,
      anomaly.severity,
      anomaly.message || null,
      anomaly.ai_alert || null,
      anomaly.detected_at || now,
      now,
      now
    ]);
    stmt.free();
    persistDb();

    // Get the last inserted row id via MAX(id) (more reliable across sql.js builds)
    const maxRow = db.exec('SELECT MAX(id) AS id FROM anomalies');
    const id = maxRow && maxRow[0] && maxRow[0].values && maxRow[0].values[0]
      ? maxRow[0].values[0][0]
      : null;

    logger.info('Anomaly recorded', {
      id,
      api_name: anomaly.api_name,
      anomaly_type: anomaly.anomaly_type,
      severity: anomaly.severity
    });

    return { id, ...anomaly, detected_at: anomaly.detected_at || now, resolved: 0, created_at: now, updated_at: now };
  },

  /**
   * Fetch all anomalies. If activeOnly is true, return only unresolved ones.
   * @param {boolean} activeOnly
   * @returns {Array}
   */
  findAll(activeOnly = true) {
    const db = getDb();
    let sql = `SELECT * FROM anomalies`;
    const params = [];
    if (activeOnly) {
      sql += ` WHERE resolved = 0`;
    }
    sql += ` ORDER BY detected_at DESC`;

    const rows = db.exec(sql, params);

    const anomalies = [];
    if (rows.length > 0) {
      const { columns, values } = rows[0];
      for (const row of values) {
        const obj = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        anomalies.push(obj);
      }
    }

    return anomalies;
  },

  /**
   * Find a single anomaly by id.
   * @param {number} id
   * @returns {Object|null}
   */
  findById(id) {
    const db = getDb();
    const rows = db.exec(
      `SELECT * FROM anomalies WHERE id = ?`,
      [id]
    );
    if (rows.length === 0 || rows[0].values.length === 0) return null;
    const { columns, values } = rows[0];
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = values[0][i];
    });
    return obj;
  },

  /**
   * Mark an anomaly as resolved.
   * @param {number} id
   * @returns {boolean}
   */
  resolve(id) {
    const db = getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(
      `UPDATE anomalies SET resolved = 1, updated_at = ? WHERE id = ?`
    );
    const result = stmt.run([now, id]);
    stmt.free();
    persistDb();
    // stmt.run() returns `true` on success in this sql.js build
    const changed = result === true;
    if (changed) {
      logger.info('Anomaly resolved', { id });
    }
    return changed;
  }
};

module.exports = Anomaly;
