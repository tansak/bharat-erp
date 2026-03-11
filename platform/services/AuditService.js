/**
 * BHARAT ERP — AuditService
 * ─────────────────────────────────────────────────────────────
 * Persistent, immutable audit trail for every canonical object
 * across every domain. Never deletes. Always appends.
 *
 * Used for: regulatory compliance, external audits,
 *           AI decision traceability, dispute resolution.
 */

const CanonicalObjectModel = require('../models/CanonicalObjectModel');

class AuditService {

  // ── Persist full canonical object state ──────────────────────
  static async save(canonicalObject) {
    try {
      await CanonicalObjectModel.findOneAndUpdate(
        { id: canonicalObject.id },
        canonicalObject.toJSON(),
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      // Audit failures must never crash the pipeline
      console.error(`[AuditService] Save failed for ${canonicalObject.id}:`, err.message);
    }
  }

  // ── Load a canonical object by ID ───────────────────────────
  static async load(id) {
    return CanonicalObjectModel.findOne({ id });
  }

  // ── Query across domain ──────────────────────────────────────
  static async query(domain, filters = {}, options = {}) {
    const { limit = 50, skip = 0, sort = { created_at: -1 } } = options;
    return CanonicalObjectModel
      .find({ domain, ...filters })
      .sort(sort)
      .skip(skip)
      .limit(limit);
  }

  // ── Dashboard aggregations ───────────────────────────────────
  static async summary(domain, tenantId, dateRange = 30) {
    const since = new Date();
    since.setDate(since.getDate() - dateRange);

    const [total, byStatus, byConfidence] = await Promise.all([
      CanonicalObjectModel.countDocuments({ domain, tenant_id: tenantId, created_at: { $gte: since } }),
      CanonicalObjectModel.aggregate([
        { $match: { domain, tenant_id: tenantId, created_at: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      CanonicalObjectModel.aggregate([
        { $match: { domain, tenant_id: tenantId, created_at: { $gte: since } } },
        { $group: { _id: null, avgConfidence: { $avg: '$confidence' } } },
      ]),
    ]);

    const statusMap = {};
    byStatus.forEach(s => { statusMap[s._id] = s.count; });

    return {
      domain,
      period_days:        dateRange,
      total,
      by_status:          statusMap,
      straight_through:   statusMap['approved'] || 0,
      exceptions:         statusMap['exception'] || 0,
      stp_rate:           total > 0 ? Math.round((statusMap['approved'] || 0) / total * 100) : 0,
      avg_confidence:     Math.round(byConfidence[0]?.avgConfidence || 0),
    };
  }

  // ── Export full audit trail for compliance/audit ─────────────
  static async exportTrail(id) {
    const obj = await this.load(id);
    if (!obj) throw new Error(`Object ${id} not found`);
    return {
      object_id:         obj.id,
      domain:            obj.domain,
      type:              obj.type,
      tenant_id:         obj.tenant_id,
      final_status:      obj.status,
      created_at:        obj.created_at,
      updated_at:        obj.updated_at,
      audit_trail:       obj.audit_trail,
      human_touchpoints: obj.human_touchpoints,
      flags:             obj.flags,
      decision:          obj.decision,
      exported_at:       new Date(),
      exported_by:       'AuditService',
    };
  }

  // ── Exception queue for human review ────────────────────────
  static async getExceptionQueue(domain, tenantId) {
    return CanonicalObjectModel.find({
      domain,
      tenant_id: tenantId,
      status: 'exception',
    }).sort({ created_at: 1 }); // oldest first
  }

  // ── Pending approvals ────────────────────────────────────────
  static async getPendingApprovals(domain, tenantId) {
    return CanonicalObjectModel.find({
      domain,
      tenant_id: tenantId,
      status: 'pending_approval',
    }).sort({ created_at: 1 });
  }
}

module.exports = AuditService;
