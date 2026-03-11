/**
 * BHARAT ERP — Unified Command Dashboard (Sprint 8)
 *
 * Adds O2C (Order-to-Cash) tab to the Sprint 6 Command Centre.
 * Connects to all four domain APIs:
 *   GET /api/p2p/dashboard
 *   GET /api/sourcing/dashboard
 *   GET /api/hr/dashboard
 *   GET /api/o2c/dashboard          ← NEW Sprint 8
 *
 * Aesthetic: Precision-industrial — dark slate (#0c111b), amber/gold
 * accents (#d97706 / #fbbf24), Space Mono data, DM Serif Display headings.
 * Inspired by Bloomberg Terminal meets modern Indian fintech.
 */

import { useState, useEffect, useCallback } from "react";

// ─── Config ────────────────────────────────────────────────────────
const BASE_URL = "https://bharat-erp.up.railway.app"; // ← your Railway URL
const API_KEY  = "your-api-key";                       // ← your API key
const TENANT   = "demo-corp";

// ─── Mock data ────────────────────────────────────────────────────
const MOCK = {
  p2p: {
    total_invoices: 847, total_value: 42850000,
    avg_confidence: 84, tds_held: 856000,
    status_breakdown: {
      PAID: 612, SCHEDULED: 89, DECISION_MADE: 54,
      COMPLIANCE_CHECKED: 43, MATCHED: 30, EXTRACTED: 19,
    },
    exceptions: [
      { invoice_number: "INV-2026-0341", vendor: "Infosys BPO",  amount: 485000, reason: "PO mismatch >10%" },
      { invoice_number: "INV-2026-0338", vendor: "Wipro Ltd",    amount: 128000, reason: "Duplicate suspected" },
      { invoice_number: "INV-2026-0329", vendor: "HCL Tech",     amount: 92000,  reason: "GST mismatch" },
    ],
    trend: [
      { date: "Mar 4",  processed: 28, value: 1420000 },
      { date: "Mar 5",  processed: 34, value: 1680000 },
      { date: "Mar 6",  processed: 22, value: 1100000 },
      { date: "Mar 7",  processed: 41, value: 2050000 },
      { date: "Mar 8",  processed: 0,  value: 0 },
      { date: "Mar 9",  processed: 0,  value: 0 },
      { date: "Mar 10", processed: 37, value: 1850000 },
    ],
  },
  sourcing: {
    total_requisitions: 124, total_po_value: 18450000,
    avg_confidence: 81, rfq_active: 29, pos_pending_approval: 9,
    status_breakdown: {
      RFQ_SENT: 18, QUOTES_RECEIVED: 11, EVALUATED: 8,
      VENDOR_SELECTED: 14, PO_DRAFTED: 9, PO_APPROVED: 4,
      PO_ISSUED: 52, CLOSED: 8,
    },
    recent: [
      { description: "Laptops for BCA batch",  status: "PO_ISSUED",       department: "Academic", po_total_value: 620000 },
      { description: "Server rack upgrade",     status: "QUOTES_RECEIVED", department: "IT",       po_total_value: null },
      { description: "Lab equipment",           status: "RFQ_SENT",        department: "Science",  po_total_value: null },
      { description: "Office furniture",        status: "PO_APPROVED",     department: "Admin",    po_total_value: 185000 },
      { description: "Networking switches",     status: "VENDOR_SELECTED", department: "IT",       po_total_value: 340000 },
    ],
  },
  hr: {
    total_runs: 15,
    status_summary: { DISBURSED: 12, APPROVED: 2, COMPLIANCE_COMPUTED: 1 },
    ytd: {
      total_gross: 38400000, total_net: 31920000,
      total_pf: 4608000, total_esi: 307200,
      total_tds: 1152000, total_employer_cost: 42240000, runs: 12,
    },
    recent_runs: [
      { month: 3, year: 2026, status: "COMPLIANCE_COMPUTED", total_employees: 48, total_gross: 3200000, total_net_payable: 2660000 },
      { month: 2, year: 2026, status: "DISBURSED",           total_employees: 48, total_gross: 3200000, total_net_payable: 2660000 },
      { month: 1, year: 2026, status: "DISBURSED",           total_employees: 47, total_gross: 3150000, total_net_payable: 2620000 },
    ],
  },
  // ── O2C mock — mirrors GET /api/o2c/dashboard response shape ──
  o2c: {
    total_orders: 312,
    avg_confidence: 89,
    overdue_orders: 14,
    status_breakdown: {
      ORDER_CONFIRMED:   28,
      INVOICE_GENERATED: 41,
      DISPATCHED:        33,
      DELIVERED:         19,
      PAYMENT_RECEIVED:  22,
      RECONCILED:       158,
      CREDIT_BLOCKED:     4,
      FAILED:             7,
    },
    ytd: {
      total_invoiced:         68400000,
      total_received:         54720000,
      total_outstanding:      13680000,
      total_gst_collected:    10476000,
      total_tcs_collected:    342000,
      total_taxable_value:    57924000,
      avg_order_value:        219231,
      fully_reconciled_count: 158,
      orders:                 312,
      collection_efficiency:  80,
    },
    recent_orders: [
      { oco_id: "OCO-001", status: "INVOICE_GENERATED", customer: { name: "Tech Solutions Pvt Ltd" }, totals: { grand_total: 542800 }, einvoice: { invoice_number: "INV-2026-2001" }, reconciliation: { fully_reconciled: false } },
      { oco_id: "OCO-002", status: "RECONCILED",        customer: { name: "Infosys Ltd" },           totals: { grand_total: 1180000 }, einvoice: { invoice_number: "INV-2026-1998" }, reconciliation: { fully_reconciled: true } },
      { oco_id: "OCO-003", status: "DISPATCHED",        customer: { name: "Wipro Limited" },         totals: { grand_total: 324500 },  einvoice: { invoice_number: "INV-2026-1995" }, reconciliation: { fully_reconciled: false } },
      { oco_id: "OCO-004", status: "CREDIT_BLOCKED",    customer: { name: "ABC Exports" },           totals: { grand_total: 890000 },  einvoice: { invoice_number: null },             reconciliation: { fully_reconciled: false } },
      { oco_id: "OCO-005", status: "RECONCILED",        customer: { name: "HCL Technologies" },      totals: { grand_total: 2100000 }, einvoice: { invoice_number: "INV-2026-1991" }, reconciliation: { fully_reconciled: true } },
    ],
  },
};

