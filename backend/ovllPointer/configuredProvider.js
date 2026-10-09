import {geminiNativeAdapter} from './geminiAdapter.js';
import {ModelGateway,openAIChatAdapter,ProviderError} from './providers.js';

// Configuration belongs to the trusted server host, never a prompt or client request.
export function resolveLocalPointerProvider(env=process.env){
  const selected=env.OVLL_POINTER_PROVIDER_ID||env.OVLL_VNEXT_PROVIDER_ID;
  if(selected)return selected;
  if(env.GEMINI_API_KEY)return 'gemini';
  if(env.GROQ_API_KEY)return 'groq';
  if(env.OVLL_POINTER_MODEL_ENDPOINT||env.OVLL_VNEXT_MODEL_ENDPOINT)return 'compatible';
  return 'gemini';
}

// Configuration belongs to the trusted server host, never a prompt or client request.
export function createConfiguredModelProvider({env=process.env,fetchImpl=fetch}={}){
  const providerId=env.OVLL_POINTER_PROVIDER_ID||env.OVLL_VNEXT_PROVIDER_ID||resolveLocalPointerProvider(env);
  const gemini=providerId==='gemini';
  const endpoint=env.OVLL_POINTER_MODEL_ENDPOINT||env.OVLL_VNEXT_MODEL_ENDPOINT;
  const apiKey=gemini
    ?env.GEMINI_API_KEY||env.OVLL_POINTER_MODEL_API_KEY||env.OVLL_VNEXT_MODEL_API_KEY
    :env.OVLL_POINTER_MODEL_API_KEY||env.OVLL_VNEXT_MODEL_API_KEY;
  const model=env.OVLL_POINTER_MODEL_ID||env.OVLL_VNEXT_MODEL_ID||
    (gemini?(env.GEMINI_MODEL||'gemini-3.5-flash-lite'):null);
  if(!apiKey||!model||!gemini&&!endpoint||!/^[a-z0-9_-]{1,48}$/.test(providerId))
    throw new ProviderError('MODEL_PROVIDER_UNCONFIGURED','MODEL_PROVIDER_UNCONFIGURED',503);
  const raw=env.OVLL_POINTER_MAX_OUTPUT_TOKENS||env.OVLL_VNEXT_MAX_OUTPUT_TOKENS||'2048';
  if(!/^[1-9][0-9]{0,4}$/.test(raw)||Number(raw)>8192)
    throw new ProviderError('MODEL_BUDGET_INVALID');
  const gateway=new ModelGateway();
  let standby=null;
  if(gemini){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(model))
      throw new ProviderError('INVALID_GEMINI_MODEL');
    gateway.register(providerId,geminiNativeAdapter({apiKey,fetchImpl}),{json:true});
    if(env.GROQ_API_KEY){
      standby={providerId:'groq',model:env.GROQ_MODEL||'openai/gpt-oss-120b',
        maxOutputTokens:Number(raw)};
      gateway.register('groq',openAIChatAdapter({
        endpoint:'https://api.groq.com/openai/v1/chat/completions',
        apiKey:env.GROQ_API_KEY,fetchImpl
      }),{json:true});
    }
  }else{
    let url;
    try{url=new URL(endpoint);}catch{throw new ProviderError('INVALID_MODEL_ENDPOINT');}
    if(url.protocol!=='https:'||url.username||url.password||url.hash||!url.hostname)
      throw new ProviderError('INSECURE_MODEL_ENDPOINT');
    gateway.register(providerId,openAIChatAdapter({endpoint:url.href,apiKey,fetchImpl}),{json:true});
  }
  const resolveModel=async()=>({providerId,model,output:'json',maxOutputTokens:Number(raw),
    ...(standby?{standby}:{} )});
  return {modelGateway:gateway,resolveTurnModel:resolveModel,resolveModel};
}
