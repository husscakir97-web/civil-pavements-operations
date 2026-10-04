'use client';
import {createContext,useContext,useEffect} from 'react';
// Route model: #Area/Sub/entityId/tab — reload and back/forward safe.
export type Route={area:string;sub?:string;id?:string;tab?:string};
export const NavContext=createContext<{route:Route;navigate:(area:string,sub?:string,id?:string,tab?:string)=>void}>({route:{area:'Home'},navigate:()=>{}});
export const useNav=()=>useContext(NavContext);
export function parseRoute(hash:string):Route{
 const [area,sub,id,tab]=decodeURIComponent(hash.replace(/^#/,'')).split('/');
 return {area:area||'Home',sub:sub||undefined,id:id||undefined,tab:tab||undefined};
}
// Empty segments are kept (e.g. #Projects//<id>/setup) so positions survive reload.
export function routeHash(r:Route){const parts=[r.area,r.sub||'',r.id||'',r.tab||''];while(parts.length>1&&!parts[parts.length-1])parts.pop();return '#'+parts.map(s=>encodeURIComponent(s)).join('/');}
/** Maps a Home/search "area" string (e.g. "Pipeline/Tenders") to navigate args. */
export function areaTarget(area:string,target?:{type:string;id:string;tab?:string}):[string,string?,string?,string?]{
 const [a,s]=area.split('/');
 if(target?.type==='tender')return ['Pipeline','Tenders',target.id,target.tab];
 if(target?.type==='project')return ['Projects',undefined,target.id,target.tab];
 return [a,s];
}

// ---------------------------------------------------------------- unsaved-work guard
// A workspace holding unsaved edits registers a message while it is dirty. Every in-app route change (navigate() and the
// browser's Back/Forward, see useRoute in app/pavement-os.tsx) asks confirmLeave() first, so unmounting the editor can never
// silently drop work. Reload and tab close are covered by beforeunload. Clean screens register nothing and are never blocked.
let guardMessage:string|null=null;
export function useNavGuard(message:string|null){
 useEffect(()=>{
  if(!message)return;
  guardMessage=message;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',warn);
  return()=>{if(guardMessage===message)guardMessage=null;window.removeEventListener('beforeunload',warn);};
 },[message]);
}
/** True when it is fine to leave: nothing is unsaved, or the user confirmed discarding it. */
export function confirmLeave():boolean{
 if(!guardMessage)return true;
 if(!window.confirm(guardMessage))return false;
 guardMessage=null;// confirmed: the editor is about to unmount, never ask twice for the same navigation
 return true;
}
