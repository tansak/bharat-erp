/**
 * BHARAT ERP — API Server (Sprint 6)
 * Adds: WhatsApp approval webhook, urlencoded body parser for Twilio
 */
require('dotenv').config();
const express        = require('express');
const mongoose       = require('mongoose');
const { apiKeyAuth, requestLogger, errorHandler } = require('./middleware/auth');
const p2pRoutes      = require('./routes/p2p');
const webhookRoutes    = require('./routes/webhook');
const sourcingRoutes   = require('./routes/sourcing');
const hrRoutes         = require('./routes/hr');
const o2cRoutes        = require('./routes/o2c');
const AIService      = require('../platform/services/AIService');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED.includes('*') || ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key,x-tenant-id,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Body parsers ──────────────────────────────────────────────────
// JSON for API routes
app.use('/api', express.json({ limit: '10mb' }));
// URL-encoded for Twilio webhook (application/x-www-form-urlencoded)
app.use('/webhook', express.urlencoded({ extended: false }));

app.use(requestLogger);

// ── Health (no auth) ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  const approvalOrch = require('../platform/services/ApprovalOrchestrator');
  res.json({
    status:           'ok',
    platform:         'Bharat ERP',
    version:          '7.0.0',
    sprint:           7,
    db:               mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    whatsapp:         process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'mock',
    pending_approvals: approvalOrch.getPendingApprovals().length,
    uptime_s:         Math.round(process.uptime()),
    timestamp:        new Date().toISOString(),
  });
});

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/p2p',      apiKeyAuth, p2pRoutes);
app.use('/api/sourcing', apiKeyAuth, sourcingRoutes);
app.use('/api/hr',      apiKeyAuth, hrRoutes);
app.use('/api/o2c',     apiKeyAuth, o2cRoutes);

// Webhook routes — no API key (Twilio calls these directly)
// Twilio signature validation is used instead (see webhook.js)
app.use('/webhook', webhookRoutes);

app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────
const PORT  = process.env.PORT || 3000;
const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017/bharat_erp';

mongoose.connect(MONGO, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀 Bharat ERP v6.0.0 (Sprint 6) — port ${PORT}`);
      console.log(`   GET  /health`);
      console.log(`   ── P2P ───────────────────────────────`);
      console.log(`   POST /api/p2p/invoices/process`);
      console.log(`   GET  /api/p2p/invoices | GET /api/p2p/dashboard`);
      console.log(`   ── Sourcing ──────────────────────────`);
      console.log(`   POST /api/sourcing/requisitions`);
      console.log(`   GET  /api/sourcing/dashboard`);
      console.log(`   ── HR ────────────────────────────────`);
      console.log(`   POST /api/hr/payroll | GET /api/hr/dashboard`);
      console.log(`   ── O2C ───────────────────────────────`);
      console.log(`   POST /api/o2c/orders | GET /api/o2c/dashboard`);
      console.log(`   ── WhatsApp ──────────────────────────`);
      console.log(`   POST /webhook/whatsapp`);
      console.log(`   GET  /webhook/whatsapp/status`);
      if (!process.env.TWILIO_ACCOUNT_SID) {
        console.log(`   ⚠️  WhatsApp: MOCK mode (set TWILIO_* to go live)`);
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log(`   ⚠️  AI: no ANTHROPIC_API_KEY — agents use fallback logic`);
      }
    });
  })
  .catch(err => { console.error('❌', err.message); process.exit(1); });

['SIGTERM','SIGINT'].forEach(sig =>
  process.on(sig, async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
);

module.exports = app;
