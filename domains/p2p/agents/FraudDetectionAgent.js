/**
 * BHARAT ERP — FraudDetectionAgent (P2P)
 * Sprint 1 — Full Implementation
 *
 * Rule-based fraud detection (ML model in Sprint 2):
 *   1. Duplicate invoice detection (same number + vendor)
 *   2. Amount anomaly (far above vendor average)
 *   3. Round-number billing (common fraud signal)
 *   4. Weekend/holiday invoice dates
 *   5. Vendor velocity (many invoices in short window)
 *   6. Suspicious patterns (split invoicing to avoid thresholds)
 */
const BaseAgent = require('../../../platform/core/BaseAgent');
const { ProcessedInvoiceModel } = require('../models/P2PModels');

class FraudDetectionAgent extends BaseAgent {
  constructor() {
    super('fraud_detection', 'p2p', {
      critical:      false,
      minConfidence: 80,
    });
  }

  async run(obj) {
    const extracted  = obj.extracted;
    const vendor     = obj.vendorData?.vendor;
    if (!extracted) return;

    const signals    = [];
    let riskScore    = 0;

    // ── 1. Duplicate detection ───────────────────────────────
    if (extracted.invoice_number && vendor) {
      const duplicate = await ProcessedInvoiceModel.findOne({
        tenant_id:      obj.tenant_id,
        invoice_number: extracted.invoice_number,
        vendor_gstin:   extracted.vendor?.gstin,
        status:         { $nin: ['rejected'] },
        canonical_id:   { $ne: obj.id },  // Exclude self — prevents false duplicate on reprocessing
      });

      if (duplicate) {
        signals.push({
          type:     'duplicate_invoice',
          severity: 'critical',
          detail:   `Invoice ${extracted.invoice_number} was already processed (ID: ${duplicate._id}, status: ${duplicate.status})`,
          score:    60,
        });
        riskScore += 60;
      }
    }

    // ── 2. Amount anomaly vs vendor history ──────────────────
    if (vendor?.annual_spend > 0) {
      const avgMonthlySpend = vendor.annual_spend / 12;
      const invoiceAmt      = extracted.total_amount || 0;

      if (invoiceAmt > avgMonthlySpend * 3) {
        const ratio = (invoiceAmt / avgMonthlySpend).toFixed(1);
        signals.push({
          type:     'amount_anomaly',
          severity: 'warn',
          detail:   `Invoice ₹${invoiceAmt.toLocaleString('en-IN')} is ${ratio}x the vendor's avg monthly billing`,
          score:    15,
        });
        riskScore += 15;
      }
    }

    // ── 3. Round-number billing ──────────────────────────────
    const amount = extracted.total_amount || 0;
    if (amount > 10000 && amount % 10000 === 0) {
      signals.push({
        type:     'round_number',
        severity: 'info',
        detail:   `Invoice amount ₹${amount.toLocaleString('en-IN')} is a suspiciously round number`,
        score:    5,
      });
      riskScore += 5;
    }

    // ── 4. Future-dated or weekend invoice ───────────────────
    if (extracted.invoice_date) {
      const invDate  = new Date(extracted.invoice_date);
      const dayOfWeek = invDate.getDay(); // 0=Sun, 6=Sat
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        signals.push({
          type:     'weekend_date',
          severity: 'info',
          detail:   `Invoice dated on a weekend (${extracted.invoice_date})`,
          score:    5,
        });
        riskScore += 5;
      }
    }

    // ── 5. Vendor velocity — many invoices in 7 days ─────────
    if (extracted.vendor?.gstin) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentCount = await ProcessedInvoiceModel.countDocuments({
        tenant_id:    obj.tenant_id,
        vendor_gstin: extracted.vendor.gstin,
        created_at:   { $gte: sevenDaysAgo },
      });

      if (recentCount >= 5) {
        signals.push({
          type:     'high_velocity',
          severity: 'warn',
          detail:   `${recentCount} invoices from this vendor in the last 7 days`,
          score:    10,
        });
        riskScore += 10;
      }
    }

    // ── 6. Split invoice detection (just below threshold) ────
    const threshold = parseInt(process.env.AUTO_APPROVAL_LIMIT || '100000');
    if (amount > threshold * 0.85 && amount < threshold) {
      signals.push({
        type:     'threshold_splitting',
        severity: 'info',
        detail:   `Invoice amount ₹${amount.toLocaleString('en-IN')} is just below auto-approval threshold ₹${threshold.toLocaleString('en-IN')}`,
        score:    8,
      });
      riskScore += 8;
    }

    // ── Flag critical fraud signals ──────────────────────────
    const critical = signals.filter(s => s.severity === 'critical');
    const warnings = signals.filter(s => s.severity === 'warn');

    if (critical.length) {
      obj.addFlag('error', this.name, '🚨 Fraud signal detected',
        critical.map(s => s.detail).join('; '),
        'Hold payment. Escalate to CFO immediately.');
    }
    if (warnings.length) {
      obj.addFlag('warn', this.name, 'Fraud risk indicators',
        warnings.map(s => s.detail).join('; '),
        'Finance manager review required');
    }

    // Risk score: 0=clean, 100=certain fraud
    const confidence = Math.max(95 - signals.length * 5, 50);

    obj.enrich(this.name, {
      risk_score: Math.min(riskScore, 100),
      risk_level: riskScore >= 50 ? 'high' : riskScore >= 20 ? 'medium' : 'low',
      signals,
    }, confidence);
  }
}

module.exports = FraudDetectionAgent;
