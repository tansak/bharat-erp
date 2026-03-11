/**
 * BHARAT ERP — Orchestrator Engine
 * ─────────────────────────────────────────────────────────────
 * Coordinates agent execution for any domain pipeline.
 * Handles sequential steps, parallel steps, and exception routing.
 *
 * Each domain creates its own Orchestrator extending this class,
 * defining which agents run and in what order/parallel grouping.
 *
 * Usage:
 *   class P2POrchestrator extends Orchestrator { ... }
 *   class HROrchestrator  extends Orchestrator { ... }
 *   class CRMOrchestrator extends Orchestrator { ... }
 */

const AuditService        = require('../services/AuditService');
const NotificationService = require('../services/NotificationService');

class Orchestrator {
  /**
   * @param {string} domain   - e.g. 'p2p', 'hr', 'crm'
   * @param {Array}  pipeline - Array of steps.
   *   Sequential:  new InvoiceReadingAgent()
   *   Parallel:    [new VendorAgent(), new POAgent()]   ← runs simultaneously
   *   Conditional: { condition: (obj) => bool, agent: new Agent() }
   */
  constructor(domain, pipeline = []) {
    this.domain   = domain;
    this.pipeline = pipeline;
  }

  // ── Main entry point ─────────────────────────────────────────
  async process(canonicalObject) {
    const startTime = Date.now();
    canonicalObject._audit(`${this.domain}_orchestrator`, 'pipeline_started', {
      steps: this.pipeline.length,
    });

    try {
      for (const step of this.pipeline) {
        // ── Parallel step: array of agents ──────────────────
        if (Array.isArray(step)) {
          await Promise.all(
            step.map(agent => agent.execute(canonicalObject))
          );

        // ── Conditional step: run agent only if condition met
        } else if (step.condition) {
          if (step.condition(canonicalObject)) {
            await step.agent.execute(canonicalObject);
          } else {
            canonicalObject._audit(
              `${this.domain}_orchestrator`,
              'step_skipped',
              { agent: step.agent.name }
            );
          }

        // ── Sequential step: single agent ───────────────────
        } else {
          await step.execute(canonicalObject);
        }

        // ── After every step: check for critical errors ──────
        if (canonicalObject.hasError()) {
          await this._routeToException(canonicalObject);
          return canonicalObject;
        }

        // ── After every step: persist state ─────────────────
        await AuditService.save(canonicalObject);
      }

      // Pipeline completed successfully
      const duration = Date.now() - startTime;
      canonicalObject._audit(`${this.domain}_orchestrator`, 'pipeline_completed', {
        duration_ms: duration,
        final_confidence: canonicalObject.overallConfidence(),
        final_status: canonicalObject.status,
      });

      await AuditService.save(canonicalObject);

    } catch (err) {
      // Unexpected orchestrator-level failure
      canonicalObject.addFlag(
        'error',
        `${this.domain}_orchestrator`,
        'Pipeline failure',
        err.message,
        'Contact system administrator'
      );
      await this._routeToException(canonicalObject);
    }

    return canonicalObject;
  }

  // ── Human approval checkpoint ────────────────────────────────
  // Insert this as a pipeline step where human review is mandatory
  approvalCheckpoint(role, threshold = 90) {
    return {
      condition: (obj) => obj.overallConfidence() < threshold || obj.hasWarn(),
      agent: {
        name: `approval_checkpoint_${role}`,
        execute: async (obj) => {
          obj.transition('pending_approval', `${this.domain}_orchestrator`);
          await NotificationService.sendApprovalRequest(obj, role);
          await AuditService.save(obj);
          // Actual approval comes via webhook — pipeline pauses here
          return obj;
        }
      }
    };
  }

  // ── Private ──────────────────────────────────────────────────
  async _routeToException(obj) {
    obj.transition('exception', `${this.domain}_orchestrator`);
    await NotificationService.alertException(obj);
    await AuditService.save(obj);
  }
}

module.exports = Orchestrator;
