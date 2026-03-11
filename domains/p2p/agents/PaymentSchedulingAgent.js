/**
 * BHARAT ERP — PaymentSchedulingAgent (P2P) — Sprint 1
 * Determines optimal payment date considering TDS, MSME, cash flow, discounts.
 */
const BaseAgent = require('../../../platform/core/BaseAgent');
const { ProcessedInvoiceModel } = require('../models/P2PModels');

class PaymentSchedulingAgent extends BaseAgent {
  constructor() { super('payment_scheduling', 'p2p', {}); }

  async run(obj) {
    const extracted = obj.extracted;
    const vendor    = obj.vendorData?.vendor;
    const tds       = obj.domain_data.compliance?.tds;
    const msme      = obj.vendorData?.msme;

    const amount    = extracted?.total_amount || 0;
    const netPayable= tds?.applicable ? tds.net_payable : amount;

    // Determine payment due date
    const invoiceDate   = new Date(extracted?.invoice_date || Date.now());
    const paymentTerms  = parseInt(extracted?.payment_terms?.match(/\d+/)?.[0] || '30');
    const standardDue   = new Date(invoiceDate);
    standardDue.setDate(standardDue.getDate() + paymentTerms);

    // MSME overrides standard terms if stricter
    let scheduledDate = standardDue;
    let reason = `Standard ${paymentTerms}-day terms`;

    if (msme?.applicable && msme.deadline) {
      const msmeDeadline = new Date(msme.deadline);
      if (msmeDeadline < standardDue) {
        scheduledDate = msmeDeadline;
        reason = 'MSME 45-day rule — overrides standard terms';
      }
    }

    // Early payment discount opportunity
    let earlyPaymentSaving = 0;
    if (vendor?.on_time_rate > 90) {
      // Assume 2/10 net 30 (2% discount if paid within 10 days)
      const earlyDate = new Date(invoiceDate);
      earlyDate.setDate(earlyDate.getDate() + 10);
      if (earlyDate >= new Date()) {
        earlyPaymentSaving = Math.round(netPayable * 0.02);
      }
    }

    // Save to processed invoice ledger
    try {
      await ProcessedInvoiceModel.findOneAndUpdate(
        { canonical_id: obj.id, tenant_id: obj.tenant_id },
        {
          canonical_id:    obj.id,
          tenant_id:       obj.tenant_id,
          invoice_number:  extracted?.invoice_number,
          invoice_date:    invoiceDate,
          due_date:        new Date(extracted?.due_date || standardDue),
          vendor_name:     vendor?.name || extracted?.vendor?.name,
          vendor_gstin:    extracted?.vendor?.gstin,
          total_amount:    amount,
          tds_amount:      tds?.applicable ? tds.tds_amount : 0,
          net_payable:     netPayable,
          status:          'approved',
          payment_due_date: scheduledDate,
          irn:             extracted?.irn,
        },
        { upsert: true, new: true }
      );
    } catch (e) {
      // Non-critical — audit trail still in canonical object
    }

    obj.enrich(this.name, {
      net_payable: netPayable,
      scheduled_date: scheduledDate,
      scheduling_reason: reason,
      tds_to_deduct: tds?.applicable ? tds.tds_amount : 0,
      tds_section: tds?.section,
      early_payment_saving: earlyPaymentSaving,
    }, 95);

    obj.transition('payment_scheduled', this.name);
  }
}
module.exports = PaymentSchedulingAgent;
