/**
 * BHARAT ERP — HR Orchestrator (Sprint 5)
 *
 * Coordinates the payroll run pipeline:
 *   Phase 1 — processPayroll():
 *     EmployeeValidation → AttendanceFetch → PayrollCalculation → StatutoryCompliance
 *
 *   Phase 2 — generatePayslips():
 *     PayslipAgent (generates payslips + WhatsApp notifications)
 *
 *   Full run — run(hco): Phase 1 + Phase 2
 *
 * Follows the identical pattern as P2POrchestrator and SourcingOrchestrator.
 * PROVES: Orchestrator pattern is a reusable template — zero new infrastructure.
 */

const EmployeeValidationAgent  = require('./agents/EmployeeValidationAgent');
const AttendanceFetchAgent     = require('./agents/AttendanceFetchAgent');
const PayrollCalculationAgent  = require('./agents/PayrollCalculationAgent');
const StatutoryComplianceAgent = require('./agents/StatutoryComplianceAgent');
const PayslipAgent             = require('./agents/PayslipAgent');

class HROrchestrator {
  constructor() {
    this.agents = {
      employeeValidation:  new EmployeeValidationAgent(),
      attendanceFetch:     new AttendanceFetchAgent(),
      payrollCalculation:  new PayrollCalculationAgent(),
      statutoryCompliance: new StatutoryComplianceAgent(),
      payslip:             new PayslipAgent(),
    };
  }

  // ── Phase 1: Validate + Calculate ────────────────────────────
  async processPayroll(hco) {
    hco.status = 'EMPLOYEE_VALIDATED';
    hco = await this.agents.employeeValidation.run(hco);

    // Abort if critical validation failed
    const fatalFlag = hco.flags.find(f => f.code === 'NO_EMPLOYEES');
    if (fatalFlag) {
      hco.status = 'FAILED';
      return hco;
    }

    hco.status = 'ATTENDANCE_FETCHED';
    hco = await this.agents.attendanceFetch.run(hco);

    hco.status = 'CALCULATED';
    hco = await this.agents.payrollCalculation.run(hco);

    hco.status = 'COMPLIANCE_COMPUTED';
    hco = await this.agents.statutoryCompliance.run(hco);

    return hco;
  }

  // ── Phase 2: Generate payslips + notify ──────────────────────
  async generatePayslips(hco) {
    hco = await this.agents.payslip.run(hco);
    hco.status = 'DISBURSED';
    return hco;
  }

  // ── Full run ──────────────────────────────────────────────────
  async run(hco) {
    hco = await this.processPayroll(hco);
    if (hco.status !== 'FAILED') {
      hco = await this.generatePayslips(hco);
    }
    return hco;
  }
}

module.exports = HROrchestrator;
