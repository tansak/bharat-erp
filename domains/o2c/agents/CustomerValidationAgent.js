/**
 * BHARAT ERP — O2C: CustomerValidationAgent
 *
 * Validates the buyer before any order is confirmed:
 *   1. GSTIN format validation (reuses platform ComplianceEngine)
 *   2. Customer type classification: B2B | B2C | EXPORT | SEZ
 *   3. GST type determination: CGST+SGST (intra-state) vs IGST (inter-state)
 *   4. Mandatory field checks: name, billing address, contact
 *   5. Blacklist / debarment check (org-level)
 *
 * Flags:
 *   INVALID_GSTIN      error  — order cannot proceed
 *   MISSING_GSTIN      warn   — B2C assumed; invoice will be B2C
 *   MISSING_ADDRESS    error  — delivery cannot be scheduled
 *   CUSTOMER_BLOCKED   error  — customer on internal blacklist
 */

const BaseAgent = require('../../../platform/core/BaseAgent');

class CustomerValidationAgent extends BaseAgent {
  constructor() {
    super('customer_validation', 'o2c', {
      maxRetries:    1,
      timeoutMs:     15000,
      minConfidence: 75,
      critical:      true,
    });
  }

  async run(oco) {
    const c = oco.customer;

    // ── 1. Customer type classification ───────────────────────────
    if (!c.gstin || c.gstin.trim() === '') {
      // No GSTIN → B2C consumer
      c.customer_type = 'B2C';
      oco._flag('MISSING_GSTIN', 'warn',
        'No GSTIN provided — treating as B2C sale',
        'Invoice will be issued without buyer GSTIN. Eligible for B2C QR code.');
    } else {
      // Validate GSTIN using platform ComplianceEngine
      const gstResult = this.compliance.validateGSTIN(c.gstin);

      if (!gstResult.valid) {
        oco._flag('INVALID_GSTIN', 'error',
          `Invalid GSTIN: ${c.gstin}`,
          gstResult.reason);
        oco.confidence_scores.customer_validation = 10;
        return oco;
      }

      c.gstin       = gstResult.gstin;
      c.state_code  = gstResult.state_code;
      c.pan         = gstResult.pan;

      // Classify customer type from GSTIN prefix
      const firstTwo = gstResult.gstin.substring(0, 2);
      if (firstTwo === '97') {
        c.customer_type = 'EXPORT';
        oco.gst.type    = 'IGST';
      } else if (firstTwo === '88') {
        c.customer_type = 'SEZ';
        oco.gst.type    = 'IGST';
      } else {
        c.customer_type = 'B2B';
        // Determine CGST+SGST vs IGST based on seller state
        const sellerState = (oco.gst.seller_gstin || '').substring(0, 2);
        oco.gst.type = (sellerState === gstResult.state_code) ? 'CGST_SGST' : 'IGST';
      }

      oco.gst.buyer_gstin      = c.gstin;
      oco.gst.place_of_supply  = c.state_code;
    }

    // ── 2. Mandatory field checks ──────────────────────────────────
    const missing = [];
    if (!c.name)            missing.push('customer name');
    if (!c.billing_address) missing.push('billing address');
    if (!c.contact_phone && !c.contact_email) missing.push('contact (phone or email)');

    if (missing.length > 0) {
      oco._flag('MISSING_FIELDS', 'error',
        `Required customer fields missing: ${missing.join(', ')}`,
        'Order cannot be processed without complete customer details.');
      oco.confidence_scores.customer_validation = 20;
      return oco;
    }

    // ── 3. Blacklist check (org-level policy) ─────────────────────
    const BLOCKED_CUSTOMERS = (process.env.BLOCKED_GSTINS || '').split(',').filter(Boolean);
    if (c.gstin && BLOCKED_CUSTOMERS.includes(c.gstin)) {
      oco._flag('CUSTOMER_BLOCKED', 'error',
        `Customer GSTIN ${c.gstin} is on the internal blocked list`,
        'Contact credit control team before proceeding.');
      oco.confidence_scores.customer_validation = 0;
      return oco;
    }

    // ── 4. Shipping address fallback ──────────────────────────────
    if (!c.shipping_address) {
      c.shipping_address = c.billing_address;
      oco._flag('SHIPPING_FALLBACK', 'warn',
        'Shipping address not provided — using billing address',
        'Update if goods are being shipped to a different location.');
    }

    // ── Confidence: 95 if B2B with valid GSTIN, 80 if B2C ─────────
    oco.confidence_scores.customer_validation = c.customer_type === 'B2B' ? 95 : 80;
    oco.transition('CUSTOMER_VALIDATED', 'customer_validation');
    return oco;
  }
}

module.exports = CustomerValidationAgent;
