"use client";
import {useCallback,useEffect,useState} from 'react';
/** Guard reloads, links and modal close without persisting personal data to storage. */
export function useDirtyForm(value:unknown, busy=false, identity:unknown=null,closeGuardRef?:{current:()=>boolean}) {
  const serialized=JSON.stringify(value);
  const [baseline,setBaseline]=useState(()=>({identity,serialized}));
  if(baseline.identity!==identity)setBaseline({identity,serialized});
  const dirty=baseline.identity===identity && serialized!==baseline.serialized;
  useEffect(()=>{
    if(!dirty)return;
    const before=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const link=(event:MouseEvent)=>{
      if(event.defaultPrevented||event.button!==0)return;
      const target=(event.target as Element)?.closest('a[href]');
      if(!target||target.hasAttribute('download')||target.getAttribute('href')?.startsWith('#')||/^(blob:|data:)/i.test(target.getAttribute('href')||'')||target.getAttribute('target')==='_blank'||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const destination=new URL(target.getAttribute('href')!,window.location.href);
      if(destination.pathname===window.location.pathname&&destination.search===window.location.search)return;
      if(busy||!window.confirm('لديك تغييرات لم تحفظ. هل تريد مغادرة النموذج؟')){event.preventDefault();event.stopPropagation();}
    };
    window.addEventListener('beforeunload',before);document.addEventListener('click',link,true);
    return ()=>{window.removeEventListener('beforeunload',before);document.removeEventListener('click',link,true);};
  },[dirty,busy]);
  const canClose=useCallback(()=>!busy&&(!dirty||window.confirm('لديك تغييرات لم تحفظ. هل تريد تجاهلها؟')),[busy,dirty]);
  useEffect(()=>{if(closeGuardRef)closeGuardRef.current=canClose;return()=>{if(closeGuardRef)closeGuardRef.current=()=>true;};},[closeGuardRef,canClose]);
  return {dirty,canClose};
}
