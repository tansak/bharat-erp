/**
 * BHARAT ERP — HR: StatutoryComplianceAgent
 *
 * Computes all statutory deductions for each employee using the platform
 * ComplianceEngine (already built in Sprint 0 — zero new rules needed):
 *
 *   PF  — Employees' Provident Fund (EPF Act 1952)
 *         Employee: 12% of basic (capped at ₹15,000 basic)
 *         Employer: 12% of basic → 8.33% EPS + 3.67% EPF
 *
 *   ESI — Employees' State Insurance (ESI Act 1948)
 *         Employee: 0.75% of gross (if gross ≤ ₹21,000/month)
 *         Employer: 3.25% of gross
 *
 *   PT  — Professional Tax (state-specific slabs)
 *         Karnataka slab used here
 *
 *   TDS — Tax Deducted at Source on Salary (Section 192)
 *         Estimated annual tax / 12 monthly installments
 *         20% flat if PAN missing
 *
 * PROVES: Platform ComplianceEngine used by P2P (TDS on invoices) AND
 *         HR (TDS on salary) — one rule engine, multiple domains.
 */

const BaseAgent        = require('../../../platform/core/BaseAgent');
const ComplianceEngine = require('../../../platform/services/ComplianceEngine');

// Karnataka Professional Tax monthly slabs (FY 2025-26)
const PT_SLABS_KA = [
  { max: 14999,  tax: 0 },
  { max: 29999,  tax: 150 },
  { max: Infinity, tax: 200 },
];

// Simplified annual income tax slabs (New Tax Regime FY 2025-26)
const INCOME_TAX_SLABS = [
  { max: 300000,   rate: 0 },
  { max: 700000,   rate: 0.05 },
  { max: 1000000,  rate: 0.10 },
  { max: 1200000,  rate: 0.15 },
  { max: 1500000,  rate: 0.20 },
  { max: Infinity, rate: 0.30 },
];

class StatutoryComplianceAgent extends BaseAgent {
  constructor() {
    super('statutory_compliance', 'hr', {
      maxRetries:    1,
      timeoutMs:     20000,
      minConfidence: 85,
      critical:      true,
    });
  }

