/**
 * BHARAT ERP — WhatsApp Webhook Route (Sprint 3)
 *
 * Twilio sends POST to this endpoint when the Finance Manager replies.
 * Endpoint: POST /webhook/whatsapp
 *
 * Twilio webhook config:
 *   URL: https://your-domain.up.railway.app/webhook/whatsapp
 *   Method: HTTP POST
 *   Content-Type: application/x-www-form-urlencoded
 *
 * Security: optionally validate Twilio signature (set TWILIO_AUTH_TOKEN + enable validation).
 *
 * Payload fields from Twilio:
 *   From        — sender's WhatsApp number (e.g. whatsapp:+919876543210)
 *   Body        — message text
 *   MessageSid  — unique message ID
 *   AccountSid  — Twilio account SID
 */

const express            = require('express');
const router             = express.Router();
const approvalOrchestrator = require('../../platform/services/ApprovalOrchestrator');
const { ProcessedInvoice } = require('../../domains/p2p/models/P2PModels');

/**
 * POST /webhook/whatsapp
 * Twilio calls this when FM sends a reply.
 *
 * Twilio expects a 200 response quickly (< 15s).
 * We respond immediately with TwiML and process async.
 */
router.post('/whatsapp', async (req, res) => {
  // Always respond 200 to Twilio immediately to prevent retries
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  res.set('Content-Type', 'text/xml').status(200).send(twiml);

  // Extract fields from Twilio payload
  const from       = req.body?.From       || '';
  const body       = req.body?.Body       || '';
  const messageSid = req.body?.MessageSid || '';
  const accountSid = req.body?.AccountSid || '';

  if (!from || !body) {
    console.warn('[Webhook] Received empty WhatsApp payload');
    return;
  }

  // Optional: validate Twilio signature
  if (process.env.NODE_ENV === 'production' && process.env.VALIDATE_TWILIO_SIG === 'true') {
    const valid = _validateTwilioSignature(req);
    if (!valid) {
      console.warn('[Webhook] Invalid Twilio signature — ignoring message');
      return;
    }
  }

  console.log(`[Webhook] WhatsApp from=${from} sid=${messageSid} body="${body.slice(0, 60)}"`);

  try {
    const result = await approvalOrchestrator.processReply(from, body, ProcessedInvoice);
    console.log(`[Webhook] Processed reply: action=${result.action} invoiceId=${result.invoiceId || 'n/a'}`);
  } catch (err) {
    console.error('[Webhook] Error processing WhatsApp reply:', err.message);
  }
});

/**
 * GET /webhook/whatsapp/status
 * Returns all pending approvals — useful for dashboard polling.
 */
router.get('/whatsapp/status', (req, res) => {
  const pending = approvalOrchestrator.getPendingApprovals();
  res.json({
    pending_count: pending.length,
    sessions: pending.map(s => ({
      invoice_id:     s.invoiceId,
      invoice_number: s.invoiceSnapshot?.invoice_number,
      vendor:         s.invoiceSnapshot?.vendor_name,
      amount:         s.invoiceSnapshot?.invoice_amount,
      created_at:     s.createdAt,
      expires_at:     s.expiresAt,
    })),
  });
});

/**
 * POST /webhook/whatsapp/simulate
 * Dev/demo tool: simulate an FM reply without a real WhatsApp message.
 * Body: { from: "whatsapp:+919...", message: "APPROVE" }
 * Disabled in production.
 */
router.post('/whatsapp/simulate', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not available in production' });
  }

  const { from, message } = req.body;
  if (!from || !message) {
    return res.status(400).json({ error: 'from and message are required' });
  }

  try {
    const result = await approvalOrchestrator.processReply(from, message, ProcessedInvoice);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Twilio Signature Validation ─────────────────────────────────────────────

function _validateTwilioSignature(req) {
  try {
    const crypto     = require('crypto');
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const url        = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const signature  = req.headers['x-twilio-signature'] || '';

    // Sort POST params alphabetically, append value
    const params     = req.body || {};
    const sortedKeys = Object.keys(params).sort();
    const paramStr   = sortedKeys.reduce((acc, k) => acc + k + params[k], url);

    const expected = crypto
      .createHmac('sha1', authToken)
      .update(paramStr)
      .digest('base64');

    return expected === signature;
  } catch (e) {
    console.error('[Webhook] Signature validation error:', e.message);
    return false;
  }
}

module.exports = router;
