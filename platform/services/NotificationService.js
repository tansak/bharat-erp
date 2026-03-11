/**
 * BHARAT ERP — NotificationService
 * ─────────────────────────────────────────────────────────────
 * Single notification interface for ALL domains.
 * Domains never call WhatsApp or email APIs directly.
 *
 * Channels: WhatsApp Business API, Email, In-app push
 * Routing:  Determines correct human recipient based on domain,
 *           exception type, amount thresholds, and org hierarchy.
 */

const ROLES = {
  // Finance
  AP_CLERK:         'ap_clerk',
  FINANCE_MANAGER:  'finance_manager',
  CFO:              'cfo',
  // Procurement
  BUYER:            'buyer',
  PROCUREMENT_HEAD: 'procurement_head',
  // HR
  HR_MANAGER:       'hr_manager',
  HRBP:             'hrbp',
  // Operations
  PLANT_MANAGER:    'plant_manager',
  WAREHOUSE_MANAGER:'warehouse_manager',
  // CRM
  SALES_MANAGER:    'sales_manager',
  ACCOUNT_MANAGER:  'account_manager',
  // Executive
  CEO:              'ceo',
  COO:              'coo',
};

class NotificationService {

  // ── Approval request ─────────────────────────────────────────
  static async sendApprovalRequest(canonicalObject, approverRole) {
    const msg     = this._buildApprovalMessage(canonicalObject);
    const contact = await this._getContact(approverRole, canonicalObject.tenant_id);

    await Promise.all([
      this._whatsapp(contact.phone, msg),
      this._email(contact.email, this._approvalSubject(canonicalObject), msg),
    ]);
  }

  // ── Exception alert ──────────────────────────────────────────
  static async alertException(canonicalObject) {
    const errorFlags = canonicalObject.errorFlags();
    const owner      = this._routeException(errorFlags, canonicalObject);
    const msg        = this._buildExceptionMessage(canonicalObject, errorFlags);
    const subject    = `⚠ Exception: ${canonicalObject.domain.toUpperCase()} · ${canonicalObject.id.slice(0, 8)}`;

    await Promise.all([
      this._whatsapp(owner.phone, msg),
      this._email(owner.email, subject, msg),
    ]);
  }

  // ── CFO / Executive morning briefing ────────────────────────
  static async sendExecutiveBriefing(role, briefingData) {
    const contact = await this._getContact(role, briefingData.tenant_id);
    const msg     = this._buildBriefing(briefingData);
    await this._email(contact.email, `📊 Bharat ERP · Daily Intelligence Briefing · ${new Date().toLocaleDateString('en-IN')}`, msg);
  }

  // ── Domain-specific convenience methods ──────────────────────

  static async notifyVendor(vendorContact, subject, message) {
    await Promise.all([
      this._whatsapp(vendorContact.phone, message),
      this._email(vendorContact.email, subject, message),
    ]);
  }

  static async notifyEmployee(employeeContact, subject, message) {
    await this._email(employeeContact.email, subject, message);
  }

  static async notifyCustomer(customerContact, subject, message) {
    await Promise.all([
      this._whatsapp(customerContact.phone, message),
      this._email(customerContact.email, subject, message),
    ]);
  }

  // ── Message builders ─────────────────────────────────────────

  static _buildApprovalMessage(obj) {
    const data = obj.domain_data;
    const domain = obj.domain.toUpperCase();

    // Build domain-appropriate message
    const lines = [
      `*${domain} Approval Required — Bharat ERP*`,
      `ID: ${obj.id.slice(0, 8)}`,
      `Confidence: ${obj.overallConfidence()}%`,
    ];

    // P2P-specific fields
    if (domain === 'P2P' && data.extraction) {
      lines.push(`Invoice: ${data.extraction.invoice_number || 'N/A'}`);
      lines.push(`Vendor: ${data.extraction.vendor?.name || 'N/A'}`);
      lines.push(`Amount: ₹${(data.extraction.total_amount || 0).toLocaleString('en-IN')}`);
    }

    // Add active warnings
    const warns = obj.flags.filter(f => f.type === 'warn' && !f.resolved);
    if (warns.length) {
      lines.push(`\n*Flags:*`);
      warns.slice(0, 3).forEach(w => lines.push(`⚠ ${w.title}`));
    }

    lines.push(`\nReply: *1* Approve  *2* Reject  *3* Query Vendor  *4* Escalate`);
    return lines.join('\n');
  }

