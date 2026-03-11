/**
 * BHARAT ERP — CanonicalObject Engine
 * ─────────────────────────────────────────────────────────────
 * The single shared document object that travels through every
 * agent pipeline in every domain. Every agent reads from it and
 * writes back to it. Nothing is stored privately inside an agent.
 *
 * Works for: P2P invoices, Sourcing RFQs, O2C orders,
 *            HR payroll runs, CRM opportunities, Manufacturing
 *            work orders, Supply chain shipments, EPM budgets.
 *
 * Domain-specific data lives in this.domain_data[agentName].
 * The platform layer knows nothing about domain specifics.
 */

const uuid = () => require('crypto').randomUUID();

class CanonicalObject {
  constructor(domain, type, sourceData = {}) {
    // ── Identity ─────────────────────────────────────────────
    this.id         = uuid();
    this.domain     = domain;   // 'p2p' | 'sourcing' | 'o2c' | 'hr' | 'crm' | ...
    this.type       = type;     // 'invoice' | 'rfq' | 'sales_order' | 'payroll_run' | ...
    this.status     = 'created';
    this.created_at = new Date();
    this.updated_at = new Date();
    this.source     = sourceData.source || 'manual'; // email|portal|api|whatsapp|system

    // ── Tenant (multi-tenant SaaS support) ───────────────────
    this.tenant_id  = sourceData.tenant_id || null;
    this.org_unit   = sourceData.org_unit  || null; // department, plant, cost center

    // ── Confidence — each agent writes its own score ─────────
    this.confidence_scores = {};

    // ── Domain payload — each agent section lives here ───────
    // Domain extension classes pre-declare their sections.
    // Platform never reads inside domain_data.
    this.domain_data = {};

    // ── Unified flags from all agents ────────────────────────
    // type: 'ok' | 'warn' | 'error' | 'info'
    this.flags = [];

    // ── Human governance ─────────────────────────────────────
    this.human_touchpoints = [];

    // ── Immutable audit trail ────────────────────────────────
    this.audit_trail = [];

    // ── Final decision ───────────────────────────────────────
    this.decision = null;

    // ── Related objects (cross-domain links) ─────────────────
    // e.g. a P2P invoice linked to a Sourcing contract
    this.related_objects = [];

    // Record creation
    this._audit('system', 'object_created', { domain, type, source: this.source });
  }

  // ── Agent writes its findings here ───────────────────────────
  enrich(agentName, data, confidence) {
    this.domain_data[agentName] = data;
    this.confidence_scores[agentName] = confidence;
    this.updated_at = new Date();
    this._audit(agentName, 'enriched', { confidence });
    return this;
  }

  // ── Only Orchestrator calls this ─────────────────────────────
  transition(newStatus, actor = 'orchestrator') {
    const prev = this.status;
    this.status = newStatus;
    this.updated_at = new Date();
    this._audit(actor, 'status_transition', { from: prev, to: newStatus });
    return this;
  }

  // ── Flag helpers ─────────────────────────────────────────────
  addFlag(type, agentName, title, detail, action = null) {
    this.flags.push({
      id: uuid(), type, agent: agentName,
      title, detail, action,
      timestamp: new Date(),
      resolved: false,
    });
    return this;
  }

  resolveFlag(flagId, resolvedBy, resolution) {
    const flag = this.flags.find(f => f.id === flagId);
    if (flag) {
      flag.resolved = true;
      flag.resolved_by = resolvedBy;
      flag.resolution = resolution;
      flag.resolved_at = new Date();
    }
    return this;
  }

  // ── Human touchpoint ─────────────────────────────────────────
  addHumanTouchpoint(role, action, notes, outcome) {
    this.human_touchpoints.push({
      role, action, notes, outcome,
      timestamp: new Date(),
    });
    this._audit(`human:${role}`, action, { notes, outcome });
    return this;
  }

  // ── Cross-domain linking ─────────────────────────────────────
  // e.g. link a P2P invoice to its originating Sourcing contract
  linkObject(domain, objectId, relation) {
    this.related_objects.push({ domain, objectId, relation });
    return this;
  }

  // ── Computed properties ──────────────────────────────────────
  overallConfidence() {
    const scores = Object.values(this.confidence_scores);
    if (!scores.length) return 0;
    return Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  }

  hasFlag(type)      { return this.flags.some(f => f.type === type && !f.resolved); }
  hasError()         { return this.hasFlag('error'); }
  hasWarn()          { return this.hasFlag('warn'); }
  isApproved()       { return this.status === 'approved'; }
  isException()      { return this.status === 'exception'; }

  activeFlags()      { return this.flags.filter(f => !f.resolved); }
  errorFlags()       { return this.flags.filter(f => f.type === 'error' && !f.resolved); }

  // ── Serialisation ────────────────────────────────────────────
  toJSON() {
    return {
      id: this.id, domain: this.domain, type: this.type,
      status: this.status, tenant_id: this.tenant_id,
      confidence: this.overallConfidence(),
      confidence_scores: this.confidence_scores,
      domain_data: this.domain_data,
      flags: this.flags,
      human_touchpoints: this.human_touchpoints,
      audit_trail: this.audit_trail,
      decision: this.decision,
      related_objects: this.related_objects,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }

  // ── Private ──────────────────────────────────────────────────
  _audit(actor, action, metadata = {}) {
    this.audit_trail.push({
      actor, action, metadata,
      timestamp: new Date(),
    });
  }
}

module.exports = CanonicalObject;
