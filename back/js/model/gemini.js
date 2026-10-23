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

  /** Return a proposal only. Tool execution belongs to the server, never this adapter. */
  async function generateFunction({prompt,context,tool,signal}={}){
    if(typeof prompt!=='string'||!prompt||!tool||typeof tool.name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(tool.name)||
       typeof tool.description!=='string'||!tool.description||
       ['inputSchema','parameters','parametersJsonSchema'].filter(key=>Object.hasOwn(tool,key)).length!==1||
       typeof (tool.inputSchema??tool.parameters??tool.parametersJsonSchema)!=='object'||
       (tool.inputSchema??tool.parameters??tool.parametersJsonSchema)===null||
       Array.isArray(tool.inputSchema??tool.parameters??tool.parametersJsonSchema))
      throw new TypeError('Invalid function call contract');
    // inputSchema is the model-neutral contract; only this adapter knows Gemini field names.
    const schemaKey=Object.hasOwn(tool,'parameters')?'parameters':'parametersJsonSchema';
    const schema=tool.inputSchema??tool[schemaKey];
    const declaration={name:tool.name,description:tool.description,[schemaKey]:structuredClone(schema)};
    const body={
      systemInstruction:{parts:[{text:prompt}]},
      contents:[{role:'user',parts:[{text:JSON.stringify(context??{})}]}],
      tools:[{functionDeclarations:[declaration]}],
      toolConfig:{functionCallingConfig:{mode:'ANY',allowedFunctionNames:[tool.name]}}
    };
    let response;
    try{
      response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify(body),signal
      });
    }catch{
      throw Object.assign(new Error('Gemini transport unavailable'),{code:signal?.aborted?'MODEL_CANCELLED':'MODEL_NETWORK'});
    }
    if(!response?.ok){
      const code=response?.status===429?'MODEL_RATE_LIMIT':[401,403].includes(response?.status)?'MODEL_AUTH':'MODEL_ERROR';
      throw Object.assign(new Error('Gemini request unsuccessful'),{code});
    }
    let payload;
    try{payload=await response.json();}catch{throw Object.assign(new Error('Gemini response unreadable'),{code:'MODEL_INVALID_RESPONSE'});}
    const parts=payload?.candidates?.[0]?.content?.parts;
    const found=Array.isArray(parts)?parts.filter(part=>part?.functionCall):[];
    if(found.length!==1||found[0].functionCall.name!==tool.name||!found[0].functionCall.args||
       typeof found[0].functionCall.args!=='object'||Array.isArray(found[0].functionCall.args))
      throw Object.assign(new Error('Gemini function proposal invalid'),{code:'MODEL_INVALID_RESPONSE'});
    return {kind:'function_proposal',name:tool.name,args:structuredClone(found[0].functionCall.args)};
  }
  return Object.freeze({generate,generateFunction});
}
