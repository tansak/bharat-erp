/**
 * BHARAT ERP — Approval Orchestrator (Sprint 3)
 *
 * Manages the complete human-in-the-loop approval lifecycle:
 *   1. Invoice arrives at pending_approval status
 *   2. WhatsApp message sent to Finance Manager
 *   3. FM replies APPROVE / REJECT / ESCALATE / INFO
 *   4. Decision persisted to MongoDB, audit trail updated
 *   5. Downstream agents notified (payment scheduling, vendor comms)
 *
 * Also handles timeout escalation via a periodic job.
 */

const whatsapp        = require('../services/WhatsAppService');
const sessionStore    = require('../services/ApprovalSessionStore');

class ApprovalOrchestrator {
  constructor() {
    // Start auto-escalation job: check every 15 minutes
    this._escalationTimer = setInterval(
      () => this._runEscalationCheck(),
      15 * 60 * 1000
    );
  }

  // ─── PUBLIC API ─────────────────────────────────────────────────────────────

  /**
   * Trigger approval flow for an invoice that has entered pending_approval state.
   * Called by the P2P route after AutoApprovalAgent returns needs_review.
   *
   * @param {object} invoice  — Mongoose ProcessedInvoice document
   * @param {string} tenantId
   * @returns {{ session, whatsapp }} session info + WA send result
   */
  async triggerApproval(invoice, tenantId) {
    console.log(`[ApprovalOrchestrator] Triggering approval for invoice ${invoice._id}`);

    // Build lightweight snapshot for session store
    const snapshot = {
      invoice_number: invoice.invoice_number,
      vendor_name:    invoice.vendor_name,
      invoice_amount: invoice.invoice_amount,
      flags:          invoice.flags || [],
    };

    // Send WhatsApp message
    const fmNumber = process.env.FM_WHATSAPP_NUMBER;
    let waResult;
    try {
      waResult = await whatsapp.sendApprovalRequest(invoice, fmNumber);
    } catch (err) {
      console.error('[ApprovalOrchestrator] WhatsApp send failed:', err.message);
      // Don't block the process — invoice stays pending_approval, can retry
      waResult = { error: err.message, mock: true, sid: null };
    }

    // Create session
    const session = sessionStore.create({
      invoiceId:       invoice._id.toString(),
      tenantId,
      whatsappSid:     waResult.sid,
      from:            fmNumber,
      invoiceSnapshot: snapshot,
    });

    // Add audit entry (caller is responsible for saving the doc)
    if (invoice.audit_trail && Array.isArray(invoice.audit_trail)) {
      invoice.audit_trail.push({
        timestamp:   new Date().toISOString(),
        agent:       'ApprovalOrchestrator',
        action:      'WHATSAPP_SENT',
        detail:      `Approval request sent to FM. WA SID: ${waResult.sid || 'mock'}`,
        actor:       'system',
      });
    }

    return { session, whatsapp: waResult };
  }

  /**
   * Process a reply from Finance Manager (called by the webhook route).
   *
   * @param {string} from     — FM's WhatsApp number (e.g. whatsapp:+91...)
   * @param {string} body     — Raw message text
   * @param {object} InvoiceModel — Mongoose model (injected to avoid circular deps)
   * @returns {{ action, invoice, reply }}
   */
  async processReply(from, body, InvoiceModel) {
    const session = sessionStore.getByFrom(from);

    if (!session) {
      // FM sent a message but no pending session found
      const reply = `ℹ️ No pending invoice approvals found for your number.\n\nIf you believe this is an error, contact your ERP administrator.`;
      await whatsapp.sendStatusUpdate({ _id: 'N/A', invoice_number: 'N/A' }, reply, from);
      return { action: 'NO_SESSION', reply };
    }

    const command = this._parseCommand(body);
    console.log(`[ApprovalOrchestrator] FM reply: ${command} for invoice ${session.invoiceId}`);

    // Fetch current invoice
    const invoice = await InvoiceModel.findById(session.invoiceId);
    if (!invoice) {
      const reply = `❌ Invoice not found. It may have been processed by another system.`;
      await whatsapp.sendStatusUpdate({ _id: session.invoiceId, invoice_number: session.invoiceSnapshot?.invoice_number }, reply, from);
      sessionStore.delete(session.invoiceId);
      return { action: 'INVOICE_NOT_FOUND', reply };
    }

    let reply;
    switch (command) {
      case 'APPROVE':
        reply = await this._handleApprove(invoice, session, from);
        break;
      case 'REJECT':
        reply = await this._handleReject(invoice, session, from, body);
        break;
      case 'ESCALATE':
        reply = await this._handleEscalate(invoice, session, from);
        break;
      case 'INFO':
        reply = await this._handleInfo(invoice, session, from);
        break;
      default:
        reply = this._buildHelpMessage(session.invoiceSnapshot);
        await whatsapp.sendStatusUpdate(invoice, reply, from);
        return { action: 'UNKNOWN_COMMAND', reply };
    }

    return { action: command, invoiceId: session.invoiceId, reply };
  }

