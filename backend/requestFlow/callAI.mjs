/**
 * One transport API, provider-specific request/response bodies.
 * mode=json returns raw JSON text. mode=tools returns proposed calls, NEVER executes them.
 * A workroom is responsible for validating tools, executing, and any later model turns.
 */
export function createCallAI({ provider, model, apiKey, fetchImpl = fetch }) {
  if (!['gemini','groq'].includes(provider) || !model || !apiKey) throw new Error('Unknown provider or missing model credentials');
  return async function callAI({ prompt, mode = 'json', tools = [], signal } = {}) {
    if (!['json','tools'].includes(mode) || typeof prompt !== 'string') throw new Error('Invalid callAI request');
    if (mode === 'tools' && (!Array.isArray(tools) || !tools.length)) throw new Error('Tool declarations required');
    let url, headers, body;
    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
      body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
      if (mode === 'json') body.generationConfig = { responseMimeType: 'application/json' };
      else body.tools = [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }];
    } else {
      url = 'https://api.groq.com/openai/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      body = { model, messages: [{ role:'user', content: prompt }] };
      if (mode === 'json') body.response_format = { type: 'json_object' };
      else { body.tools = tools.map(({ name, description, parameters }) => ({ type:'function', function: { name, description, parameters } })); body.tool_choice = 'auto'; }
    }
    const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`${provider} API error ${response.status}`);
    const result = await response.json();
    if (provider === 'gemini') {
      const parts = result.candidates?.[0]?.content?.parts ?? [];
      if (mode === 'json') {
        const text = parts.filter(x => typeof x.text === 'string').map(x => x.text).join('');
        if (!text) throw new Error('Empty Gemini JSON response');
        return text;
      }
      return { text: parts.filter(x => typeof x.text === 'string').map(x => x.text).join(''), toolCalls: parts.filter(x => x.functionCall).map(x => ({ name: x.functionCall.name, args: x.functionCall.args ?? {}, id: x.functionCall.id ?? null })) };
    }
    const message = result.choices?.[0]?.message;
    if (!message) throw new Error('Empty Groq response');
    if (mode === 'json') {
      if (typeof message.content !== 'string') throw new Error('Invalid Groq JSON response');
      return message.content;
    }
    return { text: message.content ?? '', toolCalls: (message.tool_calls ?? []).map(x => ({ name: x.function.name, args: JSON.parse(x.function.arguments), id: x.id ?? null })) };
  };
}