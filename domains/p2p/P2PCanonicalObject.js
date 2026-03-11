/**
 * BHARAT ERP — P2P Canonical Object
 * Extends platform CanonicalObject with P2P-specific accessors.
 * domain_data is keyed by agent name (set by BaseAgent.enrich).
 * Accessors provide clean aliases for downstream agents.
 */
const CanonicalObject = require('../../platform/core/CanonicalObject');

class P2PCanonicalObject extends CanonicalObject {
  constructor(sourceData = {}) {
    super('p2p', 'invoice', sourceData);
    // domain_data is populated by agents using their own name as key
    // e.g. domain_data['invoice_reading'], domain_data['vendor_validation'] etc.
  }

  // ── Clean accessors used by downstream agents ─────────────────
  get extracted()  { return this.domain_data['invoice_reading']   || null; }
  get vendorData() { return this.domain_data['vendor_validation'] || null; }
  get poData()     { return this.domain_data['po_matching']       || null; }
  get grnData()    { return this.domain_data['grn_matching']      || null; }

  isReadyForThreeWayMatch() {
    return this.vendorData?.approved === true &&
           this.poData?.matched === true;
  }

  isApprovedForPayment() {
    return this.status === 'approved' &&
           this.decision?.action === 'approve';
  }
}

module.exports = P2PCanonicalObject;
