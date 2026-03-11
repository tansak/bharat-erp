const mongoose = require('mongoose');
const FlagSchema = new mongoose.Schema({
  id: String, type: String, agent: String, title: String, detail: String,
  action: String, timestamp: Date, resolved: { type: Boolean, default: false },
  resolved_by: String, resolution: String, resolved_at: Date,
}, { _id: false });
const AuditSchema = new mongoose.Schema({ actor: String, action: String,
  metadata: mongoose.Schema.Types.Mixed, timestamp: Date }, { _id: false });
const Schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  domain: { type: String, required: true, index: true },
  type: String, status: { type: String, index: true },
  tenant_id: { type: String, index: true }, org_unit: String, source: String,
  confidence: Number, confidence_scores: mongoose.Schema.Types.Mixed,
  domain_data: mongoose.Schema.Types.Mixed, decision: mongoose.Schema.Types.Mixed,
  related_objects: [{ domain: String, objectId: String, relation: String }],
  flags: [FlagSchema], human_touchpoints: [{ type: mongoose.Schema.Types.Mixed }],
  audit_trail: [AuditSchema], created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { timestamps: true });
Schema.index({ domain: 1, status: 1, created_at: -1 });
Schema.index({ domain: 1, tenant_id: 1, status: 1 });
module.exports = mongoose.model('CanonicalObject', Schema);
