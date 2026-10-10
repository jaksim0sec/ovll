// UTF-8 byte limits apply at distinct boundaries; strings use the named character limit.
export const MODEL_CONTEXT_LIMITS=Object.freeze({maxRequestChars:12000,maxTaskTextChars:12000,
 snapshotBytes:262144,contextBytes:49152,promptDataBytes:98304,messageBytes:131072,
 outputBytes:32768,inputArtifactBytes:60000,maxProviderCalls:6});
export const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
export function utf8Preview(value,maxBytes){
 const bytes=Buffer.from(value,'utf8');if(bytes.length<=maxBytes)return value;
 return bytes.subarray(0,maxBytes).toString('utf8').replace(/\uFFFD$/,'');
}
