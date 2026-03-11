/**
 * BHARAT ERP — P2P Orchestrator (Sprint 1)
 */
const Orchestrator           = require('../../platform/core/Orchestrator');
const InvoiceReadingAgent    = require('./agents/InvoiceReadingAgent');
const VendorValidationAgent  = require('./agents/VendorValidationAgent');
const POMatchingAgent        = require('./agents/POMatchingAgent');
const GRNMatchingAgent       = require('./agents/GRNMatchingAgent');
const ComplianceAgent        = require('./agents/ComplianceAgent');
const FraudDetectionAgent    = require('./agents/FraudDetectionAgent');
const AutoApprovalAgent      = require('./agents/AutoApprovalAgent');
const PaymentSchedulingAgent = require('./agents/PaymentSchedulingAgent');

class P2POrchestrator extends Orchestrator {
  constructor() {
    super('p2p', [
      new InvoiceReadingAgent(),
      [ new VendorValidationAgent(), new POMatchingAgent() ],
      new GRNMatchingAgent(),
      [ new ComplianceAgent(), new FraudDetectionAgent() ],
      new AutoApprovalAgent(),
      { condition: (obj) => obj.status === 'approved', agent: new PaymentSchedulingAgent() },
    ]);
  }
}

module.exports = P2POrchestrator;
