import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, hasDraftContent } from '../../front/js/composer/draft.js';

test('draft preserves typed references and literal text without a wire representation', () => {
  const draft = normalizeDraft({parts:[{type:'text',text:'<b>안녕</b>'},{type:'skill',id:'research',label:'조사'},{type:'text',text:'\n'},{type:'block',id:'block-1',label:'조사 1'}],attachments:[]});
  assert.deepEqual(draft.parts,[{type:'text',text:'<b>안녕</b>'},{type:'skill',id:'research',label:'조사'},{type:'text',text:'\n'},{type:'block',id:'block-1',label:'조사 1'}]);
  assert.equal(hasDraftContent(draft),true);
});
test('normalization gives independent records and rejects unknown draft parts', () => {
  const source={parts:[{type:'text',text:'a'},{type:'text',text:'b'},{type:'legacy',id:'x'},{type:'skill',id:'x',label:'이름'}],attachments:[{id:'file-1',name:'메모.txt',type:'text/plain',size:12}]};
  const draft=normalizeDraft(source);
  assert.deepEqual(draft.parts,[{type:'text',text:'ab'},{type:'skill',id:'x',label:'이름'}]);
  draft.parts[1].label='changed';draft.attachments[0].name='changed';
  assert.equal(source.parts[3].label,'이름');assert.equal(source.attachments[0].name,'메모.txt');
  assert.equal(hasDraftContent({parts:[{type:'text',text:' \n'}],attachments:[]}),false);
  assert.equal(hasDraftContent({parts:[],attachments:[{name:'file.txt'}]}),true);
});
