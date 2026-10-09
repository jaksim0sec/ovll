import {ProviderError,readRetryAfter,waitForRetry} from './providers.js';

// Gemini's native generateContent wire format stays behind the shared ModelGateway.
const BASE_URL='https://generativelanguage.googleapis.com/v1beta/models/';
const fail=(code,status=502)=>{throw new ProviderError(code,code,status);};
function retryInfoSeconds(body){
  const details=body?.error?.details;
  if(!Array.isArray(details))return null;
  for(const entry of details){
    if(!String(entry?.['@type']||'').endsWith('/google.rpc.RetryInfo'))continue;
    const match=/^([0-9]+(?:\.[0-9]+)?)s$/.exec(String(entry.retryDelay||''));
    if(match){
      const value=Number(match[1]);
      if(Number.isFinite(value)&&value>0)return Math.min(3600,Math.ceil(value));
    }
  }
  return null;
}
function nativeMessages(messages){
  const instructions=[],contents=[];
  for(const message of messages){
    if(message.role==='system'||message.role==='developer')
      instructions.push({text:message.content});
    else contents.push({role:message.role==='assistant'?'model':'user',parts:[{text:message.content}]});
  }
  return {
    ...(instructions.length?{systemInstruction:{parts:instructions}}:{}),
    contents
  };
}
export function geminiNativeAdapter({apiKey,fetchImpl=fetch}={}){
  if(!apiKey||typeof fetchImpl!=='function')fail('PROVIDER_CONFIGURATION_REQUIRED',503);
  let blockedUntil=0;
  return {
    async complete({model,messages,output='text',signal,maxOutputTokens}={}){
      if(typeof model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(model))
        fail('INVALID_GEMINI_MODEL',422);
      if(!Array.isArray(messages))fail('INVALID_MODEL_REQUEST',422);
      if(signal?.aborted)fail('MODEL_REQUEST_CANCELLED',499);
      const remaining=Math.ceil((blockedUntil-Date.now())/1000);
      if(remaining>0)throw new ProviderError('PROVIDER_RATE_LIMIT','PROVIDER_RATE_LIMIT',429,remaining);
      const body=nativeMessages(messages);
      const generationConfig={};
      if(output==='json')generationConfig.responseMimeType='application/json';
      if(maxOutputTokens!==undefined)generationConfig.maxOutputTokens=maxOutputTokens;
      if(Object.keys(generationConfig).length)body.generationConfig=generationConfig;
      const url=BASE_URL+encodeURIComponent(model)+':generateContent';
      for(let attempt=0;attempt<2;attempt++){
        let response;
        try{
          response=await fetchImpl(url,{method:'POST',signal,headers:{
            'x-goog-api-key':apiKey,'Content-Type':'application/json'
          },body:JSON.stringify(body)});
        }catch{
          if(signal?.aborted)fail('MODEL_REQUEST_CANCELLED',499);
          fail('PROVIDER_NETWORK_ERROR');
        }
        if(response.status===429){
          let delay=readRetryAfter(response.headers);
          if(delay===null){
            let errorBody;
            try{errorBody=await response.json();}catch{}
            delay=retryInfoSeconds(errorBody);
          }
          if(attempt===0&&delay!==null&&delay<=8){
            await waitForRetry(delay,signal);
            continue;
          }
          if(delay!==null)blockedUntil=Date.now()+delay*1000;
          throw new ProviderError('PROVIDER_RATE_LIMIT','PROVIDER_RATE_LIMIT',429,delay);
        }
        if(!response.ok)fail('PROVIDER_HTTP_ERROR',response.status);
        let parsed;
        try{parsed=await response.json();}catch{fail('PROVIDER_INVALID_JSON');}
        const choice=parsed?.candidates?.[0];
        if(choice?.finishReason==='MAX_TOKENS')fail('MODEL_OUTPUT_TRUNCATED');
        if(parsed?.promptFeedback?.blockReason||choice?.finishReason&&choice.finishReason!=='STOP')
          fail('PROVIDER_OUTPUT_BLOCKED');
        const parts=choice?.content?.parts;
        const text=Array.isArray(parts)?parts.filter(p=>typeof p?.text==='string'&&p.thought!==true)
          .map(p=>p.text).join(''):'';
        if(!text.trim())fail('PROVIDER_INVALID_OUTPUT');
        const usage=parsed?.usageMetadata;
        blockedUntil=0;
        return {text,requestId:parsed?.responseId||null,usage:usage?{
          prompt_tokens:usage.promptTokenCount||0,
          completion_tokens:usage.candidatesTokenCount||0,
          total_tokens:usage.totalTokenCount||0,
          cached_tokens:usage.cachedContentTokenCount||0,
          reasoning_tokens:usage.thoughtsTokenCount||0
        }:null};
      }
      fail('PROVIDER_RATE_LIMIT',429);
    }
  };
}
