/**
 * BHARAT ERP — BaseAgent Framework
 * ─────────────────────────────────────────────────────────────
 * Every agent in every domain (P2P, HR, CRM, Manufacturing...)
 * extends this class. Written once. Inherited by all.
 *
 * What BaseAgent provides (so domain agents never repeat it):
 *  - Retry with exponential backoff
 *  - Timeout protection
 *  - Confidence threshold enforcement
 *  - Audit logging on every execution
 *  - Consistent error flag creation on failure
 *  - Claude AI caller via AIService
 *  - Access to all platform services
 */

const AIService            = require('../services/AIService');
const ComplianceEngine     = require('../services/ComplianceEngine');
const NotificationService  = require('../services/NotificationService');
const AuditService         = require('../services/AuditService');

class BaseAgent {
  /**
   * @param {string} name         - Unique agent identifier e.g. 'invoice_reading'
   * @param {string} domain       - Domain e.g. 'p2p', 'hr', 'crm', 'manufacturing'
   * @param {object} options
   * @param {number} options.maxRetries     - Default 2
   * @param {number} options.timeoutMs      - Default 30000
   * @param {number} options.minConfidence  - Warn below this. Default 60.
   * @param {boolean} options.critical      - If true, failure routes to exception. Default false.
   */
  constructor(name, domain, options = {}) {
    this.name          = name;
    this.domain        = domain;
    this.maxRetries    = options.maxRetries    ?? 2;
    this.timeoutMs     = options.timeoutMs     ?? 30000;
    this.minConfidence = options.minConfidence ?? 60;
    this.critical      = options.critical      ?? false;

    // Platform services — available to every agent
    this.ai            = AIService;
    this.compliance    = ComplianceEngine;
    this.notify        = NotificationService;
  }

  // ── OVERRIDE THIS in every domain agent ──────────────────────
  // Receives the canonical object, enriches it, returns it.
  async run(canonicalObject) {
    throw new Error(`${this.name}.run() must be implemented`);
  }

  // ── CALL THIS from Orchestrator — never override ─────────────
  async execute(canonicalObject) {
    const startTime = Date.now();
    let attempt = 0;

    canonicalObject._audit(this.name, 'agent_started', { attempt: 0 });

    while (attempt <= this.maxRetries) {
      try {
        // Race agent execution against timeout
        await Promise.race([
          this.run(canonicalObject),
          this._timeout(canonicalObject),
        ]);

        // Check confidence threshold
        const conf = canonicalObject.confidence_scores[this.name];
        if (conf !== undefined && conf < this.minConfidence) {
          canonicalObject.addFlag(
            'warn', this.name,
            'Low confidence',
            `Score ${conf}% is below threshold ${this.minConfidence}%`,
            'Human review recommended'
          );
        }

        const duration = Date.now() - startTime;
        canonicalObject._audit(this.name, 'agent_completed', {
          confidence: conf,
          duration_ms: duration,
        });

        return canonicalObject;

      } catch (err) {
        attempt++;
        canonicalObject._audit(this.name, 'agent_retry', {
          attempt, error: err.message,
        });

        if (attempt > this.maxRetries) {
          return this._handleFailure(canonicalObject, err);
        }

        // Exponential backoff: 1s, 2s, 4s
        await this._wait(1000 * Math.pow(2, attempt - 1));
      }
    }

    return canonicalObject;
  }

  // ── Shared Claude caller — all agents use this ───────────────
  async callAI(systemPrompt, userPrompt, options = {}) {
    return this.ai.call(systemPrompt, userPrompt, options);
  }

  // ── Structured Claude call expecting JSON response ───────────
  async callAIForJSON(systemPrompt, userPrompt) {
    return this.ai.call(systemPrompt, userPrompt, { expectJSON: true });
  }

  // ── MCP-enabled Claude call ──────────────────────────────────
  async callAIWithTools(systemPrompt, userPrompt, mcpServers) {
    return this.ai.callWithMCP(systemPrompt, userPrompt, mcpServers);
  }

  // ── Private helpers ──────────────────────────────────────────
  _handleFailure(obj, err) {
    const msg = err.message || 'Unknown error';
    obj.addFlag(
      this.critical ? 'error' : 'warn',
      this.name,
      `Agent ${this.critical ? 'failed' : 'warning'}`,
      msg,
      this.critical ? 'Escalate to support team' : 'Review manually'
    );
    obj._audit(this.name, 'agent_failed', { error: msg, critical: this.critical });
    return obj;
  }

  _timeout(obj) {
    return new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`${this.name} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs)
    );
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseAgent;