  /**
   * Get all currently pending approval sessions (for dashboard display).
   */
  getPendingApprovals() {
    return sessionStore.listActive();
  }

  // ─── COMMAND HANDLERS ────────────────────────────────────────────────────────

  async _handleApprove(invoice, session, from) {
    invoice.status = 'approved';
    invoice.decision = {
      ...((invoice.decision && typeof invoice.decision.toObject === 'function')
        ? invoice.decision.toObject()
        : invoice.decision || {}),
      action:        'APPROVED',
      approved_by:   'Finance Manager (WhatsApp)',
      approved_at:   new Date().toISOString(),
      approved_via:  'whatsapp',
    };
    this._addAudit(invoice, 'FM_APPROVED', `Finance Manager approved via WhatsApp from ${from}`);

    await invoice.save();
    sessionStore.delete(session.invoiceId);

    const amount = Number(invoice.decision?.net_payable || invoice.invoice_amount || 0)
      .toLocaleString('en-IN');

    const reply = [
      `✅ *Invoice Approved!*`,
      ``,
      `Invoice *${invoice.invoice_number}* from *${invoice.vendor_name}* has been approved for payment.`,
      `Amount: ₹${amount}`,
      ``,
      `Payment will be scheduled as per due date. Vendor will be notified.`,
      ``,
      `_Bharat ERP — ${new Date().toLocaleString('en-IN')}_`,
    ].join('\n');

    await whatsapp.sendStatusUpdate(invoice, reply, from);
    console.log(`[ApprovalOrchestrator] Invoice ${invoice._id} APPROVED by FM`);
    return reply;
  }

  async _handleReject(invoice, session, from, rawBody) {
    // Extract optional reason after REJECT keyword
    const reason = rawBody.replace(/^reject\s*/i, '').trim() || 'Rejected by Finance Manager';

    invoice.status = 'rejected';
    invoice.decision = {
      ...((invoice.decision && typeof invoice.decision.toObject === 'function')
        ? invoice.decision.toObject()
        : invoice.decision || {}),
      action:       'REJECTED',
      rejected_by:  'Finance Manager (WhatsApp)',
      rejected_at:  new Date().toISOString(),
      reject_reason: reason,
    };
    this._addAudit(invoice, 'FM_REJECTED', `Finance Manager rejected via WhatsApp. Reason: ${reason}`);

    await invoice.save();
    sessionStore.delete(session.invoiceId);

    const reply = [
      `❌ *Invoice Rejected*`,
      ``,
      `Invoice *${invoice.invoice_number}* has been rejected.`,
      `Reason: _${reason}_`,
      ``,
      `Vendor communications team will be notified. Invoice moved to rejected queue.`,
      ``,
      `_Bharat ERP — ${new Date().toLocaleString('en-IN')}_`,
    ].join('\n');

    await whatsapp.sendStatusUpdate(invoice, reply, from);
    console.log(`[ApprovalOrchestrator] Invoice ${invoice._id} REJECTED by FM`);
    return reply;
  }

  async _handleEscalate(invoice, session, from) {
    const cfoNumber = process.env.CFO_WHATSAPP_NUMBER;

    invoice.status = 'escalated';
    invoice.decision = {
      ...((invoice.decision && typeof invoice.decision.toObject === 'function')
        ? invoice.decision.toObject()
        : invoice.decision || {}),
      action:       'ESCALATED',
      escalated_by: 'Finance Manager (WhatsApp)',
      escalated_at: new Date().toISOString(),
      escalated_to: cfoNumber ? 'CFO' : 'Admin',
    };
    this._addAudit(invoice, 'FM_ESCALATED', `Finance Manager escalated to ${cfoNumber ? 'CFO' : 'Admin'} via WhatsApp`);

    await invoice.save();
    sessionStore.delete(session.invoiceId);

    // Notify CFO if configured
    if (cfoNumber) {
      try {
        await whatsapp.sendApprovalRequest(invoice, cfoNumber);
        sessionStore.create({
          invoiceId:       invoice._id.toString(),
          tenantId:        session.tenantId,
          whatsappSid:     null,
          from:            cfoNumber,
          invoiceSnapshot: session.invoiceSnapshot,
        });
        console.log(`[ApprovalOrchestrator] Escalated to CFO at ${cfoNumber}`);
      } catch (e) {
        console.error('[ApprovalOrchestrator] CFO notification failed:', e.message);
      }
    }

    const reply = [
      `⬆️ *Invoice Escalated*`,
      ``,
      `Invoice *${invoice.invoice_number}* has been escalated to ${cfoNumber ? 'CFO' : 'Admin'} for review.`,
      ``,
      `You will be notified once a decision is made.`,
      ``,
      `_Bharat ERP — ${new Date().toLocaleString('en-IN')}_`,
    ].join('\n');

    await whatsapp.sendStatusUpdate(invoice, reply, from);
    return reply;
  }

