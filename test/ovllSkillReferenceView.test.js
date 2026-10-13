import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillReferenceChip,renderSkillReferenceText,renderSkillReferenceParts} from '../front/js/ovllSkillReferenceView.mjs';
import {serializeSkillReference} from '../front/js/ovllSkillReferences.mjs';

class FakeNode {
  constructor(doc,tag,text=''){
    this.ownerDocument=doc;this.tag=tag;this._text=text;this.children=[];
    this.attrs={};this.style={setProperty:(key,value)=>{this.styles[key]=value}};
    this.styles={};this.classList={add:name=>{this.className+=(this.className?' ':'')+name}};
    this.className='';
  }
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=[...items];this._text=''}
  set textContent(text){this._text=String(text);this.children=[]}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join('')}
  setAttribute(key,val){this.attrs[key]=String(val)}
  querySelector(){return null}
}
class FakeDocument {
  createElement(tag){return new FakeNode(this,tag)}
  createTextNode(text){return new FakeNode(this,'#text',String(text))}
}
const doc=new FakeDocument();
const make=()=>doc.createElement('p');
const reference={kind:'skill-definition',definitionId:'custom:review',version:1};
const token=serializeSkillReference(reference);
const resolve=ref=>ref.kind==='skill-definition'&&ref.definitionId==='custom:review'?
  {kind:ref.kind,reference:ref,label:'자료 분석',iconKey:'custom',color:'#6655aa'}:null;

test('assistant Skill token resolves to a DOM chip with exact identity',()=>{
 const root=make();
 renderSkillReferenceText(root,'앞 '+token+' 뒤',{source:'assistant',resolve});
 assert.deepEqual(root.children.map(x=>x.tag),['#text','span','#text']);
 assert.equal(root.children[1].attrs['data-ovll-ref-token'],token);
 assert.equal(root.children[1].attrs['aria-label'],'정의된 스킬: 자료 분석');
 assert.equal(root.textContent,'앞 자료 분석 뒤');
});

test('literal user-authored token-shaped text remains inert',()=>{
 const root=make(),text='입력 '+token;
 renderSkillReferenceText(root,text,{source:'user',resolve});
 assert.deepEqual(root.children.map(x=>x.tag),['#text']);
 assert.equal(root.textContent,text);
});

test('missing or mismatched registry entries produce original raw token, never false chips',()=>{
 const root=make();
 renderSkillReferenceText(root,token,{source:'assistant',resolve:()=>null});
 assert.equal(root.textContent,token);
 assert.deepEqual(root.children.map(x=>x.tag),['#text']);
 renderSkillReferenceText(root,token,{source:'assistant',resolve:()=>({
  kind:'skill-definition',reference:{...reference,definitionId:'another'},label:'spoof'
 })});
 assert.equal(root.textContent,token);
});

test('registered labels are written with textContent, not untrusted HTML',()=>{
 const root=make();
 const label='<script>alert(1)</script>';
 renderSkillReferenceParts(root,[{type:'reference',reference}],{resolve:ref=>({
   kind:ref.kind,reference:ref,label,iconKey:'unknown'
 })});
 const chip=root.children[0];
 assert.equal(chip.tag,'span');
 assert.equal(chip.children[1].textContent,label);
 assert.equal(chip.children[1].children.length,0);
 assert.equal(root.textContent,label);
});

test('typed composer references and ordinary text preserve their order',()=>{
 const root=make();
 renderSkillReferenceParts(root,[
  {type:'text',text:'A '},{type:'reference',reference},{type:'text',text:' B'}
 ],{resolve});
 assert.equal(root.textContent,'A 자료 분석 B');
 assert.equal(root.children.length,3);
 assert.equal(root.children[1].attrs['data-ovll-ref-kind'],'skill-definition');
});

test('unsupported reference or malformed parts are inert',()=>{
 const root=make();
 renderSkillReferenceParts(root,[
  {type:'reference',reference:{kind:'unknown',id:'hack'},text:'plain'},
  {type:'text',text:' <img src=x onerror=alert(1)>'}
 ],{resolve});
 assert.equal(root.textContent,'plain <img src=x onerror=alert(1)>');
 assert.ok(root.children.every(x=>x.tag==='#text'));
 assert.throws(()=>renderSkillReferenceParts(root,{}),TypeError);
});

test('SVG is only obtained through registered icon library',()=>{
 const root=make();const calls=[];
 renderSkillReferenceParts(root,[{type:'reference',reference}],{
  resolve,
  svgLibrary:{get:key=>{calls.push(key);return null}}
 });
 assert.deepEqual(calls,['custom']);
 const chip=root.children[0];
 assert.equal(chip.children[0].className,'ovll-skill-ref-icon');
});
