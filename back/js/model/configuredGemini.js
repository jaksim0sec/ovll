import {createGeminiCaller} from './gemini.js';

/** Use the same Gemini env aliases and selection precedence as main. */
export function resolveGeminiConfig(env=process.env){
 return {
  apiKey:env.GEMINI_API_KEY||env.OVLL_POINTER_MODEL_API_KEY||env.OVLL_VNEXT_MODEL_API_KEY||'',
  model:env.OVLL_POINTER_MODEL_ID||env.OVLL_VNEXT_MODEL_ID||env.GEMINI_MODEL||'gemini-3.5-flash-lite'
 };
}

/** Keep model credentials optional at server boot and validate on the first call. */
export function createConfiguredGeminiCaller({env=process.env,fetchImpl=globalThis.fetch}={}){
 const selection=env.OVLL_POINTER_PROVIDER_ID||env.OVLL_VNEXT_PROVIDER_ID||'gemini';
 const {apiKey,model}=resolveGeminiConfig(env);
 return Object.freeze({
  async generate(call){
   if(selection!=='gemini')throw Object.assign(new Error('Beta prototype only supports Gemini'),{code:'MODEL_ERROR'});
   if(!apiKey)throw Object.assign(new Error('Gemini credentials not configured'),{code:'MODEL_AUTH'});
   return createGeminiCaller({apiKey,model,fetchImpl}).generate(call);
  },
  async generateFunction(call){
   if(selection!=='gemini')throw Object.assign(new Error('Beta prototype only supports Gemini'),{code:'MODEL_ERROR'});
   if(!apiKey)throw Object.assign(new Error('Gemini credentials not configured'),{code:'MODEL_AUTH'});
   return createGeminiCaller({apiKey,model,fetchImpl}).generateFunction(call);
  }
 });
}
