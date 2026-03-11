/**
 * BHARAT ERP — HR: PayrollCalculationAgent
 *
 * Computes salary for each employee:
 *   Gross = Basic + HRA + Special Allowance + Other Allowances
 *   LOP Deduction = (Gross / Working Days) × LOP Days
 *   Net Before Statutory = Gross − LOP Deduction
 *
 * Each employee record on hco.employees must have salary_structure:
 *   { basic, hra, special_allowance, other_allowances }
 *
 * Overtime pay added at 2× basic hourly rate (Factories Act standard).
 */

const BaseAgent = require('../../../platform/core/BaseAgent');

class PayrollCalculationAgent extends BaseAgent {
  constructor() {
    super('payroll_calculation', 'hr', {
      maxRetries:    1,
      timeoutMs:     20000,
      minConfidence: 80,
      critical:      true,
    });
  }

  async run(hco) {
    const attendanceMap = {};
    (hco.attendance || []).forEach(a => { attendanceMap[a.emp_id] = a; });

    const results = [];

    for (const emp of hco.employees) {
      if (emp._validation?.valid === false) continue; // skip invalid employees

      const att   = attendanceMap[emp.emp_id];
      const sal   = emp.salary_structure || {};

      // ── Salary components ────────────────────────────────────
      const basic              = Number(sal.basic)              || 0;
      const hra                = Number(sal.hra)                || 0;
      const specialAllowance   = Number(sal.special_allowance)  || 0;
      const otherAllowances    = Number(sal.other_allowances)   || 0;
      const grossSalary        = basic + hra + specialAllowance + otherAllowances;

      // ── LOP deduction ────────────────────────────────────────
      const workingDays   = att?.working_days  || 26;
      const lopDays       = att?.lop_days      || 0;
      const lopDeduction  = lopDays > 0
        ? Math.round((grossSalary / workingDays) * lopDays)
        : 0;

      // ── Overtime ──────────────────────────────────────────────
      const overtimeHours  = att?.overtime_hours || 0;
      const basicHourly    = basic / (workingDays * 8); // 8-hour day
      const overtimePay    = Math.round(basicHourly * overtimeHours * 2); // 2× rate

      // ── Net before statutory ──────────────────────────────────
      const netBeforeStatutory = grossSalary - lopDeduction + overtimePay;

      results.push({
        emp_id:               emp.emp_id,
        name:                 emp.name,
        department:           emp.department,
        designation:          emp.designation,
        basic,
        hra,
        special_allowance:    specialAllowance,
        other_allowances:     otherAllowances,
        gross_salary:         grossSalary,
        lop_days:             lopDays,
        lop_deduction:        lopDeduction,
        overtime_hours:       overtimeHours,
        overtime_pay:         overtimePay,
        net_before_statutory: netBeforeStatutory,
      });

      // ── Flags ──────────────────────────────────────────────────
      if (grossSalary === 0) {
        hco._flag('ZERO_SALARY', 'error',
          `${emp.name} (${emp.emp_id}): Gross salary is ₹0. Check salary structure.`, this.name);
      }
      if (lopDeduction > grossSalary * 0.5) {
        hco._flag('HIGH_LOP_DEDUCTION', 'warn',
          `${emp.name}: LOP deduction ₹${lopDeduction.toLocaleString('en-IN')} is >50% of gross.`,
          this.name);
      }
    }

    hco.salary_components = results;

    // ── Confidence ─────────────────────────────────────────────
    const computed = results.filter(r => r.gross_salary > 0).length;
    hco.confidence_scores.payroll_calculation = computed === 0 ? 0
      : Math.round((computed / results.length) * 100);

    hco._audit(this.name, 'PAYROLL_CALCULATED', {
      employees_computed: results.length,
      total_gross: results.reduce((s, r) => s + r.gross_salary, 0),
      total_lop_deduction: results.reduce((s, r) => s + r.lop_deduction, 0),
    });

    return hco;
  }
}

module.exports = PayrollCalculationAgent;
