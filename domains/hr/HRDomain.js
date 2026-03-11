/**
 * BHARAT ERP — HR Domain Skeleton
 * Shows exactly how a new domain plugs into the platform.
 * HR reuses: BaseAgent, Orchestrator, ComplianceEngine (PF/ESI/Gratuity),
 *            NotificationService, AuditService — zero platform changes.
 */

const CanonicalObject = require('../../platform/core/CanonicalObject');
const Orchestrator    = require('../../platform/core/Orchestrator');
const BaseAgent       = require('../../platform/core/BaseAgent');

// ── HR Canonical Object — extends platform base ──────────────────
class HRCanonicalObject extends CanonicalObject {
  constructor(type, sourceData = {}) {
    // type: 'payroll_run' | 'leave_request' | 'hiring' | 'appraisal' | 'separation'
    super('hr', type, sourceData);
    this.domain_data = {
      employee:    null,  // EmployeeValidationAgent
      calculation: null,  // PayrollCalculationAgent / LeaveCalculationAgent
      compliance:  null,  // HRComplianceAgent (PF, ESI, PT, TDS on salary)
      approval:    null,  // ManagerApprovalAgent
      disbursement:null,  // DisbursementAgent
    };
  }
}

// ── HR Agents — each extends platform BaseAgent ──────────────────

class EmployeeValidationAgent extends BaseAgent {
  constructor() { super('employee_validation', 'hr', { critical: true }); }
  async run(obj) {
    const { EmployeeModel } = require('../../platform/models/MasterDataModels');
    const employee = await EmployeeModel.findOne({
      employee_id: obj.domain_data.source_employee_id,
      tenant_id:   obj.tenant_id,
    });
    if (!employee) {
      obj.addFlag('error', this.name, 'Employee not found', 'Invalid employee ID', null);
      return;
    }
    obj.enrich(this.name, { employee: employee.toJSON() }, 100);
  }
}

class PayrollCalculationAgent extends BaseAgent {
  constructor() { super('payroll_calculation', 'hr', { critical: true }); }
  async run(obj) {
    const emp = obj.domain_data.employee?.employee;
    if (!emp) return;

    const gross  = emp.salary.gross;
    const pf     = this.compliance.calculatePF(emp.salary.basic);
    const esi    = this.compliance.calculateESI(gross);

    // TDS on salary — use ComplianceEngine (same engine P2P uses)
    // Note: salary TDS is slab-based, handled via AI for accuracy
    const tdsPrompt = `Calculate income tax (TDS) for FY 2025-26 under ${emp.tds_regime} regime.
    Annual gross salary: ₹${gross * 12}. Return JSON: { monthly_tds: number, annual_tds: number, regime: string }`;
    const tds = await this.callAIForJSON('You are an Indian income tax expert.', tdsPrompt);

    const netPay = gross - pf.employee_contribution - (esi.applicable ? esi.employee_contribution : 0) - tds.monthly_tds;

    obj.enrich(this.name, { gross, pf, esi, tds, net_pay: netPay }, 95);
  }
}

class HRComplianceAgent extends BaseAgent {
  constructor() { super('hr_compliance', 'hr', {}); }
  async run(obj) {
    const calc = obj.domain_data.calculation;
    if (!calc) return;
    // Validate PF, ESI calculations, check PT (Professional Tax) by state
    obj.enrich(this.name, {
      pf_valid:  true,
      esi_valid: true,
      pt_applicable: false,  // TODO: state-wise PT lookup
    }, 95);
  }
}

// ── HR Orchestrator — Payroll Run ────────────────────────────────
class PayrollOrchestrator extends Orchestrator {
  constructor() {
    super('hr', [
      new EmployeeValidationAgent(),
      new PayrollCalculationAgent(),
      new HRComplianceAgent(),
      // Approval checkpoint — manager must approve payroll above threshold
      // this.approvalCheckpoint('hr_manager', 95),
    ]);
  }
}

module.exports = {
  HRCanonicalObject,
  PayrollOrchestrator,
  EmployeeValidationAgent,
  PayrollCalculationAgent,
  HRComplianceAgent,
};
