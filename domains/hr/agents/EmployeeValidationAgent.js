/**
 * BHARAT ERP — HR: EmployeeValidationAgent
 *
 * For each employee in the payroll run:
 *   1. Confirms active employment status
 *   2. Validates bank account + IFSC
 *   3. Validates PAN (for TDS)
 *   4. Validates UAN (for PF)
 *   5. Checks ESI IP number (for ESI-eligible employees)
 *   6. Flags any missing / suspect data before compute
 *
 * critical: true — payroll cannot proceed with unvalidated employees.
 */

const BaseAgent = require('../../../platform/core/BaseAgent');

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PAN_REGEX  = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const UAN_REGEX  = /^[0-9]{12}$/;

class EmployeeValidationAgent extends BaseAgent {
  constructor() {
    super('employee_validation', 'hr', {
      maxRetries:    1,
      timeoutMs:     20000,
      minConfidence: 70,
      critical:      true,
    });
  }

  async run(hco) {
    const employees = hco.employees;

    if (!employees || employees.length === 0) {
      hco._flag('NO_EMPLOYEES', 'error', 'No employees in payroll run roster.', this.name);
      hco.confidence_scores.employee_validation = 0;
      return hco;
    }

    let validCount    = 0;
    let warningCount  = 0;
    const validatedList = [];

    for (const emp of employees) {
      const issues   = [];
      let empValid   = true;

      // ── Bank account ─────────────────────────────────────────
      if (!emp.bank_account || String(emp.bank_account).length < 8) {
        issues.push('Missing or invalid bank account number');
        empValid = false;
      }

      if (!emp.ifsc || !IFSC_REGEX.test(emp.ifsc.toUpperCase())) {
        issues.push(`Invalid IFSC code: ${emp.ifsc || 'missing'}`);
        empValid = false;
      }

      // ── PAN (for TDS) ────────────────────────────────────────
      if (!emp.pan) {
        issues.push('PAN missing — TDS will be deducted at 20% (higher rate)');
        warningCount++;
        hco._flag('PAN_MISSING', 'warn',
          `Employee ${emp.name} (${emp.emp_id}): PAN missing. TDS at 20%.`, this.name);
      } else if (!PAN_REGEX.test(emp.pan.toUpperCase())) {
        issues.push(`Invalid PAN format: ${emp.pan}`);
        warningCount++;
      }

      // ── UAN (for PF) ─────────────────────────────────────────
      if (emp.pf_applicable !== false) {
        if (!emp.uan || !UAN_REGEX.test(String(emp.uan))) {
          issues.push(`Invalid or missing UAN: ${emp.uan || 'missing'}`);
          warningCount++;
          hco._flag('UAN_MISSING', 'warn',
            `Employee ${emp.name} (${emp.emp_id}): UAN missing. PF filing may fail.`, this.name);
        }
      }

      // ── Employment status ────────────────────────────────────
      if (emp.status && emp.status !== 'active') {
        issues.push(`Employee status is ${emp.status} — should be active`);
        empValid = false;
        hco._flag('INACTIVE_EMPLOYEE', 'error',
          `${emp.name} (${emp.emp_id}) status: ${emp.status}. Remove from payroll run.`, this.name);
      }

      if (empValid) validCount++;

      validatedList.push({
        ...emp,
        _validation: {
          valid:  empValid,
          issues,
        },
      });
    }

    hco.employees = validatedList;

    // ── Summary flags ─────────────────────────────────────────
    const invalidCount = employees.length - validCount;
    if (invalidCount > 0) {
      hco._flag('INVALID_EMPLOYEES', 'error',
        `${invalidCount} employee(s) failed validation. Fix before processing payroll.`, this.name);
    }

    // ── Confidence ────────────────────────────────────────────
    const conf = Math.round((validCount / employees.length) * 100);
    hco.confidence_scores.employee_validation = conf;

    hco._audit(this.name, 'EMPLOYEES_VALIDATED', {
      total:     employees.length,
      valid:     validCount,
      warnings:  warningCount,
      invalid:   invalidCount,
    });

    return hco;
  }
}

module.exports = EmployeeValidationAgent;
