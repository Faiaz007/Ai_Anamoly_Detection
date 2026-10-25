const express = require('express');
const path = require('path');
const monitorRoute = require('./src/routes/monitor');
const alertRoute = require('./src/routes/alert');
const errorHandler = require('./src/middleware/errorHandler');
const { initDb } = require('./src/config/db');
const { logger } = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing
app.use(express.json({ limit: '2mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });
  next();
});

// API routes
app.use('/monitor', monitorRoute);
app.use('/alerts', alertRoute);

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Root route serves the frontend UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize database before starting the server
initDb().then(() => {
  const server = app.listen(PORT, () => {
    logger.info('Server started', { port: PORT, env: process.env.NODE_ENV || 'development' });
    console.log(`Intelligent API Monitor running at http://localhost:${PORT}`);
  });
}).catch((err) => {
  logger.error('Failed to initialize database', { error: err.message });
  process.exit(1);
});

module.exports = { app };
