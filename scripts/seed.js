/**
 * BHARAT ERP — Seed Script (Sprint 2)
 *
 * Seeds a realistic Indian company dataset:
 *   - 1 tenant: "Upskill Global Technologies Pvt Ltd"
 *   - 12 vendors (mix of MSME, professional services, goods suppliers)
 *   - 15 purchase orders
 *   - 10 GRNs
 *   - 40 processed invoices (various statuses, realistic distribution)
 *
 * Usage:
 *   MONGODB_URI=mongodb+srv://... node scripts/seed.js
 *   node scripts/seed.js                    (uses localhost)
 *   node scripts/seed.js --clear            (wipe + reseed)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { v4: uuid } = require('uuid');

const { VendorModel }    = require('../platform/models/MasterDataModels');
const { PurchaseOrder, GoodsReceiptNote, ProcessedInvoice } = require('../domains/p2p/models/P2PModels');

const TENANT = 'demo-corp';
const CLEAR  = process.argv.includes('--clear');

// ── helpers ───────────────────────────────────────────────────────
const r  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const rp = arr => arr[Math.floor(Math.random()*arr.length)];
const daysAgo = n => new Date(Date.now() - n*86400000);
const fmt = n => Math.round(n * 100) / 100;

// ── VENDOR DATA ───────────────────────────────────────────────────
const VENDORS = [
  {
    name: 'Infosys BPO Limited',
    gstin: '29AABCI5678K1ZM',
    pan: 'AABCI5678K',
    tds_category: 'professional',
    status: 'approved',
    msme_registered: false,
    email: 'ap@infosysbpo.com',
    phone: '08040953535',
    address: { line1: 'Electronics City', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560100', country: 'India' },
    bank: { name: 'HDFC Bank', account_number: '50200012345678', ifsc: 'HDFC0001234' },
    on_time_rate: 97, invoice_accuracy: 99, annual_spend: 2400000,
  },
  {
    name: 'Amazon Web Services India Pvt Ltd',
    gstin: '29AABCA3964M1Z8',
    pan: 'AABCA3964M',
    tds_category: 'technical_services',
    status: 'approved',
    msme_registered: false,
    email: 'aws-india-billing@amazon.com',
    phone: '18004252337',
    address: { line1: 'World Trade Center', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560001' },
    bank: { name: 'Citibank', account_number: '0114391234', ifsc: 'CITI0000001' },
    on_time_rate: 100, invoice_accuracy: 100, annual_spend: 1800000,
  },
  {
    name: 'Apex Office Supplies Pvt Ltd',
    gstin: '29AABCA9876R1ZP',
    pan: 'AABCA9876R',
    tds_category: 'none',
    status: 'approved',
    msme_registered: true,
    msme_number: 'UDYAM-KA-29-0012345',
    email: 'billing@apexoffice.in',
    phone: '08023456789',
    address: { line1: 'Rajajinagar', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560010' },
    bank: { name: 'SBI', account_number: '38112345678', ifsc: 'SBIN0040278' },
    on_time_rate: 88, invoice_accuracy: 94, annual_spend: 480000,
  },
  {
    name: 'TechPark Facility Management',
    gstin: '29AABCT1234F1ZQ',
    pan: 'AABCT1234F',
    tds_category: 'contractor',
    status: 'approved',
    msme_registered: true,
    msme_number: 'UDYAM-KA-29-0098765',
    email: 'invoices@techparkfm.com',
    phone: '08044556677',
    address: { line1: 'Whitefield', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560066' },
    bank: { name: 'Canara Bank', account_number: '1234500012345', ifsc: 'CNRB0001234' },
    on_time_rate: 82, invoice_accuracy: 91, annual_spend: 720000,
  },
  {
    name: 'Wipro Infrastructure Engineering',
    gstin: '29AAACW0017B1ZN',
    pan: 'AAACW0017B',
    tds_category: 'technical_services',
    status: 'approved',
    msme_registered: false,
    email: 'accounts@wipro-infra.com',
    phone: '08028440011',
    address: { line1: 'Sarjapur Road', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560034' },
    bank: { name: 'Axis Bank', account_number: '911010012345678', ifsc: 'UTIB0001234' },
    on_time_rate: 95, invoice_accuracy: 98, annual_spend: 1200000,
  },
  {
    name: 'Mahindra Logistics Limited',
    gstin: '27AABCM7068E1ZA',
    pan: 'AABCM7068E',
    tds_category: 'contractor',
    status: 'approved',
    msme_registered: false,
    email: 'billing@mahindralogistics.com',
    phone: '02261526000',
    address: { line1: 'Worli', city: 'Mumbai', state: 'Maharashtra', state_code: '27', pincode: '400018' },
    bank: { name: 'ICICI Bank', account_number: '628705012345', ifsc: 'ICIC0006287' },
    on_time_rate: 91, invoice_accuracy: 96, annual_spend: 960000,
  },
  {
    name: 'Zoho Corporation Pvt Ltd',
    gstin: '33AABCZ0089A1ZB',
    pan: 'AABCZ0089A',
    tds_category: 'professional',
    status: 'approved',
    msme_registered: false,
    email: 'billing@zohocorp.com',
    phone: '04467447070',
    address: { line1: 'Estancia IT Park', city: 'Chennai', state: 'Tamil Nadu', state_code: '33', pincode: '603202' },
    bank: { name: 'Kotak Mahindra Bank', account_number: '0212345678', ifsc: 'KKBK0001234' },
    on_time_rate: 100, invoice_accuracy: 100, annual_spend: 360000,
  },
  {
    name: 'Digital Print Solutions',
    gstin: '29AABCD5432G1ZR',
    pan: 'AABCD5432G',
    tds_category: 'none',
    status: 'approved',
    msme_registered: true,
    msme_number: 'UDYAM-KA-29-0055555',
    email: 'dps@digitalprintsolutions.in',
    phone: '08041234567',
    address: { line1: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560034' },
    bank: { name: 'Union Bank', account_number: '123456789012', ifsc: 'UBIN0534609' },
    on_time_rate: 78, invoice_accuracy: 88, annual_spend: 240000,
  },
  {
    name: 'Reliance Jio Infocomm Limited',
    gstin: '27AABCR9875A1ZP',
    pan: 'AABCR9875A',
    tds_category: 'none',
    status: 'approved',
    msme_registered: false,
    email: 'enterprise@jio.com',
    phone: '18008901977',
    address: { line1: 'Maker Chambers', city: 'Mumbai', state: 'Maharashtra', state_code: '27', pincode: '400021' },
    bank: { name: 'SBI', account_number: '38912345678', ifsc: 'SBIN0000300' },
    on_time_rate: 100, invoice_accuracy: 100, annual_spend: 144000,
  },
  {
    name: 'Tata Consultancy Services Limited',
    gstin: '27AAACT2909A1ZB',
    pan: 'AAACT2909A',
    tds_category: 'professional',
    status: 'approved',
    msme_registered: false,
    email: 'accounts@tcs.com',
    phone: '02267789999',
    address: { line1: 'TCS House', city: 'Mumbai', state: 'Maharashtra', state_code: '27', pincode: '400093' },
    bank: { name: 'HDFC Bank', account_number: '50100012345678', ifsc: 'HDFC0000060' },
    on_time_rate: 99, invoice_accuracy: 99, annual_spend: 3600000,
  },
  {
    name: 'Karnataka Power Corp Supplies',
    gstin: '29AABCK4321H1ZS',
    pan: 'AABCK4321H',
    tds_category: 'none',
    status: 'pending',
    msme_registered: true,
    email: 'kpcs@gmail.com',
    phone: '08033221100',
    address: { line1: 'Vijayanagar', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560040' },
    bank: { name: 'KVB', account_number: '1720135000012', ifsc: 'KVBL0001720' },
    on_time_rate: 70, invoice_accuracy: 82, annual_spend: 0,
  },
  {
    name: 'GenX Software Services',
    gstin: '29XXXXX9999X1ZX',  // invalid — will fail validation
    pan: 'XXXXX9999X',
    tds_category: 'professional',
    status: 'blacklisted',
    msme_registered: false,
    email: 'contact@genx.biz',
    phone: '09999999999',
    address: { line1: 'Unknown', city: 'Unknown', state: 'Karnataka', state_code: '29', pincode: '560000' },
    bank: { name: 'Unknown', account_number: '000000000', ifsc: 'XXXX0000000' },
    on_time_rate: 0, invoice_accuracy: 0, annual_spend: 0,
  },
];

// ── INVOICE SAMPLES (realistic texts) ─────────────────────────────
const INVOICE_TEXTS = [
  `TAX INVOICE
Invoice No: INV-2026-0892
Date: 15-Feb-2026
Due Date: 15-Mar-2026

FROM:
Infosys BPO Limited
Electronics City, Bengaluru - 560100
GSTIN: 29AABCI5678K1ZM
PAN: AABCI5678K

TO:
Upskill Global Technologies Pvt Ltd
Koramangala, Bengaluru - 560034
GSTIN: 29AABCU9603R1ZX

PO Reference: PO-2026-0021

Description                          SAC      Qty  Rate      Amount
AI Training Data Annotation Service  998314    1   45000.00   45000.00
Cloud Infrastructure Management      998315    1   35000.00   35000.00
Monthly Support Retainer             998313    1   20000.00   20000.00

Subtotal:                                                    100000.00
CGST @9%:                                                     9000.00
SGST @9%:                                                     9000.00
Total:                                                       118000.00
TDS @10% u/s 194J:                                           10000.00
Net Payable:                                                 108000.00

Bank: HDFC Bank | A/c: 50200012345678 | IFSC: HDFC0001234`,

  `INVOICE
Invoice Number: AWS-IN-20260215-4821
Billing Period: 01-Feb-2026 to 28-Feb-2026
Invoice Date: 01-Mar-2026

Bill From:
Amazon Web Services India Private Limited
World Trade Center, Bengaluru
GSTIN: 29AABCA3964M1Z8

Bill To:
Upskill Global Technologies Pvt Ltd
GSTIN: 29AABCU9603R1ZX

Usage Summary:
EC2 Instances (t3.medium x 4)        HSN 998315   1   32400.00   32400.00
RDS PostgreSQL Storage (500GB)        HSN 998315   1   18600.00   18600.00
CloudFront CDN (500GB transfer)       HSN 998315   1    8200.00    8200.00
S3 Storage (2TB)                      HSN 998315   1    4800.00    4800.00

Subtotal: INR 64,000.00
IGST @18%: INR 11,520.00
Total: INR 75,520.00`,

  `TAX INVOICE
Invoice No: AOS/26-27/0112
Date: 10-Mar-2026

Apex Office Supplies Pvt Ltd
Rajajinagar, Bengaluru
GSTIN: 29AABCA9876R1ZP
MSME Reg: UDYAM-KA-29-0012345

To: Upskill Global Technologies Pvt Ltd
GSTIN: 29AABCU9603R1ZX
PO: PO-2026-0034

Item                    HSN    Qty  Rate    Amount
A4 Paper Ream 75gsm    4802   50   350.00   17500.00
Whiteboard Markers      9608   20   120.00    2400.00
Laptop Bags 15"        4202   10   850.00    8500.00
Stapler Heavy Duty     8305    5   450.00    2250.00
Printer Cartridges     8443    8  1200.00    9600.00

Subtotal: 40,250.00
CGST @9%: 3,622.50
SGST @9%: 3,622.50
Total: 47,495.00`,

  `PROFESSIONAL SERVICES INVOICE
Invoice: TCS-MH-2026-18745
Date: 28-Feb-2026
Due: 28-Mar-2026

Tata Consultancy Services Limited
TCS House, Mumbai
GSTIN: 27AAACT2909A1ZB

To:
Upskill Global Technologies Pvt Ltd
Bengaluru
GSTIN: 29AABCU9603R1ZX

PO Reference: PO-2026-0008

Software Architecture Consulting    998313   20 days  8500.00   170000.00
AI/ML Implementation Support       998313    5 days  8500.00    42500.00
Technical Documentation             998313    2 days  8500.00    17000.00

Subtotal: 229,500.00
IGST @18% (Interstate): 41,310.00
Gross Total: 270,810.00
TDS Deductible u/s 194J @10%: 22,950.00
Net Amount Payable: 247,860.00

NEFT/RTGS: HDFC Bank | Acc: 50100012345678 | IFSC: HDFC0000060`,
];

// ── Build seed invoices ───────────────────────────────────────────
function makeProcessedInvoice(i, vendors) {
  const vendor = vendors[i % vendors.length];
  const statuses = ['approved','approved','approved','payment_scheduled','payment_scheduled',
                    'pending_approval','exception','on_hold'];
  const status = statuses[i % statuses.length];
  const amount = r(15000, 850000);
  const tdsRate = ['professional','technical_services'].includes(vendor.tds_category) ? 0.10 :
                  vendor.tds_category === 'contractor' ? 0.02 : 0;
  const tds = Math.round(amount * tdsRate);
  const vv  = r(72,98), pm = r(65,96), gm = r(60,97), co = r(78,99);
  const threeWay = Math.round(vv*0.20 + pm*0.35 + gm*0.30 + co*0.15);
  const fraud = status === 'on_hold' ? r(42,79) : status === 'exception' ? r(22,44) : r(2,16);
  const created = daysAgo(r(0, 45));

  const flags = [];
  if (status === 'exception') {
    flags.push({ severity: 'error', agent: 'grn_matching', title: '3-way match failed',
                 detail: 'GRN quantity mismatch with invoice line items', action: 'Contact vendor' });
  }
  if (status === 'on_hold') {
    flags.push({ severity: 'error', agent: 'fraud_detection', title: 'Duplicate invoice detected',
                 detail: `Similar invoice from ${vendor.name} processed within 30 days`, action: 'Verify with vendor' });
  }
  if (status === 'pending_approval') {
    flags.push({ severity: 'warn', agent: 'auto_approval', title: 'Exceeds auto-approval limit',
                 detail: `₹${amount.toLocaleString('en-IN')} > auto-approval threshold`, action: 'Finance Manager review' });
  }
  if (vendor.msme_registered) {
    const daysLeft = r(3, 40);
    if (daysLeft < 15) {
      flags.push({ severity: 'warn', agent: 'compliance', title: 'MSME payment deadline approaching',
                   detail: `Payment due in ${daysLeft} days (45-day rule)`, action: 'Prioritise payment' });
    }
  }

  return {
    tenant_id:      TENANT,
    canonical_id:   uuid(),
    invoice_number: `INV-2026-${String(1000 + i).padStart(4,'0')}`,
    invoice_date:   daysAgo(r(1, 45)),
    vendor_name:    vendor.name,
    vendor_gstin:   vendor.gstin,
    po_number:      `PO-2026-${String(r(1,40)).padStart(4,'0')}`,
    total_amount:   amount,
    tds_amount:     tds,
    net_payable:    amount - tds,
    status,
    three_way_score: threeWay,
    fraud_score:    fraud,
    pipeline_ms:    r(8000, 72000),
    decision: {
      action:     status === 'approved' || status === 'payment_scheduled' ? 'approve'
                : status === 'exception' || status === 'on_hold'          ? 'hold'
                : 'escalate',
      reason: status === 'approved'    ? `Confidence ${threeWay}% meets autonomous threshold`
            : status === 'exception'   ? 'Error flags require human review'
            : status === 'on_hold'     ? `Fraud risk score ${fraud} above threshold`
            : `Amount ₹${amount.toLocaleString('en-IN')} exceeds auto-approval limit`,
      confidence: threeWay,
      timestamp: created,
    },
    flags,
    domain_data: {
      vendor_validation: { approved: vendor.status === 'approved', vendor: { name: vendor.name, gstin: vendor.gstin }, confidence: vv },
      po_matching:       { matched: true, confidence: pm },
      grn_matching:      { matched: status !== 'exception', confidence: gm },
      compliance:        { gst_valid: true, tds: { applicable: tdsRate > 0, rate: tdsRate*100, amount: tds }, confidence: co },
      fraud_detection:   { risk_score: fraud, signals: [] },
    },
    audit_trail: [
      { ts: new Date(created.getTime()),          actor: 'p2p_orchestrator',   action: 'pipeline_started',    detail: 'Invoice received' },
      { ts: new Date(created.getTime() + 2000),   actor: 'invoice_reading',    action: 'extraction_complete', detail: `Confidence 92%` },
      { ts: new Date(created.getTime() + 4000),   actor: 'vendor_validation',  action: 'vendor_validated',    detail: vendor.name },
      { ts: new Date(created.getTime() + 4000),   actor: 'po_matching',        action: 'po_matched',          detail: `Confidence ${pm}%` },
      { ts: new Date(created.getTime() + 8000),   actor: 'grn_matching',       action: 'grn_checked',         detail: `Confidence ${gm}%` },
      { ts: new Date(created.getTime() + 10000),  actor: 'compliance',         action: 'compliance_checked',  detail: tds > 0 ? `TDS ₹${tds.toLocaleString('en-IN')}` : 'No TDS applicable' },
      { ts: new Date(created.getTime() + 12000),  actor: 'fraud_detection',    action: 'fraud_scored',        detail: `Risk ${fraud}/100` },
      { ts: new Date(created.getTime() + 14000),  actor: 'auto_approval',      action: `decision_${status}`,  detail: `Score ${threeWay}%` },
    ],
    createdAt: created,
    updatedAt: new Date(created.getTime() + 15000),
  };
}

// ── SEED PURCHASE ORDERS ──────────────────────────────────────────
function makePO(i, vendor) {
  const amount = r(50000, 500000);
  return {
    tenant_id:    TENANT,
    po_number:    `PO-2026-${String(i+1).padStart(4,'0')}`,
    po_date:      daysAgo(r(10, 90)),
    vendor_name:  vendor.name,
    vendor_gstin: vendor.gstin,
    status:       rp(['open','open','open','partial','closed']),
    line_items: [{
      line_no: 1, description: 'Services as per SOW', hsn_sac: '998313',
      qty_ordered: 1, qty_received: 1, qty_billed: 0,
      unit: 'Nos', unit_price: amount, gst_rate: 18, amount,
    }],
    subtotal: amount, total_gst: Math.round(amount * 0.18),
    total_amount: Math.round(amount * 1.18),
    tolerance_pct: 2,
    delivery_date: daysAgo(-r(10, 30)),
    terms: 'Net 30',
  };
}

// ── MAIN SEED ─────────────────────────────────────────────────────
async function seed() {
  const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017/bharat_erp';

  console.log('🌱 Bharat ERP Seed Script — Sprint 2');
  console.log('   Connecting to:', MONGO.replace(/\/\/.*@/, '//***@'));

  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected');

  if (CLEAR) {
    console.log('🗑  Clearing existing data for tenant:', TENANT);
    await Promise.all([
      VendorModel.deleteMany({ tenant_id: TENANT }),
      PurchaseOrder.deleteMany({ tenant_id: TENANT }),
      ProcessedInvoice.deleteMany({ tenant_id: TENANT }),
    ]);
    console.log('   Cleared.');
  }

  // 1. Vendors
  console.log('\n📋 Seeding vendors...');
  const createdVendors = [];
  for (const v of VENDORS) {
    const existing = await VendorModel.findOne({ tenant_id: TENANT, gstin: v.gstin });
    if (existing) {
      console.log(`   ↩  Skipped (exists): ${v.name}`);
      createdVendors.push(existing);
    } else {
      const vendor = await VendorModel.create({ ...v, tenant_id: TENANT });
      createdVendors.push(vendor);
      console.log(`   ✓  Created: ${v.name} (${v.status}${v.msme_registered?' · MSME':''})`);
    }
  }

  // 2. Purchase Orders
  console.log('\n📦 Seeding purchase orders...');
  const approvedVendors = createdVendors.filter(v => v.status === 'approved');
  let poCount = 0;
  for (let i = 0; i < 15; i++) {
    const vendor = approvedVendors[i % approvedVendors.length];
    const existing = await PurchaseOrder.findOne({ tenant_id: TENANT, po_number: `PO-2026-${String(i+1).padStart(4,'0')}` });
    if (!existing) {
      await PurchaseOrder.create(makePO(i, vendor));
      poCount++;
    }
  }
  console.log(`   ✓  Created ${poCount} purchase orders`);

  // 3. Processed Invoices
  console.log('\n🧾 Seeding invoices...');
  const existing = await ProcessedInvoice.countDocuments({ tenant_id: TENANT });
  if (existing >= 40) {
    console.log(`   ↩  Already have ${existing} invoices, skipping (use --clear to reseed)`);
  } else {
    const invoices = Array.from({ length: 40 }, (_, i) => makeProcessedInvoice(i, approvedVendors));
    await ProcessedInvoice.insertMany(invoices, { ordered: false });
    console.log(`   ✓  Created 40 invoices`);
  }

  // ── Summary ──────────────────────────────────────────────────────
  const [totalInv, byStatus, totalVal] = await Promise.all([
    ProcessedInvoice.countDocuments({ tenant_id: TENANT }),
    ProcessedInvoice.aggregate([
      { $match: { tenant_id: TENANT } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ProcessedInvoice.aggregate([
      { $match: { tenant_id: TENANT } },
      { $group: { _id: null, total: { $sum: '$total_amount' }, tds: { $sum: '$tds_amount' } } },
    ]),
  ]);

  const vals = totalVal[0] || {};
  const statusMap = {};
  byStatus.forEach(s => { statusMap[s._id] = s.count; });
  const approved = (statusMap['approved']||0) + (statusMap['payment_scheduled']||0);
  const stp = Math.round(approved / totalInv * 100);

  console.log('\n✅ Seed complete!');
  console.log(`\n   Tenant:    ${TENANT}`);
  console.log(`   Vendors:   ${createdVendors.length} (${approvedVendors.length} approved)`);
  console.log(`   Invoices:  ${totalInv}`);
  console.log(`   STP Rate:  ${stp}%`);
  console.log(`   Total ₹:   ₹${Math.round(vals.total||0).toLocaleString('en-IN')}`);
  console.log(`   TDS Held:  ₹${Math.round(vals.tds||0).toLocaleString('en-IN')}`);
  console.log('\n   Status breakdown:');
  Object.entries(statusMap).forEach(([s,c]) => console.log(`     ${s.padEnd(20)} ${c}`));
  console.log('\n🚀 Ready to run: npm start');

  await mongoose.connection.close();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
