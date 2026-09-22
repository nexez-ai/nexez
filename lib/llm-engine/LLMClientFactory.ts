import 'server-only';
import { LLMAdapter } from './BaseLLMAdapter';
import { GeminiAdapter } from './GeminiAdapter';
import { GrokAdapter } from './GrokAdapter';
import { ClaudeAdapter } from './ClaudeAdapter';
import { OpenAIAdapter } from './OpenAIAdapter';

/**
 * Pluggable LLM Client Factory.
 * Uses the platform's configured LLM (via LLM_PROVIDER, or inferred from LLM_BASE_URL / LLM_MODEL).
 * The "primary" is whatever the platform has set in env (e.g. Grok via xAI, Gemini via compat, Claude, OpenAI).
 * This keeps consistency with the rest of the platform (lib/llm.ts, Co-Pilot, simulator, etc.).
 * Falls back gracefully to OpenAI-compatible.
 *
 * Env vars used (same as platform LLM):
 *   LLM_PROVIDER=gemini | grok | claude | openai (optional; inferred if absent)
 *   LLM_API_KEY=...
 *   LLM_BASE_URL=... (optional, for custom / detection)
 *   LLM_MODEL=... (optional)
 */
export function createLLMAdapter(): LLMAdapter {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || '';
  const model = process.env.LLM_MODEL;

  if (!apiKey) {
    throw new Error('LLM_API_KEY is required for intelligent negotiation. Set it in Vercel / .env.local');
  }

  // Infer provider from platform config if LLM_PROVIDER not explicitly set.
  // Mirrors detection in lib/llm.ts for consistency.
  let provider = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (!provider) {
    const lowerBase = baseUrl.toLowerCase();
    if (lowerBase.includes('x.ai') || lowerBase.includes('grok')) {
      provider = 'grok';
    } else if (lowerBase.includes('generativelanguage') || lowerBase.includes('google')) {
      provider = 'gemini';
    } else if (lowerBase.includes('anthropic') || (model || '').toLowerCase().includes('claude')) {
      provider = 'claude';
    } else {
      provider = 'openai';
    }
  }

  switch (provider) {
    case 'gemini':
      return new GeminiAdapter(apiKey, model || undefined, baseUrl);
    case 'grok':
    case 'xai':
      return new GrokAdapter(apiKey, model || 'grok-2', baseUrl || 'https://api.x.ai/v1');
    case 'claude':
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model || undefined);
    case 'openai':
    default:
      return new OpenAIAdapter(apiKey, model || 'gpt-4o-mini', baseUrl);
  }
}

/**
 * Convenience: get the name of the active provider for logging / UI badges.
 * Respects the platform LLM config.
 */
export function getActiveLLMProvider(): string {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (provider) return provider;
  const base = (process.env.LLM_BASE_URL || '').toLowerCase();
  if (base.includes('x.ai') || base.includes('grok')) return 'grok';
  if (base.includes('generativelanguage')) return 'gemini';
  if (base.includes('anthropic')) return 'claude';
  return 'openai';
}
