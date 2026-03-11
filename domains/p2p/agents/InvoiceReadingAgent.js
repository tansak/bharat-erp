/**
 * BHARAT ERP — Invoice Reading Agent (P2P Domain)
 * Reads invoices from any format and extracts structured data.
 * Extends BaseAgent — inherits retry, timeout, logging for free.
 */
const BaseAgent = require('../../../platform/core/BaseAgent');

class InvoiceReadingAgent extends BaseAgent {
  constructor() {
    super('invoice_reading', 'p2p', {
      maxRetries:    2,
      timeoutMs:     45000,  // OCR-heavy invoices can be slow
      minConfidence: 65,
      critical:      true,   // Pipeline cannot continue without extraction
    });
  }

  async run(obj) {
    const rawContent = obj.source_content || '';

    // Call Claude to extract all invoice fields
    const extracted = await this.callAIForJSON(
      this._systemPrompt(),
      `Extract all fields from this invoice:\n\n${rawContent}`
    );

    // Write findings to canonical object
    obj.enrich(this.name, extracted, extracted.confidence || 75);
    obj.transition('extracted', this.name);

    // Add compliance-relevant flags immediately
    if (!extracted.vendor?.gstin) {
      obj.addFlag('warn', this.name, 'GSTIN missing',
        'Vendor GSTIN not found on invoice', 'Verify with vendor');
    }
    if (!extracted.po_reference) {
      obj.addFlag('warn', this.name, 'PO reference missing',
        'No PO number on invoice', 'Confirm if advance purchase');
    }
    if (!extracted.invoice_number) {
      obj.addFlag('error', this.name, 'Invoice number missing',
        'Cannot process invoice without a unique invoice number', 'Request corrected invoice from vendor');
    }
    if (extracted.total_amount > parseInt(process.env.AUTO_APPROVAL_LIMIT || '100000')) {
      obj.addFlag('info', this.name, 'High-value invoice',
        `Amount ₹${extracted.total_amount?.toLocaleString('en-IN')} exceeds auto-approval limit`, null);
    }
  }

  _systemPrompt() {
    return `You are an expert Indian B2B invoice reading agent for Bharat ERP.
Extract ALL structured data from the invoice and return ONLY valid JSON.
No markdown fences. No explanations. Pure JSON only.

Return this exact structure:
{
  "confidence": <0-100, based on data completeness and clarity>,
  "invoice_number": "",
  "invoice_date": "DD-MMM-YYYY",
  "due_date": "DD-MMM-YYYY",
  "payment_terms": "",
  "po_reference": "",
  "vendor": {
    "name": "", "gstin": "", "pan": "",
    "address": "", "email": "", "phone": "",
    "bank_name": "", "account_number": "", "ifsc": ""
  },
  "buyer": { "name": "", "gstin": "", "address": "" },
  "line_items": [
    {
      "sr": 1, "description": "", "hsn_sac": "",
      "quantity": 0, "unit": "Nos", "unit_price": 0,
      "gst_rate": 18, "amount": 0
    }
  ],
  "gst_breakdown": [
    { "type": "CGST|SGST|IGST", "rate": 9, "amount": 0 }
  ],
  "tds": { "applicable": false, "section": "", "rate": 0, "amount": 0 },
  "subtotal": 0,
  "total_gst": 0,
  "total_amount": 0,
  "amount_in_words": "",
  "irn": "",
  "qr_code_present": false
}

Set confidence based on: all key fields present (invoice_no, amounts, GSTIN) = 90+.
Missing GSTIN or amounts = 60-75. Severely incomplete = below 60.`;
  }
}

module.exports = InvoiceReadingAgent;
