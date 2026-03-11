/**
 * BHARAT ERP — HR: AttendanceFetchAgent
 *
 * Fetches attendance data for each employee for the payroll month:
 *   - Working days in the month (excluding Sundays + holidays)
 *   - Days present (from attendance system / HR master)
 *   - Leave taken (approved leave types)
 *   - LOP days (Loss of Pay = absent without approval)
 *   - Overtime hours
 *
 * In this build:
 *   - If attendance data is provided on hco.attendance — uses it directly
 *   - Otherwise generates from employee roster (demo mode)
 *   - Real impl: calls HR attendance API / biometric integration
 */

const BaseAgent = require('../../../platform/core/BaseAgent');

// Indian public holidays 2025-26 (representative — real impl fetches from calendar API)
const PUBLIC_HOLIDAYS_2025 = {
  1:  [26],        // Jan: Republic Day
  3:  [14],        // Mar: Holi
  4:  [14, 18],    // Apr: Ram Navami, Good Friday (varies)
  8:  [15],        // Aug: Independence Day
  10: [2, 24],     // Oct: Gandhi Jayanti, Dussehra
  11: [1, 15],     // Nov: Kannada Rajyotsava, Diwali
  12: [25],        // Dec: Christmas
};

class AttendanceFetchAgent extends BaseAgent {
  constructor() {
    super('attendance_fetch', 'hr', {
      maxRetries:    1,
      timeoutMs:     15000,
      minConfidence: 60,
      critical:      false,
    });
  }

  async run(hco) {
    const { month, year } = hco.period;
    const employees       = hco.employees.filter(e => e._validation?.valid !== false);

    // ── 1. Calculate working days in the month ────────────────
    const workingDays = this._workingDays(year, month);

    // ── 2. Match or generate attendance per employee ──────────
    const attendanceMap = {};
    (hco.attendance || []).forEach(a => { attendanceMap[a.emp_id] = a; });

    const attendanceList = employees.map(emp => {
      const existing = attendanceMap[emp.emp_id];
      if (existing) {
        // Use provided attendance, compute LOP
        const lopDays = Math.max(0,
          workingDays - (existing.days_present || 0) - (existing.leaves_taken || 0));
        return {
          emp_id:         emp.emp_id,
          name:           emp.name,
          working_days:   workingDays,
          days_present:   existing.days_present   ?? workingDays,
          leaves_taken:   existing.leaves_taken   ?? 0,
          lop_days:       existing.lop_days       ?? lopDays,
          overtime_hours: existing.overtime_hours ?? 0,
          _source:        'provided',
        };
      } else {
        // Demo mode — assume full month attendance
        return {
          emp_id:         emp.emp_id,
          name:           emp.name,
          working_days:   workingDays,
          days_present:   workingDays,
          leaves_taken:   0,
          lop_days:       0,
          overtime_hours: 0,
          _source:        'default',
        };
      }
    });

    // ── 3. Flag employees with high LOP ──────────────────────
    attendanceList.forEach(a => {
      if (a.lop_days > workingDays * 0.5) {
        hco._flag('HIGH_LOP', 'warn',
          `${a.name}: ${a.lop_days} LOP days out of ${workingDays} working days (>50%). Verify.`,
          this.name);
      }
    });

    hco.attendance = attendanceList;

    // ── 4. Confidence ─────────────────────────────────────────
    const providedCount = attendanceList.filter(a => a._source === 'provided').length;
    const conf = attendanceList.length === 0 ? 0
      : providedCount > 0
        ? Math.round((providedCount / attendanceList.length) * 80 + 20)  // 20–100 based on real data
        : 65; // demo mode

    hco.confidence_scores.attendance_fetch = conf;

    hco._audit(this.name, 'ATTENDANCE_FETCHED', {
      month, year, working_days: workingDays,
      employees: attendanceList.length,
      provided:  providedCount,
      demo_mode: providedCount === 0,
    });

    return hco;
  }

  // ─── Calculate working days in a month ────────────────────────
  _workingDays(year, month) {
    const holidays = PUBLIC_HOLIDAYS_2025[month] || [];
    let working    = 0;
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay(); // 0=Sun, 6=Sat
      if (dow !== 0 && !holidays.includes(d)) {          // exclude Sundays + holidays
        working++;
      }
    }
    return working;
  }
}

module.exports = AttendanceFetchAgent;