  async _handleInfo(invoice, session, from) {
    const dec   = invoice.decision || {};
    const flags = (invoice.flags || []).map(f => `  • ${f.code || f}: ${f.detail || ''}`).join('\n') || '  None';
    const audit = (invoice.audit_trail || []).slice(-3).map(a =>
      `  [${new Date(a.timestamp).toLocaleTimeString('en-IN')}] ${a.agent} — ${a.action}`
    ).join('\n') || '  No audit trail';

    const info = [
      `📋 *Invoice Details*`,
      ``,
      `Number:     ${invoice.invoice_number}`,
      `Vendor:     ${invoice.vendor_name}`,
      `GSTIN:      ${invoice.vendor_gstin || '—'}`,
      `Amount:     ₹${Number(invoice.invoice_amount || 0).toLocaleString('en-IN')}`,
      `Net Pay:    ₹${Number(dec.net_payable || invoice.invoice_amount || 0).toLocaleString('en-IN')}`,
      `TDS:        ₹${Number(dec.tds_amount || 0).toLocaleString('en-IN')}`,
      `3-Way:      ${invoice.three_way_score ?? '—'}%`,
      `Fraud Risk: ${invoice.fraud_score ?? '—'}%`,
      `Status:     ${invoice.status}`,
      ``,
      `*Flags:*`,
      flags,
      ``,
      `*Recent Pipeline:*`,
      audit,
      ``,
      `Reply APPROVE / REJECT / ESCALATE`,
    ].join('\n');

    await whatsapp.sendStatusUpdate(invoice, info, from);
    return info;
  }

  // ─── AUTO-ESCALATION ─────────────────────────────────────────────────────────

  async _runEscalationCheck() {
    const expired = sessionStore.getExpired();
    if (!expired.length) return;

    console.log(`[ApprovalOrchestrator] Auto-escalating ${expired.length} timed-out invoices`);
    // In a real system, dynamically require InvoiceModel here to avoid circular deps
    // For MVP: just log — full implementation needs the DB connection available
    for (const session of expired) {
      console.log(`[ApprovalOrchestrator] TIMEOUT ESCALATION: invoice ${session.invoiceId} (tenant: ${session.tenantId})`);
      sessionStore.delete(session.invoiceId);
      // TODO: load invoice from DB, set status=escalated, notify CFO
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────────

  _parseCommand(body = '') {
    const upper = body.trim().toUpperCase();
    if (upper.startsWith('APPROVE'))  return 'APPROVE';
    if (upper.startsWith('REJECT'))   return 'REJECT';
    if (upper.startsWith('ESCALATE')) return 'ESCALATE';
    if (upper.startsWith('INFO'))     return 'INFO';
    return 'UNKNOWN';
  }

  _addAudit(invoice, action, detail) {
    if (!Array.isArray(invoice.audit_trail)) invoice.audit_trail = [];
    invoice.audit_trail.push({
      timestamp: new Date().toISOString(),
      agent:     'ApprovalOrchestrator',
      action,
      detail,
      actor:     'finance_manager',
    });
  }

  _buildHelpMessage(snapshot) {
    const invNum = snapshot?.invoice_number || '—';
    return [
      `❓ *Unrecognised command*`,
      ``,
      `Pending invoice: *${invNum}*`,
      ``,
      `Please reply with one of:`,
      `• *APPROVE* — Release for payment`,
      `• *REJECT* <reason> — Reject with optional reason`,
      `• *ESCALATE* — Send to CFO`,
      `• *INFO* — Get full invoice details`,
    ].join('\n');
  }

  destroy() {
    clearInterval(this._escalationTimer);
  }
}

module.exports = new ApprovalOrchestrator();
