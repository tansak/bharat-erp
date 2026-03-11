/**
 * BHARAT ERP — MasterDataService
 * Clean query interface over master data models.
 * Used by agents across all domains.
 */
const { VendorModel, CustomerModel, EmployeeModel, ItemModel } = require('../models/MasterDataModels');

class MasterDataService {

  // ── Vendor ────────────────────────────────────────────────────

  static async findVendorByGSTIN(gstin, tenantId) {
    return VendorModel.findOne({ gstin: gstin?.trim().toUpperCase(), tenant_id: tenantId });
  }

  static async findVendorByName(name, tenantId) {
    return VendorModel.findOne({
      name: { $regex: new RegExp(name?.trim(), 'i') },
      tenant_id: tenantId,
    });
  }

  static async findVendor(gstin, name, tenantId) {
    if (gstin) return this.findVendorByGSTIN(gstin, tenantId);
    if (name)  return this.findVendorByName(name, tenantId);
    return null;
  }

  static async upsertVendor(data, tenantId) {
    return VendorModel.findOneAndUpdate(
      { gstin: data.gstin, tenant_id: tenantId },
      { ...data, tenant_id: tenantId },
      { upsert: true, new: true }
    );
  }

  // ── Customer ──────────────────────────────────────────────────

  static async findCustomerByGSTIN(gstin, tenantId) {
    return CustomerModel.findOne({ gstin: gstin?.trim().toUpperCase(), tenant_id: tenantId });
  }

  // ── Items ─────────────────────────────────────────────────────

  static async findItem(code, tenantId) {
    return ItemModel.findOne({ code: code?.trim(), tenant_id: tenantId });
  }

  static async findItemByHSN(hsnSac, tenantId) {
    return ItemModel.findOne({ hsn_sac: String(hsnSac), tenant_id: tenantId });
  }

  // ── Seed demo data (used in tests + onboarding) ───────────────

  static async seedDemoVendors(tenantId) {
    const vendors = [
      {
        tenant_id: tenantId, name: 'Tech Solutions India Pvt Ltd',
        gstin: '29AABCU9603R1ZX', pan: 'AABCU9603R',
        msme_registered: false, tds_category: 'professional',
        status: 'approved', email: 'accounts@techsolutions.in', phone: '+919876543210',
        address: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560001', country: 'India' },
        bank: { name: 'HDFC Bank', account_number: '50100123456789', ifsc: 'HDFC0001234' },
        on_time_rate: 95, invoice_accuracy: 98,
      },
      {
        tenant_id: tenantId, name: 'Apex Office Supplies',
        gstin: '29ABCDE1234F1ZP', pan: 'ABCDE1234F',
        msme_registered: true, tds_category: 'contractor',
        status: 'approved', email: 'billing@apexoffice.com', phone: '+919988776655',
        address: { line1: '45 Industrial Area', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560058', country: 'India' },
        bank: { name: 'ICICI Bank', account_number: '123456789012', ifsc: 'ICIC0000123' },
        on_time_rate: 88, invoice_accuracy: 92,
      },
      {
        tenant_id: tenantId, name: 'Mumbai Freight Services',
        gstin: '27FGHIJ5678K1ZQ', pan: 'FGHIJ5678K',
        msme_registered: false, tds_category: 'contractor',
        status: 'approved', email: 'finance@mumbaifreight.com', phone: '+912212345678',
        address: { line1: '7 Port Road', city: 'Mumbai', state: 'Maharashtra', state_code: '27', pincode: '400001', country: 'India' },
        bank: { name: 'SBI', account_number: '987654321098', ifsc: 'SBIN0001234' },
        on_time_rate: 91, invoice_accuracy: 96,
      },
    ];

    for (const v of vendors) {
      await VendorModel.findOneAndUpdate(
        { gstin: v.gstin, tenant_id: v.tenant_id },
        v,
        { upsert: true, new: true }
      );
    }
    return vendors.length;
  }
}

module.exports = MasterDataService;
