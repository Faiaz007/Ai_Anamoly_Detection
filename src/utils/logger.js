const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' };

function formatTimestamp() {
  return new Date().toISOString();
}

function formatLog(level, message, meta = {}) {
  const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
  return `[${formatTimestamp()}] [${level}] ${message}${metaStr}`;
}

function writeToFile(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // Fallback to console only if file logging fails
    console.error('[LOGGER_FILE_ERROR]', err.message);
  }
}

const logger = {
  info(message, meta) {
    const line = formatLog(LEVELS.INFO, message, meta);
    console.log(line);
    writeToFile(line);
  },
  warn(message, meta) {
    const line = formatLog(LEVELS.WARN, message, meta);
    console.warn(line);
    writeToFile(line);
  },
  error(message, meta) {
    const line = formatLog(LEVELS.ERROR, message, meta);
    console.error(line);
    writeToFile(line);
  },
  debug(message, meta) {
    if (process.env.NODE_ENV === 'development') {
      const line = formatLog(LEVELS.DEBUG, message, meta);
      console.log(line);
      writeToFile(line);
    }
  }
};

module.exports = { logger, LEVELS };
