/**
 * BHARAT ERP — O2C: InvoiceGenerationAgent
 *
 * Generates a GST-compliant tax invoice after order confirmation:
 *   1. Assigns invoice number (INV-YYYY-NNNN, org-specific series)
 *   2. Generates simulated IRN (Invoice Reference Number) — 64-char hash
 *      Production: call IRP (Invoice Registration Portal) API
 *   3. Produces structured e-invoice payload (GSTN schema v1.1)
 *   4. Checks e-invoicing applicability (turnover > ₹5 Cr mandatory)
 *   5. Generates QR code data string (IRN + key fields)
 *   6. Sends invoice to customer via WhatsApp (reuses Sprint 3 service)
 *   7. Checks E-way bill requirement (consignment value > ₹50,000)
 *
 * Flags:
 *   EINVOICE_REQUIRED    warn  — e-invoicing mandatory for this taxpayer
 *   EWAY_BILL_REQUIRED   warn  — E-way bill needed for dispatch
 *   INVOICE_SENT         info  — WhatsApp delivery status
 */

const BaseAgent       = require('../../../platform/core/BaseAgent');
const crypto          = require('crypto');
const WhatsAppService = require('../../../platform/services/WhatsAppService');

// E-invoicing threshold (turnover > ₹5 Cr from FY 2023-24)
const EINVOICE_TURNOVER_THRESHOLD = Number(process.env.EINVOICE_THRESHOLD) || 50000000;

// E-way bill threshold (consignment value > ₹50,000)
const EWAY_BILL_THRESHOLD = 50000;

// Invoice series counter (production: MongoDB sequence)
let _invoiceSeq = 2000;
const nextInvoiceNumber = () => `INV-${new Date().getFullYear()}-${String(++_invoiceSeq).padStart(4, '0')}`;

class InvoiceGenerationAgent extends BaseAgent {
  constructor() {
    super('invoice_generation', 'o2c', {
      maxRetries:    1,
      timeoutMs:     20000,
      minConfidence: 85,
      critical:      true,
    });
  }

  async run(oco) {
    // ── 1. Assign invoice number and date ─────────────────────────
    const invoiceNumber = nextInvoiceNumber();
    const invoiceDate   = new Date().toISOString().split('T')[0];

    // ── 2. E-invoicing applicability check ────────────────────────
    const annualTurnover = Number(process.env.COMPANY_ANNUAL_TURNOVER) || 100000000; // ₹10Cr default
    const einvoiceRequired = annualTurnover >= EINVOICE_TURNOVER_THRESHOLD
      && oco.customer.customer_type !== 'B2C';

    if (einvoiceRequired) {
      oco._flag('EINVOICE_REQUIRED', 'warn',
        'E-invoicing is mandatory for this taxpayer (turnover > ₹5 Cr)',
        'IRN has been simulated. In production, call IRP API to get real IRN + ACK.');
    }

    // ── 3. Generate IRN (simulated) ───────────────────────────────
    // Real IRN = SHA-256 of: SellerGSTIN + InvoiceNumber + FY + DocType
    const irnInput = [
      oco.gst.seller_gstin,
      invoiceNumber,
      this._fiscalYear(),
      'INV',
    ].join('|');
    const irn = crypto.createHash('sha256').update(irnInput).digest('hex');

    // ── 4. ACK number and date (simulated IRP response) ───────────
    const ackNumber = Date.now().toString().substring(0, 13);
    const ackDate   = new Date().toISOString();

    // ── 5. QR code data (GSTN-prescribed format) ──────────────────
    const qrData = JSON.stringify({
      irn,
      SellerGSTIN:  oco.gst.seller_gstin,
      BuyerGSTIN:   oco.gst.buyer_gstin || 'URP',
      DocNo:        invoiceNumber,
      DocDt:        invoiceDate,
      TotInvVal:    oco.totals.grand_total,
      ItemCnt:      oco.line_items.length,
      MainHsnCode:  oco.line_items[0]?.hsn_sac || '',
    });

    // ── 6. Populate e-invoice fields on OCO ───────────────────────
    oco.einvoice = {
      irn,
      ack_number:     ackNumber,
      ack_date:       ackDate,
      qr_code:        Buffer.from(qrData).toString('base64'),
      invoice_number: invoiceNumber,
      invoice_date:   invoiceDate,
      signed_invoice: this._buildInvoicePayload(oco, invoiceNumber, invoiceDate, irn),
    };

    // ── 7. E-way bill check ───────────────────────────────────────
    const consignmentValue = oco.totals.grand_total;
    if (consignmentValue > EWAY_BILL_THRESHOLD
      && oco.order.shipping_mode !== 'COURIER') {
      oco.dispatch.eway_bill_no = `EWB-${Date.now()}`; // simulated
      oco._flag('EWAY_BILL_REQUIRED', 'warn',
        `E-way bill required — consignment value ₹${Math.round(consignmentValue).toLocaleString('en-IN')} > ₹50,000`,
        'E-way bill has been auto-generated. Attach to vehicle before dispatch.');
    }

    // ── 8. Send invoice via WhatsApp ──────────────────────────────
    if (oco.customer.contact_phone) {
      try {
        const waNumber = oco.customer.contact_phone.startsWith('whatsapp:')
          ? oco.customer.contact_phone
          : `whatsapp:+91${oco.customer.contact_phone.replace(/\D/g, '').slice(-10)}`;

        const msg = [
          `🧾 *Tax Invoice — ${invoiceNumber}*`,
          `📅 Date: ${invoiceDate}`,
          ``,
          `*Bill To:* ${oco.customer.name}`,
          oco.customer.gstin ? `*GSTIN:* ${oco.customer.gstin}` : '',
          ``,
          `*Items:* ${oco.line_items.length} line item(s)`,
          `*Taxable Value:* ₹${oco.totals.taxable_value.toLocaleString('en-IN')}`,
          `*GST (${oco.gst.type}):* ₹${oco.totals.total_gst.toLocaleString('en-IN')}`,
          oco.totals.tcs_amount ? `*TCS u/s 206C:* ₹${oco.totals.tcs_amount.toLocaleString('en-IN')}` : '',
          `*Total Amount:* ₹${oco.totals.grand_total.toLocaleString('en-IN')}`,
          ``,
          `*IRN:* ${irn.substring(0, 16)}...`,
          `*Payment Due:* ${oco.order.delivery_date || 'As per terms'}`,
          ``,
          `Thank you for your business! 🙏`,
        ].filter(Boolean).join('\n');

        await WhatsAppService.send(waNumber, msg);
        oco._flag('INVOICE_SENT', 'info',
          `Invoice ${invoiceNumber} sent via WhatsApp to ${oco.customer.contact_phone}`,
          null);
      } catch (err) {
        oco._flag('INVOICE_NOTIF_FAILED', 'warn',
          'WhatsApp invoice notification failed',
          err.message);
      }
    }

    oco.confidence_scores.invoice_generation = einvoiceRequired ? 88 : 92;
    oco.transition('INVOICE_GENERATED', 'invoice_generation');
    return oco;
  }