  static _buildExceptionMessage(obj, errorFlags) {
    const lines = [
      `*🚨 Exception Alert — Bharat ERP*`,
      `Domain: ${obj.domain.toUpperCase()}`,
      `Object ID: ${obj.id.slice(0, 8)}`,
      `Status: ${obj.status}`,
      ``,
      `*Errors:*`,
      ...errorFlags.slice(0, 3).map(f => `• ${f.title}: ${f.detail}`),
      ``,
      `AI Diagnosis: Please review in Bharat ERP dashboard.`,
    ];
    return lines.join('\n');
  }

  static _buildBriefing(data) {
    return `
Bharat ERP Daily Intelligence Briefing
Generated: ${new Date().toLocaleString('en-IN')}

SUMMARY
-------
${JSON.stringify(data, null, 2)}

View full dashboard: ${process.env.APP_URL || 'https://bharaterp.app'}/dashboard
    `.trim();
  }

  static _approvalSubject(obj) {
    return `[${obj.domain.toUpperCase()}] Approval Required · ${obj.id.slice(0, 8)}`;
  }

  // ── Exception routing logic ──────────────────────────────────
  static _routeException(errorFlags, obj) {
    // Fraud → CFO always
    if (errorFlags.some(f => f.title.toLowerCase().includes('fraud'))) {
      return this._contactFor(ROLES.CFO, obj.tenant_id);
    }
    // HR exceptions → HR Manager
    if (obj.domain === 'hr') {
      return this._contactFor(ROLES.HR_MANAGER, obj.tenant_id);
    }
    // Manufacturing → Plant Manager
    if (obj.domain === 'manufacturing') {
      return this._contactFor(ROLES.PLANT_MANAGER, obj.tenant_id);
    }
    // Default: Finance Manager
    return this._contactFor(ROLES.FINANCE_MANAGER, obj.tenant_id);
  }

  static _contactFor(role, tenantId) {
    // In production: lookup from TenantConfig / HR master
    // For now: use environment variables
    const envMap = {
      [ROLES.CFO]:              { phone: process.env.CFO_PHONE,              email: process.env.CFO_EMAIL },
      [ROLES.FINANCE_MANAGER]:  { phone: process.env.FINANCE_MANAGER_PHONE,  email: process.env.FINANCE_MANAGER_EMAIL },
      [ROLES.HR_MANAGER]:       { phone: process.env.HR_MANAGER_PHONE,       email: process.env.HR_MANAGER_EMAIL },
      [ROLES.PROCUREMENT_HEAD]: { phone: process.env.PROCUREMENT_HEAD_PHONE, email: process.env.PROCUREMENT_HEAD_EMAIL },
      [ROLES.PLANT_MANAGER]:    { phone: process.env.PLANT_MANAGER_PHONE,    email: process.env.PLANT_MANAGER_EMAIL },
      [ROLES.SALES_MANAGER]:    { phone: process.env.SALES_MANAGER_PHONE,    email: process.env.SALES_MANAGER_EMAIL },
    };
    return envMap[role] || { phone: process.env.DEFAULT_ALERT_PHONE, email: process.env.DEFAULT_ALERT_EMAIL };
  }

  async _getContact(role, tenantId) {
    return NotificationService._contactFor(role, tenantId);
  }

  static async _getContact(role, tenantId) {
    return this._contactFor(role, tenantId);
  }

  // ── Channel implementations ──────────────────────────────────

  static async _whatsapp(phone, message) {
    if (!phone || process.env.NODE_ENV === 'test') {
      console.log(`[WhatsApp → ${phone}]\n${message}\n`);
      return;
    }
    // Production: Twilio WhatsApp API
    // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    // await twilio.messages.create({ from: 'whatsapp:' + process.env.TWILIO_FROM, to: 'whatsapp:' + phone, body: message });
  }

  static async _email(to, subject, body) {
    if (!to || process.env.NODE_ENV === 'test') {
      console.log(`[Email → ${to}] ${subject}\n${body}\n`);
      return;
    }
    // Production: Nodemailer or AWS SES
    // const transporter = nodemailer.createTransport({ ... });
    // await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, text: body });
  }
}

module.exports = NotificationService;
module.exports.ROLES = ROLES;
