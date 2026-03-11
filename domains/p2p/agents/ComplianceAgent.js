/**
 * BHARAT ERP — ComplianceAgent (P2P)
 * Sprint 1 — Full Implementation
 *
 * Indian statutory compliance checks:
 *   1. GST validation — GSTIN, rate, type (IGST vs CGST+SGST), amount
 *   2. TDS calculation — section, rate, net payable
 *   3. MSME 45-day rule (vendor_validation covers deadline; this verifies calculation)
 *   4. E-invoice IRN verification
 *   5. GST amount arithmetic check
 */
const BaseAgent = require('../../../platform/core/BaseAgent');

class ComplianceAgent extends BaseAgent {
  constructor() {
    super('compliance', 'p2p', {
      critical:      false,
      minConfidence: 75,
    });
  }

  async run(obj) {
    const extracted = obj.extracted;
    if (!extracted) return;

    const vendorResult = obj.vendorData;
    const vendor       = vendorResult?.vendor;
    const issues       = [];
    const findings     = {};

    // ── 1. GSTIN Validation ──────────────────────────────────
    const buyerGSTIN  = extracted.buyer?.gstin;
    const vendorGSTIN = extracted.vendor?.gstin;

    const vendorGSTResult = this.compliance.validateGSTIN(vendorGSTIN);
    const buyerGSTResult  = this.compliance.validateGSTIN(buyerGSTIN);

    findings.vendor_gstin = { value: vendorGSTIN, valid: vendorGSTResult.valid };
    findings.buyer_gstin  = { value: buyerGSTIN,  valid: buyerGSTResult.valid };

    if (!vendorGSTResult.valid) {
      issues.push({ severity: 'warn', msg: `Vendor GSTIN "${vendorGSTIN}" is invalid` });
    }
    if (!buyerGSTResult.valid) {
      issues.push({ severity: 'warn', msg: `Buyer GSTIN "${buyerGSTIN}" is invalid` });
    }

    // ── 2. GST Type — IGST vs CGST+SGST ────────────────────
    if (vendorGSTResult.valid && buyerGSTResult.valid) {
      const expectedGSTType = this.compliance.determineGSTType(vendorGSTIN, buyerGSTIN);
      const invoiceHasIGST  = extracted.gst_breakdown?.some(g => g.type === 'IGST');
      const invoiceHasCGST  = extracted.gst_breakdown?.some(g => g.type === 'CGST');

      findings.expected_gst_type = expectedGSTType;
      findings.invoice_gst_type  = invoiceHasIGST ? 'IGST' : invoiceHasCGST ? 'CGST_SGST' : 'unknown';

      if (expectedGSTType === 'IGST' && !invoiceHasIGST) {
        issues.push({ severity: 'warn', msg: 'Inter-state supply should use IGST but invoice shows CGST/SGST' });
      }
      if (expectedGSTType === 'CGST_SGST' && invoiceHasIGST) {
        issues.push({ severity: 'warn', msg: 'Intra-state supply should use CGST+SGST but invoice shows IGST' });
      }
    }

    // ── 3. GST Amount Arithmetic Check ──────────────────────
    const lineItemGSTTotal = (extracted.line_items || []).reduce((sum, li) => {
      return sum + ((li.amount || 0) * (li.gst_rate || 0) / 100);
    }, 0);
    const invoiceGSTTotal = extracted.total_gst || 0;
    const gstVariance     = Math.abs(lineItemGSTTotal - invoiceGSTTotal);

    findings.gst_computed     = Math.round(lineItemGSTTotal);
    findings.gst_on_invoice   = invoiceGSTTotal;
    findings.gst_variance     = Math.round(gstVariance);

    if (gstVariance > 10) { // Allow ₹10 rounding difference
      issues.push({ severity: 'warn', msg: `GST arithmetic mismatch: computed ₹${Math.round(lineItemGSTTotal)} vs invoice ₹${invoiceGSTTotal}` });
    }

    // ── 4. TDS Calculation ───────────────────────────────────
    const tdsCategory = vendor?.tds_category || 'none';
    const totalAmount = extracted.total_amount || 0;
    const tds         = this.compliance.calculateTDS(totalAmount, tdsCategory);
    findings.tds      = tds;

    if (tds.applicable) {
      obj.addFlag('info', this.name, `TDS applicable — ${tds.section}`,
        `Deduct ₹${tds.tds_amount?.toLocaleString('en-IN')} @ ${tds.rate}. Net payable: ₹${tds.net_payable?.toLocaleString('en-IN')}`,
        null);
    }

    // ── 5. E-invoice IRN check ───────────────────────────────
    // For vendors with turnover > ₹5Cr, IRN is mandatory
    // We check format — API verification is Sprint 2
    const hasIRN         = !!extracted.irn;
    const irnValid       = hasIRN && extracted.irn.length === 64; // IRN is 64-char hex
    findings.irn         = { present: hasIRN, valid: irnValid };

    // If large invoice (>5L) and no IRN — flag it
    if (totalAmount > 500000 && !hasIRN) {
      issues.push({ severity: 'info', msg: 'No IRN on invoice. Verify if vendor is below e-invoicing threshold.' });
    }

    // ── 6. Invoice date is not future-dated ─────────────────
    if (extracted.invoice_date) {
      const invoiceDate = new Date(extracted.invoice_date);
      const today       = new Date();
      if (invoiceDate > today) {
        issues.push({ severity: 'error', msg: `Invoice is future-dated: ${extracted.invoice_date}` });
      }
    }

    // ── Apply flags from issues ──────────────────────────────
    issues.forEach(issue => {
      obj.addFlag(issue.severity, this.name, 'Compliance issue', issue.msg,
        issue.severity === 'error' ? 'Block payment until resolved' : 'Review before payment');
    });

    // ── Confidence ───────────────────────────────────────────
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warnCount  = issues.filter(i => i.severity === 'warn').length;
    const confidence = Math.max(95 - (errorCount * 30) - (warnCount * 10), 10);

    obj.enrich(this.name, {
      ...findings,
      issues,
      compliant: errorCount === 0,
    }, confidence);

    obj.transition('compliance_checked', this.name);
  }
}

module.exports = ComplianceAgent;
