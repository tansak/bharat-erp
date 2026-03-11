/**
 * BHARAT ERP — GRNMatchingAgent (P2P)
 * Sprint 1 — Full Implementation
 *
 * Third leg of the 3-way match: Invoice vs GRN
 *   1. Find GRN linked to the PO
 *   2. Verify goods were actually received before invoice
 *   3. Match invoice quantities to GRN quantities
 *   4. Flag discrepancies (can't bill for unreceived goods)
 *   5. Handle partial deliveries correctly
 */
const BaseAgent  = require('../../../platform/core/BaseAgent');
const { GRNModel } = require('../models/P2PModels');

class GRNMatchingAgent extends BaseAgent {
  constructor() {
    super('grn_matching', 'p2p', {
      critical:      false,  // Service invoices may have no GRN
      minConfidence: 60,
    });
  }

  async run(obj) {
    const extracted = obj.extracted;
    const poData    = obj.poData;

    if (!extracted) return;

    // ── Services don't have GRN — skip gracefully ────────────
    const isService = this._isServiceInvoice(extracted.line_items || []);
    if (isService) {
      obj.enrich(this.name, {
        applicable: false,
        reason:     'Service invoice — GRN not required',
        matched:    true,
      }, 90);
      obj.transition('grn_matched', this.name);
      return;
    }

    // ── Find GRN by PO number ────────────────────────────────
    const poNumber = poData?.po?.po_number || extracted.po_reference;
    let grns = [];

    if (poNumber) {
      grns = await GRNModel.find({
        tenant_id: obj.tenant_id,
        po_number: poNumber,
        status:    'confirmed',
        invoice_matched: false,
      });
    }

    if (!grns.length) {
      // No GRN found
      obj.addFlag('warn', this.name, 'No GRN found',
        `No Goods Receipt Note found for PO ${poNumber || 'unknown'}`,
        'Confirm delivery with warehouse before approving payment');
      obj.enrich(this.name, { matched: false, reason: 'no_grn_found', applicable: true }, 40);
      return;
    }

    // ── Match invoice lines to GRN received quantities ───────
    const invoiceLines = extracted.line_items || [];
    const allGRNLines  = grns.flatMap(g => g.line_items);
    const discrepancies= [];
    const lineResults  = [];

    for (const invLine of invoiceLines) {
      const grnLine = allGRNLines.find(gl =>
        gl.item_code === invLine.item_code ||
        gl.description?.toLowerCase().includes(invLine.description?.toLowerCase().slice(0, 10))
      );

      if (!grnLine) {
        discrepancies.push({
          item:   invLine.description,
          issue:  'Item on invoice not in GRN — goods may not have been received',
          severity: 'high',
        });
        lineResults.push({ invoice: invLine, grn: null, matched: false });
        continue;
      }

      const qtyInvoiced = invLine.quantity || 0;
      const qtyReceived = grnLine.qty_received || 0;
      const qtyVariance = qtyInvoiced - qtyReceived;

      if (qtyVariance > 0) {
        const pct = ((qtyVariance / qtyReceived) * 100).toFixed(1);
        discrepancies.push({
          item:       invLine.description,
          invoiced:   qtyInvoiced,
          received:   qtyReceived,
          variance:   qtyVariance,
          issue:      `Invoice qty (${qtyInvoiced}) > received qty (${qtyReceived}) by ${pct}%`,
          severity:   qtyVariance / qtyReceived > 0.05 ? 'high' : 'low',
        });
      }

      if (grnLine.quality_status === 'rejected') {
        discrepancies.push({
          item:    invLine.description,
          issue:   'Goods were quality-rejected at GRN stage',
          severity:'high',
        });
      }

      lineResults.push({
        invoice:      invLine,
        grn:          grnLine,
        matched:      qtyVariance === 0 && grnLine.quality_status === 'accepted',
        qty_variance: qtyVariance,
      });
    }

    // ── Flag high-severity discrepancies ────────────────────
    const highSeverity = discrepancies.filter(d => d.severity === 'high');
    if (highSeverity.length) {
      obj.addFlag('error', this.name, '3-way match failed',
        `${highSeverity.length} high-severity GRN discrepancy: ${highSeverity[0].issue}`,
        'Do not pay until discrepancy resolved with vendor and warehouse');
    } else if (discrepancies.length) {
      obj.addFlag('warn', this.name, 'Minor GRN variance',
        `${discrepancies.length} minor quantity variance`,
        'Review with warehouse before payment');
    }

    // ── Confidence ───────────────────────────────────────────
    const matchRate  = lineResults.filter(l => l.matched).length / Math.max(lineResults.length, 1);
    const confidence = Math.round(40 + matchRate * 55 - highSeverity.length * 20);

    obj.enrich(this.name, {
      applicable:     true,
      matched:        highSeverity.length === 0,
      grns:           grns.map(g => g.toObject()),
      line_results:   lineResults,
      discrepancies,
      match_rate:     (matchRate * 100).toFixed(0) + '%',
    }, Math.max(confidence, 10));

    obj.transition('grn_matched', this.name);
  }

  _isServiceInvoice(lineItems) {
    if (!lineItems.length) return true;
    // SAC codes start with 99 — service accounting codes
    return lineItems.every(l =>
      String(l.hsn_sac || '').startsWith('99') ||
      ['consulting','service','subscription','licence','license','support','maintenance']
        .some(kw => l.description?.toLowerCase().includes(kw))
    );
  }
}

module.exports = GRNMatchingAgent;
