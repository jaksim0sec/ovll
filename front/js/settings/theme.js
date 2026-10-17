const VALUES=new Set(['system','dark','light']);
/** Only preferences are owned here; browser/OS theme changes are resolved by CSS. */
export function createThemeSettings({root=document.documentElement,storage}={}) {
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  let theme='system';
  try {const stored=storage?.getItem('ovll:theme');if(VALUES.has(stored))theme=stored;} catch {}
  root.dataset.theme=theme;
  const subscribers=new Set();
  return {
    getTheme(){return theme;},
    setTheme(next){
      if(!VALUES.has(next))throw new TypeError('Unknown theme');
      theme=next;root.dataset.theme=next;
      try{storage?.setItem('ovll:theme',next);}catch{}
      subscribers.forEach(listener=>listener(next));
    },
    subscribe(listener){subscribers.add(listener);return ()=>subscribers.delete(listener);},
    destroy(){subscribers.clear();}
  };
}
