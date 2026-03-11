/**
 * BHARAT ERP — AutoApprovalAgent (P2P) — Sprint 1
 * Makes final approve/escalate/hold decision.
 */
const BaseAgent = require('../../../platform/core/BaseAgent');

class AutoApprovalAgent extends BaseAgent {
  constructor() { super('auto_approval', 'p2p', { critical: true }); }

  async run(obj) {
    const extracted  = obj.extracted;
    const amount     = extracted?.total_amount || 0;
    const limit      = parseInt(process.env.AUTO_APPROVAL_LIMIT || '100000');
    const confThresh = parseInt(process.env.CONFIDENCE_THRESHOLD || '90');
    const fraudHold  = parseInt(process.env.MIN_FRAUD_SCORE_TO_HOLD || '40');

    const errorFlags = obj.errorFlags();
    const warns      = obj.flags.filter(f => f.type === 'warn' && !f.resolved);
    const fraudScore = obj.domain_data.fraud_detection?.risk_score || 0;

    // Weighted 3-way match score
    const vc = obj.confidence_scores.vendor_validation || 0;
    const pc = obj.confidence_scores.po_matching       || 50;
    const gc = obj.confidence_scores.grn_matching      || 50;
    const cc = obj.confidence_scores.compliance        || 0;
    const threeWay = Math.round(vc*0.20 + pc*0.35 + gc*0.30 + cc*0.15);

    let action, reason, approvalLevel;

    if (errorFlags.length > 0) {
      action = 'exception';
      reason = `${errorFlags.length} error(s): ${errorFlags.map(f=>f.title).join('; ')}`;
      approvalLevel = 'finance_manager';
    } else if (fraudScore >= fraudHold) {
      action = 'hold';
      reason = `Fraud risk ${fraudScore}/100 exceeds threshold ${fraudHold}`;
      approvalLevel = 'cfo';
    } else if (amount > limit * 5) {
      action = 'escalate';
      reason = `Amount requires CFO approval`;
      approvalLevel = 'cfo';
    } else if (amount > limit) {
      action = 'escalate';
      reason = `Amount Rs.${amount.toLocaleString('en-IN')} exceeds auto-limit Rs.${limit.toLocaleString('en-IN')}`;
      approvalLevel = 'finance_manager';
    } else if (threeWay < confThresh || warns.length > 2) {
      action = 'review';
      reason = `3-way score ${threeWay}% needs review`;
      approvalLevel = 'ap_clerk';
    } else {
      action = 'approve';
      reason = `3-way ${threeWay}% | Fraud risk ${fraudScore}/100 | No errors`;
      approvalLevel = 'autonomous';
    }

    const tds = obj.domain_data.compliance?.tds;
    obj.decision = {
      action, reason, approval_level: approvalLevel,
      three_way_score: threeWay,
      overall_confidence: obj.overallConfidence(),
      fraud_risk_score: fraudScore,
      invoice_amount: amount,
      tds_deduction: tds?.applicable ? tds.tds_amount : 0,
      net_payable: tds?.applicable ? tds.net_payable : amount,
      timestamp: new Date(),
      auto_processed: action === 'approve',
    };

    obj.enrich(this.name, { action, reason, approval_level: approvalLevel, three_way_score: threeWay }, threeWay);

    if      (action === 'approve')   obj.transition('approved', this.name);
    else if (action === 'exception') obj.transition('exception', this.name);
    else if (action === 'hold')      obj.transition('on_hold', this.name);
    else                             obj.transition('pending_approval', this.name);
  }
}
module.exports = AutoApprovalAgent;
