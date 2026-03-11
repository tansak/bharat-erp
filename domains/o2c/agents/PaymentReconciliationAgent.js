/**
 * BHARAT ERP — O2C: PaymentReconciliationAgent
 *
 * Matches incoming payments against open invoices and closes the O2C loop:
 *   1. Validates payment references (UTR for NEFT/RTGS, UPI transaction ID)
 *   2. Matches payment amount against invoice total (exact / partial / excess)
 *   3. Updates AR ledger: reduces outstanding, frees credit limit
 *   4. Handles partial payments → flags for follow-up
 *   5. Handles overpayments → flags for refund / credit note
 *   6. Ageing analysis on remaining outstanding
 *   7. Updates customer credit profile (frees credit for future orders)
 *   8. Sends payment confirmation via WhatsApp
 *
 * Flags:
 *   PARTIAL_PAYMENT       warn   — amount received < invoice total
 *   EXCESS_PAYMENT        warn   — amount received > invoice total (refund needed)
 *   INVALID_UTR           error  — UTR/UPI reference format invalid
 *   DUPLICATE_PAYMENT     error  — same UTR already applied to an invoice
 *   PAYMENT_FULLY_MATCHED info   — invoice closed
 */

const BaseAgent       = require('../../../platform/core/BaseAgent');
const WhatsAppService = require('../../../platform/services/WhatsAppService');

// Tolerance for rounding differences (paise)
const RECONCILIATION_TOLERANCE = 1.00;

// UTR format: 22-char alphanumeric (NEFT/RTGS/IMPS)
const UTR_REGEX = /^[A-Z0-9]{12,22}$/i;

// UPI transaction ID format
const UPI_REGEX = /^[0-9]{12,20}$/;

class PaymentReconciliationAgent extends BaseAgent {
  constructor() {
    super('payment_reconciliation', 'o2c', {
      maxRetries:    1,
      timeoutMs:     20000,
      minConfidence: 80,
      critical:      false, // non-critical — order ships even if payment not yet received
    });
  }

