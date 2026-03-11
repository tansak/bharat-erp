/**
 * BHARAT ERP — P2P Agents index
 * Clean re-export of all Sprint 1 agents
 */
module.exports = {
  InvoiceReadingAgent:    require('./InvoiceReadingAgent'),
  VendorValidationAgent:  require('./VendorValidationAgent'),
  POMatchingAgent:        require('./POMatchingAgent'),
  GRNMatchingAgent:       require('./GRNMatchingAgent'),
  ComplianceAgent:        require('./ComplianceAgent'),
  FraudDetectionAgent:    require('./FraudDetectionAgent'),
  AutoApprovalAgent:      require('./AutoApprovalAgent'),
  PaymentSchedulingAgent: require('./PaymentSchedulingAgent'),
};
