import {ModelGateway,openAIChatAdapter,ProviderError} from './providers.js';

// Configuration belongs to the trusted server host, never a prompt or client request.
export function createConfiguredModelProvider({env=process.env,fetchImpl=fetch}={}){
  const endpoint=env.OVLL_VNEXT_MODEL_ENDPOINT,apiKey=env.OVLL_VNEXT_MODEL_API_KEY,
    model=env.OVLL_VNEXT_MODEL_ID,providerId=env.OVLL_VNEXT_PROVIDER_ID||'compatible';
  if(!endpoint||!apiKey||!model||!/^[a-z0-9_-]{1,48}$/.test(providerId))
    throw new ProviderError('MODEL_PROVIDER_UNCONFIGURED','MODEL_PROVIDER_UNCONFIGURED',503);
  let url;
  try{url=new URL(endpoint);}catch{throw new ProviderError('INVALID_MODEL_ENDPOINT');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!url.hostname)
    throw new ProviderError('INSECURE_MODEL_ENDPOINT');
  const raw=env.OVLL_VNEXT_MAX_OUTPUT_TOKENS||'1200';
  if(!/^[1-9][0-9]{0,4}$/.test(raw)||Number(raw)>8192)
    throw new ProviderError('MODEL_BUDGET_INVALID');
  const gateway=new ModelGateway();
  gateway.register(providerId,openAIChatAdapter({endpoint:url.href,apiKey,fetchImpl}),{json:true});
  const resolveModel=async()=>({providerId,model,output:'json',maxOutputTokens:Number(raw)});
  return {modelGateway:gateway,resolveTurnModel:resolveModel,resolveModel};
}