  async run(oco) {
    const payments = oco.payments || [];

    // No payments received yet — this is normal for credit sales
    if (payments.length === 0) {
      oco.reconciliation = {
        total_received:    0,
        total_outstanding: oco.totals.grand_total,
        fully_reconciled:  false,
        reconciled_at:     null,
      };
      oco._flag('PAYMENT_PENDING', 'info',
        `Invoice ${oco.einvoice.invoice_number} outstanding: ₹${oco.totals.grand_total.toLocaleString('en-IN')}`,
        `Payment due as per ${oco.order.payment_terms || 'NET30'} terms.`);
      oco.confidence_scores.payment_reconciliation = 80;
      return oco;
    }

    // ── 1. Validate payment references ────────────────────────────
    const processedPayments = [];
    const usedUTRs = new Set(); // guard against duplicates within this run

    for (const pmt of payments) {
      const utr = (pmt.utr_number || pmt.bank_reference || '').trim().toUpperCase();

      // Validate UTR/UPI format
      if (utr && !UTR_REGEX.test(utr) && !UPI_REGEX.test(utr)) {
        oco._flag('INVALID_UTR', 'error',
          `Invalid payment reference: "${utr}"`,
          'UTR must be 12-22 alphanumeric characters (NEFT/RTGS/IMPS/UPI).');
        continue;
      }

      // Duplicate guard
      if (utr && usedUTRs.has(utr)) {
        oco._flag('DUPLICATE_PAYMENT', 'error',
          `Duplicate payment reference detected: ${utr}`,
          'This UTR has already been applied to this invoice in the current run.');
        continue;
      }
      if (utr) usedUTRs.add(utr);

      processedPayments.push({
        ...pmt,
        utr_number:          utr || null,
        amount:              Number(pmt.amount) || 0,
        received_date:       pmt.received_date || new Date().toISOString().split('T')[0],
        mode:                pmt.mode || 'NEFT',
        allocated_to_invoice: oco.einvoice.invoice_number,
      });
    }

    oco.payments = processedPayments;

    // ── 2. Compute totals ─────────────────────────────────────────
    const totalReceived    = processedPayments.reduce((s, p) => s + p.amount, 0);
    const invoiceTotal     = oco.totals.grand_total;
    const outstanding      = invoiceTotal - totalReceived;
    const absOutstanding   = Math.abs(outstanding);

    // ── 3. Reconciliation status ──────────────────────────────────
    let fullyReconciled = false;

    if (absOutstanding <= RECONCILIATION_TOLERANCE) {
      // Exact match (within tolerance)
      fullyReconciled = true;
      oco._flag('PAYMENT_FULLY_MATCHED', 'info',
        `Invoice ${oco.einvoice.invoice_number} fully reconciled`,
        `Total received: ₹${totalReceived.toLocaleString('en-IN')}`);

    } else if (outstanding > RECONCILIATION_TOLERANCE) {
      // Partial payment
      oco._flag('PARTIAL_PAYMENT', 'warn',
        `Partial payment received — ₹${outstanding.toLocaleString('en-IN')} still outstanding`,
        `Received: ₹${totalReceived.toLocaleString('en-IN')} | ` +
        `Invoice: ₹${invoiceTotal.toLocaleString('en-IN')} | ` +
        `Balance: ₹${outstanding.toLocaleString('en-IN')}`);

    } else {
      // Excess payment
      const excess = Math.abs(outstanding);
      oco._flag('EXCESS_PAYMENT', 'warn',
        `Excess payment of ₹${excess.toLocaleString('en-IN')} received`,
        'Issue a credit note or refund the excess amount to the customer.');
    }

    // ── 4. Ageing analysis ────────────────────────────────────────
    if (!fullyReconciled && oco.einvoice.invoice_date) {
      const invoiceDt   = new Date(oco.einvoice.invoice_date);
      const today       = new Date();
      const ageDays     = Math.floor((today - invoiceDt) / 86400000);
      const creditDays  = oco.credit.credit_days || 30;

      if (ageDays > creditDays + 60) {
        oco._flag('OVERDUE_90', 'error',
          `Invoice overdue by ${ageDays - creditDays} days — escalate to collections`,
          `Legal notice may be required. Outstanding: ₹${outstanding.toLocaleString('en-IN')}`);
      } else if (ageDays > creditDays + 30) {
        oco._flag('OVERDUE_60', 'warn',
          `Invoice overdue by ${ageDays - creditDays} days`,
          `Send final payment reminder. Outstanding: ₹${outstanding.toLocaleString('en-IN')}`);
      } else if (ageDays > creditDays) {
        oco._flag('OVERDUE_30', 'warn',
          `Invoice past due date by ${ageDays - creditDays} days`,
          `Send payment reminder. Outstanding: ₹${outstanding.toLocaleString('en-IN')}`);
      }
    }

    // ── 5. Update reconciliation summary ──────────────────────────
    oco.reconciliation = {
      total_received:    Math.round(totalReceived * 100) / 100,
      total_outstanding: Math.max(0, Math.round(outstanding * 100) / 100),
      fully_reconciled:  fullyReconciled,
      reconciled_at:     fullyReconciled ? new Date().toISOString() : null,
    };

    // ── 6. Free credit limit if fully reconciled ──────────────────
    if (fullyReconciled) {
      oco.credit.credit_used      = Math.max(0, (oco.credit.credit_used || 0) - invoiceTotal);
      oco.credit.credit_available = oco.credit.credit_limit - oco.credit.credit_used;
      oco._audit('payment_reconciliation', 'credit_limit_freed',
        { freed: invoiceTotal, new_used: oco.credit.credit_used });
    }

    // ── 7. WhatsApp payment confirmation ──────────────────────────
    if (fullyReconciled && oco.customer.contact_phone) {
      try {
        const waNumber = oco.customer.contact_phone.startsWith('whatsapp:')
          ? oco.customer.contact_phone
          : `whatsapp:+91${oco.customer.contact_phone.replace(/\D/g, '').slice(-10)}`;

        await WhatsAppService.send(waNumber,
          `✅ *Payment Confirmed*\n\n` +
          `Invoice: ${oco.einvoice.invoice_number}\n` +
          `Amount Received: ₹${totalReceived.toLocaleString('en-IN')}\n` +
          `UTR: ${processedPayments[0]?.utr_number || 'N/A'}\n` +
          `Status: *Fully Reconciled* 🎉\n\n` +
          `Thank you for your payment! 🙏`
        );
      } catch (_) { /* non-critical */ }
    }

    oco.confidence_scores.payment_reconciliation = fullyReconciled ? 95 : 75;

    oco.transition(
      fullyReconciled ? 'RECONCILED' : 'PAYMENT_RECEIVED',
      'payment_reconciliation'
    );
    return oco;
  }
}

module.exports = PaymentReconciliationAgent;
