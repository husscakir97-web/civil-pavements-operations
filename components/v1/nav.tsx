'use client';
import {createContext,useContext} from 'react';
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
export function areaTarget(area:string,target?:{type:string;id:string}):[string,string?,string?]{
 const [a,s]=area.split('/');
 if(target?.type==='tender')return ['Pipeline','Tenders',target.id];
 if(target?.type==='project')return ['Projects',undefined,target.id];
 return [a,s];
}
