/**
 * BHARAT ERP — AIService
 * Single Claude API wrapper used by ALL agents across ALL domains.
 */
const Anthropic = require('@anthropic-ai/sdk');

class AIService {
  static _client = null;
  static _callCount = 0;
  static _totalTokens = 0;

  static _getClient() {
    if (!this._client) this._client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return this._client;
  }

  static async call(systemPrompt, userPrompt, options = {}) {
    const { expectJSON = false, maxTokens = 2000, model = 'claude-sonnet-4-20250514' } = options;
    this._callCount++;
    const response = await this._getClient().messages.create({
      model, max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    this._totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!expectJSON) return text;
    const clean = text.replace(/```json\s?|```/g, '').trim();
    try { return JSON.parse(clean); }
    catch(e) { throw new Error(`AIService: JSON parse failed.\nRaw: ${clean.slice(0,200)}`); }
  }

  static async callWithMCP(systemPrompt, userPrompt, mcpServers = []) {
    const response = await this._getClient().messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      mcp_servers: mcpServers,
    });
    return response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }

  static stats() {
    return { total_calls: this._callCount, total_tokens: this._totalTokens,
             estimated_cost_usd: (this._totalTokens / 1_000_000) * 3 };
  }
}
module.exports = AIService;