// ─── Utilities ────────────────────────────────────────────────────
const fmt = (n, compact = false) => {
  if (n == null) return "—";
  if (compact) {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${n.toLocaleString("en-IN")}`;
  }
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

const fmtNum = (n) => (n ?? 0).toLocaleString("en-IN");
const MONTH_NAMES = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STATUS_COLOR = {
  PAID: "#22c55e", DISBURSED: "#22c55e", PO_ISSUED: "#22c55e",
  CLOSED: "#6b7280", RECONCILED: "#22c55e",
  SCHEDULED: "#3b82f6", PO_APPROVED: "#3b82f6", APPROVED: "#3b82f6",
  PAYMENT_RECEIVED: "#3b82f6",
  DECISION_MADE: "#a78bfa", VENDOR_SELECTED: "#a78bfa",
  DELIVERED: "#a78bfa",
  COMPLIANCE_COMPUTED: "#f59e0b", COMPLIANCE_CHECKED: "#f59e0b",
  PO_DRAFTED: "#f59e0b", EVALUATED: "#f59e0b",
  ORDER_CONFIRMED: "#f59e0b",
  QUOTES_RECEIVED: "#fb923c", INVOICE_GENERATED: "#fb923c",
  DISPATCHED: "#06b6d4",
  MATCHED: "#06b6d4", RFQ_SENT: "#06b6d4",
  EXTRACTED: "#94a3b8", INITIATED: "#94a3b8",
  CREDIT_BLOCKED: "#ef4444", FAILED: "#ef4444",
};

async function fetchDomain(path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "x-api-key": API_KEY, "x-tenant-id": TENANT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Shared Sub-components ─────────────────────────────────────────

function Ticker({ label, value, sub, accent = false, large = false }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${accent ? "#d97706" : "rgba(255,255,255,0.08)"}`,
      borderRadius: 6, padding: "14px 18px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 2 }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Space Mono',monospace",
        fontSize: large ? 28 : 22, fontWeight: 700,
        color: accent ? "#fbbf24" : "#f1f5f9", lineHeight: 1.1,
      }}>
        {value}
      </span>
      {sub && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#475569" }}>{sub}</span>}
    </div>
  );
}

function SectionHeader({ label, status, statusColor = "#22c55e" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <div style={{ width: 3, height: 18, background: "#d97706", borderRadius: 2 }} />
      <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 17, color: "#e2e8f0", letterSpacing: 0.3 }}>{label}</span>
      {status && (
        <span style={{
          marginLeft: "auto", fontFamily: "'Space Mono',monospace", fontSize: 9,
          color: statusColor,
          background: `${statusColor}18`,
          border: `1px solid ${statusColor}40`,
          padding: "2px 8px", borderRadius: 20,
          letterSpacing: 1.5, textTransform: "uppercase",
        }}>
          {status}
        </span>
      )}
    </div>
  );
}

