'use client';
import {useState} from 'react';
import {Check,MessageSquare,Send,Users,X} from 'lucide-react';
import {api,useAction,useApi,useSession,Btn,ErrorState,field,Pill,EmptyState} from './kit';
import type {CommunicationContext} from '@/lib/platform/communications';

type Person={id:string;name:string;email:string;role:string};
type Receipt={userId:string;name:string;mentioned:boolean;readAt:string|null;acknowledgedAt:string|null};
type Message={id:string;parent_message_id:string|null;author_user_id:string;authorName:string;body:string;requiresAck:boolean;created_at:string;receipts:Receipt[]};
type ThreadFeed={context:{title:string}|null;thread:{id:string;title:string;status:string}|null;messages:Message[];people:Person[]};
const when=(v:string)=>new Date(v).toLocaleString('en-AU',{timeZone:'Australia/Sydney',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const roleLabel=(v:string)=>v.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());

export function CommunicationPanel({contextType,contextId,title='Discussion'}:{contextType:CommunicationContext;contextId:string;title?:string}){
 const session=useSession(),url='/api/communications?contextType='+encodeURIComponent(contextType)+'&contextId='+encodeURIComponent(contextId);
 const feed=useApi<ThreadFeed>(url),send=useAction(),ack=useAction();
 const [body,setBody]=useState(''),[selected,setSelected]=useState<string[]>([]),[requiresAck,setRequiresAck]=useState(false),[replyTo,setReplyTo]=useState<Message|null>(null);
 const toggle=(id:string)=>setSelected(x=>x.includes(id)?x.filter(y=>y!==id):[...x,id]);
 const submit=()=>{if(!body.trim())return;void send.run(()=>api('/api/communications',{method:'POST',body:{action:'send',contextType,contextId,body:body.trim(),recipientUserIds:selected,mentionedUserIds:selected,requiresAck,parentMessageId:replyTo?.id||null}}),()=>{setBody('');setSelected([]);setRequiresAck(false);setReplyTo(null);feed.refresh();});};
 return <section className="overflow-hidden rounded-xl border bg-white" aria-label={title}>
  <div className="flex items-center gap-2 border-b px-4 py-3"><MessageSquare aria-hidden className="size-4 text-sky-700"/><h3 className="font-semibold">{title}</h3><span className="ml-auto text-xs text-slate-500">{feed.data?.messages.length||0} messages</span></div>
  <ErrorState error={feed.error||send.error||ack.error} onRetry={feed.refresh}/>
  <div className="max-h-[34rem] overflow-y-auto">
   {!feed.data?.messages.length?<div className="p-4"><EmptyState title="No messages yet." detail="Keep decisions, instructions and updates attached to the work they belong to."/></div>:<ul className="divide-y">{feed.data.messages.map(m=>{const mine=m.author_user_id===session.userId,receipt=m.receipts.find(r=>r.userId===session.userId),awaiting=m.requiresAck&&receipt&&!receipt.acknowledgedAt;return <li key={m.id} className="px-4 py-3">
    <div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{m.authorName.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-semibold">{m.authorName}</span><span className="text-xs text-slate-400">{when(m.created_at)}</span>{m.requiresAck&&<Pill tone="warning">Acknowledgement required</Pill>}</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{m.body}</p>
     <div className="mt-2 flex flex-wrap items-center gap-2">{awaiting&&<Btn variant="secondary" busy={ack.busy} onClick={()=>void ack.run(()=>api('/api/communications',{method:'POST',body:{action:'acknowledge',messageId:m.id}}),feed.refresh)}><Check aria-hidden className="size-4"/>Acknowledge</Btn>}<button type="button" className="text-xs text-slate-500 underline" onClick={()=>setReplyTo(m)}>Reply</button>{mine&&m.receipts.length>0&&<span className="text-xs text-slate-500">{m.receipts.filter(r=>r.acknowledgedAt).length}/{m.receipts.length} acknowledged · {m.receipts.filter(r=>r.readAt).length}/{m.receipts.length} read</span>}</div>
     {mine&&m.receipts.length>0&&<details className="mt-2"><summary className="cursor-pointer text-xs text-slate-500">Receipt details</summary><ul className="mt-1 grid gap-1 text-xs text-slate-500">{m.receipts.map(r=><li key={r.userId}>{r.name} · {r.acknowledgedAt?'acknowledged':r.readAt?'read':'unread'}</li>)}</ul></details>}
    </div></div>
   </li>;})}</ul>}
  </div>
  {session.can('communication.send')&&<div className="border-t bg-slate-50 p-3">
   {replyTo&&<div className="mb-2 flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-xs"><span className="truncate">Replying to {replyTo.authorName}: {replyTo.body}</span><button type="button" onClick={()=>setReplyTo(null)} aria-label="Cancel reply"><X className="size-4"/></button></div>}
   <textarea className={field+' min-h-20 resize-y bg-white'} placeholder="Write an update, instruction or question…" value={body} onChange={e=>setBody(e.target.value)}/>
   {feed.data?.people.length?<details className="mt-2 rounded-lg border bg-white p-2"><summary className="cursor-pointer text-xs font-medium text-slate-600"><Users aria-hidden className="mr-1 inline size-3.5"/>Notify / mention people {selected.length?'('+selected.length+')':''}</summary><div className="mt-2 grid gap-1 sm:grid-cols-2">{feed.data.people.filter(p=>p.id!==session.userId).map(p=><label key={p.id} className="flex items-center gap-2 rounded p-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)}/><span className="min-w-0"><span className="block truncate">{p.name}</span><span className="block truncate text-xs text-slate-400">{roleLabel(p.role)}</span></span></label>)}</div></details>:null}
   <div className="mt-2 flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={requiresAck} onChange={e=>setRequiresAck(e.target.checked)}/>Require acknowledgement</label><Btn className="ml-auto" busy={send.busy} disabled={!body.trim()||(requiresAck&&!selected.length)} onClick={submit}><Send aria-hidden className="size-4"/>Send</Btn></div>
  </div>}
 </section>;
}
