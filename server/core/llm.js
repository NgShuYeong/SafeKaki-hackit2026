// Provider adapter. Keeps the rest of the app independent of which LLM is used.
// LLM_PROVIDER=anthropic (default) | openai   (openai = any OpenAI-compatible /chat/completions API)
import { SYSTEM_PROMPT } from './prompt.js';

export class LlmError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function llmConfig(env = process.env) {
  const provider = (env.LLM_PROVIDER || 'anthropic').toLowerCase();
  return {
    provider,
    apiKey: env.LLM_API_KEY || (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) || '',
    model: env.LLM_MODEL || (provider === 'anthropic' ? 'claude-haiku-5-5' : 'gpt-4o-mini'),
    baseUrl: (env.LLM_BASE_URL || (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com')).replace(/\/$/, ''),
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || 20000,
  };
}

export function llmConfigured(cfg = llmConfig()) {
  return Boolean(cfg.apiKey);
}

function extractJson(text) {
  if (!text) throw new LlmError('bad_response');
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new LlmError('bad_response');
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new LlmError('bad_response'); }
}

async function post(url, headers, body, timeoutMs, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (res.status === 401 || res.status === 403) throw new LlmError('auth');
    if (res.status === 429) throw new LlmError('rate_limited');
    if (!res.ok) throw new LlmError(res.status >= 500 ? 'provider_down' : 'bad_request');
    return await res.json();
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e?.name === 'AbortError') throw new LlmError('timeout');
    throw new LlmError('network');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the parsed JSON object from the model. Throws LlmError(code) on any failure.
 * Error codes are safe to show; provider error bodies are never exposed or logged.
 */
// images: optional [{ mediaType: 'image/png', base64: '...' }] for screenshot reading.
export async function callLlm(userPrompt, { cfg = llmConfig(), fetchImpl = fetch, system = SYSTEM_PROMPT, images = [], maxTokens = 1200 } = {}) {
  if (!llmConfigured(cfg)) throw new LlmError('not_configured');
  const attempt = async () => {
    if (cfg.provider === 'anthropic') {
      const data = await post(`${cfg.baseUrl}/v1/messages`, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        { model: cfg.model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: images.length
          ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } })), { type: 'text', text: userPrompt }]
          : userPrompt }] }, cfg.timeoutMs, fetchImpl);
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return extractJson(text);
    }
    const data = await post(`${cfg.baseUrl}/v1/chat/completions`, { authorization: `Bearer ${cfg.apiKey}` },
      { model: cfg.model, temperature: 0, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: images.length
        ? [...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.base64}` } })), { type: 'text', text: userPrompt }]
        : userPrompt }] }, cfg.timeoutMs, fetchImpl);
    return extractJson(data?.choices?.[0]?.message?.content);
  };
  try {
    return await attempt();
  } catch (e) {
    if (e instanceof LlmError && ['timeout', 'provider_down', 'network', 'bad_response'].includes(e.code)) return attempt(); // one retry
    throw e;
  }
}
