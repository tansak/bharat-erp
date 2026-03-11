/**
 * BHARAT ERP — O2C Models (Sprint 7)
 *
 * MongoDB schema for persisting O2C Canonical Objects.
 * Mirrors SourcingModels / HRModels pattern.
 */

const mongoose = require('mongoose');

// ── Sub-schemas ───────────────────────────────────────────────────

const LineItemSchema = new mongoose.Schema({
  id:            String,
  description:   String,
  hsn_sac:       String,
  quantity:      Number,
  unit:          String,
  unit_price:    Number,
  discount_pct:  { type: Number, default: 0 },
  taxable_value: Number,
  gst_rate:      Number,
  cgst:          { type: Number, default: 0 },
  sgst:          { type: Number, default: 0 },
  igst:          { type: Number, default: 0 },
  total_amount:  Number,
  batch_no:      String,
  warehouse:     String,
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
  id:                   String,
  amount:               Number,
  mode:                 { type: String, enum: ['UPI', 'NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'CASH', 'COD'] },
  utr_number:           String,
  bank_reference:       String,
  received_date:        String,
  allocated_to_invoice: String,
  remarks:              String,
}, { _id: false });

const FlagSchema = new mongoose.Schema({
  code:      String,
  level:     { type: String, enum: ['info', 'warn', 'error'] },
  message:   String,
  detail:    String,
  timestamp: Date,
  resolved:  { type: Boolean, default: false },
}, { _id: false });

const AuditSchema = new mongoose.Schema({
  actor:     String,
  action:    String,
  metadata:  mongoose.Schema.Types.Mixed,
  timestamp: Date,
}, { _id: false });

// ── Main schema ───────────────────────────────────────────────────

const SalesOrderSchema = new mongoose.Schema({
  // OCO identity
  oco_id:     { type: String, required: true, unique: true },
  tenant_id:  { type: String, required: true, index: true },
  type:       { type: String, default: 'sales_order' },
  source:     String,
  created_by: String,

  // Status
  status: {
    type: String,
    enum: [
      'INITIATED', 'CUSTOMER_VALIDATED', 'CREDIT_CHECKED',
      'ORDER_CONFIRMED', 'PICKING_PACKED', 'INVOICE_GENERATED',
      'DISPATCHED', 'DELIVERED', 'PAYMENT_RECEIVED', 'RECONCILED',
      'FAILED', 'CREDIT_BLOCKED',
    ],
    default: 'INITIATED',
    index: true,
  },

  // Customer
  customer: {
    id:               String,
    name:             String,
    gstin:            String,
    pan:              String,
    billing_address:  String,
    shipping_address: String,
    contact_email:    String,
    contact_phone:    String,
    gstin_valid:      Boolean,
    state_code:       String,
    customer_type:    String,
  },

  // Credit
  credit: {
    credit_limit:       Number,
    credit_used:        Number,
    credit_available:   Number,
    outstanding_amount: Number,
    overdue_amount:     Number,
    overdue_days:       Number,
    credit_score:       Number,
    credit_days:        Number,
    risk_level:         String,
    last_payment_date:  String,
    payment_history:    [mongoose.Schema.Types.Mixed],
  },

  // Order
  order: {
    order_number:         String,
    order_date:           String,
    delivery_date:        String,
    payment_terms:        String,
    delivery_address:     String,
    shipping_mode:        String,
    special_instructions: String,
  },

  // Line items
  line_items: [LineItemSchema],

  // Totals
  totals: {
    subtotal:        Number,
    total_discount:  Number,
    taxable_value:   Number,
    cgst:            Number,
    sgst:            Number,
    igst:            Number,
    total_gst:       Number,
    tcs_amount:      Number,
    grand_total:     Number,
    amount_in_words: String,
  },

  // GST
  gst: {
    type:            String,
    seller_gstin:    String,
    buyer_gstin:     String,
    place_of_supply: String,
    reverse_charge:  Boolean,
    tcs_applicable:  Boolean,
    tcs_rate:        Number,
    tcs_section:     String,
  },

  // E-invoice
  einvoice: {
    irn:            String,
    ack_number:     String,
    ack_date:       String,
    qr_code:        String,
    invoice_number: String,
    invoice_date:   String,
  },

  // Dispatch
  dispatch: {
    dispatched_at:   String,
    eway_bill_no:    String,
    transporter:     String,
    vehicle_no:      String,
    lr_number:       String,
    delivered_at:    String,
    pod_reference:   String,
    delivery_status: String,
  },

  // Payments
  payments:       [PaymentSchema],
  reconciliation: {
    total_received:    Number,
    total_outstanding: Number,
    fully_reconciled:  Boolean,
    reconciled_at:     String,
  },

  // AI
  confidence:        Number,
  confidence_scores: mongoose.Schema.Types.Mixed,
  flags:             [FlagSchema],
  audit_trail:       [AuditSchema],
}, {
  timestamps: true,
  collection: 'sales_orders',
});

// ── Indexes ───────────────────────────────────────────────────────
SalesOrderSchema.index({ tenant_id: 1, status: 1 });
SalesOrderSchema.index({ tenant_id: 1, 'customer.gstin': 1 });
SalesOrderSchema.index({ tenant_id: 1, 'einvoice.invoice_number': 1 });
SalesOrderSchema.index({ tenant_id: 1, 'order.order_number': 1 });
SalesOrderSchema.index({ 'totals.grand_total': 1 });
SalesOrderSchema.index({ createdAt: -1 });

const SalesOrder = mongoose.model('SalesOrder', SalesOrderSchema);

module.exports = { SalesOrder };
