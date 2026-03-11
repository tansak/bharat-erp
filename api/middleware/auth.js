/**
 * BHARAT ERP — Auth & Tenant Middleware (Sprint 2)
 *
 * Simple API key auth for MVP. Replace with JWT in Sprint 3.
 * Multi-tenant: x-tenant-id header identifies the company.
 */

/**
 * API Key authentication
 * In dev/demo mode: any key works (or no key).
 * In production: check against env-configured keys.
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const masterKey = process.env.API_MASTER_KEY;

  // Demo mode — no key configured, allow all
  if (!masterKey || process.env.NODE_ENV !== 'production') {
    req.tenant_id = req.headers['x-tenant-id'] || 'demo-corp';
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'x-api-key header required' });
  }
  if (apiKey !== masterKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  req.tenant_id = req.headers['x-tenant-id'] || 'demo-corp';
  next();
}

/**
 * Request logger
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 400 ? 'ERROR' : 'INFO';
    console.log(`[${level}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms tenant=${req.tenant_id || '-'}`);
  });
  next();
}

/**
 * Error handler
 */
function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
}

module.exports = { apiKeyAuth, requestLogger, errorHandler };
