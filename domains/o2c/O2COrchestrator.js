/**
 * BHARAT ERP — O2C Orchestrator (Sprint 7)
 *
 * Coordinates the Order-to-Cash pipeline across 3 phases:
 *
 *   Phase 1 — createOrder(oco):
 *     CustomerValidation → CreditCheck → SalesOrder
 *     Result: ORDER_CONFIRMED with full tax invoice calculated
 *
 *   Phase 2 — generateInvoice(oco):
 *     InvoiceGeneration
 *     Result: INVOICE_GENERATED with IRN, QR, e-invoice payload, WhatsApp sent
 *
 *   Phase 3 — reconcilePayment(oco):
 *     PaymentReconciliation
 *     Result: PAYMENT_RECEIVED or RECONCILED
 *
 *   Full run — run(oco): Phase 1 + Phase 2 (Phase 3 triggered separately on payment receipt)
 *
 * Follows identical pattern as HROrchestrator / SourcingOrchestrator.
 * PROVES: 4th domain, zero new platform infrastructure.
 */

const CustomerValidationAgent   = require('./agents/CustomerValidationAgent');
const CreditCheckAgent          = require('./agents/CreditCheckAgent');
const SalesOrderAgent           = require('./agents/SalesOrderAgent');
const InvoiceGenerationAgent    = require('./agents/InvoiceGenerationAgent');
const PaymentReconciliationAgent = require('./agents/PaymentReconciliationAgent');

class O2COrchestrator {
  constructor() {
    this.agents = {
      customerValidation:    new CustomerValidationAgent(),
      creditCheck:           new CreditCheckAgent(),
      salesOrder:            new SalesOrderAgent(),
      invoiceGeneration:     new InvoiceGenerationAgent(),
      paymentReconciliation: new PaymentReconciliationAgent(),
    };
  }

  // ── Phase 1: Validate customer, check credit, confirm order ───
  async createOrder(oco) {
    // Customer validation (critical — stops pipeline on GSTIN/field error)
    oco = await this.agents.customerValidation.run(oco);

    if (oco.hasError()) {
      oco.status = 'FAILED';
      oco._audit('orchestrator', 'pipeline_aborted',
        { reason: 'Customer validation failed', flags: oco.flags.filter(f => f.level === 'error') });
      return oco;
    }

    // Credit check (critical — blocks order for BLOCKED customers)
    oco = await this.agents.creditCheck.run(oco);

    if (oco.isBlocked()) {
      oco.status = 'CREDIT_BLOCKED';
      oco._audit('orchestrator', 'pipeline_aborted',
        { reason: 'Customer credit blocked', risk_level: oco.credit.risk_level });
      return oco;
    }

    // Sales order: line items, totals, GST, TCS
    oco = await this.agents.salesOrder.run(oco);

    if (oco.hasError()) {
      oco.status = 'FAILED';
      oco._audit('orchestrator', 'pipeline_aborted',
        { reason: 'Sales order processing failed', flags: oco.flags.filter(f => f.level === 'error') });
      return oco;
    }

    return oco;
  }

  // ── Phase 2: Generate GST e-invoice, send to customer ─────────
  async generateInvoice(oco) {
    if (!['ORDER_CONFIRMED', 'PICKING_PACKED'].includes(oco.status)) {
      throw new Error(`Cannot generate invoice from status: ${oco.status}`);
    }
    oco = await this.agents.invoiceGeneration.run(oco);
    return oco;
  }

  // ── Phase 3: Reconcile payment receipt ────────────────────────
  async reconcilePayment(oco, payments) {
    if (!['INVOICE_GENERATED', 'DISPATCHED', 'DELIVERED', 'PAYMENT_RECEIVED'].includes(oco.status)) {
      throw new Error(`Cannot reconcile payment from status: ${oco.status}`);
    }
    // Merge new payments into existing list
    oco.payments = [...(oco.payments || []), ...(payments || [])];
    oco = await this.agents.paymentReconciliation.run(oco);
    return oco;
  }

  // ── Full run: Phase 1 + Phase 2 ───────────────────────────────
  async run(oco) {
    oco = await this.createOrder(oco);

    // Don't generate invoice if order failed
    if (['FAILED', 'CREDIT_BLOCKED'].includes(oco.status)) return oco;

    oco = await this.generateInvoice(oco);
    return oco;
  }
}

module.exports = O2COrchestrator;
