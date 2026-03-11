/**
 * BHARAT ERP — P2P REST Routes (Sprint 2)
 *
 * POST   /api/p2p/invoices/process    Submit raw invoice text → run pipeline
 * GET    /api/p2p/invoices            List invoices (filter, paginate, search)
 * GET    /api/p2p/invoices/:id        Single invoice with full CIO
 * PATCH  /api/p2p/invoices/:id/decision  Human approve/reject/escalate
 * GET    /api/p2p/dashboard           KPIs for dashboard
 * GET    /api/p2p/vendors             List vendors
 * POST   /api/p2p/vendors             Create vendor
 * GET    /api/p2p/pos                 List purchase orders
 * POST   /api/p2p/pos                 Create PO
 */
const router = require('express').Router();
const P2PCanonicalObject  = require('../../domains/p2p/P2PCanonicalObject');
const P2POrchestrator     = require('../../domains/p2p/P2POrchestrator');
const { ProcessedInvoice } = require('../../domains/p2p/models/P2PModels');
const { VendorModel }     = require('../../platform/models/MasterDataModels');
const { PurchaseOrder, GoodsReceiptNote } = require('../../domains/p2p/models/P2PModels');
const MasterDataService   = require('../../platform/services/MasterDataService');
const approvalOrchestrator = require('../../platform/services/ApprovalOrchestrator');

// ── helpers ───────────────────────────────────────────────────────
const tenantId = (req) => req.headers['x-tenant-id'] || 'demo-corp';

// ─────────────────────────────────────────────────────────────────
// INVOICE PIPELINE
// ─────────────────────────────────────────────────────────────────

/**
 * POST /api/p2p/invoices/process
 * Body: { content: "invoice text", source: "api|email|whatsapp|manual" }
 * Returns: processed canonical invoice object
 */