  // ── Build GSTN e-invoice schema payload ───────────────────────
  _buildInvoicePayload(oco, invoiceNumber, invoiceDate, irn) {
    return {
      Version:  '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: oco.customer.customer_type === 'EXPORT' ? 'EXPWOP' : 'B2B',
        RegRev: oco.gst.reverse_charge ? 'Y' : 'N',
      },
      DocDtls: {
        Typ:  'INV',
        No:   invoiceNumber,
        Dt:   invoiceDate,
      },
      SellerDtls: {
        Gstin: oco.gst.seller_gstin,
        TrdNm: process.env.COMPANY_NAME || 'Upskill Global Technologies Pvt Ltd',
        Addr1: process.env.COMPANY_ADDRESS || '123 MG Road, Bengaluru',
        Loc:   'Bengaluru',
        Pin:   560001,
        Stcd:  '29',
      },
      BuyerDtls: {
        Gstin: oco.customer.gstin || 'URP',
        TrdNm: oco.customer.name,
        Addr1: oco.customer.billing_address,
        Loc:   oco.customer.shipping_address || oco.customer.billing_address,
        Stcd:  oco.customer.state_code || '29',
      },
      ItemList: oco.line_items.map((li, i) => ({
        SlNo:    String(i + 1),
        PrdDesc: li.description,
        HsnCd:   li.hsn_sac,
        Qty:     li.quantity,
        Unit:    (li.unit || 'NOS').toUpperCase().substring(0, 3),
        UnitPrice: li.unit_price,
        Discount:  li.discount_pct ? (li.unit_price * li.quantity * li.discount_pct / 100) : 0,
        AssAmt:  li.taxable_value,
        GstRt:   li.gst_rate,
        CgstAmt: li.cgst || 0,
        SgstAmt: li.sgst || 0,
        IgstAmt: li.igst || 0,
        TotItemVal: li.total_amount,
      })),
      ValDtls: {
        AssVal:  oco.totals.taxable_value,
        CgstVal: oco.totals.cgst,
        SgstVal: oco.totals.sgst,
        IgstVal: oco.totals.igst,
        TcsTaxableAmt: oco.gst.tcs_applicable ? oco.totals.taxable_value : 0,
        TcsRate:       oco.gst.tcs_applicable ? oco.gst.tcs_rate : 0,
        TcsVal:        oco.totals.tcs_amount,
        TotInvVal:     oco.totals.grand_total,
      },
      EwbDtls: oco.dispatch.eway_bill_no ? {
        EwbNo:  oco.dispatch.eway_bill_no,
        EwbDt:  new Date().toISOString(),
        VehNo:  oco.dispatch.vehicle_no || null,
        VehType: 'R',
      } : undefined,
      Irn: irn,
      AckNo:  Date.now(),
      AckDt:  new Date().toISOString(),
    };
  }

  _fiscalYear() {
    const now = new Date();
    const fy  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${fy}-${String(fy + 1).slice(2)}`;
  }
}

module.exports = InvoiceGenerationAgent;
