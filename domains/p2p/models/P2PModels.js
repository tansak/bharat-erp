/**
 * BHARAT ERP — P2P Domain Models
 * Purchase Orders, Goods Receipt Notes, GL Accounts
 * Used by POMatchingAgent, GRNMatchingAgent, ReconciliationAgent
 */
const mongoose = require('mongoose');

// ── Purchase Order ───────────────────────────────────────────────
const POLineSchema = new mongoose.Schema({
  line_no:     Number,
  item_code:   String,
  description: String,
  hsn_sac:     String,
  qty_ordered: Number,
  qty_received:{ type: Number, default: 0 },
  qty_billed:  { type: Number, default: 0 },
  unit:        String,
  unit_price:  Number,
  gst_rate:    Number,
  amount:      Number,
}, { _id: false });

const POSchema = new mongoose.Schema({
  tenant_id:    { type: String, required: true, index: true },
  po_number:    { type: String, required: true },
  po_date:      Date,
  vendor_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  vendor_gstin: String,
  vendor_name:  String,
  status:       { type: String, enum: ['open','partial','closed','cancelled'], default: 'open' },
  line_items:   [POLineSchema],
  subtotal:     Number,
  total_gst:    Number,
  total_amount: Number,
  currency:     { type: String, default: 'INR' },
  delivery_date: Date,
  terms:        String,
  // Billing tolerance — auto-approve variance within this %
  tolerance_pct: { type: Number, default: 2 },
}, { timestamps: true });

POSchema.index({ tenant_id: 1, po_number: 1 }, { unique: true });
POSchema.index({ tenant_id: 1, vendor_gstin: 1, status: 1 });

// ── Goods Receipt Note ───────────────────────────────────────────
const GRNLineSchema = new mongoose.Schema({
  po_line_no:    Number,
  item_code:     String,
  description:   String,
  qty_received:  Number,
  unit:          String,
  batch_no:      String,
  expiry_date:   Date,
  quality_status:{ type: String, enum: ['accepted','rejected','partial'], default: 'accepted' },
}, { _id: false });

const GRNSchema = new mongoose.Schema({
  tenant_id:   { type: String, required: true, index: true },
  grn_number:  { type: String, required: true },
  grn_date:    Date,
  po_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  po_number:   String,
  vendor_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  vendor_name: String,
  status:      { type: String, enum: ['draft','confirmed','cancelled'], default: 'confirmed' },
  line_items:  [GRNLineSchema],
  warehouse:   String,
  received_by: String,
  invoice_matched: { type: Boolean, default: false },
}, { timestamps: true });

GRNSchema.index({ tenant_id: 1, grn_number: 1 }, { unique: true });
GRNSchema.index({ tenant_id: 1, po_number: 1 });

// ── GL Account ───────────────────────────────────────────────────
const GLAccountSchema = new mongoose.Schema({
  tenant_id:    { type: String, required: true, index: true },
  account_code: { type: String, required: true },
  account_name: String,
  account_type: { type: String, enum: ['asset','liability','income','expense','equity'] },
  parent_code:  String,
  is_active:    { type: Boolean, default: true },
}, { timestamps: true });

GLAccountSchema.index({ tenant_id: 1, account_code: 1 }, { unique: true });

// ── Invoice Record (after processing) ───────────────────────────
const ProcessedInvoiceSchema = new mongoose.Schema({
  tenant_id:        { type: String, required: true, index: true },
  canonical_id:     { type: String, index: true },
  invoice_number:   String,
  invoice_date:     Date,
  due_date:         Date,
  vendor_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  vendor_name:      String,
  vendor_gstin:     String,
  po_number:        String,
  grn_number:       String,
  subtotal:         Number,
  total_gst:        Number,
  tds_amount:       { type: Number, default: 0 },
  total_amount:     Number,
  net_payable:      Number,
  status: {
    type: String,
    enum: ['approved','payment_scheduled','pending_approval','exception','on_hold','rejected','paid','reconciled'],
    default: 'pending_approval',
    index: true,
  },
  // Sprint 2: AI pipeline results
  three_way_score:  { type: Number, default: 0 },  // 0–100 weighted confidence
  fraud_score:      { type: Number, default: 0 },  // 0–100 risk score
  pipeline_ms:      Number,                         // pipeline execution time
  decision:         mongoose.Schema.Types.Mixed,    // {action, reason, confidence, reviewer}
  flags:            [mongoose.Schema.Types.Mixed],  // [{severity, agent, title, detail}]
  domain_data:      mongoose.Schema.Types.Mixed,    // full agent outputs
  audit_trail:      [mongoose.Schema.Types.Mixed],  // [{ts, actor, action, detail}]
  // Payment
  payment_due_date: Date,
  payment_date:     Date,
  irn:              String,
  gl_entries:       [{ account_code: String, debit: Number, credit: Number, narration: String }],
}, { timestamps: true });

ProcessedInvoiceSchema.index({ tenant_id: 1, invoice_number: 1, vendor_gstin: 1 }, { sparse: true });
ProcessedInvoiceSchema.index({ tenant_id: 1, status: 1, createdAt: -1 });
ProcessedInvoiceSchema.index({ tenant_id: 1, createdAt: -1 });

// Use mongoose.models cache to avoid "Cannot overwrite model" on hot-reload
const PurchaseOrder    = mongoose.models.PurchaseOrder    || mongoose.model('PurchaseOrder',    POSchema);
const GoodsReceiptNote = mongoose.models.GRN              || mongoose.model('GRN',              GRNSchema);
const GLAccount        = mongoose.models.GLAccount        || mongoose.model('GLAccount',        GLAccountSchema);
const ProcessedInvoice = mongoose.models.ProcessedInvoice || mongoose.model('ProcessedInvoice', ProcessedInvoiceSchema);

module.exports = {
  PurchaseOrder, GoodsReceiptNote, GLAccount, ProcessedInvoice,
  // Legacy aliases — keep Sprint 1 tests passing
  POModel:               PurchaseOrder,
  GRNModel:              GoodsReceiptNote,
  GLAccountModel:        GLAccount,
  ProcessedInvoiceModel: ProcessedInvoice,
};