  async run(hco) {
    const empMap = {};
    (hco.employees || []).forEach(e => { empMap[e.emp_id] = e; });

    const statutoryList = [];
    let summary = {
      total_pf_employee:  0,
      total_pf_employer:  0,
      total_esi_employee: 0,
      total_esi_employer: 0,
      total_pt:           0,
      total_tds:          0,
    };

    for (const comp of hco.salary_components) {
      const emp = empMap[comp.emp_id];

      // ── 1. PF — uses platform ComplianceEngine ───────────────
      const pfResult = ComplianceEngine.calculatePF(comp.basic);
      const pfEmployee = comp.net_before_statutory > 0 ? pfResult.employee_contribution : 0;
      const pfEmployer = comp.net_before_statutory > 0 ? pfResult.employer_total : 0;

      // ── 2. ESI ────────────────────────────────────────────────
      const esiResult  = ComplianceEngine.calculateESI(comp.gross_salary);
      const esiEmployee = (esiResult.applicable && comp.net_before_statutory > 0)
        ? esiResult.employee_contribution : 0;
      const esiEmployer = (esiResult.applicable && comp.net_before_statutory > 0)
        ? esiResult.employer_contribution : 0;

      // ── 3. Professional Tax (Karnataka slab) ─────────────────
      const pt = this._calculatePT(comp.gross_salary);

      // ── 4. TDS on salary (Section 192) ───────────────────────
      const hasPAN = emp?.pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((emp.pan || '').toUpperCase());
      const tds    = this._calculateTDS(comp.net_before_statutory, hasPAN);

      // ── 5. Net payable ────────────────────────────────────────
      const totalDeductions = pfEmployee + esiEmployee + pt + tds;
      const netPayable      = Math.max(0, comp.net_before_statutory - totalDeductions);

      const record = {
        emp_id:             comp.emp_id,
        name:               comp.name,
        gross_salary:       comp.gross_salary,
        net_before_statutory: comp.net_before_statutory,
        pf_employee:        pfEmployee,
        pf_employer:        pfEmployer,
        esi_employee:       esiEmployee,
        esi_employer:       esiEmployer,
        esi_eligible:       esiResult.applicable,
        professional_tax:   pt,
        tds_salary:         tds,
        tds_has_pan:        hasPAN,
        total_deductions:   totalDeductions,
        net_payable:        netPayable,
        employer_cost:      comp.gross_salary + pfEmployer + esiEmployer,
      };

      statutoryList.push(record);

      // Accumulate summary
      summary.total_pf_employee  += pfEmployee;
      summary.total_pf_employer  += pfEmployer;
      summary.total_esi_employee += esiEmployee;
      summary.total_esi_employer += esiEmployer;
      summary.total_pt           += pt;
      summary.total_tds          += tds;
    }

    hco.statutory = statutoryList;

    // ── Build full payroll summary ────────────────────────────
    const totalGross    = hco.salary_components.reduce((s, c) => s + c.gross_salary, 0);
    const totalNet      = statutoryList.reduce((s, r) => s + r.net_payable, 0);
    const totalEmpCost  = statutoryList.reduce((s, r) => s + r.employer_cost, 0);

    hco.summary = {
      total_employees:     statutoryList.length,
      total_gross:         totalGross,
      total_pf_employee:   summary.total_pf_employee,
      total_pf_employer:   summary.total_pf_employer,
      total_esi_employee:  summary.total_esi_employee,
      total_esi_employer:  summary.total_esi_employer,
      total_pt:            summary.total_pt,
      total_tds:           summary.total_tds,
      total_net_payable:   totalNet,
      total_employer_cost: totalEmpCost,
    };

    // ── Flags ──────────────────────────────────────────────────
    const missingPAN = statutoryList.filter(r => !r.tds_has_pan).length;
    if (missingPAN > 0) {
      hco._flag('TDS_HIGHER_RATE', 'warn',
        `${missingPAN} employee(s) without PAN — TDS at 20% higher rate applied.`, this.name);
    }

    // ── Confidence ─────────────────────────────────────────────
    hco.confidence_scores.statutory_compliance = 95; // rule-based = deterministic

    hco._audit(this.name, 'STATUTORY_COMPUTED', {
      employees:          statutoryList.length,
      total_gross:        totalGross,
      total_net_payable:  totalNet,
      total_pf:           summary.total_pf_employee + summary.total_pf_employer,
      total_esi:          summary.total_esi_employee + summary.total_esi_employer,
      total_tds:          summary.total_tds,
      total_employer_cost: totalEmpCost,
    });

    return hco;
  }

  // ─── PT slab (Karnataka) ──────────────────────────────────────
  _calculatePT(grossSalary) {
    for (const slab of PT_SLABS_KA) {
      if (grossSalary <= slab.max) return slab.tax;
    }
    return 200;
  }

  // ─── TDS on salary (simplified new tax regime) ────────────────
  _calculateTDS(monthlyNet, hasPAN) {
    if (!hasPAN) {
      // Flat 20% if no PAN (Section 206AA)
      return Math.round(monthlyNet * 0.20);
    }
    const annual = monthlyNet * 12;
    let tax = 0;
    let remaining = annual;
    let prev = 0;
    for (const slab of INCOME_TAX_SLABS) {
      const slabIncome = Math.min(remaining, slab.max - prev);
      if (slabIncome <= 0) break;
      tax += slabIncome * slab.rate;
      remaining -= slabIncome;
      prev = slab.max;
      if (remaining <= 0) break;
    }
    return Math.max(0, Math.round(tax / 12));
  }
}

module.exports = StatutoryComplianceAgent;