function StatusBar({ breakdown }) {
  const entries = Object.entries(breakdown || {}).filter(([,v]) => v > 0);
  const total   = entries.reduce((s, [,v]) => s + v, 0);
  if (!total) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1, marginBottom: 8 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{
            flex: v, background: STATUS_COLOR[k] || "#475569",
            transition: "flex 0.6s ease",
          }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {entries.map(([k, v]) => (
          <span key={k} style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#94a3b8" }}>
            <span style={{ color: STATUS_COLOR[k] || "#475569" }}>●</span>{" "}
            {k.replace(/_/g, " ")} {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniBar({ data, field }) {
  const max = Math.max(...data.map(d => d[field] || 0), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 48 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={{
            width: "100%",
            height: Math.max(2, (d[field] / max) * 40),
            background: d[field] ? "rgba(217,119,6,0.7)" : "rgba(255,255,255,0.06)",
            borderRadius: "2px 2px 0 0",
            transition: "height 0.4s ease",
          }} />
          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569" }}>
            {d.date?.split(" ")[1] || ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExceptionRow({ item }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#f1f5f9" }}>{item.invoice_number}</div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b", marginTop: 1 }}>{item.vendor}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#fbbf24" }}>{fmt(item.amount, true)}</div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#ef4444", marginTop: 1 }}>{item.reason}</div>
      </div>
    </div>
  );
}

function ReqRow({ item }) {
  const color = STATUS_COLOR[item.status] || "#94a3b8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.description}
        </div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b", marginTop: 1 }}>{item.department}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color, letterSpacing: 0.5 }}>
          {item.status.replace(/_/g, " ")}
        </div>
        {item.po_total_value && (
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#475569", marginTop: 1 }}>
            {fmt(item.po_total_value, true)}
          </div>
        )}
      </div>
    </div>
  );
}

function PayrollRow({ run }) {
  const color = STATUS_COLOR[run.status] || "#94a3b8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 4, border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#f1f5f9" }}>{MONTH_NAMES[run.month]} {run.year}</div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b", marginTop: 1 }}>{run.total_employees} employees</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#fbbf24" }}>{fmt(run.total_net_payable, true)}</div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color, marginTop: 1 }}>{run.status.replace(/_/g, " ")}</div>
      </div>
    </div>
  );
}

function ConfidenceRing({ value, label }) {
  const r = 28, circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  const color = value >= 85 ? "#22c55e" : value >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={72} height={72} viewBox="0 0 72 72">
        <circle cx={36} cy={36} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle cx={36} cy={36} r={r} fill="none"
          stroke={color} strokeWidth={5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
        <text x={36} y={40} textAnchor="middle"
          style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, fontWeight: 700, fill: "#f1f5f9" }}>
          {value}%
        </text>
      </svg>
      <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b", textAlign: "center", letterSpacing: 1 }}>
        {label}
      </span>
    </div>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: "#475569" }}>
      {time.toLocaleTimeString("en-IN", { hour12: false })} IST
    </span>
  );
}

// ─── O2C-specific components ───────────────────────────────────────

/** Horizontal progress bar showing collection efficiency */
function CollectionGauge({ pct }) {
  const color = pct >= 90 ? "#22c55e" : pct >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b", letterSpacing: 1.5, textTransform: "uppercase" }}>
          Collection Efficiency
        </span>
        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 14, fontWeight: 700, color }}>
          {pct}%
        </span>
      </div>
      <div style={{ height: 8, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 4,
          transition: "width 1.2s cubic-bezier(.4,0,.2,1)",
          boxShadow: `0 0 8px ${color}60`,
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#334155" }}>0%</span>
        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#334155" }}>TARGET 95%</span>
        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#334155" }}>100%</span>
      </div>
    </div>
  );
}

