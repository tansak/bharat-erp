/**
 * BHARAT ERP — HR Canonical Object (HCO)
 *
 * Single source of truth for an HR event as it travels through the pipeline.
 * Sprint 5 covers: Payroll Run (monthly salary processing)
 *
 * Lifecycle:
 *   INITIATED → EMPLOYEE_VALIDATED → ATTENDANCE_FETCHED → CALCULATED →
 *   COMPLIANCE_COMPUTED → APPROVED → DISBURSED → RECONCILED
 *
 * Extends same _audit / _flag / overallConfidence pattern as SCO and CIO.
 */

const { randomUUID } = require('crypto');

class HRCanonicalObject {
  constructor({ tenant_id = 'demo-corp', month, year, initiatedBy } = {}) {
    this.id          = `HCO-${randomUUID()}`;
    this.tenant_id   = tenant_id;
    this.type        = 'payroll_run';
    this.created_at  = new Date().toISOString();
    this.updated_at  = new Date().toISOString();

    // ── Payroll period ─────────────────────────────────────────
    this.period = {
      month:        month || new Date().getMonth() + 1,   // 1-12
      year:         year  || new Date().getFullYear(),
      pay_date:     null,  // actual disbursement date
      initiated_by: initiatedBy || null,
    };

    // ── Status ──────────────────────────────────────────────────
    this.status = 'INITIATED';

    // ── Employee roster for this run ────────────────────────────
    this.employees = [];
    // Each: { emp_id, name, designation, department, status,
    //         bank_account, ifsc, pan, uan, esi_ip_number }

    // ── Attendance data ─────────────────────────────────────────
    this.attendance = [];
    // Each: { emp_id, working_days, days_present, leaves_taken,
    //         lop_days, overtime_hours }

    // ── Salary components per employee ──────────────────────────
    this.salary_components = [];
    // Each: { emp_id, basic, hra, special_allowance, other_allowances,
    //         gross_salary, lop_deduction, net_before_statutory }

    // ── Statutory deductions per employee ───────────────────────
    this.statutory = [];
    // Each: { emp_id, pf_employee, pf_employer, esi_employee, esi_employer,
    //         professional_tax, tds_salary, total_deductions, net_payable }

    // ── Payroll summary (company-level) ─────────────────────────
    this.summary = {
      total_employees:    0,
      total_gross:        0,
      total_pf_employee:  0,
      total_pf_employer:  0,
      total_esi_employee: 0,
      total_esi_employer: 0,
      total_pt:           0,
      total_tds:          0,
      total_net_payable:  0,
      total_employer_cost: 0,
    };

    // ── Approval ────────────────────────────────────────────────
    this.approval = {
      required:    false,
      approved_by: null,
      approved_at: null,
      remarks:     null,
    };

    // ── Disbursement ─────────────────────────────────────────────
    this.disbursement = {
      status:       null,   // pending | initiated | completed | failed
      initiated_at: null,
      completed_at: null,
      bank_file:    null,   // NEFT/RTGS file details
    };

    // ── Confidence per agent ────────────────────────────────────
    this.confidence_scores = {};

    // ── Flags ───────────────────────────────────────────────────
    this.flags = [];

    // ── Audit trail ─────────────────────────────────────────────
    this.audit_trail = [];
  }

  _audit(agent, action, detail = {}) {
    this.audit_trail.push({ timestamp: new Date().toISOString(), agent, action, detail });
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

  toJSON() { return { ...this }; }
}

module.exports = HRCanonicalObject;
