// v1 syntax-only SkillReference codec. A parsed candidate is not a verified
// reference; the authorization/scoped registry resolver runs separately.
const OPEN='⟦ovll:ref:v1:';
const CLOSE='⟧';
const MAX_TOKEN_LENGTH=512;
const MAX_ID_CHARS=160;
const own=(x,key)=>Object.prototype.hasOwnProperty.call(x,key);
const exactKeys=(ref,fields)=>{
  const names=Object.keys(ref);
  if(names.some(name=>!fields.includes(name))||
    fields.slice(0,2).some(name=>!own(ref,name))||
    !own(ref,'kind'))fail('INVALID_SKILL_REFERENCE_FIELDS');
};

export class SkillReferenceSyntaxError extends Error {
  constructor(code){
    super(code);
    this.name='SkillReferenceSyntaxError';
    this.code=code;
  }
}
const fail=code=>{throw new SkillReferenceSyntaxError(code)};
const validVersion=v=>Number.isSafeInteger(v)&&v>0;
const hasForbiddenCodepoint=text=>/[\u0000-\u001F\u007F-\u009F]/u.test(text);

function encodeId(value){
  if(typeof value!=='string'||!value||
     Array.from(value).length>MAX_ID_CHARS||hasForbiddenCodepoint(value))
    fail('INVALID_SKILL_REFERENCE_ID');
  try{
    return encodeURIComponent(value).replace(/[!'()*]/g,
      c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  }catch{
    fail('INVALID_SKILL_REFERENCE_ID');
  }
}
function decodeId(value){
  if(typeof value!=='string'||!value)return null;
  try{
    const result=decodeURIComponent(value);
    if(encodeId(result)!==value)return null;
    return result;
  }catch{return null}
}
function versionText(reference){
  if(!own(reference,'version'))return '';
  if(!validVersion(reference.version))fail('INVALID_SKILL_REFERENCE_VERSION');
  return ':'+String(reference.version);
}
export function serializeSkillReference(reference){
  if(!reference||typeof reference!=='object'||Array.isArray(reference))
    fail('INVALID_SKILL_REFERENCE_KIND');
  let value='';
  switch(reference.kind){
    case 'skill-definition':
      exactKeys(reference,['kind','definitionId','version']);
      value=OPEN+'skill-def:'+encodeId(reference.definitionId)+versionText(reference)+CLOSE;
      break;
    case 'skill-canvas':
      exactKeys(reference,['kind','graphId','skillId']);
      if(!own(reference,'skillId'))fail('INVALID_SKILL_REFERENCE_FIELDS');
      value=OPEN+'skill-canvas:'+encodeId(reference.graphId)+':'+encodeId(reference.skillId)+CLOSE;
      break;
    case 'function':
      exactKeys(reference,['kind','functionId','version']);
      value=OPEN+'function:'+encodeId(reference.functionId)+versionText(reference)+CLOSE;
      break;
    default:fail('INVALID_SKILL_REFERENCE_KIND');
  }
  if(value.length>MAX_TOKEN_LENGTH)fail('SKILL_REFERENCE_TOO_LONG');
  return value;
}
function parsedVersion(text){
  if(!/^[1-9][0-9]*$/.test(text))return null;
  const number=Number(text);
  return validVersion(number)?number:null;
}
export function parseSkillReference(token){
  if(typeof token!=='string'||token.length>MAX_TOKEN_LENGTH||
     !token.startsWith(OPEN)||!token.endsWith(CLOSE))return null;
  const body=token.slice(OPEN.length,-CLOSE.length);
  const pieces=body.split(':');
  const kind=pieces.shift();
  if(!kind)return null;
  let reference=null;
  if(kind==='skill-canvas'&&pieces.length===2){
    const graphId=decodeId(pieces[0]),skillId=decodeId(pieces[1]);
    if(graphId===null||skillId===null)return null;
    reference={kind:'skill-canvas',graphId,skillId};
  }else if((kind==='skill-def'||kind==='function')&&
    pieces.length>=1&&pieces.length<=2){
    const id=decodeId(pieces[0]);
    if(id===null)return null;
    const version=pieces.length===2?parsedVersion(pieces[1]):undefined;
    if(pieces.length===2&&version===null)return null;
    reference=kind==='skill-def'
      ?{kind:'skill-definition',definitionId:id}
      :{kind:'function',functionId:id};
    if(version!==undefined)reference.version=version;
  }else return null;
  // One canonical encoding only; forbids hidden extra fields/delimiters.
  try{
    if(serializeSkillReference(reference)!==token)return null;
  }catch{return null}
  return Object.freeze(reference);
}

function isEscaped(text,index){
  let count=0;
  for(let i=index-1;i>=0&&text[i]==='\\';i--)count++;
  return count%2===1;
}

/** Preserve every input code unit; no async resolution or privilege elevation. */
export function segmentSkillReferences(source){
  const value=String(source??'');
  const parts=[];
  let cursor=0,search=0;
  while(search<value.length){
    const start=value.indexOf(OPEN,search);
    if(start<0)break;
    const end=value.indexOf(CLOSE,start+OPEN.length);
    if(end<0)break;
    search=start+OPEN.length;
    if(isEscaped(value,start))continue;
    const token=value.slice(start,end+CLOSE.length);
    const reference=parseSkillReference(token);
    if(!reference)continue;
    if(cursor<start)parts.push({type:'text',text:value.slice(cursor,start)});
    parts.push({type:'candidate',token,reference});
    cursor=end+CLOSE.length;
    search=cursor;
  }
  if(cursor<value.length)parts.push({type:'text',text:value.slice(cursor)});
  return parts;
}

/** Encode literal user text so token-looking content cannot become a chip. */
export function escapeSkillReferenceLiteral(value){
  return String(value??'').replace(/(\\*)⟦ovll:ref:v1:/g,
    (_,slashes)=>'\\'.repeat(slashes.length*2+1)+OPEN);
}