/** Single O2C order row for the recent orders table */
function OrderRow({ item }) {
  const color  = STATUS_COLOR[item.status] || "#94a3b8";
  const reconciled = item.reconciliation?.fully_reconciled;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 12px",
      background: "rgba(255,255,255,0.015)",
      borderRadius: 4,
      border: "1px solid rgba(255,255,255,0.05)",
      marginBottom: 6,
    }}>
      {/* Status dot */}
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0,
        boxShadow: `0 0 5px ${color}80` }} />

      {/* Customer + invoice */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#f1f5f9",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.customer?.name || "—"}
        </div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#475569", marginTop: 1 }}>
          {item.einvoice?.invoice_number || item.oco_id || "—"}
        </div>
      </div>

      {/* Amount */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#fbbf24" }}>
          {fmt(item.totals?.grand_total, true)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end", marginTop: 2 }}>
          {reconciled && (
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#22c55e",
              background: "rgba(34,197,94,0.1)", padding: "1px 5px", borderRadius: 3 }}>
              PAID
            </span>
          )}
          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color, letterSpacing: 0.5 }}>
            {item.status?.replace(/_/g, " ")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** AR ageing donut — outstanding split into buckets */
function AgeingDonut({ outstanding, overdue }) {
  const current  = Math.max(0, outstanding - overdue);
  const od30     = overdue * 0.4;
  const od60     = overdue * 0.35;
  const od90plus = overdue * 0.25;
  const total    = outstanding || 1;

  const segments = [
    { label: "Current",  value: current,  color: "#22c55e" },
    { label: "1-30d",    value: od30,     color: "#f59e0b" },
    { label: "31-60d",   value: od60,     color: "#fb923c" },
    { label: "60d+",     value: od90plus, color: "#ef4444" },
  ];

  // Build SVG arc segments
  let cumAngle = -90;
  const cx = 52, cy = 52, r = 38, strokeW = 12;
  const circ = 2 * Math.PI * r;

  const arcs = segments.map(seg => {
    const pct   = seg.value / total;
    const angle = pct * 360;
    const start = cumAngle;
    cumAngle += angle;
    const startRad = (start * Math.PI) / 180;
    const endRad   = ((start + angle) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const large = angle > 180 ? 1 : 0;
    return { ...seg, d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, pct };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <svg width={104} height={104} viewBox="0 0 104 104">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} />
        {arcs.filter(a => a.pct > 0.005).map((arc, i) => (
          <path key={i} d={arc.d} fill="none"
            stroke={arc.color} strokeWidth={strokeW}
            strokeLinecap="butt"
            style={{ transition: "all 0.8s ease" }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle"
          style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, fill: "#64748b", letterSpacing: 1 }}>
          OUTST
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle"
          style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, fontWeight: 700, fill: "#fbbf24" }}>
          {fmt(outstanding, true)}
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#94a3b8", flex: 1 }}>
              {seg.label}
            </span>
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: seg.color, fontWeight: 700 }}>
              {fmt(seg.value, true)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** GST + TCS collected summary row */
function TaxRow({ label, value, section, color = "#f59e0b" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 12px",
      background: "rgba(255,255,255,0.02)",
      borderRadius: 4,
      border: `1px solid ${color}20`,
    }}>
      <div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#e2e8f0" }}>{label}</div>
        {section && (
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569", marginTop: 1 }}>{section}</div>
        )}
      </div>
      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 14, fontWeight: 700, color }}>{fmt(value, true)}</div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────
export default function BharatERPDashboard() {
  const [data, setData]         = useState({ p2p: null, sourcing: null, hr: null, o2c: null });
  const [loading, setLoading]   = useState(true);
  const [source, setSource]     = useState("mock");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeTab, setActiveTab]     = useState("overview");

  const load = useCallback(async () => {
    setLoading(true);
    const [p2p, sourcing, hr, o2c] = await Promise.all([
      fetchDomain("/api/p2p/dashboard"),
      fetchDomain("/api/sourcing/dashboard"),
      fetchDomain("/api/hr/dashboard"),
      fetchDomain("/api/o2c/dashboard"),
    ]);
    const live = p2p || sourcing || hr || o2c;
    setData({
      p2p:     p2p     || MOCK.p2p,
      sourcing: sourcing || MOCK.sourcing,
      hr:      hr      || MOCK.hr,
      o2c:     o2c     || MOCK.o2c,
    });
    setSource(live ? "live" : "mock");
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const { p2p, sourcing, hr, o2c } = data;
  if (!p2p || !sourcing || !hr || !o2c) return null;

  // Cross-domain totals for overview
  const totalValue = (p2p.total_value || 0)
    + (sourcing.total_po_value || 0)
    + (hr.ytd?.total_employer_cost || 0)
    + (o2c.ytd?.total_invoiced || 0);

  const avgConfidence = Math.round((
    (p2p.avg_confidence || 84) +
    (sourcing.avg_confidence || 81) +
    87 +
    (o2c.avg_confidence || 89)
  ) / 4);

  // ── Panel definitions ──────────────────────────────────────────
  const panels = {

    // ── OVERVIEW ──────────────────────────────────────────────────
    overview: (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Ticker label="Total Throughput"   value={fmt(totalValue, true)} sub="P2P + Sourcing + HR + O2C YTD" accent large />
          <Ticker label="Invoices Processed" value={fmtNum(p2p.total_invoices)} sub={`${fmt(p2p.total_value, true)} total value`} />
          <Ticker label="O2C Orders"         value={fmtNum(o2c.total_orders)} sub={`${fmt(o2c.ytd?.total_invoiced, true)} invoiced YTD`} />
          <Ticker label="Payroll Runs YTD"   value={hr.ytd?.runs || 0} sub={`${fmt(hr.ytd?.total_net, true)} net paid`} />
        </div>

        {/* Confidence rings — now 4 domains + overall */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px 24px" }}>
          <SectionHeader label="AI Agent Confidence" status="LIVE" />
          <div style={{ display: "flex", gap: 32, justifyContent: "center", paddingTop: 8 }}>
            <ConfidenceRing value={p2p.avg_confidence || 84}       label="P2P PIPELINE" />
            <ConfidenceRing value={sourcing.avg_confidence || 81}   label="SOURCING" />
            <ConfidenceRing value={87}                              label="HR PAYROLL" />
            <ConfidenceRing value={o2c.avg_confidence || 89}        label="O2C" />
            <ConfidenceRing value={avgConfidence}                   label="OVERALL" />
          </div>
          <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#475569", textAlign: "center", marginTop: 16, lineHeight: 1.6 }}>
            Confidence bands: 90–100 autonomous · 70–89 auto + spot-check · 50–69 human review · &lt;50 full review
          </p>
        </div>

        {/* Domain tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* P2P */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px 20px 16px" }}>
            <SectionHeader label="P2P — Invoice Processing" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <Ticker label="TDS Held"     value={fmt(p2p.tds_held, true)} />
              <Ticker label="Exceptions"   value={p2p.exceptions?.length || 0} />
            </div>
            <StatusBar breakdown={p2p.status_breakdown} />
            <div style={{ marginTop: 16 }}>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#475569", letterSpacing: 1.5 }}>7-DAY VOLUME</span>
              <div style={{ marginTop: 8 }}><MiniBar data={p2p.trend || []} field="processed" /></div>
            </div>
          </div>

          {/* O2C — prominent in overview */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(217,119,6,0.18)", borderRadius: 8, padding: "20px 20px 16px" }}>
            <SectionHeader label="O2C — Order to Cash" status="NEW" statusColor="#d97706" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <Ticker label="Total Invoiced"    value={fmt(o2c.ytd?.total_invoiced, true)} accent />
              <Ticker label="Outstanding"       value={fmt(o2c.ytd?.total_outstanding, true)} />
            </div>
            <CollectionGauge pct={o2c.ytd?.collection_efficiency || 80} />
            <div style={{ marginTop: 16 }}>
              <StatusBar breakdown={o2c.status_breakdown} />
            </div>
          </div>

          {/* Sourcing */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px 20px 16px" }}>
            <SectionHeader label="Sourcing — Procure to PO" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <Ticker label="RFQs Active"   value={sourcing.rfq_active || 0} />
              <Ticker label="POs Pending"   value={sourcing.pos_pending_approval || 0} />
            </div>
            <StatusBar breakdown={sourcing.status_breakdown} />
            <div style={{ marginTop: 16 }}>
              {(sourcing.recent || []).slice(0, 3).map((r, i) => <ReqRow key={i} item={r} />)}
            </div>
          </div>

          {/* HR summary */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px 20px 16px" }}>
            <SectionHeader label="HR — Payroll Summary" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <Ticker label="YTD Gross"  value={fmt(hr.ytd?.total_gross, true)} />
              <Ticker label="YTD Net"    value={fmt(hr.ytd?.total_net, true)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(hr.recent_runs || []).slice(0, 2).map((run, i) => <PayrollRow key={i} run={run} />)}
            </div>
          </div>
        </div>
      </div>
    ),

    // ── P2P TAB ───────────────────────────────────────────────────
    p2p: (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Ticker label="Total Invoices" value={fmtNum(p2p.total_invoices)} accent large />
          <Ticker label="Total Value"    value={fmt(p2p.total_value, true)} />
          <Ticker label="TDS Withheld"   value={fmt(p2p.tds_held, true)} />
          <Ticker label="AI Confidence"  value={`${p2p.avg_confidence || 84}%`} />
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px 20px 16px" }}>
          <SectionHeader label="Invoice Status Breakdown" />
          <StatusBar breakdown={p2p.status_breakdown} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
            {Object.entries(p2p.status_breakdown || {}).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 4 }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#94a3b8" }}>{k.replace(/_/g, " ")}</span>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: STATUS_COLOR[k] || "#94a3b8", fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "20px" }}>
          <SectionHeader label="Active Exceptions — Requires Review" />
          {(p2p.exceptions || []).map((e, i) => <ExceptionRow key={i} item={e} />)}
          {!p2p.exceptions?.length && (
            <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#22c55e", textAlign: "center", padding: 20 }}>✓ No active exceptions</p>
          )}
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
          <SectionHeader label="7-Day Processing Volume" />
          <MiniBar data={p2p.trend || []} field="processed" />
        </div>
      </div>
    ),

    // ── SOURCING TAB ──────────────────────────────────────────────
    sourcing: (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Ticker label="Total Requisitions"   value={fmtNum(sourcing.total_requisitions)} accent large />
          <Ticker label="PO Value Committed"   value={fmt(sourcing.total_po_value, true)} />
          <Ticker label="RFQs Active"          value={fmtNum(sourcing.rfq_active)} />
          <Ticker label="POs Pending Approval" value={fmtNum(sourcing.pos_pending_approval)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Pipeline Status" />
            <StatusBar breakdown={sourcing.status_breakdown} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
              {Object.entries(sourcing.status_breakdown || {}).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLOR[k] || "#94a3b8" }} />
                    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#94a3b8" }}>{k.replace(/_/g, " ")}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ height: 3, borderRadius: 2, background: STATUS_COLOR[k] || "#94a3b8", width: Math.max(4, v * 4), opacity: 0.7 }} />
                    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#e2e8f0", width: 24, textAlign: "right" }}>{v}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Recent Requisitions" />
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(sourcing.recent || []).map((r, i) => <ReqRow key={i} item={r} />)}
            </div>
          </div>
        </div>
      </div>
    ),

    // ── HR / PAYROLL TAB ──────────────────────────────────────────
    hr: (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Ticker label="YTD Gross Payroll"   value={fmt(hr.ytd?.total_gross, true)} accent large />
          <Ticker label="YTD Net Paid"         value={fmt(hr.ytd?.total_net, true)} />
          <Ticker label="YTD PF Contribution"  value={fmt(hr.ytd?.total_pf, true)} sub="Employee + Employer" />
          <Ticker label="YTD TDS Deducted"     value={fmt(hr.ytd?.total_tds, true)} sub="Section 192" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Statutory Deductions — YTD" />
            {[
              { label: "Provident Fund (EPF)", value: hr.ytd?.total_pf,  color: "#3b82f6" },
              { label: "ESI Contribution",     value: hr.ytd?.total_esi, color: "#22c55e" },
              { label: "Professional Tax",     value: hr.ytd?.total_tds ? 14400 : 0, color: "#a78bfa" },
              { label: "TDS (Sec 192)",        value: hr.ytd?.total_tds, color: "#f59e0b" },
            ].map((row, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#94a3b8" }}>{row.label}</span>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#f1f5f9" }}>{fmt(row.value, true)}</span>
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: row.color, width: `${Math.min(100, ((row.value || 0) / (hr.ytd?.total_gross || 1)) * 100 * 3)}%`, transition: "width 1s ease" }} />
                </div>
              </div>
            ))}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b" }}>Total Employer Cost YTD</span>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>{fmt(hr.ytd?.total_employer_cost, true)}</span>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Payroll Run History" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(hr.recent_runs || []).map((run, i) => <PayrollRow key={i} run={run} />)}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              {Object.entries(hr.status_summary || {}).map(([k, v]) => (
                <div key={k} style={{ flex: 1, padding: "8px 10px", background: "rgba(255,255,255,0.02)", border: `1px solid ${STATUS_COLOR[k] || "#475569"}40`, borderRadius: 4, textAlign: "center" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 16, color: STATUS_COLOR[k] || "#94a3b8", fontWeight: 700 }}>{v}</div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569", marginTop: 2 }}>{k.replace(/_/g, " ")}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),

    // ── O2C TAB (Sprint 8 NEW) ────────────────────────────────────
    o2c: (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Ticker label="Total Orders"          value={fmtNum(o2c.total_orders)} accent large />
          <Ticker label="YTD Invoiced"          value={fmt(o2c.ytd?.total_invoiced, true)} />
          <Ticker label="Total Received"        value={fmt(o2c.ytd?.total_received, true)} sub={`${o2c.ytd?.fully_reconciled_count} orders fully closed`} />
          <Ticker label="Outstanding"           value={fmt(o2c.ytd?.total_outstanding, true)} sub={`${o2c.overdue_orders} overdue orders`} />
        </div>

        {/* Row 2: collection gauge + order pipeline status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Collection Efficiency + AR Ageing */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Cash Collection Health" />
            <CollectionGauge pct={o2c.ytd?.collection_efficiency || 80} />
            <div style={{ marginTop: 24 }}>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b", letterSpacing: 1.5, textTransform: "uppercase" }}>
                AR Ageing — Outstanding {fmt(o2c.ytd?.total_outstanding, true)}
              </span>
              <div style={{ marginTop: 12 }}>
                <AgeingDonut
                  outstanding={o2c.ytd?.total_outstanding || 0}
                  overdue={(o2c.ytd?.total_outstanding || 0) * 0.3}
                />
              </div>
            </div>
          </div>

          {/* Order pipeline */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Order Pipeline Status" />
            <StatusBar breakdown={o2c.status_breakdown} />
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 16 }}>
              {Object.entries(o2c.status_breakdown || {}).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLOR[k] || "#94a3b8" }} />
                    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#94a3b8" }}>{k.replace(/_/g, " ")}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ height: 3, borderRadius: 2, background: STATUS_COLOR[k] || "#94a3b8", width: Math.max(4, v * 2), opacity: 0.7 }} />
                    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: STATUS_COLOR[k] || "#e2e8f0", width: 28, textAlign: "right", fontWeight: 700 }}>{v}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: Tax collected + Recent orders */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Tax & statutory collected on sales */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Tax Collected on Sales — YTD" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <TaxRow
                label="GST Collected (Output)"
                value={o2c.ytd?.total_gst_collected}
                section="CGST + SGST / IGST on all invoices"
                color="#f59e0b"
              />
              <TaxRow
                label="TCS — Section 206C(1H)"
                value={o2c.ytd?.total_tcs_collected}
                section="1% on aggregate receipts > ₹50L"
                color="#06b6d4"
              />
              <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b" }}>Total Taxable Value (YTD)</span>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>
                    {fmt(o2c.ytd?.total_taxable_value, true)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b" }}>Avg Order Value</span>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#e2e8f0", fontWeight: 700 }}>
                    {fmt(o2c.ytd?.avg_order_value, true)}
                  </span>
                </div>
              </div>
            </div>

            {/* Overdue alert */}
            {(o2c.overdue_orders || 0) > 0 && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 6,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 6px #ef4444", flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#ef4444" }}>
                    {o2c.overdue_orders} overdue orders — action required
                  </div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#64748b", marginTop: 2 }}>
                    Send payment reminders · Review credit limits
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Recent orders */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
            <SectionHeader label="Recent Orders" status={`${o2c.total_orders} TOTAL`} statusColor="#d97706" />
            <div>
              {(o2c.recent_orders || []).map((order, i) => <OrderRow key={i} item={order} />)}
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 16 }}>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 18, fontWeight: 700, color: "#22c55e" }}>
                  {o2c.ytd?.fully_reconciled_count || 0}
                </div>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569", marginTop: 2, letterSpacing: 1 }}>FULLY PAID</div>
              </div>
              <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>
                  {(o2c.total_orders || 0) - (o2c.ytd?.fully_reconciled_count || 0)}
                </div>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569", marginTop: 2, letterSpacing: 1 }}>IN PIPELINE</div>
              </div>
              <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 18, fontWeight: 700, color: "#ef4444" }}>
                  {o2c.overdue_orders || 0}
                </div>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569", marginTop: 2, letterSpacing: 1 }}>OVERDUE</div>
              </div>
            </div>
          </div>
        </div>

        {/* Row 4: AI confidence breakdown */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "20px" }}>
          <SectionHeader label="O2C Agent Confidence" status="5 AGENTS" statusColor="#a78bfa" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {[
              { agent: "Customer Validation", conf: 93 },
              { agent: "Credit Check",        conf: 87 },
              { agent: "Sales Order",         conf: 92 },
              { agent: "Invoice Generation",  conf: 90 },
              { agent: "Payment Reconciliation", conf: 85 },
            ].map((a, i) => {
              const color = a.conf >= 90 ? "#22c55e" : a.conf >= 75 ? "#f59e0b" : "#ef4444";
              return (
                <div key={i} style={{ textAlign: "center", padding: "12px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 20, fontWeight: 700, color }}>{a.conf}%</div>
                  <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, margin: "8px 0" }}>
                    <div style={{ height: "100%", width: `${a.conf}%`, background: color, borderRadius: 2, transition: "width 1s ease" }} />
                  </div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569", lineHeight: 1.4 }}>{a.agent.toUpperCase()}</div>
                </div>
              );
            })}
          </div>
          <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#334155", textAlign: "center", marginTop: 14 }}>
            ComplianceEngine reused for GSTIN validation · WhatsAppService reused for invoice + payment notifications · 0 new platform files
          </p>
        </div>
      </div>
    ),
  };

  const tabs = [
    { id: "overview",  label: "OVERVIEW" },
    { id: "p2p",       label: "P2P" },
    { id: "sourcing",  label: "SOURCING" },
    { id: "hr",        label: "PAYROLL" },
    { id: "o2c",       label: "O2C", isNew: true },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0c111b; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "#0c111b",
        backgroundImage: `
          radial-gradient(ellipse at 20% 10%, rgba(217,119,6,0.06) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 90%, rgba(59,130,246,0.04) 0%, transparent 50%)
        `,
        padding: "0 0 40px",
        fontFamily: "'Space Mono', monospace",
      }}>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          padding: "16px 32px",
          display: "flex", alignItems: "center", gap: 24,
          background: "rgba(0,0,0,0.3)",
          backdropFilter: "blur(10px)",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32,
              background: "linear-gradient(135deg, #d97706, #92400e)",
              borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'DM Serif Display', serif",
              fontSize: 16, color: "#fff", fontWeight: 700,
            }}>भ</div>
            <div>
              <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: "#f1f5f9", letterSpacing: 0.5 }}>Bharat ERP</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 8, color: "#475569", letterSpacing: 2 }}>AI-FIRST · P2P · SOURCING · HR · O2C</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginLeft: 24 }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                background: activeTab === tab.id ? "rgba(217,119,6,0.15)" : "transparent",
                border: `1px solid ${activeTab === tab.id ? "rgba(217,119,6,0.4)" : "rgba(255,255,255,0.07)"}`,
                color: activeTab === tab.id ? "#fbbf24" : "#64748b",
                padding: "6px 16px",
                borderRadius: 4,
                fontFamily: "'Space Mono',monospace",
                fontSize: 10, letterSpacing: 1.5,
                cursor: "pointer",
                transition: "all 0.15s ease",
                position: "relative",
              }}>
                {tab.label}
                {tab.isNew && (
                  <span style={{
                    position: "absolute", top: -6, right: -6,
                    fontFamily: "'Space Mono',monospace", fontSize: 7,
                    background: "#d97706", color: "#fff",
                    padding: "1px 4px", borderRadius: 3,
                    letterSpacing: 0.5,
                  }}>NEW</span>
                )}
              </button>
            ))}
          </div>

          {/* Right: status + clock + refresh */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: source === "live" ? "#22c55e" : "#f59e0b",
                boxShadow: `0 0 6px ${source === "live" ? "#22c55e" : "#f59e0b"}`,
                animation: "pulse 2s infinite",
              }} />
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#475569" }}>
                {source === "live" ? "LIVE" : "DEMO DATA"}
              </span>
            </div>
            <LiveClock />
            <button onClick={load} disabled={loading} style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: loading ? "#334155" : "#94a3b8",
              padding: "5px 12px", borderRadius: 4,
              fontFamily: "'Space Mono',monospace",
              fontSize: 9, letterSpacing: 1,
              cursor: loading ? "default" : "pointer",
            }}>
              {loading ? "LOADING..." : "↻ REFRESH"}
            </button>
          </div>
        </div>

        {/* ── Page title ─────────────────────────────────────────── */}
        <div style={{ padding: "28px 32px 20px" }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 26, color: "#f1f5f9", letterSpacing: 0.5 }}>
            {activeTab === "overview" ? "Command Centre"
              : activeTab === "o2c"  ? "O2C Dashboard"
              : tabs.find(t => t.id === activeTab)?.label + " Dashboard"}
          </div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#475569", marginTop: 4 }}>
            SPRINT 8 · {TENANT.toUpperCase()} ·{" "}
            {lastRefresh ? `UPDATED ${lastRefresh.toLocaleTimeString("en-IN", { hour12: false })}` : "LOADING"}
          </div>
        </div>

        {/* ── Content ───────────────────────────────────────────── */}
        <div style={{ padding: "0 32px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 80 }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: "#475569", letterSpacing: 2 }}>
                FETCHING DATA...
              </div>
            </div>
          ) : (
            panels[activeTab]
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────── */}
        <div style={{
          padding: "24px 32px 0",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          marginTop: 32,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#1e293b" }}>
            BHARAT ERP v7.0 · SPRINT 8 · UPSKILL GLOBAL TECHNOLOGIES PVT LTD
          </span>
          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#1e293b" }}>
            4 DOMAINS · 23 AI AGENTS · 0 NEW PLATFORM FILES
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}
