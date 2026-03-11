/**
 * BHARAT ERP — Sourcing REST Routes (Sprint 4)
 *
 * POST   /api/sourcing/requisitions           Create + run pipeline Phase 1
 * GET    /api/sourcing/requisitions           List with filter/pagination
 * GET    /api/sourcing/requisitions/:id       Single requisition + full SCO
 * POST   /api/sourcing/requisitions/:id/quotes  Submit vendor quote(s)
 * POST   /api/sourcing/requisitions/:id/evaluate  Run Phase 2 (eval + PO draft)
 * PATCH  /api/sourcing/requisitions/:id/select   Human selects vendor
 * GET    /api/sourcing/dashboard              KPIs for sourcing dashboard
 *
 * Pattern identical to p2p.js — proves reusability.
 */

const router               = require('express').Router();
const SourcingCanonicalObject = require('../../domains/sourcing/SourcingCanonicalObject');
const SourcingOrchestrator = require('../../domains/sourcing/SourcingOrchestrator');
const { Requisition }      = require('../../domains/sourcing/models/SourcingModels');

const tid = (req) => req.headers['x-tenant-id'] || 'demo-corp';

// ─────────────────────────────────────────────────────────────────
// POST /api/sourcing/requisitions
// Create a requisition and immediately run Phase 1 (enrich + shortlist + RFQ)
// ─────────────────────────────────────────────────────────────────
router.post('/requisitions', async (req, res) => {
  const start = Date.now();
  try {
    const {
      description, category, quantity, unit, estimated_value,
      required_by, department, requested_by, cost_center,
      skip_rfq = false,
    } = req.body;

    if (!description) return res.status(400).json({ error: 'description is required' });

    // Build canonical object
    const sco = new SourcingCanonicalObject({ tenant_id: tid(req), source: 'api', requestedBy: requested_by });
    sco.requisition = {
      ...sco.requisition,
      description,
      category:        category || null,
      quantity:        quantity || null,
      unit:            unit || null,
      estimated_value: estimated_value || null,
      required_by:     required_by || null,
      department:      department || null,
      requested_by:    requested_by || null,
      cost_center:     cost_center || null,
    };

    // Run Phase 1 pipeline
    const orchestrator = new SourcingOrchestrator();
    const result       = skip_rfq
      ? await orchestrator.processRequisition(sco).catch(() => sco)
      : await orchestrator.processRequisition(sco);

    // Persist
    const doc = await Requisition.create({
      tenant_id:          result.tenant_id,
      canonical_id:       result.id,
      status:             result.status,
      description:        result.requisition.description,
      category:           result.requisition.category,
      quantity:           result.requisition.quantity,
      unit:               result.requisition.unit,
      estimated_value:    result.requisition.estimated_value,
      required_by:        result.requisition.required_by ? new Date(result.requisition.required_by) : null,
      department:         result.requisition.department,
      requested_by:       result.requisition.requested_by,
      gl_code:            result.requisition.gl_code,
      hsn_sac_code:       result.enriched?.hsn_sac_code,
      market_rate_min:    result.enriched?.market_rate_estimate?.min,
      market_rate_max:    result.enriched?.market_rate_estimate?.max,
      rfq_id:             result.rfq?.id,
      rfq_sent_at:        result.rfq?.sent_at ? new Date(result.rfq.sent_at) : null,
      rfq_response_due:   result.rfq?.response_due ? new Date(result.rfq.response_due) : null,
      vendors_invited:    result.rfq?.vendors_invited || [],
      overall_confidence: result.overallConfidence(),
      flags:              result.flags || [],
      audit_trail:        result.audit_trail || [],
      domain_data:        result.domain_data || {},
      quotes:             result.quotes || [],
    });

    res.status(201).json({
      success:       true,
      requisition_id: doc._id,
      canonical_id:  result.id,
      status:        result.status,
      rfq_id:        result.rfq?.id,
      rfq_sent_to:   result.rfq?.vendors_invited?.length,
      rfq_response_due: result.rfq?.response_due,
      confidence:    result.overallConfidence(),
      flags:         result.flags?.length,
      pipeline_ms:   Date.now() - start,
    });
  } catch (err) {
    console.error('[Sourcing] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/sourcing/requisitions
// ─────────────────────────────────────────────────────────────────
router.get('/requisitions', async (req, res) => {
  try {
    const {
      status, search, page = 1, limit = 50,
      sort = 'createdAt', order = 'desc',
    } = req.query;

    const filter = { tenant_id: tid(req) };
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { description:        { $regex: search, $options: 'i' } },
        { rfq_id:             { $regex: search, $options: 'i' } },
        { po_number:          { $regex: search, $options: 'i' } },
        { selected_vendor_name: { $regex: search, $options: 'i' } },
        { department:         { $regex: search, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      Requisition.find(filter)
        .sort({ [sort]: order === 'desc' ? -1 : 1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .select('-audit_trail -domain_data -quotes'),
      Requisition.countDocuments(filter),
    ]);

    res.json({ total, page: Number(page), limit: Number(limit), requisitions: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/sourcing/requisitions/:id
// ─────────────────────────────────────────────────────────────────
router.get('/requisitions/:id', async (req, res) => {
  try {
    const doc = await Requisition.findOne({ _id: req.params.id, tenant_id: tid(req) });
    if (!doc) return res.status(404).json({ error: 'Requisition not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/sourcing/requisitions/:id/quotes
// Submit one or more vendor quotes (from RFQ responses)
// ─────────────────────────────────────────────────────────────────
router.post('/requisitions/:id/quotes', async (req, res) => {
  try {
    const doc = await Requisition.findOne({ _id: req.params.id, tenant_id: tid(req) });
    if (!doc) return res.status(404).json({ error: 'Requisition not found' });

    const { quotes } = req.body;
    if (!quotes || !Array.isArray(quotes) || !quotes.length) {
      return res.status(400).json({ error: 'quotes array is required' });
    }

    // Append quotes, update status
    doc.quotes = [...(doc.quotes || []), ...quotes];
    doc.status = 'QUOTES_RECEIVED';
    await doc.save();

    res.json({
      success:         true,
      quotes_received: doc.quotes.length,
      status:          doc.status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/sourcing/requisitions/:id/evaluate
// Run Phase 2: evaluate quotes + draft PO
// ─────────────────────────────────────────────────────────────────
router.post('/requisitions/:id/evaluate', async (req, res) => {
  const start = Date.now();
  try {
    const doc = await Requisition.findOne({ _id: req.params.id, tenant_id: tid(req) });
    if (!doc) return res.status(404).json({ error: 'Requisition not found' });

    if (!doc.quotes?.length) {
      return res.status(400).json({ error: 'No quotes available. Submit quotes first.' });
    }

    // Reconstruct SCO from DB record
    const sco = _docToSCO(doc);

    // Run Phase 2
    const orchestrator = new SourcingOrchestrator();
    const result       = await orchestrator.evaluateAndDraft(sco, req.body.selected_vendor || null);

    // Persist results
    doc.status             = result.status;
    doc.evaluation         = result.evaluation;
    doc.quotes             = result.quotes;
    doc.po_draft           = result.po_draft;
    doc.po_number          = result.po_draft?.po_number;
    doc.po_total_value     = result.po_draft?.total_value;
    doc.po_status          = result.po_draft?.status;
    doc.selected_vendor_id   = result.selected_vendor?.id;
    doc.selected_vendor_name = result.selected_vendor?.name;
    doc.negotiated_price     = result.selected_vendor?.negotiated_price;
    doc.overall_confidence   = result.overallConfidence();
    doc.flags = result.flags;
    result.audit_trail.forEach(e => doc.audit_trail.push(e));
    await doc.save();

    res.json({
      success:            true,
      status:             result.status,
      recommended_vendor: result.evaluation?.recommended_vendor,
      po_number:          result.po_draft?.po_number,
      po_total_value:     result.po_draft?.total_value,
      po_status:          result.po_draft?.status,
      confidence:         result.overallConfidence(),
      pipeline_ms:        Date.now() - start,
    });
  } catch (err) {
    console.error('[Sourcing] evaluate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/sourcing/requisitions/:id/select
// Human selects a vendor (override AI recommendation)
// ─────────────────────────────────────────────────────────────────
router.patch('/requisitions/:id/select', async (req, res) => {
  try {
    const { vendor_name, vendor_id, notes } = req.body;
    if (!vendor_name) return res.status(400).json({ error: 'vendor_name required' });

    const doc = await Requisition.findOne({ _id: req.params.id, tenant_id: tid(req) });
    if (!doc) return res.status(404).json({ error: 'Requisition not found' });

    doc.selected_vendor_name = vendor_name;
    doc.selected_vendor_id   = vendor_id || null;
    doc.status               = 'VENDOR_SELECTED';
    doc.audit_trail.push({
      timestamp: new Date().toISOString(),
      agent:     'HumanOverride',
      action:    'VENDOR_SELECTED_MANUAL',
      detail:    { vendor_name, notes: notes || null, actor: 'user' },
    });
    await doc.save();

    res.json({ success: true, selected_vendor: vendor_name, status: doc.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/sourcing/dashboard
// ─────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const t = tid(req);

    const [total, byStatus, recentDocs, avgConf] = await Promise.all([
      Requisition.countDocuments({ tenant_id: t }),
      Requisition.aggregate([
        { $match: { tenant_id: t } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Requisition.find({ tenant_id: t })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('description status rfq_id po_number po_total_value department createdAt'),
      Requisition.aggregate([
        { $match: { tenant_id: t, overall_confidence: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$overall_confidence' } } },
      ]),
    ]);

    // Status counts
    const statusMap = {};
    byStatus.forEach(s => { statusMap[s._id] = s.count; });

    // Total PO value in pipeline
    const poValueAgg = await Requisition.aggregate([
      { $match: { tenant_id: t, po_total_value: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$po_total_value' } } },
    ]);
    const totalPOValue = poValueAgg[0]?.total || 0;

    res.json({
      total_requisitions: total,
      status_breakdown:   statusMap,
      total_po_value:     totalPOValue,
      avg_confidence:     Math.round(avgConf[0]?.avg || 0),
      rfq_active:         (statusMap['RFQ_SENT'] || 0) + (statusMap['QUOTES_RECEIVED'] || 0),
      pos_pending_approval: (statusMap['PO_DRAFTED'] || 0),
      recent:             recentDocs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: reconstruct SCO from DB doc ─────────────────────────
function _docToSCO(doc) {
  const SourcingCanonicalObject = require('../../domains/sourcing/SourcingCanonicalObject');
  const sco = new SourcingCanonicalObject({ tenant_id: doc.tenant_id });
  sco.id     = doc.canonical_id;
  sco.status = doc.status;
  sco.requisition = {
    ...sco.requisition,
    description:     doc.description,
    category:        doc.category,
    quantity:        doc.quantity,
    unit:            doc.unit,
    estimated_value: doc.estimated_value,
    required_by:     doc.required_by,
    department:      doc.department,
    requested_by:    doc.requested_by,
    gl_code:         doc.gl_code,
  };
  sco.enriched = {
    ...sco.enriched,
    hsn_sac_code: doc.hsn_sac_code,
    suggested_vendors: doc.vendors_invited || [],
    market_rate_estimate: { min: doc.market_rate_min, max: doc.market_rate_max },
  };
  sco.rfq = {
    id:              doc.rfq_id,
    sent_at:         doc.rfq_sent_at,
    response_due:    doc.rfq_response_due,
    vendors_invited: doc.vendors_invited || [],
  };
  sco.quotes       = doc.quotes || [];
  sco.audit_trail  = doc.audit_trail || [];
  sco.flags        = doc.flags || [];
  sco.domain_data  = doc.domain_data || {};
  return sco;
}

module.exports = router;
