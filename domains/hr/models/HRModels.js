/**
 * BHARAT ERP — HR Domain Models (Sprint 5)
 * MongoDB schema for payroll runs.
 */

const mongoose = require('mongoose');

const PayrollRunSchema = new mongoose.Schema({
  tenant_id:     { type: String, required: true, index: true },
  canonical_id:  { type: String, required: true, unique: true },
  status:        { type: String, default: 'INITIATED', enum: [
    'INITIATED','EMPLOYEE_VALIDATED','ATTENDANCE_FETCHED',
    'CALCULATED','COMPLIANCE_COMPUTED','APPROVED','DISBURSED','RECONCILED','FAILED',
  ]},
  month:         { type: Number, required: true },
  year:          { type: Number, required: true },
  initiated_by:  { type: String },

  // Summary (company level)
  total_employees:     { type: Number, default: 0 },
  total_gross:         { type: Number, default: 0 },
  total_net_payable:   { type: Number, default: 0 },
  total_employer_cost: { type: Number, default: 0 },
  total_pf_employee:   { type: Number, default: 0 },
  total_pf_employer:   { type: Number, default: 0 },
  total_esi_employee:  { type: Number, default: 0 },
  total_esi_employer:  { type: Number, default: 0 },
  total_pt:            { type: Number, default: 0 },
  total_tds:           { type: Number, default: 0 },

  // Full detail (embedded)
  employees:          { type: mongoose.Schema.Types.Mixed, default: [] },
  attendance:         { type: mongoose.Schema.Types.Mixed, default: [] },
  salary_components:  { type: mongoose.Schema.Types.Mixed, default: [] },
  statutory:          { type: mongoose.Schema.Types.Mixed, default: [] },
  domain_data:        { type: mongoose.Schema.Types.Mixed, default: {} },

  overall_confidence: { type: Number, default: 0 },
  flags:              [{ code: String, severity: String, detail: String, agent: String }],
  audit_trail:        [{ timestamp: String, agent: String, action: String, detail: mongoose.Schema.Types.Mixed }],
}, { timestamps: true });

PayrollRunSchema.index({ tenant_id: 1, year: 1, month: 1 });

const PayrollRun = mongoose.models.PayrollRun
  || mongoose.model('PayrollRun', PayrollRunSchema);

module.exports = { PayrollRun };
