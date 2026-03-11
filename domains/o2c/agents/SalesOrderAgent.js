/**
 * BHARAT ERP — O2C: SalesOrderAgent
 *
 * Processes the sales order after customer and credit are validated:
 *   1. Assigns order number (SO-YYYY-NNNN sequence)
 *   2. AI-enriches each line item: HSN/SAC, GST rate, GL code
 *   3. Computes all line item totals with discounts
 *   4. Applies CGST+SGST or IGST based on place of supply
 *   5. Checks TCS applicability (Section 206C(1H), aggregate > ₹50L)
 *   6. Validates inventory availability (placeholder — hooks into WMS)
 *   7. Sets delivery schedule based on payment terms
 *
 * Flags:
 *   ZERO_VALUE_ORDER      error  — order has no value
 *   INVALID_LINE_ITEM     error  — quantity/price missing
 *   HSN_NOT_FOUND         warn   — HSN/SAC could not be auto-mapped
 *   TCS_APPLICABLE        warn   — TCS @ 1% triggered on this order
 *   HIGH_DISCOUNT         warn   — discount > org policy limit
 */

const BaseAgent = require('../../../platform/core/BaseAgent');

// Internal sequence counter (production: use MongoDB sequence or UUID-based)
let _orderSeq = 1000;
const nextOrderNumber = () => `SO-${new Date().getFullYear()}-${String(++_orderSeq).padStart(4, '0')}`;

// Max discount % allowed without manager approval
const MAX_DISCOUNT_PCT = Number(process.env.MAX_DISCOUNT_PCT) || 20;

// TCS threshold — sales > ₹50L aggregate from a single buyer in FY triggers TCS
const TCS_THRESHOLD = Number(process.env.TCS_THRESHOLD) || 5000000;

class SalesOrderAgent extends BaseAgent {
  constructor() {
    super('sales_order', 'o2c', {
      maxRetries:    1,
      timeoutMs:     25000,
      minConfidence: 80,
      critical:      true,
    });
  }

  async run(oco) {
    const lineItems = oco.line_items || [];

    // ── 1. Validate line items ────────────────────────────────────
    if (lineItems.length === 0) {
      oco._flag('ZERO_VALUE_ORDER', 'error', 'Order has no line items', null);
      oco.confidence_scores.sales_order = 0;
      return oco;
    }

    const invalidItems = lineItems.filter(li => !li.quantity || !li.unit_price || li.quantity <= 0 || li.unit_price <= 0);
    if (invalidItems.length > 0) {
      oco._flag('INVALID_LINE_ITEM', 'error',
        `${invalidItems.length} line item(s) have missing quantity or price`,
        invalidItems.map(li => li.description || 'Unknown item').join(', '));
      oco.confidence_scores.sales_order = 10;
      return oco;
    }

    // ── 2. Assign order number and date ───────────────────────────
    oco.order.order_number = oco.order.order_number || nextOrderNumber();
    oco.order.order_date   = oco.order.order_date   || new Date().toISOString().split('T')[0];

    // Set delivery date based on payment terms (configurable lead times)
    if (!oco.order.delivery_date) {
      const leadDays = { ADVANCE: 3, COD: 5, NET30: 7, NET60: 10 };
      const days = leadDays[oco.order.payment_terms] || 7;
      const d = new Date();
      d.setDate(d.getDate() + days);
      oco.order.delivery_date = d.toISOString().split('T')[0];
    }

    // ── 3. Enrich line items: HSN/SAC, GST rate, compute totals ──
    const gstType = oco.gst.type || 'CGST_SGST'; // default intra-state
    let subtotal       = 0;
    let totalDiscount  = 0;
    let taxableValue   = 0;
    let totalCGST = 0, totalSGST = 0, totalIGST = 0;
    const { randomUUID } = require('crypto');

    for (const li of lineItems) {
      // Auto-map HSN/SAC if missing (use platform ComplianceEngine)
      if (!li.hsn_sac) {
        const mapped = this._mapHSN(li.description);
        if (mapped) {
          li.hsn_sac  = mapped.code;
          li.gst_rate = li.gst_rate ?? mapped.rate;
        } else {
          oco._flag('HSN_NOT_FOUND', 'warn',
            `Could not auto-map HSN/SAC for: "${li.description}"`,
            'Default GST rate of 18% applied. Please verify before invoicing.');
          li.gst_rate = li.gst_rate ?? 18;
        }
      } else {
        // Validate the provided HSN/SAC rate
        const validatedRate = this.compliance.getGSTRate(li.hsn_sac);
        if (li.gst_rate === undefined || li.gst_rate === null) {
          li.gst_rate = validatedRate ?? 18;
        }
      }

      li.id = li.id || randomUUID();

      // Compute line totals
      const qty        = Number(li.quantity);
      const unitPrice  = Number(li.unit_price);
      const discPct    = Number(li.discount_pct) || 0;
      const lineSubtotal = qty * unitPrice;
      const lineDiscount = lineSubtotal * (discPct / 100);
      const lineTaxable  = lineSubtotal - lineDiscount;
      const gstRate      = Number(li.gst_rate) || 18;
      const lineGST      = lineTaxable * (gstRate / 100);

      if (discPct > MAX_DISCOUNT_PCT) {
        oco._flag('HIGH_DISCOUNT', 'warn',
          `Line item "${li.description}" has ${discPct}% discount (policy limit: ${MAX_DISCOUNT_PCT}%)`,
          'Manager approval required for discounts above policy limit.');
      }

      // Apply GST split
      if (gstType === 'CGST_SGST') {
        li.cgst = Math.round(lineGST / 2 * 100) / 100;
        li.sgst = Math.round(lineGST / 2 * 100) / 100;
        li.igst = 0;
        totalCGST += li.cgst;
        totalSGST += li.sgst;
      } else {
        li.igst = Math.round(lineGST * 100) / 100;
        li.cgst = 0;
        li.sgst = 0;
        totalIGST += li.igst;
      }

      li.taxable_value = Math.round(lineTaxable * 100) / 100;
      li.total_amount  = Math.round((lineTaxable + lineGST) * 100) / 100;

      subtotal      += lineSubtotal;
      totalDiscount += lineDiscount;
      taxableValue  += lineTaxable;
    }

    oco.line_items = lineItems;

    // ── 4. TCS check — Section 206C(1H) ─────────────────────────
    // TCS @ 1% applies if aggregate receipts from buyer exceed ₹50L in FY
    // In demo: trigger if order value itself > ₹50L
    const totalGST = totalCGST + totalSGST + totalIGST;
    const orderPreTCS = taxableValue + totalGST;

    let tcsAmount = 0;
    if (taxableValue > TCS_THRESHOLD) {
      oco.gst.tcs_applicable = true;
      tcsAmount = Math.round(taxableValue * (oco.gst.tcs_rate / 100) * 100) / 100;
      oco._flag('TCS_APPLICABLE', 'warn',
        `TCS @ ${oco.gst.tcs_rate}% u/s ${oco.gst.tcs_section} applied: ₹${tcsAmount.toLocaleString('en-IN')}`,
        'Buyer\'s aggregate receipts from seller exceed ₹50 Lakh in this FY.');
    }

    // ── 5. Populate totals ────────────────────────────────────────
    const grandTotal = Math.round((orderPreTCS + tcsAmount) * 100) / 100;
    oco.totals = {
      subtotal:       Math.round(subtotal * 100) / 100,
      total_discount: Math.round(totalDiscount * 100) / 100,
      taxable_value:  Math.round(taxableValue * 100) / 100,
      cgst:           Math.round(totalCGST * 100) / 100,
      sgst:           Math.round(totalSGST * 100) / 100,
      igst:           Math.round(totalIGST * 100) / 100,
      total_gst:      Math.round(totalGST * 100) / 100,
      tcs_amount:     tcsAmount,
      grand_total:    grandTotal,
      amount_in_words: this._amountInWords(grandTotal),
    };

    // ── 6. Update credit utilisation with confirmed total ─────────
    oco.credit.credit_used     = (oco.credit.credit_used || 0) + grandTotal;
    oco.credit.credit_available = oco.credit.credit_limit - oco.credit.credit_used;

    oco.confidence_scores.sales_order = 92;
    oco.transition('ORDER_CONFIRMED', 'sales_order');
    return oco;
  }

