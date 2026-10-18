/** The local draft keeps references separate from user text. */
export function normalizeDraft(value = {}) {
  const parts = [];
  for (const part of Array.isArray(value?.parts) ? value.parts : []) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text) {
      const previous = parts.at(-1);
      if (previous?.type === 'text') previous.text += part.text;
      else parts.push({type:'text',text:part.text});
    } else if (['skill','block'].includes(part?.type) && typeof part.id === 'string' && part.id && typeof part.label === 'string') {
      parts.push({type:part.type,id:part.id,label:part.label});
    }
  }
  const attachments = (Array.isArray(value?.attachments) ? value.attachments : [])
    .filter(item => item && typeof item.name === 'string')
    .map(item => ({
      ...(typeof item.id === 'string' ? {id:item.id} : {}),
      name:item.name,type:typeof item.type === 'string' ? item.type : '',
      size:Number.isFinite(item.size) && item.size >= 0 ? item.size : 0,
      ...(Number.isFinite(item.lastModified) ? {lastModified:item.lastModified} : {}),
      ...(typeof Blob !== 'undefined' && item.file instanceof Blob ? {file:item.file} : {})
    }));
  return {parts,attachments};
}

export function hasDraftContent(draft) {
  return Boolean(draft?.attachments?.length || draft?.parts?.some(part => part.type !== 'text' || part.text?.trim()));
}
