/**
 * BHARAT ERP — HR REST Routes (Sprint 5)
 *
 * POST   /api/hr/payroll            Initiate + run full payroll pipeline
 * GET    /api/hr/payroll            List payroll runs
 * GET    /api/hr/payroll/:id        Single run detail
 * GET    /api/hr/payroll/:id/payslips  All payslips for a run
 * POST   /api/hr/payroll/:id/approve   Approve a payroll run
 * GET    /api/hr/dashboard          HR KPI dashboard
 */

const router         = require('express').Router();
const HRCanonicalObject = require('../../domains/hr/HRCanonicalObject');
const HROrchestrator = require('../../domains/hr/HROrchestrator');
const { PayrollRun } = require('../../domains/hr/models/HRModels');

const tid = (req) => req.headers['x-tenant-id'] || 'demo-corp';

// ─────────────────────────────────────────────────────────────────
// POST /api/hr/payroll  — Run payroll for a month
// ─────────────────────────────────────────────────────────────────
router.post('/payroll', async (req, res) => {
  const start = Date.now();
  try {
    const { month, year, employees, attendance, initiated_by } = req.body;
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    if (!employees?.length) return res.status(400).json({ error: 'employees array is required' });

    const hco = new HRCanonicalObject({ tenant_id: tid(req), month, year, initiatedBy: initiated_by });
    hco.employees  = employees;
    hco.attendance = attendance || [];

    const orchestrator = new HROrchestrator();
    const result       = await orchestrator.run(hco);

    const doc = await PayrollRun.create({
      tenant_id:           result.tenant_id,
      canonical_id:        result.id,
      status:              result.status,
      month:               result.period.month,
      year:                result.period.year,
      initiated_by:        result.period.initiated_by,
      ...result.summary,
      employees:           result.employees,
      attendance:          result.attendance,
      salary_components:   result.salary_components,
      statutory:           result.statutory,
      domain_data:         result.domain_data,
      overall_confidence:  result.overallConfidence(),
      flags:               result.flags,
      audit_trail:         result.audit_trail,
    });

    res.status(201).json({
      success:             true,
      payroll_run_id:      doc._id,
      canonical_id:        result.id,
      status:              result.status,
      period:              `${result.period.month}/${result.period.year}`,
      summary:             result.summary,
      confidence:          result.overallConfidence(),
      flags:               result.flags?.length,
      payslips_generated:  result.domain_data?.payslips?.length,
      pipeline_ms:         Date.now() - start,
    });
  } catch (err) {
    console.error('[HR] payroll error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/hr/payroll
// ─────────────────────────────────────────────────────────────────
router.get('/payroll', async (req, res) => {
  try {
    const { year, status, page = 1, limit = 24 } = req.query;
    const filter = { tenant_id: tid(req) };
    if (year)   filter.year   = Number(year);
    if (status) filter.status = status;

    const [docs, total] = await Promise.all([
      PayrollRun.find(filter)
        .sort({ year: -1, month: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .select('-employees -attendance -salary_components -statutory -domain_data -audit_trail'),
      PayrollRun.countDocuments(filter),
    ]);

    res.json({ total, page: Number(page), runs: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/hr/payroll/:id
// ─────────────────────────────────────────────────────────────────
router.get('/payroll/:id', async (req, res) => {
  try {
    const doc = await PayrollRun.findOne({ _id: req.params.id, tenant_id: tid(req) });
    if (!doc) return res.status(404).json({ error: 'Payroll run not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/hr/payroll/:id/payslips
// ─────────────────────────────────────────────────────────────────
router.get('/payroll/:id/payslips', async (req, res) => {
  try {
    const doc = await PayrollRun.findOne({ _id: req.params.id, tenant_id: tid(req) })
      .select('domain_data period status');
    if (!doc) return res.status(404).json({ error: 'Payroll run not found' });
    res.json({
      period:   `${doc.period?.month}/${doc.period?.year}`,
      status:   doc.status,
      payslips: doc.domain_data?.payslips || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/hr/payroll/:id/approve
// ─────────────────────────────────────────────────────────────────
router.post('/payroll/:id/approve', async (req, res) => {
  try {
    const { approved_by, remarks } = req.body;
    const doc = await PayrollRun.findOne({ _id: req.params.id, tenant_id: tid(req) });
    if (!doc) return res.status(404).json({ error: 'Payroll run not found' });

    doc.status = 'APPROVED';
    doc.audit_trail.push({
      timestamp: new Date().toISOString(),
      agent:     'HumanApproval',
      action:    'PAYROLL_APPROVED',
      detail:    { approved_by, remarks },
    });
    await doc.save();

    res.json({ success: true, status: doc.status, approved_by });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/hr/dashboard
// ─────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const t = tid(req);
    const currentYear = new Date().getFullYear();

    const [total, recent, ytdAgg, byStatus] = await Promise.all([
      PayrollRun.countDocuments({ tenant_id: t }),
      PayrollRun.find({ tenant_id: t })
        .sort({ year: -1, month: -1 })
        .limit(6)
        .select('month year status total_employees total_gross total_net_payable total_employer_cost'),
      PayrollRun.aggregate([
        { $match: { tenant_id: t, year: currentYear } },
        { $group: {
          _id: null,
          total_gross:         { $sum: '$total_gross' },
          total_net:           { $sum: '$total_net_payable' },
          total_pf:            { $sum: { $add: ['$total_pf_employee', '$total_pf_employer'] } },
          total_esi:           { $sum: { $add: ['$total_esi_employee', '$total_esi_employer'] } },
          total_tds:           { $sum: '$total_tds' },
          total_employer_cost: { $sum: '$total_employer_cost' },
          runs:                { $sum: 1 },
        }},
      ]),
      PayrollRun.aggregate([
        { $match: { tenant_id: t } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const statusMap = {};
    byStatus.forEach(s => { statusMap[s._id] = s.count; });

    res.json({
      total_runs:     total,
      status_summary: statusMap,
      ytd:            ytdAgg[0] || {},
      recent_runs:    recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
