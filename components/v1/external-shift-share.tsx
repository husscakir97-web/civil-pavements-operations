'use client';
import {useState} from 'react';
import {Copy,ExternalLink,Link2} from 'lucide-react';
import {api,useAction,useApi,useSession,Btn,ErrorState,Field,field} from './kit';

type ExternalLinkRow={id:string;recipientName:string|null;recipientEmail:string|null;recipientPhone:string|null;expiresAt:string;revokedAt:string|null;lastAccessedAt:string|null;createdAt:string;lastResponse:string|null};
const when=(v:string)=>new Date(v).toLocaleString('en-AU',{timeZone:'Australia/Sydney',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});

export function ExternalShiftShare({shiftId}:{shiftId:string}){
 const session=useSession();const links=useApi<{links:ExternalLinkRow[]}>(session.can('external.share')?'/api/communications/external?shiftId='+encodeURIComponent(shiftId):null),action=useAction();
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[days,setDays]=useState(7),[newPath,setNewPath]=useState('');
 const absolute=newPath&&typeof window!=='undefined'?window.location.origin+newPath:'';
 if(!session.can('external.share'))return null;
 const create=()=>void action.run(()=>api<{path:string;expiresAt:string}>('/api/communications/external',{method:'POST',body:{action:'create',shiftId,recipientName:name||undefined,recipientEmail:email||undefined,recipientPhone:phone||undefined,expiresDays:days}}),r=>{setNewPath(r.path);links.refresh();});
 return <section className="rounded-lg border p-3"><div className="flex items-center gap-2"><Link2 aria-hidden className="size-4 text-sky-700"/><h3 className="font-bold">External job link</h3></div><p className="mt-1 text-xs text-slate-500">Share this shift without creating an Infrastruct account. Links expire, can be revoked and expose only the permitted job pack.</p>
  {newPath&&<div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-medium text-emerald-900">New link — copy it now. The raw token is not stored.</p><div className="mt-2 flex gap-2"><input readOnly className={field+' min-w-0 flex-1 bg-white'} value={absolute}/><Btn variant="secondary" onClick={()=>navigator.clipboard?.writeText(absolute)}><Copy aria-hidden className="size-4"/>Copy</Btn></div></div>}
  <div className="mt-3 grid gap-2 sm:grid-cols-2"><Field label="Recipient name"><input className={field} value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="Email"><input className={field} type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Phone"><input className={field} value={phone} onChange={e=>setPhone(e.target.value)}/></Field><Field label="Expires in days"><input className={field} type="number" min={1} max={30} value={days} onChange={e=>setDays(Math.min(30,Math.max(1,Number(e.target.value)||7)))}/></Field></div><div className="mt-2"><Btn busy={action.busy} onClick={create}><ExternalLink aria-hidden className="size-4"/>Create secure link</Btn></div>
  <ErrorState error={links.error||action.error} onRetry={links.refresh}/>{links.data?.links.length?<ul className="mt-3 divide-y rounded-lg border">{links.data.links.map(l=><li key={l.id} className="flex flex-wrap items-center gap-2 p-2 text-xs"><span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.recipientName||l.recipientEmail||l.recipientPhone||'Unnamed recipient'}</span><span className="text-slate-500">{l.revokedAt?'Revoked':new Date(l.expiresAt)<new Date()?'Expired':'Expires '+when(l.expiresAt)}{l.lastResponse?' · '+l.lastResponse:''}</span></span>{!l.revokedAt&&new Date(l.expiresAt)>new Date()&&<button type="button" className="text-red-700 underline" onClick={()=>void action.run(()=>api('/api/communications/external',{method:'POST',body:{action:'revoke',id:l.id}}),links.refresh)}>Revoke</button>}</li>)}</ul>:null}
 </section>;
}
