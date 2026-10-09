// Provider-independent gateway: typed request/result and a separate vendor wire adapter.
export class ProviderError extends Error {
  constructor(code, detail = code, status = 502, retryAfterSeconds = null) {
    super(detail);
    this.code = code;
    this.status = status;
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0)
      this.retryAfterSeconds = Math.ceil(retryAfterSeconds);
  }
}
const fail = (code, status) => { throw new ProviderError(code, code, status); };
export function readRetryAfter(headers) {
  const value = headers?.get?.('retry-after');
  if (!value) return null;
  const number = Number(value);
  const seconds = Number.isFinite(number) ? number : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : null;
}
export async function waitForRetry(seconds, signal) {
  if (signal?.aborted) fail('MODEL_REQUEST_CANCELLED', 499);
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError('MODEL_REQUEST_CANCELLED', 'MODEL_REQUEST_CANCELLED', 499));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, seconds * 1000);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}
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
  // A short, explicitly signalled quota reset can recover; never blindly reissue on unknown limits.
  let blockedUntil = 0;
  return {
    async complete({ model, messages, output, signal, maxOutputTokens }) {
      const remaining = Math.ceil((blockedUntil - Date.now()) / 1000);
      if (remaining > 0) throw new ProviderError('PROVIDER_RATE_LIMIT', 'PROVIDER_RATE_LIMIT', 429, remaining);
      const body = { model, messages, stream: false };
      if (maxOutputTokens !== undefined) body.max_completion_tokens = maxOutputTokens;
      if (output === 'json') body.response_format = { type: 'json_object' };
      for (let attempt = 0; attempt < 2; attempt++) {
        let response;
        try {
          response = await fetchImpl(endpoint, { method: 'POST', signal, headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } catch {
          if (signal?.aborted) fail('MODEL_REQUEST_CANCELLED', 499);
          fail('PROVIDER_NETWORK_ERROR', 502);
        }
        if (response.status === 429) {
          const retryAfterSeconds = readRetryAfter(response.headers);
          if (attempt === 0 && retryAfterSeconds !== null && retryAfterSeconds <= 8) {
            await waitForRetry(retryAfterSeconds, signal);
            continue;
          }
          if (retryAfterSeconds !== null) blockedUntil = Date.now() + retryAfterSeconds * 1000;
          throw new ProviderError('PROVIDER_RATE_LIMIT', 'PROVIDER_RATE_LIMIT', 429, retryAfterSeconds);
        }
        if (!response.ok) fail('PROVIDER_HTTP_ERROR', response.status);
        let parsed;
        try { parsed = await response.json(); } catch { fail('PROVIDER_INVALID_JSON'); }
        const choice = parsed?.choices?.[0];
        if (choice?.finish_reason === 'length') fail('MODEL_OUTPUT_TRUNCATED');
        if (typeof choice?.message?.content !== 'string') fail('PROVIDER_INVALID_OUTPUT');
        blockedUntil = 0;
        return { text: choice.message.content, usage: parsed.usage || null, requestId: parsed.id || null };
      }
      fail('PROVIDER_RATE_LIMIT', 429);
    }
  };
}
