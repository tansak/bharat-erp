/**
 * BHARAT ERP — Approval Session Store (Sprint 3)
 *
 * Tracks which WhatsApp conversation is waiting for a decision on which invoice.
 * In production: back this with Redis. For MVP: in-memory with TTL.
 *
 * Sessions expire after APPROVAL_TIMEOUT_HOURS (default: 24h).
 * After expiry: invoice escalates automatically.
 */

const TIMEOUT_MS = (parseInt(process.env.APPROVAL_TIMEOUT_HOURS) || 24) * 60 * 60 * 1000;

class ApprovalSessionStore {
  constructor() {
    /**
     * Map<invoiceId, SessionEntry>
     * SessionEntry: { invoiceId, tenantId, whatsappSid, from, createdAt, expiresAt, invoiceSnapshot }
     */
    this._sessions = new Map();

    // Cleanup expired sessions every 30 minutes
    setInterval(() => this._cleanup(), 30 * 60 * 1000);
  }

  /**
   * Create a new approval session after sending a WhatsApp message.
   */
  create({ invoiceId, tenantId, whatsappSid, from, invoiceSnapshot }) {
    const now = Date.now();
    const session = {
      invoiceId,
      tenantId,
      whatsappSid,
      from,          // the WhatsApp number that will reply (FM's number)
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TIMEOUT_MS).toISOString(),
      invoiceSnapshot,   // lightweight copy for message context
    };
    this._sessions.set(invoiceId.toString(), session);
    console.log(`[ApprovalStore] Session created for invoice ${invoiceId}, expires ${session.expiresAt}`);
    return session;
  }

  /**
   * Find session by invoiceId.
   */
  getByInvoiceId(invoiceId) {
    const s = this._sessions.get(invoiceId.toString());
    if (!s) return null;
    if (new Date(s.expiresAt) < new Date()) {
      this._sessions.delete(invoiceId.toString());
      return null;
    }
    return s;
  }

  /**
   * Find session by the WhatsApp sender's number (used in webhook).
   * A sender can only have one pending session at a time (last-wins).
   */
  getByFrom(from) {
    const normalised = this._normalise(from);
    for (const [, session] of this._sessions) {
      if (this._normalise(session.from) === normalised) {
        if (new Date(session.expiresAt) < new Date()) {
          this._sessions.delete(session.invoiceId.toString());
          continue;
        }
        return session;
      }
    }
    return null;
  }

  /**
   * Delete session (after decision recorded).
   */
  delete(invoiceId) {
    this._sessions.delete(invoiceId.toString());
  }

  /**
   * List all active (non-expired) sessions.
   */
  listActive() {
    const now = new Date();
    return [...this._sessions.values()].filter(s => new Date(s.expiresAt) > now);
  }

  /**
   * Return sessions that have expired and need auto-escalation.
   */
  getExpired() {
    const now = new Date();
    return [...this._sessions.values()].filter(s => new Date(s.expiresAt) <= now);
  }

  // ─── private ────────────────────────────────────────────────────────────────

  _normalise(number = '') {
    return number.replace(/\s+/g, '').toLowerCase();
  }

  _cleanup() {
    const now = new Date();
    let removed = 0;
    for (const [id, session] of this._sessions) {
      if (new Date(session.expiresAt) <= now) {
        this._sessions.delete(id);
        removed++;
      }
    }
    if (removed) console.log(`[ApprovalStore] Cleaned up ${removed} expired sessions`);
  }
}

// Singleton — shared across the process
module.exports = new ApprovalSessionStore();
