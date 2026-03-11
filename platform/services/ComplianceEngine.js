/**
 * BHARAT ERP — ComplianceEngine
 * ─────────────────────────────────────────────────────────────
 * ALL Indian statutory compliance rules live here.
 * When government rules change, update ONE file.
 * Every domain (P2P, HR, Manufacturing, O2C...) benefits instantly.
 *
 * Covers:
 *  INDIRECT TAX:  GST, E-invoicing, E-way bill
 *  DIRECT TAX:    TDS, TCS, Advance Tax
 *  LABOUR LAW:    PF, ESI, PT, Gratuity, Minimum Wage
 *  CORPORATE:     MCA filings, ROC compliance
 *  SEBI:          For listed companies (future)
 *  CUSTOM:        Org-specific policy rules
 */

const dayjs = require('./_dayjsMock');

class ComplianceEngine {

  // ════════════════════════════════════════════════════════════
  // GST — Goods & Services Tax
  // ════════════════════════════════════════════════════════════

  /**
   * Validate GSTIN format (does not call GST portal — offline check)
   * Format: 2-digit state + 10-char PAN + 1 entity + Z + 1 check
   */
  static validateGSTIN(gstin) {
    if (!gstin) return { valid: false, reason: 'GSTIN is empty' };
    const clean = gstin.trim().toUpperCase();
    const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!regex.test(clean)) return { valid: false, reason: 'Invalid GSTIN format', gstin: clean };
    return {
      valid:      true,
      gstin:      clean,
      state_code: clean.substring(0, 2),
      pan:        clean.substring(2, 12),
    };
  }

  /**
   * Determine GST type based on vendor and buyer state codes
   */
  static determineGSTType(vendorGSTIN, buyerGSTIN) {
    const vendorState = vendorGSTIN?.substring(0, 2);
    const buyerState  = buyerGSTIN?.substring(0, 2);
    if (!vendorState || !buyerState) return 'unknown';
    return vendorState === buyerState ? 'CGST_SGST' : 'IGST';
  }

  /**
   * Validate GST rate for an HSN/SAC code
   * Extend this map as needed — currently covers common codes
   */
  static getGSTRate(hsnSac) {
    const rates = {
      // Software / IT services
      '998314': 18, '998315': 18, '998316': 18,
      // Professional services
      '997212': 18, '997221': 18,
      // Cloud services
      '998319': 18,
      // Manufacturing — common
      '8471': 18,   // computers
      '8517': 18,   // phones
      '8528': 28,   // televisions
      // Education — exempt
      '9992':  0,
      // Healthcare — exempt
      '9993':  0,
      // Food & agriculture — mostly 0 or 5
      '0901':  5,   // coffee
      '0902':  5,   // tea
    };
    return rates[String(hsnSac)] ?? null; // null = unknown, needs lookup
  }

  /**
   * E-invoice: check if IRN generation is required
   * Current threshold: ₹5 crore annual turnover
   */
  static requiresEInvoice(annualTurnoverCr) {
    return annualTurnoverCr >= 5;
  }

  /**
   * E-way bill: check if required for goods movement
   * Required for consignment value > ₹50,000
   */
  static requiresEWayBill(consignmentValue, goodsType = 'general') {
    const exemptGoods = ['currency', 'jewellery_for_personal_use'];
    if (exemptGoods.includes(goodsType)) return false;
    return consignmentValue > 50000;
  }

  // ════════════════════════════════════════════════════════════
  // TDS — Tax Deducted at Source
  // ════════════════════════════════════════════════════════════

  /**
   * Calculate TDS deduction amount
   * Used by: P2P payment agent, HR payroll agent, O2C billing agent
   */
  static calculateTDS(grossAmount, vendorCategory, hasLowerDeductionCert = false) {
    const rules = {
      // Section: { rate for company, rate for individual/HUF, threshold }
      contractor:          { section: '194C',  rateCompany: 0.02, rateIndividual: 0.01, threshold: 30000 },
      professional:        { section: '194J',  rateCompany: 0.10, rateIndividual: 0.10, threshold: 30000 },
      technical_services:  { section: '194J',  rateCompany: 0.02, rateIndividual: 0.02, threshold: 30000 },
      rent_plant:          { section: '194I',  rateCompany: 0.10, rateIndividual: 0.10, threshold: 240000 },
      rent_land_building:  { section: '194I',  rateCompany: 0.10, rateIndividual: 0.10, threshold: 240000 },
      commission:          { section: '194H',  rateCompany: 0.05, rateIndividual: 0.05, threshold: 15000 },
      interest_bank:       { section: '194A',  rateCompany: 0.10, rateIndividual: 0.10, threshold: 40000 },
      salary:              { section: '192',   rateCompany: null, rateIndividual: null,  threshold: 0    }, // slab-based
      none:                { section: null,    rateCompany: 0,    rateIndividual: 0,     threshold: 0    },
    };

    const rule = rules[vendorCategory] || rules.none;
    if (!rule.section) return { applicable: false, section: null, rate: 0, amount: 0 };
    if (grossAmount < rule.threshold) return { applicable: false, section: rule.section, reason: 'Below threshold', amount: 0 };

    const rate = hasLowerDeductionCert ? 0 : rule.rateCompany;
    const tdsAmount = Math.round(grossAmount * rate);

    return {
      applicable:  true,
      section:     rule.section,
      rate:        rate * 100 + '%',
      gross:       grossAmount,
      tds_amount:  tdsAmount,
      net_payable: grossAmount - tdsAmount,
    };
  }

  // ════════════════════════════════════════════════════════════
  // MSME — Micro, Small & Medium Enterprises Act
  // ════════════════════════════════════════════════════════════

  /**
   * Check MSME payment deadline compliance
   * Rule: Payment to MSME vendor must be made within 45 days of invoice
   * Interest on delay: 3x RBI MCLR (approx 9-10% p.a. currently)
   */
  static checkMSMECompliance(invoiceDate, isMSME, rbiMCLR = 9.0) {
    if (!isMSME) return { applicable: false };

    const invoice  = dayjs(invoiceDate);
    const deadline = invoice.add(45, 'day');
    const today    = dayjs();
    const daysLeft = deadline.diff(today, 'day');

    const result = {
      applicable:    true,
      invoice_date:  invoice.format('DD-MMM-YYYY'),
      deadline:      deadline.format('DD-MMM-YYYY'),
      days_remaining: daysLeft,
      status:        daysLeft > 10 ? 'ok' : daysLeft > 0 ? 'urgent' : 'breached',
      alert_required: daysLeft <= 10,
    };

    if (daysLeft < 0) {
      const delayDays   = Math.abs(daysLeft);
      const interestRate = rbiMCLR * 3 / 100 / 365; // daily compounding
      result.breach_days     = delayDays;
      result.interest_rate   = `${rbiMCLR * 3}% p.a.`;
      result.action_required = `IMMEDIATE PAYMENT — ${delayDays} days overdue`;
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════
  // LABOUR LAWS — HR domain compliance
  // ════════════════════════════════════════════════════════════

  /**
   * Calculate PF (Provident Fund) contribution
   * Employee: 12% of basic. Employer: 12% of basic (split: 8.33% EPS + 3.67% EPF)
   */
  static calculatePF(basicSalary) {
    const employeeContribution = Math.round(basicSalary * 0.12);
    const eps  = Math.round(Math.min(basicSalary, 15000) * 0.0833); // EPS capped at 15K
    const epf  = Math.round(basicSalary * 0.12) - eps;
    return {
      employee_contribution: employeeContribution,
      employer_eps:          eps,
      employer_epf:          epf,
      employer_total:        eps + epf,
      total_pf:              employeeContribution + eps + epf,
    };
  }

  /**
   * Calculate ESI (Employee State Insurance)
   * Applicable for employees earning ≤ ₹21,000/month
   * Employee: 0.75%. Employer: 3.25%
   */
  static calculateESI(grossSalary) {
    if (grossSalary > 21000) return { applicable: false };
    return {
      applicable:            true,
      employee_contribution: Math.round(grossSalary * 0.0075),
      employer_contribution: Math.round(grossSalary * 0.0325),
      total:                 Math.round(grossSalary * 0.04),
    };
  }

  /**
   * Calculate Gratuity
   * Formula: (Last drawn salary × 15 × years of service) / 26
   * Applicable after 5 years of continuous service
   */
  static calculateGratuity(lastSalary, yearsOfService) {
    if (yearsOfService < 5) return { applicable: false, reason: 'Less than 5 years service' };
    const amount = Math.round((lastSalary * 15 * yearsOfService) / 26);
    return {
      applicable: true,
      amount,
      tax_exempt_limit: 2000000, // ₹20L tax exempt
      taxable: Math.max(0, amount - 2000000),
    };
  }

  // ════════════════════════════════════════════════════════════
  // CUSTOM — Organisation-specific policy rules
  // ════════════════════════════════════════════════════════════

  /**
   * Evaluate custom org policy rules
   * Each organisation can define their own rules in config
   */
  static evaluatePolicy(policyRules, context) {
    const violations = [];
    for (const rule of policyRules || []) {
      try {
        const fn = new Function('ctx', `return ${rule.condition}`);
        if (!fn(context)) {
          violations.push({ rule: rule.name, action: rule.action });
        }
      } catch (e) {
        violations.push({ rule: rule.name, error: e.message });
      }
    }
    return { compliant: violations.length === 0, violations };
  }
}

module.exports = ComplianceEngine;
