/**
 * BHARAT ERP — WhatsApp Notification Service (Sprint 3)
 *
 * Sends structured approval requests to Finance Manager via WhatsApp.
 * Uses Twilio's WhatsApp Business API (sandbox or production).
 *
 * ENV vars needed:
 *   TWILIO_ACCOUNT_SID   — Twilio account SID
 *   TWILIO_AUTH_TOKEN    — Twilio auth token
 *   TWILIO_WA_FROM       — WhatsApp sender, e.g. whatsapp:+14155238886
 *   FM_WHATSAPP_NUMBER   — Finance Manager's number, e.g. whatsapp:+919876543210
 *
 * For sandbox testing: use Twilio sandbox number and join with "join <word>-<word>"
 */

const https = require('https');

class WhatsAppService {
  constructor() {
    this.accountSid  = process.env.TWILIO_ACCOUNT_SID;
    this.authToken   = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber  = process.env.TWILIO_WA_FROM  || 'whatsapp:+14155238886';
    this.fmNumber    = process.env.FM_WHATSAPP_NUMBER;
    this.enabled     = !!(this.accountSid && this.authToken && this.fmNumber);

    if (!this.enabled) {
      console.log('[WhatsApp] Running in MOCK mode — set TWILIO_* env vars to enable live messages');
    }
  }

  /**
   * Send approval request for a pending invoice to Finance Manager.
   * @param {object} invoice  — ProcessedInvoice document
   * @param {string} toNumber — override recipient (optional, defaults to FM_WHATSAPP_NUMBER)
   * @returns {{ sid, mock }} Twilio message SID or mock indicator
   */
  async sendApprovalRequest(invoice, toNumber) {
    const recipient = toNumber || this.fmNumber;
    if (!recipient) throw new Error('No WhatsApp recipient configured (FM_WHATSAPP_NUMBER)');

    const message = this._buildApprovalMessage(invoice);

    if (!this.enabled) {
      console.log(`[WhatsApp MOCK] → ${recipient}\n${message}`);
      return { sid: `MOCK_${Date.now()}`, mock: true, to: recipient, body: message };
    }

    return this._sendTwilio(recipient, message);
  }

  /**
   * Send a status update (e.g. after auto-approval, payment scheduled, etc.)
   */
  async sendStatusUpdate(invoice, message, toNumber) {
    const recipient = toNumber || this.fmNumber;
    if (!recipient) return { skipped: true };

    const body = `📊 *Bharat ERP Update*\n\nInvoice: *${invoice.invoice_number || invoice._id}*\n${message}\n\n_Bharat ERP AI_`;

    if (!this.enabled) {
      console.log(`[WhatsApp MOCK STATUS] → ${recipient}\n${body}`);
      return { sid: `MOCK_${Date.now()}`, mock: true };
    }

    return this._sendTwilio(recipient, body);
  }

  // ─── private ────────────────────────────────────────────────────────────────

  _buildApprovalMessage(invoice) {
    const dec     = invoice.decision || {};
    const amount  = this._formatAmount(dec.net_payable || invoice.invoice_amount);
    const vendor  = invoice.vendor_name || 'Unknown Vendor';
    const invNum  = invoice.invoice_number || invoice._id?.toString()?.slice(-8) || '—';
    const gstin   = invoice.vendor_gstin || '—';
    const threeWay = invoice.three_way_score != null ? `${invoice.three_way_score}%` : '—';
    const tds     = this._formatAmount(dec.tds_amount || 0);
    const flags   = (invoice.flags || []).length
      ? '\n⚠️ *Flags:* ' + (invoice.flags || []).map(f => f.code || f).join(', ')
      : '';

    return [
      `🔔 *Invoice Approval Required*`,
      ``,
      `📄 *Invoice:* ${invNum}`,
      `🏢 *Vendor:* ${vendor}`,
      `📋 *GSTIN:* ${gstin}`,
      `💰 *Amount:* ₹${amount}`,
      `🧾 *TDS Held:* ₹${tds}`,
      `✅ *3-Way Match:* ${threeWay}`,
      flags,
      ``,
      `━━━━━━━━━━━━━━`,
      `Reply with:`,
      `*APPROVE* — Release for payment`,
      `*REJECT* — Reject this invoice`,
      `*ESCALATE* — Send to CFO`,
      `*INFO* — Get full details`,
      `━━━━━━━━━━━━━━`,
      `_Invoice ID: ${invoice._id}_`,
    ].filter(l => l !== undefined).join('\n');
  }

  _formatAmount(amount) {
    if (!amount && amount !== 0) return '—';
    return Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  async _sendTwilio(to, body) {
    const auth    = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const payload = new URLSearchParams({ To: to, From: this.fromNumber, Body: body });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.twilio.com',
        path:     `/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        method:   'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`Twilio error ${res.statusCode}: ${parsed.message}`));
            } else {
              resolve({ sid: parsed.sid, status: parsed.status, to: parsed.to });
            }
          } catch (e) {
            reject(new Error(`Twilio parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payload.toString());
      req.end();
    });
  }
}

module.exports = new WhatsAppService();
