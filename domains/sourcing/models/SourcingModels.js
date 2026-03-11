/**
 * BHARAT ERP — Sourcing Domain Models (Sprint 4)
 * MongoDB schemas for purchase requisitions and sourcing events.
 * Follows same pattern as P2PModels.js — proves 40% effort claim.
 */

const mongoose = require('mongoose');

// ── Purchase Requisition ─────────────────────────────────────────
const RequisitionSchema = new mongoose.Schema({
  tenant_id:         { type: String, required: true, index: true },
  canonical_id:      { type: String, required: true, unique: true },
  status:            { type: String, default: 'RAISED', enum: [
    'RAISED','ENRICHED','VENDORS_SHORTLISTED','RFQ_SENT',
    'QUOTES_RECEIVED','EVALUATED','VENDOR_SELECTED',
    'PO_DRAFTED','PO_APPROVED','PO_ISSUED','CLOSED','CANCELLED',
  ]},
  description:       { type: String, required: true },
  category:          { type: String },
  quantity:          { type: Number },
  unit:              { type: String },
  estimated_value:   { type: Number },
  required_by:       { type: Date },
  department:        { type: String },
  requested_by:      { type: String },
  cost_center:       { type: String },
  gl_code:           { type: String },

  // Enrichment
  hsn_sac_code:      { type: String },
  market_rate_min:   { type: Number },
  market_rate_max:   { type: Number },

  // RFQ
  rfq_id:            { type: String },
  rfq_sent_at:       { type: Date },
  rfq_response_due:  { type: Date },
  vendors_invited:   [{ vendor_id: String, name: String, gstin: String }],

  // Selected vendor
  selected_vendor_id:   { type: String },
  selected_vendor_name: { type: String },
  negotiated_price:     { type: Number },

  // PO
  po_number:         { type: String },
  po_total_value:    { type: Number },
  po_status:         { type: String },

  // Scores & meta
  overall_confidence: { type: Number },
  flags:              [{ code: String, severity: String, detail: String, agent: String }],
  audit_trail:        [{ timestamp: String, agent: String, action: String, detail: mongoose.Schema.Types.Mixed }],
  domain_data:        { type: mongoose.Schema.Types.Mixed, default: {} },
  quotes:             [mongoose.Schema.Types.Mixed],
  evaluation:         { type: mongoose.Schema.Types.Mixed },
  po_draft:           { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
});

RequisitionSchema.index({ tenant_id: 1, status: 1, createdAt: -1 });
RequisitionSchema.index({ tenant_id: 1, rfq_id: 1 });
RequisitionSchema.index({ tenant_id: 1, po_number: 1 });

const Requisition = mongoose.models.Requisition
  || mongoose.model('Requisition', RequisitionSchema);

module.exports = { Requisition };
