/**
 * BHARAT ERP — Sourcing Canonical Object (SCO)
 *
 * The single source of truth for a sourcing event as it travels through the pipeline.
 * Mirrors the P2PCanonicalObject design — same base, domain-specific fields.
 *
 * Sourcing lifecycle:
 *   RAISED → APPROVED → RFQ_SENT → QUOTES_RECEIVED → EVALUATED →
 *   VENDOR_SELECTED → PO_DRAFTED → PO_APPROVED → PO_ISSUED → CLOSED
 *
 * Proves the architecture claim: Domain 2 = 40% effort because the platform
 * (BaseAgent, Orchestrator, AIService, etc.) is already built.
 */

const { randomUUID: uuidv4 } = require('crypto');

class SourcingCanonicalObject {
  constructor({ source = 'manual', tenant_id = 'demo-corp', requestedBy } = {}) {
    // ── Core identity ────────────────────────────────────────────
    this.id         = `SCO-${uuidv4()}`;
    this.tenant_id  = tenant_id;
    this.source     = source;       // manual | email | portal | api
    this.created_at = new Date().toISOString();
    this.updated_at = new Date().toISOString();

    // ── Status lifecycle (Orchestrator-controlled) ─────────────
    this.status = 'RAISED';

    // ── Purchase Requisition fields ─────────────────────────────
    this.requisition = {
      id:              null,
      description:     null,   // Natural language: "50 laptops for BCA students"
      category:        null,   // IT Hardware, Office Supplies, Services, etc.
      quantity:        null,
      unit:            null,
      estimated_value: null,
      required_by:     null,
      department:      null,
      requested_by:    requestedBy || null,
      cost_center:     null,
      gl_code:         null,
      budget_available: null,
      justification:   null,
    };

    // ── AI-enriched requisition data ────────────────────────────
    this.enriched = {
      hsn_sac_code:        null,   // AI-suggested HSN/SAC for tax purposes
      suggested_vendors:   [],     // From vendor master
      market_rate_estimate: null,  // AI market research
      similar_past_orders: [],     // Deduplication check
      gl_code_suggestion:  null,   // Auto-suggested GL account
    };

    // ── Approval ────────────────────────────────────────────────
    this.approval = {
      required:    false,
      approved_by: null,
      approved_at: null,
      remarks:     null,
    };

    // ── RFQ (Request for Quotation) ─────────────────────────────
    this.rfq = {
      id:             null,
      sent_at:        null,
      response_due:   null,
      vendors_invited: [],  // [{ vendor_id, name, gstin, email, whatsapp }]
      responses_received: 0,
    };

    // ── Vendor Quotes ────────────────────────────────────────────
    this.quotes = [];
    // Each quote: { vendor_id, vendor_name, gstin, unit_price, total_price,
    //               delivery_days, payment_terms, validity_days, received_at,
    //               score, score_breakdown }

    // ── Evaluation ───────────────────────────────────────────────
    this.evaluation = {
      recommended_vendor:  null,
      recommendation_reason: null,
      comparison_matrix:   [],   // All vendors scored
      evaluated_at:        null,
      evaluator:           'AI', // AI or human name
    };

    // ── Selected Vendor ───────────────────────────────────────────
    this.selected_vendor = {
      id:           null,
      name:         null,
      gstin:        null,
      negotiated_price: null,
      final_terms:  null,
      selected_at:  null,
    };

    // ── Purchase Order Draft ──────────────────────────────────────
    this.po_draft = {
      po_number:      null,
      line_items:     [],
      total_value:    null,
      delivery_terms: null,
      payment_terms:  null,
      created_at:     null,
    };

    // ── Confidence scores (per agent) ─────────────────────────────
    this.confidence_scores = {};

    // ── Flags raised by any agent ──────────────────────────────────
    this.flags = [];

    // ── Audit trail ────────────────────────────────────────────────
    this.audit_trail = [];

    // ── Domain data (free-form per-agent enrichment) ───────────────
    this.domain_data = {};
  }

  // ── Helpers ────────────────────────────────────────────────────

  _audit(agentName, action, detail = {}) {
    this.audit_trail.push({
      timestamp: new Date().toISOString(),
      agent:     agentName,
      action,
      detail,
    });
    this.updated_at = new Date().toISOString();
  }

  _flag(code, severity, detail, agent) {
    this.flags.push({ code, severity, detail, agent, raised_at: new Date().toISOString() });
  }

  overallConfidence() {
    const scores = Object.values(this.confidence_scores).filter(s => s != null);
    if (!scores.length) return 0;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = SourcingCanonicalObject;
