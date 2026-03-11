/**
 * BHARAT ERP — O2C: CreditCheckAgent
 *
 * Evaluates buyer's credit position before order confirmation:
 *   1. Credit limit vs current order value + outstanding
 *   2. Overdue ageing (30/60/90+ day buckets)
 *   3. Credit risk scoring (0-100)
 *   4. Payment history pattern analysis
 *   5. Auto-hold or auto-approve based on risk level
 *
 * Risk levels:
 *   LOW    (score 80-100) → auto-approve
 *   MEDIUM (score 50-79)  → approve with flag
 *   HIGH   (score 20-49)  → route to credit controller
 *   BLOCKED (score 0-19)  → reject order
 *
 * Flags:
 *   CREDIT_LIMIT_EXCEEDED   error  — order exceeds available credit
 *   OVERDUE_BALANCE         error  — customer has overdue > 60 days
 *   HIGH_CREDIT_RISK        warn   — score < 50, needs manual review
 *   NEW_CUSTOMER            warn   — no payment history
 *   ADVANCE_PAYMENT_REQUIRED warn  — risk too high for credit terms
 */

const BaseAgent = require('../../../platform/core/BaseAgent');

// Order value above which a credit check is mandatory regardless of customer type
const CREDIT_CHECK_THRESHOLD = Number(process.env.CREDIT_CHECK_THRESHOLD) || 50000;

// Max overdue days before order is auto-blocked
const MAX_OVERDUE_DAYS = Number(process.env.MAX_OVERDUE_DAYS) || 90;

class CreditCheckAgent extends BaseAgent {
  constructor() {
    super('credit_check', 'o2c', {
      maxRetries:    1,
      timeoutMs:     15000,
      minConfidence: 70,
      critical:      true,
    });
  }

  async run(oco) {
    const orderTotal = oco.totals.grand_total || this._estimateOrderTotal(oco);

    // Skip credit check for advance/COD payment terms (no credit risk)
    if (['ADVANCE', 'COD'].includes(oco.order.payment_terms)) {
      oco.credit.risk_level = 'LOW';
      oco.credit.credit_score = 90;
      oco.confidence_scores.credit_check = 88;
      oco._audit('credit_check', 'credit_check_skipped',
        { reason: 'Advance/COD payment — no credit risk' });
      oco.transition('CREDIT_CHECKED', 'credit_check');
      return oco;
    }

    // Skip for small orders below threshold (configurable)
    if (orderTotal < CREDIT_CHECK_THRESHOLD && oco.customer.customer_type === 'B2C') {
      oco.credit.risk_level  = 'LOW';
      oco.credit.credit_score = 85;
      oco.confidence_scores.credit_check = 85;
      oco.transition('CREDIT_CHECKED', 'credit_check');
      return oco;
    }

    // ── Simulate fetching credit data from AR ledger ───────────────
    // In production: query AR subledger / ERP database for live data
    const creditData = this._fetchCreditData(oco.customer.id, oco.customer.gstin);

    oco.credit = {
      ...oco.credit,
      credit_limit:       creditData.credit_limit,
      credit_used:        creditData.credit_used,
      credit_available:   creditData.credit_limit - creditData.credit_used,
      outstanding_amount: creditData.outstanding_amount,
      overdue_amount:     creditData.overdue_amount,
      overdue_days:       creditData.overdue_days,
      credit_days:        creditData.credit_days,
      last_payment_date:  creditData.last_payment_date,
      payment_history:    creditData.payment_history,
    };

    // ── 1. Credit limit check ─────────────────────────────────────
    const projectedUsed = oco.credit.credit_used + orderTotal;
    if (projectedUsed > oco.credit.credit_limit) {
      const excess = projectedUsed - oco.credit.credit_limit;
      oco._flag('CREDIT_LIMIT_EXCEEDED', 'error',
        `Order exceeds credit limit by ₹${Math.round(excess).toLocaleString('en-IN')}`,
        `Credit limit: ₹${oco.credit.credit_limit.toLocaleString('en-IN')} | ` +
        `Currently used: ₹${oco.credit.credit_used.toLocaleString('en-IN')} | ` +
        `This order: ₹${Math.round(orderTotal).toLocaleString('en-IN')}`);
    }

    // ── 2. Overdue ageing check ────────────────────────────────────
    if (oco.credit.overdue_days > MAX_OVERDUE_DAYS) {
      oco._flag('OVERDUE_BALANCE', 'error',
        `Customer has ₹${oco.credit.overdue_amount.toLocaleString('en-IN')} overdue > ${MAX_OVERDUE_DAYS} days`,
        'Order should be blocked until overdue amount is cleared.');
    } else if (oco.credit.overdue_days > 30) {
      oco._flag('OVERDUE_BALANCE', 'warn',
        `Customer has overdue amount of ₹${oco.credit.overdue_amount.toLocaleString('en-IN')} (${oco.credit.overdue_days} days)`,
        'Recommend collecting overdue before shipping.');
    }

    // ── 3. Credit score calculation ───────────────────────────────
    const score = this._calculateCreditScore(oco.credit, orderTotal);
    oco.credit.credit_score = score;

    // ── 4. Risk level classification ──────────────────────────────
    if (score >= 80)      oco.credit.risk_level = 'LOW';
    else if (score >= 50) oco.credit.risk_level = 'MEDIUM';
    else if (score >= 20) oco.credit.risk_level = 'HIGH';
    else                  oco.credit.risk_level = 'BLOCKED';

    // ── 5. Flags based on risk level ──────────────────────────────
    if (oco.credit.risk_level === 'BLOCKED') {
      oco._flag('CUSTOMER_BLOCKED', 'error',
        'Credit score below minimum threshold — order blocked',
        'Escalate to credit controller. Consider advance payment terms.');
    } else if (oco.credit.risk_level === 'HIGH') {
      oco._flag('HIGH_CREDIT_RISK', 'warn',
        `Credit risk is HIGH (score: ${score})`,
        'Manual credit controller approval required before dispatch.');
      oco._flag('ADVANCE_PAYMENT_REQUIRED', 'warn',
        'Consider requesting advance or PDC (post-dated cheque)',
        'Customer payment history suggests collection risk.');
    } else if (oco.credit.risk_level === 'MEDIUM') {
      oco._flag('MEDIUM_CREDIT_RISK', 'warn',
        `Credit risk is MEDIUM (score: ${score})`,
        'Monitor closely. Consider reducing credit days for this order.');
    }

    // New customer — no history
    if (!creditData.payment_history || creditData.payment_history.length === 0) {
      oco._flag('NEW_CUSTOMER', 'warn',
        'No payment history found for this customer',
        'Consider COD or advance payment for first order.');
    }

    oco.confidence_scores.credit_check = score >= 80 ? 90 : score >= 50 ? 75 : 55;
    oco.transition('CREDIT_CHECKED', 'credit_check');
    return oco;
  }

