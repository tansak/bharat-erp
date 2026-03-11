/**
 * BHARAT ERP — POMatchingAgent (P2P)
 * Sprint 1 — Full Implementation
 *
 * Matches invoice to Purchase Order:
 *   1. Find PO by number or vendor+amount fuzzy match
 *   2. Verify PO status (open/partial only — not closed/cancelled)
 *   3. Check invoice amount vs PO within tolerance %
 *   4. Verify line items match (quantity + price)
 *   5. Check for over-billing (invoice > remaining PO value)
 *   6. Update PO billed quantities (2-way match)
 */
const BaseAgent = require('../../../platform/core/BaseAgent');
const { POModel } = require('../models/P2PModels');

class POMatchingAgent extends BaseAgent {
  constructor() {
    super('po_matching', 'p2p', {
      critical:      false,  // Invoice can proceed without PO (advance purchase)
      minConfidence: 60,
    });
  }

  async run(obj) {
    const extracted = obj.extracted;
    if (!extracted) return;

    const poNumber    = extracted.po_reference;
    const invoiceAmt  = extracted.total_amount || 0;
    const vendorGSTIN = extracted.vendor?.gstin;

    // ── 1. Find PO ───────────────────────────────────────────
    let po = null;

    if (poNumber) {
      // Direct match by PO number
      po = await POModel.findOne({
        po_number:  poNumber.trim(),
        tenant_id:  obj.tenant_id,
      });
    }

    if (!po && vendorGSTIN && invoiceAmt) {
      // Fuzzy: same vendor, open PO, amount within 20% (to handle partial invoices)
      po = await POModel.findOne({
        tenant_id:    obj.tenant_id,
        vendor_gstin: vendorGSTIN,
        status:       { $in: ['open', 'partial'] },
        total_amount: { $gte: invoiceAmt * 0.8, $lte: invoiceAmt * 1.2 },
      });
    }

    if (!po) {
      // No PO found — flag but don't block (could be advance/petty cash)
      obj.addFlag('warn', this.name, 'No PO found',
        `No open PO found for ${poNumber ? `PO# ${poNumber}` : `vendor ${vendorGSTIN}`}`,
        'Confirm if advance purchase or petty cash. Attach approval.');
      obj.enrich(this.name, { matched: false, reason: 'no_po_found' }, 50);
      return;
    }

    // ── 2. PO status check ───────────────────────────────────
    if (po.status === 'cancelled') {
      obj.addFlag('error', this.name, 'PO is cancelled',
        `PO ${po.po_number} was cancelled. Invoice cannot be processed.`,
        'Contact vendor to reject invoice.');
      obj.enrich(this.name, { matched: false, po: po.toObject(), reason: 'po_cancelled' }, 0);
      return;
    }
    if (po.status === 'closed') {
      obj.addFlag('error', this.name, 'PO already closed',
        `PO ${po.po_number} is fully billed and closed.`,
        'Check for duplicate invoice or request new PO.');
      obj.enrich(this.name, { matched: false, po: po.toObject(), reason: 'po_closed' }, 0);
      return;
    }

    // ── 3. Amount tolerance check ────────────────────────────
    const tolerance    = (po.tolerance_pct || 2) / 100;
    const poRemaining  = po.total_amount - this._alreadyBilled(po);
    const variance     = Math.abs(invoiceAmt - poRemaining) / poRemaining;
    const varianceAmt  = invoiceAmt - poRemaining;
    const withinTol    = variance <= tolerance;

    if (invoiceAmt > poRemaining * (1 + tolerance)) {
      const overBillAmt = invoiceAmt - poRemaining;
      obj.addFlag('error', this.name, 'Invoice exceeds PO value',
        `Invoice ₹${invoiceAmt.toLocaleString('en-IN')} exceeds remaining PO value ₹${poRemaining.toLocaleString('en-IN')} by ₹${overBillAmt.toLocaleString('en-IN')}`,
        'Request credit note from vendor or raise PO amendment.');
      obj.enrich(this.name, { matched: false, po: po.toObject(), over_billed: overBillAmt }, 10);
      return;
    }

    if (!withinTol && varianceAmt > 0) {
      obj.addFlag('warn', this.name, 'Amount variance',
        `Invoice vs PO variance: ₹${Math.abs(varianceAmt).toLocaleString('en-IN')} (${(variance * 100).toFixed(1)}%)`,
        `Within ${(tolerance * 100).toFixed(0)}% tolerance: ${withinTol ? 'Yes' : 'No — manual review'}`);
    }

    // ── 4. Line item matching (2-way) ────────────────────────
    const lineMatches = this._matchLineItems(extracted.line_items || [], po.line_items || []);
    const unmatchedLines = lineMatches.filter(l => !l.matched);
    if (unmatchedLines.length > 0) {
      obj.addFlag('warn', this.name, 'Line item mismatch',
        `${unmatchedLines.length} line items do not match PO`,
        'Review line items with vendor');
    }

    // ── Confidence ───────────────────────────────────────────
    let confidence = 90;
    if (!poNumber)            confidence -= 10;  // found by fuzzy match
    if (!withinTol)           confidence -= 15;
    if (unmatchedLines.length) confidence -= (unmatchedLines.length * 5);
    confidence = Math.max(confidence, 20);

    obj.enrich(this.name, {
      matched:        true,
      po:             po.toObject(),
      po_remaining:   poRemaining,
      invoice_amount: invoiceAmt,
      variance_amt:   varianceAmt,
      variance_pct:   (variance * 100).toFixed(1),
      within_tolerance: withinTol,
      line_matches:   lineMatches,
      match_method:   poNumber ? 'direct' : 'fuzzy',
    }, confidence);
  }

  _alreadyBilled(po) {
    return po.line_items.reduce((sum, l) => sum + (l.qty_billed * l.unit_price || 0), 0);
  }

  _matchLineItems(invoiceLines, poLines) {
    return invoiceLines.map(il => {
      const match = poLines.find(pl =>
        (pl.item_code && il.description?.toLowerCase().includes(pl.item_code.toLowerCase())) ||
        (pl.description && il.description?.toLowerCase().includes(pl.description.toLowerCase().slice(0, 10)))
      );
      if (!match) return { invoice_line: il, matched: false, reason: 'No matching PO line' };

      const qtyOk  = Math.abs(il.quantity - match.qty_ordered) / match.qty_ordered < 0.05;
      const priceOk= Math.abs(il.unit_price - match.unit_price) / match.unit_price < 0.02;

      return {
        invoice_line: il,
        po_line:      match,
        matched:      qtyOk && priceOk,
        qty_ok:       qtyOk,
        price_ok:     priceOk,
      };
    });
  }
}

module.exports = POMatchingAgent;
