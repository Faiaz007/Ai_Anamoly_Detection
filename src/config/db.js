const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const DB_FILE = path.join(__dirname, '..', 'data', 'anomalies.sqlite');

// Ensure data directory exists
const DATA_DIR = path.dirname(DB_FILE);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;
let dbReady = null;

/**
 * Initialize the SQLite database (sql.js WASM build) and create schema.
 * Returns a promise that resolves to the database instance.
 */
async function initDb() {
  if (db) return db;
  if (dbReady) return dbReady;

  dbReady = (async () => {
    // sql.js v1 exports an async factory via .default
    const SQL = (require('sql.js').default || require('sql.js'));
    const sql = await SQL();
    db = new sql.Database();

    // Persistence: load existing file if present
    if (fs.existsSync(DB_FILE)) {
      try {
        const filebuf = fs.readFileSync(DB_FILE);
        db = new sql.Database(filebuf);
        logger.info('Loaded existing SQLite database', { path: DB_FILE });
      } catch (err) {
        logger.warn('Failed to load existing DB file, starting fresh', {
          path: DB_FILE,
          error: err.message
        });
        db = new sql.Database();
      }
    }

    // Create schema
    db.run(`
      CREATE TABLE IF NOT EXISTS anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_name TEXT NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER,
        records_returned INTEGER,
        anomaly_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT,
        ai_alert TEXT,
        detected_at TEXT NOT NULL,
        resolved INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_anomalies_api_name ON anomalies(api_name);
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_anomalies_detected_at ON anomalies(detected_at);
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_anomalies_resolved ON anomalies(resolved);
    `);

    logger.info('Database initialized', { path: DB_FILE });
    return db;
  })();

  return dbReady;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

/**
 * Persist the in-memory database to disk.
 */
function persistDb() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
    logger.debug('Database persisted to disk', { path: DB_FILE });
  } catch (err) {
    logger.error('Failed to persist database to disk', {
      path: DB_FILE,
      error: err.message
    });
  }
}

module.exports = { initDb, getDb, persistDb, DB_FILE };
