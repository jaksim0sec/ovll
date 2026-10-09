// Provider-independent gateway: typed request/result and a separate vendor wire adapter.
export class ProviderError extends Error {
  constructor(code, detail = code, status = 502) { super(detail); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new ProviderError(code, code, status); };
export class ModelGateway {
  #providers = new Map();
  register(providerId, adapter, capabilities = {}) {
    if (!/^[a-z0-9_-]{1,48}$/.test(providerId) || typeof adapter?.complete !== 'function') fail('INVALID_PROVIDER_REGISTRATION');
    this.#providers.set(providerId, { adapter, capabilities: Object.freeze({ ...capabilities }) });
  }
  capabilities(providerId) {
    const profile = this.#providers.get(providerId);
    if (!profile) fail('UNKNOWN_PROVIDER');
    return profile.capabilities;
  }
  async complete({ providerId, model, messages, output = 'text', signal, maxOutputTokens } = {}) {
    const p = this.#providers.get(providerId);
    if (!p) fail('UNKNOWN_PROVIDER');
    if (output === 'json' && !p.capabilities.json) fail('CAPABILITY_NOT_SUPPORTED');
    if (!['text', 'json'].includes(output) || typeof model !== 'string' || !Array.isArray(messages)) fail('INVALID_MODEL_REQUEST');
    for (const m of messages) {
      if (!['system','developer','user','assistant'].includes(m.role) || typeof m.content !== 'string') fail('INVALID_MESSAGE');
    }
    const result = await p.adapter.complete({ model, messages, output, signal, maxOutputTokens });
    if (!result || typeof result.text !== 'string') fail('INVALID_PROVIDER_RESPONSE');
    return { text: result.text, usage: result.usage || null, providerRequestId: result.requestId || null, providerId, model };
  }
}
export function openAIChatAdapter({ endpoint, apiKey, fetchImpl = fetch } = {}) {
  if (!endpoint || !apiKey || typeof fetchImpl !== 'function') fail('PROVIDER_CONFIGURATION_REQUIRED');
  // endpoint and secret must be supplied from trusted server configuration, never ModelTurn.
  return {
    async complete({ model, messages, output, signal, maxOutputTokens }) {
      const body = { model, messages, stream: false };
      if (maxOutputTokens !== undefined) body.max_completion_tokens = maxOutputTokens;
      if (output === 'json') body.response_format = { type: 'json_object' };
      let response;
      try {
        response = await fetchImpl(endpoint, { method: 'POST', signal, headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch (e) {
        if (signal?.aborted) fail('MODEL_REQUEST_CANCELLED', 499);
        fail('PROVIDER_NETWORK_ERROR', 502);
      }
      if (!response.ok) fail(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR', response.status);
      let parsed;
      try { parsed = await response.json(); } catch { fail('PROVIDER_INVALID_JSON'); }
      const choice = parsed?.choices?.[0];
      if(choice?.finish_reason==='length')fail('MODEL_OUTPUT_TRUNCATED');
      if (typeof choice?.message?.content !== 'string') fail('PROVIDER_INVALID_OUTPUT');
      return { text: choice.message.content, usage: parsed.usage || null, requestId: parsed.id || null };
    }
  };
}