  // ── Simulate AR ledger lookup ─────────────────────────────────
  // Production: replace with real DB query against AR subledger
  _fetchCreditData(customerId, gstin) {
    // Demo data — varies by customer segment for realistic testing
    const seed = (gstin || customerId || 'X').charCodeAt(0) % 4;
    const scenarios = [
      {
        credit_limit: 1000000, credit_used: 200000,
        outstanding_amount: 200000, overdue_amount: 0, overdue_days: 0,
        credit_days: 30, last_payment_date: new Date(Date.now() - 15 * 86400000).toISOString(),
        payment_history: [
          { month: 'Feb 2026', days_to_pay: 18, amount: 150000 },
          { month: 'Jan 2026', days_to_pay: 22, amount: 200000 },
          { month: 'Dec 2025', days_to_pay: 28, amount: 180000 },
        ],
      },
      {
        credit_limit: 500000, credit_used: 350000,
        outstanding_amount: 350000, overdue_amount: 80000, overdue_days: 45,
        credit_days: 45, last_payment_date: new Date(Date.now() - 45 * 86400000).toISOString(),
        payment_history: [
          { month: 'Feb 2026', days_to_pay: 52, amount: 80000 },
          { month: 'Jan 2026', days_to_pay: 38, amount: 120000 },
        ],
      },
      {
        credit_limit: 2000000, credit_used: 400000,
        outstanding_amount: 400000, overdue_amount: 0, overdue_days: 0,
        credit_days: 60, last_payment_date: new Date(Date.now() - 5 * 86400000).toISOString(),
        payment_history: [
          { month: 'Feb 2026', days_to_pay: 12, amount: 500000 },
          { month: 'Jan 2026', days_to_pay: 14, amount: 400000 },
          { month: 'Dec 2025', days_to_pay: 10, amount: 600000 },
          { month: 'Nov 2025', days_to_pay: 15, amount: 350000 },
        ],
      },
      {
        // New customer
        credit_limit: 100000, credit_used: 0,
        outstanding_amount: 0, overdue_amount: 0, overdue_days: 0,
        credit_days: 30, last_payment_date: null,
        payment_history: [],
      },
    ];
    return scenarios[seed];
  }

  // ── Credit score model (0-100) ────────────────────────────────
  _calculateCreditScore(credit, orderTotal) {
    let score = 100;

    // Overdue penalty
    if (credit.overdue_days > 90)     score -= 60;
    else if (credit.overdue_days > 60) score -= 40;
    else if (credit.overdue_days > 30) score -= 20;
    else if (credit.overdue_days > 0)  score -= 10;

    // Credit utilisation penalty (above 80% = risky)
    const utilisation = credit.credit_limit > 0
      ? (credit.credit_used + orderTotal) / credit.credit_limit
      : 1;
    if (utilisation > 1.0)   score -= 30;
    else if (utilisation > 0.8) score -= 15;
    else if (utilisation > 0.6) score -= 5;

    // Payment history bonus
    const history = credit.payment_history || [];
    if (history.length > 0) {
      const avgDays = history.reduce((s, h) => s + h.days_to_pay, 0) / history.length;
      if (avgDays <= credit.credit_days)           score += 5;  // consistently on time
      else if (avgDays <= credit.credit_days + 15)  score += 0;  // slightly late
      else                                          score -= 15; // habitually late
    } else {
      score -= 10; // new customer — no history
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ── Estimate total before SalesOrderAgent runs ────────────────
  _estimateOrderTotal(oco) {
    return (oco.line_items || []).reduce((sum, li) => {
      const taxable = (li.quantity || 0) * (li.unit_price || 0) * (1 - (li.discount_pct || 0) / 100);
      const gst     = taxable * ((li.gst_rate || 18) / 100);
      return sum + taxable + gst;
    }, 0);
  }
}

module.exports = CreditCheckAgent;
