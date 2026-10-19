/** Display-only library. No fake assets or assumed server asset type hierarchy. */
export function normalizeLibraryItems(items){
  if(!Array.isArray(items))throw new TypeError('Library items must be an array');
  const seen=new Set();
  return items.map(item=>{
    if(!item||typeof item.id!=='string'||!item.id.trim()||seen.has(item.id)||
       typeof item.title!=='string'||!item.title.trim()||
       (item.detail!==undefined&&typeof item.detail!=='string')||
       (item.kind!==undefined&&typeof item.kind!=='string'))
      throw new TypeError('Invalid Library item');
    seen.add(item.id);
    return {id:item.id,title:item.title,
      ...(item.kind!==undefined?{kind:item.kind}:{}),
      ...(item.detail!==undefined?{detail:item.detail}:{})};
  });
}
export function createLibraryPage(){
  const element=document.createElement('section');element.className='library-page';
  element.dataset.page='library';element.tabIndex=-1;element.setAttribute('aria-label','라이브러리');
  const inner=document.createElement('div');inner.className='library-page-inner';
  const eyebrow=document.createElement('span');eyebrow.className='library-eyebrow';eyebrow.textContent='OVLL / LIBRARY';
  const title=document.createElement('h1');title.textContent='라이브러리';
  const desc=document.createElement('p');desc.className='library-description';desc.textContent='저장된 자산을 살펴보는 공간입니다.';
  const info=document.createElement('p');info.className='library-empty-state';info.setAttribute('role','status');
  info.textContent='아직 라이브러리 데이터가 연결되지 않았습니다.';
  const list=document.createElement('div');list.className='library-items';list.hidden=true;list.setAttribute('aria-label','라이브러리 항목');
  inner.append(eyebrow,title,desc,info,list);element.append(inner);
  let items=[],hasSource=false,loading=false,destroyed=false;
  const make=(tag,css,text)=>{const node=document.createElement(tag);node.className=css;node.textContent=text;return node};
  function render(){
    if(destroyed)return;
    list.replaceChildren(...items.map(item=>{
      const article=make('article','library-item','');article.dataset.assetId=item.id;
      const copy=make('div','library-item-copy','');
      if(item.kind)copy.append(make('span','library-item-kind',item.kind));
      copy.append(make('strong','library-item-title',item.title));
      if(item.detail)copy.append(make('small','library-item-detail',item.detail));
      article.append(copy);return article;
    }));
    list.hidden=!items.length;info.hidden=!!items.length;
    if(!items.length)info.textContent=loading?'라이브러리 데이터를 불러오는 중입니다.':
      hasSource?'표시할 라이브러리 항목이 없습니다.':'아직 라이브러리 데이터가 연결되지 않았습니다.';
  }
  return {element,
    setConfirmedItems(value){if(destroyed)throw new Error('Library page has been destroyed');items=normalizeLibraryItems(value);hasSource=true;loading=false;render();},
    setLoading(value){if(destroyed)throw new Error('Library page has been destroyed');if(typeof value!=='boolean')throw new TypeError('Loading must be boolean');loading=value;render();},
    destroy(){if(destroyed)return;destroyed=true;items=[];element.remove();}
  };
}
