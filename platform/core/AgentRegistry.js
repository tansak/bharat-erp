/**
 * BHARAT ERP — AgentRegistry
 * ─────────────────────────────────────────────────────────────
 * Central registry of all agents across all domains.
 * Allows the platform to discover, instantiate, and monitor
 * agents without tight coupling to domain code.
 */

class AgentRegistry {
  constructor() {
    // Map: domain -> Map: agentName -> agentClass
    this._registry = new Map();
  }

  // Register a domain's agents
  // Called from each domain's index.js at startup
  register(domain, agentName, AgentClass) {
    if (!this._registry.has(domain)) {
      this._registry.set(domain, new Map());
    }
    this._registry.get(domain).set(agentName, AgentClass);
  }

  // Bulk register all agents for a domain
  registerDomain(domain, agentMap) {
    Object.entries(agentMap).forEach(([name, AgentClass]) => {
      this.register(domain, name, AgentClass);
    });
  }

  // Get a fresh instance of an agent
  get(domain, agentName) {
    const domainAgents = this._registry.get(domain);
    if (!domainAgents) throw new Error(`Domain '${domain}' not registered`);
    const AgentClass = domainAgents.get(agentName);
    if (!AgentClass) throw new Error(`Agent '${agentName}' not found in domain '${domain}'`);
    return new AgentClass();
  }

  // List all registered domains
  domains() { return [...this._registry.keys()]; }

  // List all agents in a domain
  agents(domain) {
    const d = this._registry.get(domain);
    return d ? [...d.keys()] : [];
  }

  // Health check — all agents instantiate without error
  healthCheck() {
    const results = {};
    for (const [domain, agents] of this._registry) {
      results[domain] = {};
      for (const [name, AgentClass] of agents) {
        try {
          new AgentClass();
          results[domain][name] = 'ok';
        } catch (err) {
          results[domain][name] = `error: ${err.message}`;
        }
      }
    }
    return results;
  }
}

// Singleton — one registry for the whole platform
module.exports = new AgentRegistry();
