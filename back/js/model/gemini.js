/** Gemini-specific transport adapter for the model-neutral engine generate contract. */
export function createGeminiCaller({apiKey,model,fetchImpl=globalThis.fetch}={}){
  if(typeof apiKey!=='string'||!apiKey||typeof model!=='string'|| !/^[A-Za-z0-9._-]+$/.test(model)||typeof fetchImpl!=='function')throw new TypeError('Gemini configuration required');
  async function generate({prompt,context,format,signal}={}){
    if(typeof prompt!=='string'||!prompt||format!=='json')throw new TypeError('Invalid model-neutral call');
    const body={systemInstruction:{parts:[{text:prompt}]},contents:[{role:'user',parts:[{text:JSON.stringify(context??{})}]}],generationConfig:{responseMimeType:'application/json'}};
    let response;
    try {response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify(body),signal
    });}catch(error){throw Object.assign(new Error('Gemini transport unavailable'),{code:'MODEL_NETWORK'});}
    if(!response?.ok){const code=response?.status===429?'MODEL_RATE_LIMIT':[401,403].includes(response?.status)?'MODEL_AUTH':'MODEL_ERROR';throw Object.assign(new Error('Gemini request unsuccessful'),{code});}
    let payload;try{payload=await response.json();}catch{throw Object.assign(new Error('Gemini response unreadable'),{code:'MODEL_INVALID_RESPONSE'});}
    const parts=payload?.candidates?.[0]?.content?.parts;
    const jsonText=Array.isArray(parts)?parts.filter(p=>typeof p?.text==='string').map(p=>p.text).join(''):'';
    if(!jsonText)throw Object.assign(new Error('Gemini returned no JSON text'),{code:'MODEL_INVALID_RESPONSE'});
    return {jsonText};
  }
  return Object.freeze({generate});
}
