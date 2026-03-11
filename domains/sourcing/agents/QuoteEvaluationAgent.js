/**
 * BHARAT ERP — Sourcing: QuoteEvaluationAgent
 *
 * Evaluates vendor quotes using a weighted scoring model:
 *   - Price (40%) — lowest price scores highest
 *   - Delivery timeline (20%) — fastest delivery scores highest
 *   - Vendor track record (25%) — from vendor master score
 *   - Payment terms (15%) — longer credit period scores higher
 *
 * Also runs AI analysis to surface non-obvious risks or opportunities.
 * Produces a ranked comparison matrix and a recommendation.
 *
 * Reuses: BaseAgent, AIService.
 */

const BaseAgent = require('../../../platform/core/BaseAgent');

const WEIGHTS = {
  price:           0.40,
  delivery:        0.20,
  vendor_track:    0.25,
  payment_terms:   0.15,
};

class QuoteEvaluationAgent extends BaseAgent {
  constructor() {
    super('quote_evaluation', 'sourcing', {
      maxRetries:    2,
      timeoutMs:     45000,
      minConfidence: 60,
      critical:      true,  // Must complete — no quotes = no PO
    });
  }

  async run(sco) {
    const quotes = sco.quotes || [];

    if (!quotes.length) {
      sco._flag('NO_QUOTES_RECEIVED', 'error',
        'No vendor quotes available for evaluation. Extend RFQ deadline or invite more vendors.',
        this.name);
      sco.confidence_scores.quote_evaluation = 0;
      sco._audit(this.name, 'NO_QUOTES', {});
      return sco;
    }

    // ── 1. Normalised scoring (0–100 per dimension) ───────────────
    const prices    = quotes.map(q => q.total_price || q.unit_price * (sco.requisition.quantity || 1));
    const minPrice  = Math.min(...prices);
    const maxPrice  = Math.max(...prices);

    const deliveries = quotes.map(q => q.delivery_days || 30);
    const minDel    = Math.min(...deliveries);
    const maxDel    = Math.max(...deliveries);

    const scored = quotes.map((q, i) => {
      const price       = prices[i];
      const delivery    = deliveries[i];

      // Price: lower is better (inverted)
      const priceScore  = maxPrice === minPrice ? 100
        : Math.round(((maxPrice - price) / (maxPrice - minPrice)) * 100);

      // Delivery: faster is better (inverted)
      const delivScore  = maxDel === minDel ? 100
        : Math.round(((maxDel - delivery) / (maxDel - minDel)) * 100);

      // Vendor track record (already 0–100 from master)
      const trackScore  = q.vendor_track_score || 75;

      // Payment terms: longer credit = better (normalise 0–90 day range → 0–100)
      const payDays     = q.payment_days || 30;
      const payScore    = Math.min(100, Math.round((payDays / 90) * 100));

      const total = Math.round(
        priceScore  * WEIGHTS.price +
        delivScore  * WEIGHTS.delivery +
        trackScore  * WEIGHTS.vendor_track +
        payScore    * WEIGHTS.payment_terms
      );

      return {
        ...q,
        total_price:     price,
        score:           total,
        score_breakdown: { priceScore, delivScore, trackScore, payScore },
        rank:            0, // will set after sort
      };
    });

    // Sort and assign ranks
    scored.sort((a, b) => b.score - a.score);
    scored.forEach((q, i) => { q.rank = i + 1; });

    // ── 2. AI analysis for non-obvious insights ───────────────────
    let aiAnalysis = null;
    try {
      const prompt = `You are a procurement expert. Analyse these vendor quotes and provide insights.

REQUISITION: ${sco.requisition.description}
Quantity: ${sco.requisition.quantity} ${sco.requisition.unit}
Budget: ₹${sco.requisition.estimated_value?.toLocaleString('en-IN') || 'Not set'}

QUOTES (already scored by algorithm):
${scored.map(q => `- ${q.vendor_name}: ₹${q.total_price?.toLocaleString('en-IN')}, ${q.delivery_days} days, Score: ${q.score}/100`).join('\n')}

Return ONLY JSON:
{
  "recommendation": "vendor_name",
  "recommendation_reason": "2-3 sentence explanation",
  "risks": ["risk1", "risk2"],
  "negotiation_tips": ["tip1", "tip2"],
  "savings_opportunity": "description of any savings opportunity",
  "confidence": 88
}`;

      const raw = await this.ai.complete(prompt, {
        maxTokens: 500,
        systemPrompt: 'Return ONLY valid JSON. No markdown.',
      });
      const clean = (raw.content || raw).replace(/```json|```/g, '').trim();
      aiAnalysis = JSON.parse(clean);
    } catch (err) {
      console.warn('[QuoteEvaluation] AI analysis failed:', err.message);
      aiAnalysis = {
        recommendation:       scored[0]?.vendor_name,
        recommendation_reason: 'Highest composite score (price + delivery + track record).',
        risks:                [],
        negotiation_tips:     [],
        savings_opportunity:  null,
        confidence:           70,
      };
    }

    // ── 3. Assign to SCO ──────────────────────────────────────────
    sco.evaluation = {
      recommended_vendor:    aiAnalysis.recommendation || scored[0]?.vendor_name,
      recommendation_reason: aiAnalysis.recommendation_reason,
      comparison_matrix:     scored,
      evaluated_at:          new Date().toISOString(),
      evaluator:             'AI',
      risks:                 aiAnalysis.risks || [],
      negotiation_tips:      aiAnalysis.negotiation_tips || [],
      savings_opportunity:   aiAnalysis.savings_opportunity,
    };

    // Update each quote with score
    sco.quotes = scored;

    // ── 4. Flag potential issues ──────────────────────────────────
    if (scored.length === 1) {
      sco._flag('SINGLE_QUOTE', 'warn',
        'Only one quote received. Consider extending RFQ for competitive pricing.', this.name);
    }

    const topPrice   = prices[scored.findIndex(q => q.rank === 1)];
    const secondPrice = prices[scored.findIndex(q => q.rank === 2)];
    if (secondPrice && topPrice && (secondPrice - topPrice) / secondPrice < 0.03) {
      sco._flag('CLOSE_COMPETITION', 'info',
        'Top 2 vendors within 3% on price — consider delivery speed as tiebreaker.', this.name);
    }

    if (sco.requisition.estimated_value && topPrice > sco.requisition.estimated_value * 1.2) {
      sco._flag('BEST_QUOTE_OVER_BUDGET', 'warn',
        `Best quote (₹${topPrice.toLocaleString('en-IN')}) exceeds budget by >20%. Review budget or negotiate.`,
        this.name);
    }

    // ── 5. Confidence ─────────────────────────────────────────────
    const conf = aiAnalysis.confidence || Math.min(95, 60 + scored.length * 10);
    sco.confidence_scores.quote_evaluation = conf;

    sco._audit(this.name, 'QUOTES_EVALUATED', {
      quotes_evaluated:    scored.length,
      recommended_vendor:  sco.evaluation.recommended_vendor,
      top_score:           scored[0]?.score,
      price_range:         { min: minPrice, max: maxPrice },
    });

    return sco;
  }
}

module.exports = QuoteEvaluationAgent;
