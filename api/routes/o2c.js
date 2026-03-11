/**
 * BHARAT ERP — O2C REST Routes (Sprint 7)
 *
 * POST   /api/o2c/orders                       Create order → run Phase 1 + 2 (full pipeline)
 * GET    /api/o2c/orders                       List orders (filter by status, customer, date)
 * GET    /api/o2c/orders/:id                   Single order + full OCO
 * PATCH  /api/o2c/orders/:id/dispatch          Mark as dispatched (E-way bill + LR number)
 * PATCH  /api/o2c/orders/:id/deliver           Mark as delivered (POD)
 * POST   /api/o2c/orders/:id/payments          Record payment receipt → Phase 3 reconciliation
 * GET    /api/o2c/orders/:id/invoice           Get e-invoice payload + IRN
 * GET    /api/o2c/dashboard                    YTD KPIs for O2C Command Centre
 *
 * Pattern identical to sourcing.js and hr.js.
 */

const router           = require('express').Router();
const O2CCanonicalObject = require('../../domains/o2c/O2CCanonicalObject');
const O2COrchestrator  = require('../../domains/o2c/O2COrchestrator');
const { SalesOrder }   = require('../../domains/o2c/models/O2CModels');

const tid = (req) => req.headers['x-tenant-id'] || 'demo-corp';

const orchestrator = new O2COrchestrator();

