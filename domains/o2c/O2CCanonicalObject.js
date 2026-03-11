/**
 * BHARAT ERP — O2C Canonical Object (OCO)
 *
 * Single source of truth for an Order-to-Cash event as it travels through
 * the pipeline. Mirrors HCO / SCO / CIO design — same base, domain-specific.
 *
 * O2C Lifecycle:
 *   INITIATED → CUSTOMER_VALIDATED → CREDIT_CHECKED → ORDER_CONFIRMED →
 *   PICKING_PACKED → INVOICE_GENERATED → DISPATCHED → DELIVERED →
 *   PAYMENT_RECEIVED → RECONCILED
 *
 * Domain 4 proves architecture claim: same platform, same patterns,
 * new business logic only.
 */

const { randomUUID } = require('crypto');

class O2CCanonicalObject {
  constructor({ tenant_id = 'demo-corp', source = 'api', created_by } = {}) {
    // ── Identity ──────────────────────────────────────────────────
    this.id          = `OCO-${randomUUID()}`;
    this.tenant_id   = tenant_id;
    this.type        = 'sales_order';
    this.source      = source;           // api | portal | whatsapp | email
    this.created_at  = new Date().toISOString();
    this.updated_at  = new Date().toISOString();
    this.created_by  = created_by || null;

    // ── Status (Orchestrator-controlled) ──────────────────────────
    this.status = 'INITIATED';

    // ── Customer ──────────────────────────────────────────────────
    this.customer = {
      id:               null,
      name:             null,
      gstin:            null,   // Validated by CustomerValidationAgent
      pan:              null,
      billing_address:  null,
      shipping_address: null,
      contact_email:    null,
      contact_phone:    null,
      // Populated by CustomerValidationAgent
      gstin_valid:      null,
      state_code:       null,
      customer_type:    null,   // 'B2B' | 'B2C' | 'EXPORT' | 'SEZ'
    };

    // ── Credit Profile (populated by CreditCheckAgent) ────────────
    this.credit = {
      credit_limit:       0,
      credit_used:        0,
      credit_available:   0,
      outstanding_amount: 0,
      overdue_amount:     0,
      overdue_days:       0,
      credit_score:       null,   // 0-100
      credit_days:        30,     // standard payment terms
      risk_level:         null,   // 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED'
      last_payment_date:  null,
      payment_history:    [],
    };

    // ── Sales Order ───────────────────────────────────────────────
    this.order = {
      order_number:     null,   // e.g. SO-2026-0001
      order_date:       null,
      delivery_date:    null,
      payment_terms:    null,   // 'NET30' | 'NET60' | 'ADVANCE' | 'COD'
      delivery_address: null,
      shipping_mode:    null,   // 'ROAD' | 'AIR' | 'RAIL' | 'COURIER'
      special_instructions: null,
    };

    // ── Line Items ────────────────────────────────────────────────
    this.line_items = [];
    // Each: { id, description, hsn_sac, quantity, unit, unit_price,
    //         discount_pct, taxable_value, gst_rate, cgst, sgst, igst,
    //         total_amount, batch_no, warehouse }

    // ── Totals (populated by SalesOrderAgent) ─────────────────────
    this.totals = {
      subtotal:          0,
      total_discount:    0,
      taxable_value:     0,
      cgst:              0,
      sgst:              0,
      igst:              0,
      total_gst:         0,
      tcs_amount:        0,   // TCS u/s 206C if applicable
      grand_total:       0,
      amount_in_words:   null,
    };

    // ── GST Details ───────────────────────────────────────────────
    this.gst = {
      type:             null,   // 'CGST_SGST' | 'IGST'
      seller_gstin:     process.env.COMPANY_GSTIN || '29AABCU9603R1ZX',
      buyer_gstin:      null,
      place_of_supply:  null,
      reverse_charge:   false,
      tcs_applicable:   false,
      tcs_rate:         1,      // TCS @ 1% u/s 206C on aggregate > ₹50L
      tcs_section:      '206C(1H)',
    };

    // ── E-Invoice (populated by InvoiceGenerationAgent) ───────────
    this.einvoice = {
      irn:            null,   // Invoice Reference Number (64-char hash)
      ack_number:     null,
      ack_date:       null,
      qr_code:        null,
      signed_invoice: null,
      invoice_number: null,
      invoice_date:   null,
    };

    // ── Dispatch / Delivery ───────────────────────────────────────
    this.dispatch = {
      dispatched_at:  null,
      eway_bill_no:   null,   // E-way bill for consignment > ₹50,000
      transporter:    null,
      vehicle_no:     null,
      lr_number:      null,   // Lorry Receipt
      delivered_at:   null,
      pod_reference:  null,   // Proof of delivery
      delivery_status: null,
    };

    // ── Payment Receipts (populated by PaymentReconciliationAgent) ─
    this.payments = [];
    // Each: { id, amount, mode, utr_number, bank_reference,
    //         received_date, allocated_to_invoice, remarks }

    this.reconciliation = {
      total_received:   0,
      total_outstanding: 0,
      fully_reconciled: false,
      reconciled_at:    null,
    };

    // ── Confidence & AI ───────────────────────────────────────────
    this.confidence_scores = {};
    this.flags = [];
    this.audit_trail = [];
  }

  // ── Lifecycle helpers ─────────────────────────────────────────
  transition(newStatus, actor = 'orchestrator') {
    const prev = this.status;
    this.status = newStatus;
    this.updated_at = new Date().toISOString();
    this._audit(actor, 'status_transition', { from: prev, to: newStatus });
    return this;
  }

  _audit(actor, action, metadata = {}) {
    this.audit_trail.push({ actor, action, metadata, timestamp: new Date().toISOString() });
  }

  _flag(code, level, message, detail = null) {
    this.flags.push({ code, level, message, detail, timestamp: new Date().toISOString(), resolved: false });
  }

  overallConfidence() {
    const scores = Object.values(this.confidence_scores);
    if (!scores.length) return 0;
    return Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  }

  hasError()  { return this.flags.some(f => f.level === 'error'  && !f.resolved); }
  hasWarn()   { return this.flags.some(f => f.level === 'warn'   && !f.resolved); }
  isBlocked() { return this.credit.risk_level === 'BLOCKED'; }

  toJSON() {
    return {
      id:                 this.id,
      tenant_id:          this.tenant_id,
      type:               this.type,
      status:             this.status,
      source:             this.source,
      created_at:         this.created_at,
      updated_at:         this.updated_at,
      created_by:         this.created_by,
      customer:           this.customer,
      credit:             this.credit,
      order:              this.order,
      line_items:         this.line_items,
      totals:             this.totals,
      gst:                this.gst,
      einvoice:           this.einvoice,
      dispatch:           this.dispatch,
      payments:           this.payments,
      reconciliation:     this.reconciliation,
      confidence:         this.overallConfidence(),
      confidence_scores:  this.confidence_scores,
      flags:              this.flags,
      audit_trail:        this.audit_trail,
    };
  }
}

module.exports = O2CCanonicalObject;
