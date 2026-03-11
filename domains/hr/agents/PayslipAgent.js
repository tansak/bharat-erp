/**
 * BHARAT ERP — HR: PayslipAgent
 *
 * Generates structured payslip data for each employee and sends
 * a WhatsApp notification with salary summary.
 *
 * Uses: WhatsAppService (same service from Sprint 3 P2P approval flow)
 * PROVES: Cross-domain service reuse — WhatsApp built once, used by P2P + HR.
 */

const BaseAgent   = require('../../../platform/core/BaseAgent');
const whatsapp    = require('../../../platform/services/WhatsAppService');

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

class PayslipAgent extends BaseAgent {
  constructor() {
    super('payslip', 'hr', {
      maxRetries:    1,
      timeoutMs:     60000,
      minConfidence: 70,
      critical:      false,  // Non-critical: payroll runs even if notifications fail
    });
  }

  async run(hco) {
    const { month, year } = hco.period;
    const compMap  = {};
    const statMap  = {};
    const empMap   = {};

    (hco.salary_components || []).forEach(c => { compMap[c.emp_id] = c; });
    (hco.statutory         || []).forEach(s => { statMap[s.emp_id] = s; });
    (hco.employees         || []).forEach(e => { empMap[e.emp_id]  = e; });

    const payslips  = [];
    const notifResults = [];
    const monthName    = MONTH_NAMES[month] || `Month ${month}`;

    for (const emp of hco.employees) {
      if (emp._validation?.valid === false) continue;

      const comp = compMap[emp.emp_id];
      const stat = statMap[emp.emp_id];
      if (!comp || !stat) continue;

      // ── Build payslip record ─────────────────────────────────
      const payslip = {
        emp_id:         emp.emp_id,
        name:           emp.name,
        designation:    emp.designation,
        department:     emp.department,
        pay_period:     `${monthName} ${year}`,
        earnings: {
          basic:              comp.basic,
          hra:                comp.hra,
          special_allowance:  comp.special_allowance,
          other_allowances:   comp.other_allowances,
          overtime_pay:       comp.overtime_pay,
          gross_salary:       comp.gross_salary,
          lop_deduction:      -(comp.lop_deduction),
          net_earnings:       comp.net_before_statutory,
        },
        deductions: {
          pf_employee:        stat.pf_employee,
          esi_employee:       stat.esi_employee,
          professional_tax:   stat.professional_tax,
          tds_salary:         stat.tds_salary,
          total_deductions:   stat.total_deductions,
        },
        net_payable:    stat.net_payable,
        bank_account:   emp.bank_account,
        ifsc:           emp.ifsc,
        employer_contributions: {
          pf_employer:   stat.pf_employer,
          esi_employer:  stat.esi_employer,
          total_ctc_component: stat.employer_cost,
        },
        generated_at: new Date().toISOString(),
      };

      payslips.push(payslip);

      // ── WhatsApp notification ─────────────────────────────────
      if (emp.whatsapp) {
        const message = this._buildPayslipMessage(payslip, monthName, year);
        try {
          const result = await whatsapp.sendStatusUpdate(
            { _id: hco.id, invoice_number: `PAY-${emp.emp_id}-${month}-${year}` },
            message,
            emp.whatsapp
          );
          notifResults.push({ emp_id: emp.emp_id, name: emp.name, sent: true, mock: result.mock });
        } catch (err) {
          notifResults.push({ emp_id: emp.emp_id, name: emp.name, sent: false, error: err.message });
          hco._flag('PAYSLIP_NOTIF_FAILED', 'warn',
            `WhatsApp payslip notification failed for ${emp.name}: ${err.message}`, this.name);
        }
      } else {
        notifResults.push({ emp_id: emp.emp_id, name: emp.name, sent: false, reason: 'no_whatsapp' });
      }
    }

    hco.domain_data.payslips        = payslips;
    hco.domain_data.notif_results   = notifResults;

    // ── Confidence ─────────────────────────────────────────────
    const generated = payslips.length;
    hco.confidence_scores.payslip = generated > 0
      ? Math.round((generated / (hco.employees?.length || 1)) * 100)
      : 0;

    const notifSent = notifResults.filter(r => r.sent).length;

    hco._audit(this.name, 'PAYSLIPS_GENERATED', {
      payslips_generated: generated,
      notifications_sent: notifSent,
      month: monthName, year,
    });

    return hco;
  }

  // ─── Build WhatsApp payslip message ───────────────────────────
  _buildPayslipMessage(payslip, monthName, year) {
    const fmt = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
    return [
      `💰 *Salary Credit — ${monthName} ${year}*`,
      ``,
      `Hi ${payslip.name.split(' ')[0]},`,
      `Your salary for *${payslip.pay_period}* has been processed.`,
      ``,
      `━━━ 📋 EARNINGS ━━━`,
      `Basic:              ${fmt(payslip.earnings.basic)}`,
      `HRA:                ${fmt(payslip.earnings.hra)}`,
      `Allowances:         ${fmt(payslip.earnings.special_allowance + payslip.earnings.other_allowances)}`,
      payslip.earnings.overtime_pay > 0
        ? `Overtime:           ${fmt(payslip.earnings.overtime_pay)}` : null,
      payslip.earnings.lop_deduction < 0
        ? `LOP Deduction:      ${fmt(payslip.earnings.lop_deduction)}` : null,
      `*Gross Earnings:    ${fmt(payslip.earnings.net_earnings)}*`,
      ``,
      `━━━ 🏛️ DEDUCTIONS ━━━`,
      `PF (Employee):      ${fmt(payslip.deductions.pf_employee)}`,
      payslip.deductions.esi_employee > 0
        ? `ESI (Employee):     ${fmt(payslip.deductions.esi_employee)}` : null,
      `Prof. Tax:          ${fmt(payslip.deductions.professional_tax)}`,
      payslip.deductions.tds_salary > 0
        ? `TDS (Salary):       ${fmt(payslip.deductions.tds_salary)}` : null,
      `*Total Deductions:  ${fmt(payslip.deductions.total_deductions)}*`,
      ``,
      `━━━━━━━━━━━━━━━`,
      `🟢 *Net Salary: ${fmt(payslip.net_payable)}*`,
      ``,
      `🏦 Credited to: ****${String(payslip.bank_account || '').slice(-4)}`,
      ``,
      `_Bharat ERP Payroll System_`,
    ].filter(Boolean).join('\n');
  }
}

module.exports = PayslipAgent;