// ─────────────────────────────────────────────────────────────────
// POST /api/o2c/orders
// Create a sales order and immediately run Phase 1 (validate + credit + order)
// and Phase 2 (generate invoice)
// ─────────────────────────────────────────────────────────────────
router.post('/orders', async (req, res) => {
  const start = Date.now();
  try {
    const {
      customer, line_items, order = {},
      source = 'api', created_by,
      skip_invoice = false,
    } = req.body;

    if (!customer)            return res.status(400).json({ error: 'customer object is required' });
    if (!line_items?.length)  return res.status(400).json({ error: 'line_items array is required' });
    if (!customer.name)       return res.status(400).json({ error: 'customer.name is required' });

    // Build OCO
    const oco = new O2CCanonicalObject({ tenant_id: tid(req), source, created_by });
    oco.customer   = { ...oco.customer, ...customer };
    oco.line_items = line_items;
    oco.order      = { ...oco.order, ...order };

    // Run pipeline
    let result;
    if (skip_invoice) {
      result = await orchestrator.createOrder(oco);
    } else {
      result = await orchestrator.run(oco);
    }

    // Persist
    const doc = await SalesOrder.create({
      oco_id:            result.id,
      tenant_id:         result.tenant_id,
      source:            result.source,
      created_by:        result.created_by,
      status:            result.status,
      customer:          result.customer,
      credit:            result.credit,
      order:             result.order,
      line_items:        result.line_items,
      totals:            result.totals,
      gst:               result.gst,
      einvoice:          result.einvoice,
      dispatch:          result.dispatch,
      payments:          result.payments,
      reconciliation:    result.reconciliation,
      confidence:        result.overallConfidence(),
      confidence_scores: result.confidence_scores,
      flags:             result.flags,
      audit_trail:       result.audit_trail,
    });

    res.status(201).json({
      success:          true,
      oco_id:           result.id,
      db_id:            doc._id,
      status:           result.status,
      order_number:     result.order.order_number,
      invoice_number:   result.einvoice?.invoice_number || null,
      irn:              result.einvoice?.irn || null,
      grand_total:      result.totals.grand_total,
      confidence:       result.overallConfidence(),
      flags:            result.flags,
      processing_ms:    Date.now() - start,
      oco:              result.toJSON(),
    });
  } catch (err) {
    console.error('[O2C] POST /orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/o2c/orders
// List orders with optional filters
// ─────────────────────────────────────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const { status, customer_gstin, from, to, limit = 50, page = 1 } = req.query;
    const query = { tenant_id: tid(req) };

    if (status)          query.status = status;
    if (customer_gstin)  query['customer.gstin'] = customer_gstin;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)   query.createdAt.$lte = new Date(to);
    }

    const [orders, total] = await Promise.all([
      SalesOrder.find(query)
        .select('oco_id status customer.name customer.gstin order totals.grand_total einvoice.invoice_number confidence createdAt')
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip((Number(page) - 1) * Number(limit))
        .lean(),
      SalesOrder.countDocuments(query),
    ]);

    res.json({ total, page: Number(page), limit: Number(limit), orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/o2c/orders/:id
// Single order by OCO ID or MongoDB _id
// ─────────────────────────────────────────────────────────────────
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await SalesOrder.findOne({
      $or: [{ oco_id: req.params.id }, { _id: req.params.id.match(/^[a-f\d]{24}$/i) ? req.params.id : null }],
      tenant_id: tid(req),
    }).lean();

    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/o2c/orders/:id/invoice
// E-invoice payload + IRN details
// ─────────────────────────────────────────────────────────────────
router.get('/orders/:id/invoice', async (req, res) => {
  try {
    const order = await SalesOrder.findOne({ oco_id: req.params.id, tenant_id: tid(req) })
      .select('einvoice gst totals customer order').lean();

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.einvoice?.irn) return res.status(400).json({ error: 'Invoice not yet generated' });

    res.json({
      invoice_number: order.einvoice.invoice_number,
      invoice_date:   order.einvoice.invoice_date,
      irn:            order.einvoice.irn,
      ack_number:     order.einvoice.ack_number,
      ack_date:       order.einvoice.ack_date,
      qr_code:        order.einvoice.qr_code,
      customer:       order.customer,
      totals:         order.totals,
      gst:            order.gst,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/o2c/orders/:id/dispatch
// Record dispatch details (E-way bill, vehicle, LR number)
// ─────────────────────────────────────────────────────────────────
router.patch('/orders/:id/dispatch', async (req, res) => {
  try {
    const { transporter, vehicle_no, lr_number, eway_bill_no, shipping_mode } = req.body;

    const update = {
      status: 'DISPATCHED',
      'dispatch.dispatched_at':   new Date().toISOString(),
      'dispatch.transporter':     transporter,
      'dispatch.vehicle_no':      vehicle_no,
      'dispatch.lr_number':       lr_number,
      'dispatch.delivery_status': 'IN_TRANSIT',
    };
    if (eway_bill_no)  update['dispatch.eway_bill_no']  = eway_bill_no;
    if (shipping_mode) update['order.shipping_mode']    = shipping_mode;

    const order = await SalesOrder.findOneAndUpdate(
      { oco_id: req.params.id, tenant_id: tid(req), status: 'INVOICE_GENERATED' },
      { $set: update },
      { new: true }
    );

    if (!order) return res.status(404).json({ error: 'Order not found or not in INVOICE_GENERATED status' });
    res.json({ success: true, status: order.status, dispatch: order.dispatch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/o2c/orders/:id/deliver
// Confirm delivery (Proof of Delivery)
// ─────────────────────────────────────────────────────────────────
router.patch('/orders/:id/deliver', async (req, res) => {
  try {
    const { pod_reference, delivered_by, notes } = req.body;

    const order = await SalesOrder.findOneAndUpdate(
      { oco_id: req.params.id, tenant_id: tid(req), status: 'DISPATCHED' },
      {
        $set: {
          status:                      'DELIVERED',
          'dispatch.delivered_at':     new Date().toISOString(),
          'dispatch.pod_reference':    pod_reference,
          'dispatch.delivery_status':  'DELIVERED',
        },
        $push: {
          audit_trail: {
            actor: delivered_by || 'logistics',
            action: 'delivery_confirmed',
            metadata: { pod_reference, notes },
            timestamp: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!order) return res.status(404).json({ error: 'Order not found or not in DISPATCHED status' });
    res.json({ success: true, status: order.status, delivered_at: order.dispatch.delivered_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/o2c/orders/:id/payments
// Record payment receipt and run Phase 3 reconciliation
// ─────────────────────────────────────────────────────────────────
router.post('/orders/:id/payments', async (req, res) => {
  const start = Date.now();
  try {
    const { payments } = req.body;
    if (!payments?.length) return res.status(400).json({ error: 'payments array is required' });

    // Fetch current OCO state
    const doc = await SalesOrder.findOne({ oco_id: req.params.id, tenant_id: tid(req) });
    if (!doc) return res.status(404).json({ error: 'Order not found' });

    // Rebuild OCO from persisted state
    const oco = new O2CCanonicalObject({ tenant_id: doc.tenant_id });
    Object.assign(oco, doc.toObject());
    oco.id = doc.oco_id;

    // Run Phase 3
    const result = await orchestrator.reconcilePayment(oco, payments);

    // Persist updates
    await SalesOrder.findOneAndUpdate(
      { oco_id: req.params.id },
      {
        $set: {
          status:         result.status,
          payments:       result.payments,
          reconciliation: result.reconciliation,
          credit:         result.credit,
          flags:          result.flags,
          audit_trail:    result.audit_trail,
        },
      }
    );

    res.json({
      success:           true,
      status:            result.status,
      fully_reconciled:  result.reconciliation.fully_reconciled,
      total_received:    result.reconciliation.total_received,
      total_outstanding: result.reconciliation.total_outstanding,
      flags:             result.flags,
      processing_ms:     Date.now() - start,
    });
  } catch (err) {
    console.error('[O2C] POST /payments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/o2c/dashboard
// YTD KPIs for the O2C Command Centre
// ─────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const t    = tid(req);
    const fy   = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const fyStart = new Date(`${fy}-04-01`);

    const [
      totalOrders,
      statusCounts,
      financials,
      avgConfidence,
      recentOrders,
      overdueOrders,
    ] = await Promise.all([

      SalesOrder.countDocuments({ tenant_id: t }),

      SalesOrder.aggregate([
        { $match: { tenant_id: t } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      SalesOrder.aggregate([
        { $match: { tenant_id: t, createdAt: { $gte: fyStart } } },
        { $group: {
          _id:                    null,
          total_invoiced:         { $sum: '$totals.grand_total' },
          total_received:         { $sum: '$reconciliation.total_received' },
          total_outstanding:      { $sum: '$reconciliation.total_outstanding' },
          total_gst:              { $sum: '$totals.total_gst' },
          total_tcs:              { $sum: '$totals.tcs_amount' },
          total_taxable:          { $sum: '$totals.taxable_value' },
          avg_order_value:        { $avg: '$totals.grand_total' },
          fully_reconciled_count: { $sum: { $cond: ['$reconciliation.fully_reconciled', 1, 0] } },
          runs: { $sum: 1 },
        }},
      ]),

      SalesOrder.aggregate([
        { $match: { tenant_id: t } },
        { $group: { _id: null, avg: { $avg: '$confidence' } } },
      ]),

      SalesOrder.find({ tenant_id: t })
        .select('oco_id status customer.name totals.grand_total einvoice.invoice_number reconciliation.fully_reconciled createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

      SalesOrder.countDocuments({
        tenant_id: t,
        status: { $in: ['INVOICE_GENERATED', 'DISPATCHED', 'DELIVERED', 'PAYMENT_RECEIVED'] },
        'reconciliation.fully_reconciled': false,
      }),

    ]);

    const fin  = financials[0] || {};
    const statusMap = statusCounts.reduce((m, s) => { m[s._id] = s.count; return m; }, {});

    res.json({
      total_orders:       totalOrders,
      avg_confidence:     Math.round(avgConfidence[0]?.avg || 0),
      status_breakdown:   statusMap,
      overdue_orders:     overdueOrders,
      ytd: {
        total_invoiced:         fin.total_invoiced         || 0,
        total_received:         fin.total_received         || 0,
        total_outstanding:      fin.total_outstanding      || 0,
        total_gst_collected:    fin.total_gst              || 0,
        total_tcs_collected:    fin.total_tcs              || 0,
        total_taxable_value:    fin.total_taxable          || 0,
        avg_order_value:        Math.round(fin.avg_order_value || 0),
        fully_reconciled_count: fin.fully_reconciled_count || 0,
        orders:                 fin.runs                   || 0,
        collection_efficiency:  fin.total_invoiced
          ? Math.round((fin.total_received / fin.total_invoiced) * 100)
          : 0,
      },
      recent_orders:  recentOrders,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
