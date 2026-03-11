/**
 * BHARAT ERP — VendorValidationAgent (P2P)
 * Sprint 1 — Full Implementation
 *
 * Validates the vendor on the invoice against:
 *   1. Approved vendor master
 *   2. Blacklist check
 *   3. GSTIN format validation
 *   4. MSME deadline compliance
 *   5. TDS category determination
 *   6. Vendor performance signals
 */
const BaseAgent          = require('../../../platform/core/BaseAgent');
const MasterDataService  = require('../../../platform/services/MasterDataService');

class VendorValidationAgent extends BaseAgent {
  constructor() {
    super('vendor_validation', 'p2p', {
      critical:      true,   // Pipeline cannot continue with unknown vendor
      maxRetries:    1,
      minConfidence: 70,
    });
  }

  async run(obj) {
    const extracted = obj.extracted;
    if (!extracted) {
      obj.addFlag('error', this.name, 'No extracted data', 'InvoiceReadingAgent must run first', null);
      return;
    }

    const gstin = extracted.vendor?.gstin;
    const name  = extracted.vendor?.name;

    // ── 1. Look up vendor in master ──────────────────────────
    const vendor = await MasterDataService.findVendor(gstin, name, obj.tenant_id);

    if (!vendor) {
      obj.addFlag('error', this.name, 'Unknown vendor',
        `Vendor "${name}" (GSTIN: ${gstin || 'N/A'}) not in approved master`,
        'Initiate vendor onboarding process');
      obj.enrich(this.name, { approved: false, reason: 'not_in_master' }, 0);
      return;
    }

    // ── 2. Blacklist check ───────────────────────────────────
    if (vendor.status === 'blacklisted') {
      obj.addFlag('error', this.name, 'Blacklisted vendor',
        `${vendor.name} is blacklisted. Do not process.`,
        'Reject invoice. Escalate to Procurement Head.');
      obj.enrich(this.name, { approved: false, reason: 'blacklisted', vendor: vendor.toObject() }, 0);
      return;
    }

    if (vendor.status === 'inactive') {
      obj.addFlag('warn', this.name, 'Inactive vendor',
        `${vendor.name} is marked inactive`,
        'Confirm vendor reactivation before payment');
    }

    // ── 3. GSTIN validation ──────────────────────────────────
    const gstinResult = gstin
      ? this.compliance.validateGSTIN(gstin)
      : { valid: false, reason: 'GSTIN not on invoice' };

    if (!gstinResult.valid) {
      obj.addFlag('warn', this.name, 'GSTIN mismatch or invalid',
        gstinResult.reason || 'Invoice GSTIN does not match master',
        'Verify GSTIN with vendor. Check for recent changes.');
    }

    // ── 4. GSTIN on invoice vs master ───────────────────────
    if (gstin && vendor.gstin && gstin.toUpperCase() !== vendor.gstin.toUpperCase()) {
      obj.addFlag('warn', this.name, 'GSTIN mismatch',
        `Invoice GSTIN ${gstin} differs from master ${vendor.gstin}`,
        'Confirm correct GSTIN with vendor');
    }

    // ── 5. MSME 45-day rule ──────────────────────────────────
    const msme = this.compliance.checkMSMECompliance(
      extracted.invoice_date, vendor.msme_registered
    );
    if (msme.applicable && msme.urgent) {
      obj.addFlag('warn', this.name, 'MSME deadline approaching',
        `Payment due by ${msme.deadline} — ${msme.days_remaining} days remaining`,
        'Prioritise in payment run');
    }
    if (msme.applicable && msme.status === 'breached') {
      obj.addFlag('error', this.name, 'MSME payment overdue',
        `Payment ${msme.breach_days} days overdue. Interest: ${msme.interest_rate}`,
        'Process immediately to stop interest accrual');
    }

    // ── 6. Performance signals ───────────────────────────────
    const signals = [];
    if (vendor.on_time_rate < 70)     signals.push(`Low on-time delivery: ${vendor.on_time_rate}%`);
    if (vendor.invoice_accuracy < 80) signals.push(`Low invoice accuracy: ${vendor.invoice_accuracy}%`);
    if (vendor.dispute_count > 3)     signals.push(`${vendor.dispute_count} open disputes`);
    if (signals.length) {
      obj.addFlag('info', this.name, 'Vendor performance alert', signals.join('; '), null);
    }

    // ── Confidence: deduct for each issue found ──────────────
    let confidence = 95;
    if (!gstinResult.valid)              confidence -= 15;
    if (vendor.status === 'inactive')    confidence -= 10;
    if (signals.length)                  confidence -= (signals.length * 5);
    confidence = Math.max(confidence, 30);

    obj.enrich(this.name, {
      approved:     true,
      vendor:       vendor.toObject(),
      gstin_valid:  gstinResult.valid,
      msme:         msme,
      tds_category: vendor.tds_category,
      performance:  { on_time: vendor.on_time_rate, accuracy: vendor.invoice_accuracy },
    }, confidence);

    obj.transition('vendor_validated', this.name);
  }
}

module.exports = VendorValidationAgent;
