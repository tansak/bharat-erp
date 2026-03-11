/**
 * BHARAT ERP — Sourcing Orchestrator (Sprint 4)
 *
 * Coordinates the full sourcing pipeline:
 *   Requisition → Enrich → Shortlist Vendors → Send RFQ →
 *   [Wait for Quotes] → Evaluate → Select Vendor → Draft PO
 *
 * Follows the exact same pattern as P2POrchestrator.
 * PROVES: Orchestrator pattern = fully reusable across domains.
 *
 * Two modes:
 *   1. process(sco)        — full pipeline (no quotes yet, sends RFQ)
 *   2. evaluateQuotes(sco) — second pass after quotes arrive
 */

const RequisitionEnrichmentAgent = require('./agents/RequisitionEnrichmentAgent');
const VendorShortlistAgent       = require('./agents/VendorShortlistAgent');
const RFQAgent                   = require('./agents/RFQAgent');
const QuoteEvaluationAgent       = require('./agents/QuoteEvaluationAgent');
const PODraftAgent               = require('./agents/PODraftAgent');

const STATUS_FLOW = [
  'RAISED',
  'ENRICHED',
  'VENDORS_SHORTLISTED',
  'RFQ_SENT',
  'QUOTES_RECEIVED',
  'EVALUATED',
  'VENDOR_SELECTED',
  'PO_DRAFTED',
  'PO_APPROVED',
  'PO_ISSUED',
  'CLOSED',
];

class SourcingOrchestrator {
  constructor() {
    this.agents = {
      enrichment:     new RequisitionEnrichmentAgent(),
      vendorShortlist: new VendorShortlistAgent(),
      rfq:            new RFQAgent(),
      quoteEval:      new QuoteEvaluationAgent(),
      poDraft:        new PODraftAgent(),
    };
  }

  /**
   * Phase 1: Process a new requisition through to RFQ sent.
   * Call this when a purchase request is created.
   */
  async processRequisition(sco) {
    console.log(`[SourcingOrchestrator] Starting Phase 1 for ${sco.id}`);

    // Stage 1: Enrich the requisition
    sco = await this._runAgent('enrichment', sco);
    sco.status = 'ENRICHED';

    // Stage 2: Shortlist vendors
    sco = await this._runAgent('vendorShortlist', sco);
    sco.status = 'VENDORS_SHORTLISTED';

    // Stage 3: Send RFQ to shortlisted vendors
    sco = await this._runAgent('rfq', sco);
    sco.status = 'RFQ_SENT';

    sco._audit('SourcingOrchestrator', 'PHASE_1_COMPLETE', {
      vendors_invited: sco.rfq.vendors_invited?.length,
      rfq_id:          sco.rfq.id,
      response_due:    sco.rfq.response_due,
      confidence:      sco.overallConfidence(),
    });

    console.log(`[SourcingOrchestrator] Phase 1 complete. RFQ ${sco.rfq.id} sent to ${sco.rfq.vendors_invited?.length} vendors.`);
    return sco;
  }

  /**
   * Phase 2: Evaluate quotes and draft PO.
   * Call this when quotes have been received and added to sco.quotes.
   * Optionally pass selectedVendorName to skip AI recommendation.
   */
  async evaluateAndDraft(sco, selectedVendorName = null) {
    console.log(`[SourcingOrchestrator] Starting Phase 2 for ${sco.id} (${sco.quotes?.length} quotes)`);

    sco.status = 'QUOTES_RECEIVED';

    // Stage 4: Evaluate quotes
    sco = await this._runAgent('quoteEval', sco);
    sco.status = 'EVALUATED';

    // Stage 5: Set selected vendor (human override or AI recommendation)
    const vendorName = selectedVendorName || sco.evaluation?.recommended_vendor;
    const chosen     = sco.quotes?.find(q => q.vendor_name === vendorName) || sco.quotes?.[0];
    if (chosen) {
      sco.selected_vendor = {
        id:               chosen.vendor_id,
        name:             chosen.vendor_name,
        gstin:            chosen.vendor_gstin,
        negotiated_price: chosen.total_price,
        final_terms:      chosen.payment_terms,
        selected_at:      new Date().toISOString(),
      };
      sco.status = 'VENDOR_SELECTED';
      sco._audit('SourcingOrchestrator', 'VENDOR_SELECTED', {
        vendor:     chosen.vendor_name,
        price:      chosen.total_price,
        by:         selectedVendorName ? 'human' : 'AI',
      });
    }

    // Stage 6: Draft PO
    sco = await this._runAgent('poDraft', sco);
    sco.status = sco.po_draft?.status === 'pending_approval' ? 'PO_DRAFTED' : 'PO_APPROVED';

    sco._audit('SourcingOrchestrator', 'PHASE_2_COMPLETE', {
      po_number:      sco.po_draft?.po_number,
      selected_vendor: sco.selected_vendor?.name,
      po_value:       sco.po_draft?.total_value,
      po_status:      sco.po_draft?.status,
      confidence:     sco.overallConfidence(),
    });

    console.log(`[SourcingOrchestrator] Phase 2 complete. PO ${sco.po_draft?.po_number} drafted.`);
    return sco;
  }

  /**
   * Full pipeline: process requisition + inject mock quotes + evaluate.
   * Useful for testing and demo flows.
   */
  async process(sco, mockQuotes = null) {
    sco = await this.processRequisition(sco);

    // Inject quotes (from database / webhook / manual entry in real usage)
    if (mockQuotes?.length) {
      sco.quotes = mockQuotes;
    } else if (!sco.quotes?.length) {
      // Demo: generate synthetic quotes from shortlisted vendors
      sco.quotes = this._generateDemoQuotes(sco);
    }

    sco = await this.evaluateAndDraft(sco);
    return sco;
  }

  // ─── Private ──────────────────────────────────────────────────

  async _runAgent(agentKey, sco) {
    const agent = this.agents[agentKey];
    try {
      return await agent.execute(sco);
    } catch (err) {
      console.error(`[SourcingOrchestrator] Agent ${agentKey} failed:`, err.message);
      sco._flag(`AGENT_${agentKey.toUpperCase()}_FAILED`, 'error',
        `Agent ${agentKey} failed: ${err.message}`, 'SourcingOrchestrator');
      return sco;
    }
  }

  _generateDemoQuotes(sco) {
    const vendors = sco.rfq?.vendors_invited || [];
    const basePrice = sco.requisition.estimated_value
      ? sco.requisition.estimated_value / (sco.requisition.quantity || 1)
      : 10000;

    return vendors.slice(0, 3).map((vendor, i) => ({
      vendor_id:           vendor.vendor_id,
      vendor_name:         vendor.name,
      vendor_gstin:        vendor.gstin,
      unit_price:          Math.round(basePrice * (0.85 + i * 0.10)),
      total_price:         Math.round(basePrice * (0.85 + i * 0.10) * (sco.requisition.quantity || 1)),
      gst_rate:            18,
      delivery_days:       7 + i * 3,
      payment_terms:       `Net ${30 + i * 15}`,
      payment_days:        30 + i * 15,
      validity_days:       30,
      received_at:         new Date().toISOString(),
      vendor_track_score:  85 - i * 5,
      note:                '[DEMO QUOTE]',
    }));
  }
}

module.exports = SourcingOrchestrator;
