/**
 * Centralized error-handling middleware.
 * Always responds with JSON and never leaks stack traces to the client
 * unless NODE_ENV=development.
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[${new Date().toISOString()}] [ERROR] ${message}\n${err.stack || ''}`);

  const response = {
    success: false,
    error: message
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  return res.status(statusCode).json(response);
}

module.exports = errorHandler;
