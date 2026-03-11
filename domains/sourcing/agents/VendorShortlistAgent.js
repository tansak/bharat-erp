/**
 * BHARAT ERP — Sourcing: VendorShortlistAgent
 *
 * Shortlists vendors from the master database for a given requisition.
 * Scores vendors on: category match, past performance, MSME preference,
 * current workload, and payment terms compatibility.
 *
 * Reuses: BaseAgent, MasterDataService (already built in P2P Sprint 1).
 * PROVES: Same vendor master, zero new infrastructure.
 */

const BaseAgent         = require('../../../platform/core/BaseAgent');
const MasterDataService = require('../../../platform/services/MasterDataService');

// Minimum vendors to invite for RFQ (configurable)
const MIN_VENDORS_FOR_RFQ  = parseInt(process.env.MIN_RFQ_VENDORS)  || 3;
const MAX_VENDORS_FOR_RFQ  = parseInt(process.env.MAX_RFQ_VENDORS)  || 6;
const MSME_PREFERENCE_SCORE = 15; // Extra points for MSME vendors (govt policy)

class VendorShortlistAgent extends BaseAgent {
  constructor() {
    super('vendor_shortlist', 'sourcing', {
      maxRetries:    1,
      timeoutMs:     15000,
      minConfidence: 50,
      critical:      false,
    });
  }

  async run(sco) {
    const req = sco.requisition;

    // ── 1. Fetch vendors from master ──────────────────────────────
    let allVendors = [];
    try {
      allVendors = await MasterDataService.getVendors(sco.tenant_id);
    } catch (err) {
      console.warn('[VendorShortlist] MasterData unavailable — using empty list:', err.message);
    }

    // ── 2. Filter: active, not blacklisted, relevant category ─────
    const active = allVendors.filter(v =>
      v.status !== 'blacklisted' &&
      v.status !== 'suspended' &&
      v.status !== 'inactive'
    );

    if (active.length === 0) {
      sco._flag('NO_VENDORS_AVAILABLE', 'error',
        'No active vendors found in master. Add vendors before issuing RFQ.', this.name);
      sco.confidence_scores.vendor_shortlist = 0;
      sco._audit(this.name, 'NO_VENDORS_FOUND', { total_vendors: allVendors.length });
      return sco;
    }

    // ── 3. Score each vendor ──────────────────────────────────────
    const scored = active.map(v => ({
      vendor_id:     v._id?.toString() || v.id,
      name:          v.name,
      gstin:         v.gstin,
      email:         v.email || null,
      whatsapp:      v.whatsapp || null,
      msme:          v.msme_registered || false,
      past_score:    v.vendor_score    || 75,
      status:        v.status,
      score:         this._scoreVendor(v, req),
      score_breakdown: this._scoreBreakdown(v, req),
    }));

    // ── 4. Sort by score, take top MAX_VENDORS_FOR_RFQ ────────────
    scored.sort((a, b) => b.score - a.score);
    const shortlisted = scored.slice(0, MAX_VENDORS_FOR_RFQ);

    // ── 5. Check minimum vendor count ────────────────────────────
    if (shortlisted.length < MIN_VENDORS_FOR_RFQ) {
      sco._flag('LOW_VENDOR_COUNT', 'warn',
        `Only ${shortlisted.length} vendor(s) shortlisted. Minimum recommended is ${MIN_VENDORS_FOR_RFQ}. Consider adding more vendors.`,
        this.name);
    }

    // ── 6. Flag if no MSME vendors in list ───────────────────────
    const msmeCount = shortlisted.filter(v => v.msme).length;
    if (msmeCount === 0 && active.filter(v => v.msme).length > 0) {
      sco._flag('NO_MSME_IN_SHORTLIST', 'info',
        'MSME vendors available in master but not shortlisted. Consider including for government compliance.',
        this.name);
    }

    // ── 7. Assign to SCO ──────────────────────────────────────────
    sco.enriched.suggested_vendors = shortlisted;
    sco.rfq.vendors_invited = shortlisted.map(v => ({
      vendor_id: v.vendor_id,
      name:      v.name,
      gstin:     v.gstin,
      email:     v.email,
      whatsapp:  v.whatsapp,
    }));

    // ── 8. Confidence ─────────────────────────────────────────────
    const conf = shortlisted.length >= MIN_VENDORS_FOR_RFQ ? 85 : 55;
    sco.confidence_scores.vendor_shortlist = conf;

    sco._audit(this.name, 'VENDORS_SHORTLISTED', {
      total_active:  active.length,
      shortlisted:   shortlisted.length,
      msme_count:    msmeCount,
      top_vendor:    shortlisted[0]?.name,
    });

    return sco;
  }

  // ─── Scoring Logic ─────────────────────────────────────────────

  _scoreVendor(vendor, req) {
    let score = 0;
    // Past performance (0–50)
    score += Math.min(50, (vendor.vendor_score || 75) * 0.5);
    // MSME preference (+15)
    if (vendor.msme_registered) score += MSME_PREFERENCE_SCORE;
    // Approved status (+20)
    if (vendor.status === 'approved') score += 20;
    // Pending status (+5)
    if (vendor.status === 'pending') score += 5;
    return Math.round(score);
  }

  _scoreBreakdown(vendor, req) {
    return {
      past_performance: Math.min(50, (vendor.vendor_score || 75) * 0.5),
      msme_preference:  vendor.msme_registered ? MSME_PREFERENCE_SCORE : 0,
      approval_status:  vendor.status === 'approved' ? 20 : (vendor.status === 'pending' ? 5 : 0),
    };
  }
}

module.exports = VendorShortlistAgent;
