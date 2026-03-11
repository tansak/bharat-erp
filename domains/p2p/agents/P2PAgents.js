/**
 * BHARAT ERP — P2P Stub Agents
 * These extend BaseAgent. Implement run() for each in Sprint 1.
 */
const BaseAgent = require('../../../platform/core/BaseAgent');

// ── VendorValidationAgent ────────────────────────────────────────
class VendorValidationAgent extends BaseAgent {
  constructor() { super('vendor_validation', 'p2p', { critical: true }); }
  async run(obj) {
    const { VendorModel } = require('../../../platform/models/MasterDataModels');
    const gstin = obj.extracted?.vendor?.gstin;
    const vendor = gstin
      ? await VendorModel.findOne({ gstin, tenant_id: obj.tenant_id })
      : await VendorModel.findOne({ name: new RegExp(obj.extracted?.vendor?.name, 'i'), tenant_id: obj.tenant_id });

    if (!vendor) {
      obj.addFlag('error', this.name, 'Unknown vendor', 'Vendor not in approved master', 'Initiate vendor onboarding');
      obj.enrich(this.name, { approved: false }, 0);
      return;
    }
    if (vendor.status === 'blacklisted') {
      obj.addFlag('error', this.name, 'Blacklisted vendor', `${vendor.name} is blacklisted`, 'Reject invoice immediately');
      obj.enrich(this.name, { approved: false, vendor }, 0);
      return;
    }

    const msme = this.compliance.checkMSMECompliance(obj.extracted?.invoice_date, vendor.msme_registered);
    if (msme.urgent) obj.addFlag('warn', this.name, 'MSME deadline approaching', `Payment due by ${msme.deadline}`, 'Prioritise payment');

    obj.enrich(this.name, { approved: true, vendor: vendor.toJSON(), msme }, 90);
    obj.transition('vendor_validated', this.name);
  }
}

// ── POMatchingAgent ──────────────────────────────────────────────
class POMatchingAgent extends BaseAgent {
  constructor() { super('po_matching', 'p2p', { critical: false }); }
  async run(obj) {
    // TODO Sprint 1: Query PO database, fuzzy match, amount tolerance check
    obj.enrich(this.name, { matched: true, po: null, tolerance_ok: true }, 85);
  }
}

// ── GRNMatchingAgent ─────────────────────────────────────────────
class GRNMatchingAgent extends BaseAgent {
  constructor() { super('grn_matching', 'p2p', { critical: false }); }
  async run(obj) {
    // TODO Sprint 1: Match GRN quantities to invoice line items
    obj.enrich(this.name, { matched: true, discrepancies: [] }, 88);
    obj.transition('grn_matched', this.name);
  }
}

// ── ComplianceAgent ──────────────────────────────────────────────
class ComplianceAgent extends BaseAgent {
  constructor() { super('compliance', 'p2p', { critical: false }); }
  async run(obj) {
    const data = obj.extracted;
    const vendor = obj.vendorData?.vendor;
    const gstValid = data?.vendor?.gstin
      ? this.compliance.validateGSTIN(data.vendor.gstin)
      : { valid: false };
    const tds = vendor
      ? this.compliance.calculateTDS(data?.total_amount || 0, vendor.tds_category)
      : { applicable: false };

    if (!gstValid.valid) obj.addFlag('warn', this.name, 'GSTIN invalid', 'Vendor GSTIN failed validation', 'Verify with vendor');
    if (tds.applicable) obj.addFlag('info', this.name, 'TDS applicable', `${tds.section} @ ${tds.rate}`, null);

    obj.enrich(this.name, { gst_valid: gstValid.valid, tds, irn_valid: !!data?.irn }, 92);
    obj.transition('compliance_checked', this.name);
  }
}

// ── FraudDetectionAgent ──────────────────────────────────────────
class FraudDetectionAgent extends BaseAgent {
  constructor() { super('fraud_detection', 'p2p', { critical: false }); }
  async run(obj) {
    // TODO Sprint 2: Duplicate detection, amount anomaly ML model, velocity checks
    obj.enrich(this.name, { risk_score: 5, signals: [] }, 95);
  }
}

// ── AutoApprovalAgent ────────────────────────────────────────────
class AutoApprovalAgent extends BaseAgent {
  constructor() { super('auto_approval', 'p2p', { critical: true }); }
  async run(obj) {
    const conf = obj.overallConfidence();
    const limit = parseInt(process.env.AUTO_APPROVAL_LIMIT || '100000');
    const amount = obj.extracted?.total_amount || 0;
    const hasErrors = obj.hasError();
    const fraudRisk = obj.domain_data.fraud?.risk_score || 0;

    let action, reason;
    if (hasErrors) {
      action = 'exception'; reason = 'Error flags require human review';
    } else if (amount > limit) {
      action = 'escalate'; reason = `Amount ₹${amount.toLocaleString('en-IN')} exceeds auto-approval limit`;
    } else if (fraudRisk > 40) {
      action = 'hold'; reason = `Fraud risk score ${fraudRisk} above threshold`;
    } else if (conf >= 90) {
      action = 'approve'; reason = `Confidence ${conf}% meets autonomous threshold`;
    } else {
      action = 'review'; reason = `Confidence ${conf}% requires human review`;
    }

    obj.decision = { action, reason, confidence: conf, timestamp: new Date() };
    obj.enrich(this.name, { action, reason }, conf);

    if (action === 'approve') obj.transition('approved', this.name);
    else if (action === 'exception') obj.transition('exception', this.name);
    else obj.transition('pending_approval', this.name);
  }
}

// ── ExceptionRouterAgent ─────────────────────────────────────────
class ExceptionRouterAgent extends BaseAgent {
  constructor() { super('exception_router', 'p2p', {}); }
  async run(obj) {
    await this.notify.alertException(obj);
  }
}

// ── PaymentSchedulingAgent ───────────────────────────────────────
class PaymentSchedulingAgent extends BaseAgent {
  constructor() { super('payment_scheduling', 'p2p', {}); }
  async run(obj) {
    // TODO Sprint 2: Cash flow optimisation, TDS deduction, payment scheduling
    obj.enrich(this.name, { scheduled: true, scheduled_date: new Date() }, 90);
    obj.transition('payment_scheduled', this.name);
  }
}

// ── VendorCommsAgent ─────────────────────────────────────────────
class VendorCommsAgent extends BaseAgent {
  constructor() { super('vendor_comms', 'p2p', {}); }
  async run(obj) {
    // TODO Sprint 2: Auto-generate vendor queries, payment advices, rejection notices
  }
}

// ── ReconciliationAgent ──────────────────────────────────────────
class ReconciliationAgent extends BaseAgent {
  constructor() { super('reconciliation', 'p2p', {}); }
  async run(obj) {
    // TODO Sprint 2: Bank feed matching, GL posting, GST ITC claiming
    obj.transition('reconciled', this.name);
  }
}

module.exports = {
  VendorValidationAgent, POMatchingAgent, GRNMatchingAgent,
  ComplianceAgent, FraudDetectionAgent, AutoApprovalAgent,
  ExceptionRouterAgent, PaymentSchedulingAgent,
  VendorCommsAgent, ReconciliationAgent,
};