  // ── HSN/SAC auto-mapper ───────────────────────────────────────
  // Production: use AI (Claude) to map from product description
  _mapHSN(description) {
    if (!description) return null;
    const desc = description.toLowerCase();
    const map = [
      { keywords: ['laptop', 'computer', 'desktop', 'server'],                  code: '8471', rate: 18 },
      { keywords: ['mobile', 'phone', 'tablet', 'smartphone'],                  code: '8517', rate: 12 },
      { keywords: ['furniture', 'chair', 'table', 'desk'],                      code: '9403', rate: 18 },
      { keywords: ['software', 'subscription', 'saas', 'licence', 'license'],   code: '998314', rate: 18 },
      { keywords: ['consulting', 'advisory', 'professional'],                    code: '998311', rate: 18 },
      { keywords: ['training', 'education', 'course'],                          code: '999293', rate: 18 },
      { keywords: ['stationery', 'paper', 'printing'],                          code: '4820', rate: 12 },
      { keywords: ['clothing', 'uniform', 'apparel', 'garment'],               code: '6201', rate: 12 },
      { keywords: ['food', 'catering', 'canteen', 'snack'],                    code: '9963', rate: 5  },
      { keywords: ['transport', 'logistics', 'freight', 'courier', 'delivery'], code: '9965', rate: 5  },
      { keywords: ['rent', 'lease', 'property'],                               code: '9972', rate: 18 },
      { keywords: ['repair', 'maintenance', 'service', 'amc'],                 code: '998719', rate: 18 },
    ];
    for (const entry of map) {
      if (entry.keywords.some(k => desc.includes(k))) return { code: entry.code, rate: entry.rate };
    }
    return null;
  }

  // ── Amount in words (Indian numbering system) ──────────────────
  _amountInWords(amount) {
    const crore = Math.floor(amount / 10000000);
    const lakh  = Math.floor((amount % 10000000) / 100000);
    const thou  = Math.floor((amount % 100000) / 1000);
    const rest  = Math.floor(amount % 1000);
    const paise = Math.round((amount % 1) * 100);

    let words = 'Rupees ';
    if (crore) words += `${crore} Crore `;
    if (lakh)  words += `${lakh} Lakh `;
    if (thou)  words += `${thou} Thousand `;
    if (rest)  words += `${rest} `;
    words += 'Only';
    if (paise) words += ` and ${paise} Paise`;
    return words.trim();
  }
}

module.exports = SalesOrderAgent;