router.post('/invoices/process', async (req, res) => {
  const start = Date.now();
  try {
    const { content, source = 'api' } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });

    const obj = new P2PCanonicalObject({
      source,
      tenant_id: tenantId(req),
    });
    obj.source_content = content;

    const orchestrator = new P2POrchestrator();
    const result = await orchestrator.process(obj);

    // Persist to MongoDB
    const doc = new ProcessedInvoice({
      tenant_id:    result.tenant_id,
      canonical_id: result.id,
      invoice_number: result.extracted?.invoice_number || 'UNKNOWN',
      vendor_name:    result.extracted?.vendor?.name   || 'Unknown',
      vendor_gstin:   result.extracted?.vendor?.gstin  || '',
      invoice_date:   result.extracted?.invoice_date ? new Date(result.extracted.invoice_date) : new Date(),
      total_amount:   result.extracted?.total_amount   || 0,
      net_payable:    result.domain_data?.compliance?.tds?.net_payable
                      || result.extracted?.total_amount || 0,
      tds_amount:     result.domain_data?.compliance?.tds?.amount || 0,
      status:         result.status,
      three_way_score: result.overallConfidence(),
      fraud_score:    result.domain_data?.fraud_detection?.risk_score || 0,
      decision:       result.decision,
      flags:          result.flags || [],
      domain_data:    result.domain_data || {},
      audit_trail:    result.audit_trail || [],
      pipeline_ms:    Date.now() - start,
    });
    await doc.save();

    // Sprint 3: Trigger WhatsApp approval if invoice needs human review
    let approvalTriggered = false;
    if (doc.status === 'pending_approval' && process.env.FM_WHATSAPP_NUMBER) {
      try {
        await approvalOrchestrator.triggerApproval(doc, doc.tenant_id);
        approvalTriggered = true;
        // Save updated audit trail
        await doc.save();
      } catch (waErr) {
        console.error('[P2P] WhatsApp trigger failed (non-fatal):', waErr.message);
      }
    }

    res.json({
      success: true,
      invoice_id: doc._id,
      canonical_id: result.id,
      status: result.status,
      invoice_number: doc.invoice_number,
      vendor_name: doc.vendor_name,
      total_amount: doc.total_amount,
      three_way_score: doc.three_way_score,
      fraud_score: doc.fraud_score,
      decision: result.decision,
      flags: result.flags,
      pipeline_ms: doc.pipeline_ms,
      approval_triggered: approvalTriggered,
    });
  } catch (err) {
    console.error('[P2P] process error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/p2p/invoices
 * Query: status, search, page, limit, sort, from_date, to_date
 */
router.get('/invoices', async (req, res) => {
  try {
    const {
      status, search, page = 1, limit = 50,
      sort = 'createdAt', order = 'desc',
      from_date, to_date,
    } = req.query;

    const q = { tenant_id: tenantId(req) };
    if (status && status !== 'all') q.status = status;
    if (search) {
      q.$or = [
        { invoice_number: { $regex: search, $options: 'i' } },
        { vendor_name:    { $regex: search, $options: 'i' } },
      ];
    }
    if (from_date || to_date) {
      q.invoice_date = {};
      if (from_date) q.invoice_date.$gte = new Date(from_date);
      if (to_date)   q.invoice_date.$lte = new Date(to_date);
    }

    const [invoices, total] = await Promise.all([
      ProcessedInvoice.find(q)
        .sort({ [sort]: order === 'desc' ? -1 : 1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      ProcessedInvoice.countDocuments(q),
    ]);

    res.json({ invoices, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/p2p/invoices/:id
 * Full canonical invoice object with audit trail
 */
router.get('/invoices/:id', async (req, res) => {
  try {
    const doc = await ProcessedInvoice.findOne({
      _id: req.params.id,
      tenant_id: tenantId(req),
    }).lean();
    if (!doc) return res.status(404).json({ error: 'Invoice not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/p2p/invoices/:id/decision
 * Human override: approve / reject / escalate
 * Body: { action: "approve|reject|escalate", reason: "...", reviewer: "..." }
 */
router.patch('/invoices/:id/decision', async (req, res) => {
  try {
    const { action, reason, reviewer = 'finance_manager' } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });

    const statusMap = {
      approve:  'approved',
      reject:   'rejected',
      escalate: 'pending_approval',
    };
    const newStatus = statusMap[action] || 'pending_approval';

    const doc = await ProcessedInvoice.findOneAndUpdate(
      { _id: req.params.id, tenant_id: tenantId(req) },
      {
        status: newStatus,
        decision: {
          action,
          reason: reason || `Human ${action} by ${reviewer}`,
          confidence: 100,
          reviewer,
          timestamp: new Date(),
          human_override: true,
        },
        $push: {
          audit_trail: {
            ts: new Date(),
            actor: reviewer,
            action: `human_${action}`,
            detail: reason || `Invoice ${action}d by ${reviewer}`,
          },
        },
      },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, status: doc.status, decision: doc.decision });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// DASHBOARD KPIs
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/p2p/dashboard
 * Returns all KPIs needed by the React dashboard
 */
router.get('/dashboard', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const [
      totalInvoices,
      statusCounts,
      totalValue,
      avgScores,
      recentTrend,
      topExceptions,
    ] = await Promise.all([
      ProcessedInvoice.countDocuments({ tenant_id: tid }),

      ProcessedInvoice.aggregate([
        { $match: { tenant_id: tid } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      ProcessedInvoice.aggregate([
        { $match: { tenant_id: tid } },
        { $group: {
          _id: null,
          total_value:  { $sum: '$total_amount' },
          tds_held:     { $sum: '$tds_amount' },
          avg_amount:   { $avg: '$total_amount' },
        }},
      ]),

      ProcessedInvoice.aggregate([
        { $match: { tenant_id: tid } },
        { $group: {
          _id: null,
          avg_three_way:  { $avg: '$three_way_score' },
          avg_fraud:      { $avg: '$fraud_score' },
          avg_pipeline_ms:{ $avg: '$pipeline_ms' },
        }},
      ]),

      // Last 15 days — daily STP rate
      ProcessedInvoice.aggregate([
        { $match: { tenant_id: tid, createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: 1 },
          approved: {
            $sum: {
              $cond: [
                { $in: ['$status', ['approved', 'payment_scheduled']] }, 1, 0
              ]
            }
          },
          total_value: { $sum: '$total_amount' },
        }},
        { $sort: { _id: 1 } },
        { $limit: 15 },
      ]),

      // Recent exceptions
      ProcessedInvoice.find({
        tenant_id: tid,
        status: { $in: ['exception', 'on_hold'] },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('invoice_number vendor_name total_amount status flags createdAt')
        .lean(),
    ]);

    // Build status map
    const byStatus = {};
    statusCounts.forEach(s => { byStatus[s._id] = s.count; });

    const approved = (byStatus['approved'] || 0) + (byStatus['payment_scheduled'] || 0);
    const stp_rate = totalInvoices > 0 ? Math.round(approved / totalInvoices * 100) : 0;

    const vals = totalValue[0] || {};
    const scores = avgScores[0] || {};

    res.json({
      summary: {
        total_invoices:    totalInvoices,
        stp_rate,
        approved,
        pending:    byStatus['pending_approval'] || 0,
        exceptions: (byStatus['exception'] || 0) + (byStatus['on_hold'] || 0),
        total_value:    vals.total_value    || 0,
        tds_held:       vals.tds_held       || 0,
        avg_amount:     Math.round(vals.avg_amount || 0),
        avg_three_way:  Math.round(scores.avg_three_way || 0),
        avg_fraud:      Math.round(scores.avg_fraud || 0),
        avg_pipeline_ms:Math.round(scores.avg_pipeline_ms || 0),
      },
      by_status: byStatus,
      daily_trend: recentTrend,
      top_exceptions: topExceptions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// VENDORS
// ─────────────────────────────────────────────────────────────────

router.get('/vendors', async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const q = { tenant_id: tenantId(req) };
    if (status) q.status = status;
    if (search) q.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { gstin: { $regex: search, $options: 'i' } },
    ];
    const vendors = await VendorModel.find(q)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();
    const total = await VendorModel.countDocuments(q);
    res.json({ vendors, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/vendors', async (req, res) => {
  try {
    const vendor = new VendorModel({ ...req.body, tenant_id: tenantId(req) });
    await vendor.save();
    res.status(201).json(vendor);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PURCHASE ORDERS
// ─────────────────────────────────────────────────────────────────

router.get('/pos', async (req, res) => {
  try {
    const { status, vendor, page = 1, limit = 20 } = req.query;
    const q = { tenant_id: tenantId(req) };
    if (status) q.status = status;
    if (vendor) q.vendor_name = { $regex: vendor, $options: 'i' };
    const pos = await PurchaseOrder.find(q)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();
    const total = await PurchaseOrder.countDocuments(q);
    res.json({ pos, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pos', async (req, res) => {
  try {
    const po = new PurchaseOrder({ ...req.body, tenant_id: tenantId(req) });
    await po.save();
    res.status(201).json(po);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
