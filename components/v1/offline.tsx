'use client';
// Offline field capture: IndexedDB queue + read cache + local drafts.
// Nothing is removed from the queue until the server accepts it or the user
// discards it. Cached reads come only from field-safe endpoints (no rates).
import {createContext,useCallback,useContext,useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {CloudOff,RefreshCw,Trash2,Wifi} from 'lucide-react';
import {syncQueue,recoverInterrupted,newItem,type QueueItem,type QueueStore,type SendResult,type SyncOutcome} from '@/lib/v1/offline-sync';
import {useSession,Btn,Pill,dateText} from './kit';

const DB='infrastruct-offline',VERSION=1;
function openDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,VERSION);
  req.onupgradeneeded=()=>{const db=req.result;for(const s of ['queue','cache','drafts'])if(!db.objectStoreNames.contains(s))db.createObjectStore(s,s==='queue'?{keyPath:'id'}:undefined);};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
}
async function run<T>(store:string,mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest):Promise<T>{
 const db=await openDb();
 return new Promise<T>((resolve,reject)=>{const t=db.transaction(store,mode);const r=fn(t.objectStore(store));t.oncomplete=()=>{resolve(r.result as T);db.close();};t.onerror=()=>{reject(t.error);db.close();};t.onabort=()=>{reject(t.error);db.close();};});
}
export const idb={
 get:<T,>(store:string,key:string)=>run<T|undefined>(store,'readonly',s=>s.get(key)),
 set:(store:string,key:string,value:unknown)=>run<void>(store,'readwrite',s=>s.put(value,key)),
 del:(store:string,key:string)=>run<void>(store,'readwrite',s=>s.delete(key)),
};
const queueStore:QueueStore={
 list:()=>run<QueueItem[]>('queue','readonly',s=>s.getAll()),
 put:item=>run<void>('queue','readwrite',s=>s.put(item)),
 remove:id=>run<void>('queue','readwrite',s=>s.delete(id)),
};

async function send(item:QueueItem):Promise<SendResult>{
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20_000);
 try{
  const r=await fetch(item.url,{method:item.method,headers:{'Content-Type':'application/json'},body:JSON.stringify(item.body),signal:abort.signal,cache:'no-store'});
  const body=await r.json().catch(()=>({}));
  if(r.status===401)return {ok:false,status:0,error:'Signed out: sign in again to send'};
  return r.ok?{ok:true,status:r.status,body}:{ok:false,status:r.status,body};
 }catch(e){return {ok:false,status:0,error:abort.signal.aborted?'Timed out':e instanceof Error?e.message:'Network error'};}
 finally{clearTimeout(timer);}
}

const subscribeOnline=(cb:()=>void)=>{window.addEventListener('online',cb);window.addEventListener('offline',cb);return()=>{window.removeEventListener('online',cb);window.removeEventListener('offline',cb);};};
export function useOnline(){
 return useSyncExternalStore(subscribeOnline,()=>navigator.onLine,()=>true);
}

type Offline={online:boolean;items:QueueItem[];lastSync:string|null;lastOutcomes:SyncOutcome[];enqueue:(input:Pick<QueueItem,'id'|'kind'|'label'|'url'|'body'>)=>Promise<void>;sync:(opts?:{force?:boolean;only?:string})=>Promise<SyncOutcome[]>;discard:(id:string)=>Promise<void>;available:boolean};
const Ctx=createContext<Offline|null>(null);
export const useOffline=()=>useContext(Ctx);

export function OfflineProvider({children}:{children:ReactNode}){
 const {userId}=useSession(),online=useOnline();
 const [items,setItems]=useState<QueueItem[]>([]),[lastSync,setLastSync]=useState<string|null>(null),[lastOutcomes,setOutcomes]=useState<SyncOutcome[]>([]);
 const [available,setAvailable]=useState(true);
 const syncing=useRef(false);
 const reload=useCallback(async()=>{try{setItems((await queueStore.list()).filter(i=>i.userId===userId));}catch{setAvailable(false);}},[userId]);
 const sync=useCallback(async(opts:{force?:boolean;only?:string}={})=>{
  if(!userId||syncing.current)return [];
  syncing.current=true;
  try{const out=await syncQueue(queueStore,send,userId,opts);if(out.length)setOutcomes(out);if(out.some(o=>o.result==='done'))setLastSync(new Date().toISOString());return out;}
  catch{setAvailable(false);return [];}
  finally{syncing.current=false;await reload();}
 },[userId,reload]);
 useEffect(()=>{if(!userId)return;let active=true;void (async()=>{try{await recoverInterrupted(queueStore);}catch{if(active)setAvailable(false);}if(active)await sync();})();return()=>{active=false;};},[userId,sync]);
 // Sync when the connection returns, when the app comes back to the foreground, and every 30 s.
 useEffect(()=>{
  const tick=setInterval(()=>{if(navigator.onLine)void sync();},30_000);
  const visible=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void sync();};
  const reconnected=()=>{void sync();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('online',reconnected);
  return()=>{clearInterval(tick);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',reconnected);};
 },[sync]);
 const enqueue=useCallback(async(input:Pick<QueueItem,'id'|'kind'|'label'|'url'|'body'>)=>{await queueStore.put(newItem({...input,userId}));await reload();},[userId,reload]);
 const discard=useCallback(async(id:string)=>{await queueStore.remove(id);await reload();},[reload]);
 return <Ctx.Provider value={{online,items,lastSync,lastOutcomes,enqueue,sync,discard,available}}>{children}</Ctx.Provider>;
}

/** Tries the network first; on a connection failure serves the last copy saved on this device. */
export function useCachedApi<T>(url:string|null){
 const {userId}=useSession();
 const [state,setState]=useState<{key:string|null;data:T|null;error:string|null;cachedAt:string|null;loading:boolean}>({key:null,data:null,error:null,cachedAt:null,loading:true});
 const [tick,setTick]=useState(0);
 const refresh=useCallback(()=>setTick(t=>t+1),[]);
 useEffect(()=>{
  if(!url||!userId)return;
  const key=`${userId}:${url}`,abort=new AbortController();
  void (async()=>{
   setState(s=>({...s,loading:true}));
   try{
    const r=await fetch(url,{cache:'no-store',signal:abort.signal});
    if(r.status===401){window.location.assign('/login');return;}
    const body=await r.json().catch(()=>({}));
    if(!r.ok){setState(s=>({...s,key,loading:false,error:String(body.error||'The request failed. Please retry.')}));return;}
    setState({key,data:body as T,error:null,cachedAt:null,loading:false});
    idb.set('cache',key,{value:body,savedAt:new Date().toISOString()}).catch(()=>{});
   }catch{
    if(abort.signal.aborted)return;
    const cached=await idb.get<{value:T;savedAt:string}>('cache',key).catch(()=>undefined);
    setState(cached?{key,data:cached.value,error:null,cachedAt:cached.savedAt,loading:false}:{key,data:null,error:'You are offline and this has not been saved on this device yet.',cachedAt:null,loading:false});
   }
  })();
  return()=>abort.abort();
 },[url,userId,tick]);
 return {...state,refresh};
}

/** A form draft kept on this device (survives refresh and loss of signal) until cleared. */
export function useDraft<T>(key:string,initial:T){
 const {userId}=useSession(),full=`${userId}:${key}`;
 const [value,setValue]=useState<T>(initial),[restored,setRestored]=useState(false);
 useEffect(()=>{if(!userId)return;let active=true;idb.get<T>('drafts',full).then(v=>{if(active&&v!==undefined)setValue(v);}).catch(()=>{}).finally(()=>{if(active)setRestored(true);});return()=>{active=false;};},[full,userId]);
 useEffect(()=>{if(!restored)return;const t=setTimeout(()=>{idb.set('drafts',full,value).catch(()=>{});},300);return()=>clearTimeout(t);},[full,value,restored]);
 const clear=useCallback(async()=>{setValue(initial);await idb.del('drafts',full).catch(()=>{});},[full,initial]);
 return [value,setValue,clear] as const;
}

export function OfflineBanner(){
 const o=useOffline();
 if(!o)return null;
 const waiting=o.items.filter(i=>i.status!=='conflict'),conflicts=o.items.filter(i=>i.status==='conflict');
 return <section aria-live="polite" className="grid gap-2">
  <div className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm ${o.online?'border-emerald-200 bg-emerald-50 text-emerald-900':'border-amber-300 bg-amber-50 text-amber-900'}`}>
   {o.online?<Wifi aria-hidden className="size-4"/>:<CloudOff aria-hidden className="size-4"/>}
   <span className="font-medium">{o.online?'Online':'Offline: work is saved on this device'}</span>
   {waiting.length>0&&<Pill tone="warning">{waiting.length} waiting to send</Pill>}
   {conflicts.length>0&&<Pill tone="danger">{conflicts.length} need attention</Pill>}
   {o.lastSync&&<span className="text-xs">Last sent {new Date(o.lastSync).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}</span>}
   {o.items.length>0&&<Btn variant="secondary" className="ml-auto min-h-9 px-2.5 py-1 text-xs" disabled={!o.online} onClick={()=>void o.sync({force:true})}><RefreshCw aria-hidden className="size-3.5"/>Send now</Btn>}
  </div>
  {!o.available&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">This browser is blocking on-device storage, so work cannot be kept offline. Stay online to submit, or allow site data for this site.</p>}
  {o.items.length>0&&<ul className="grid gap-2">{o.items.map(i=><li key={i.id} className={`rounded-xl border bg-white p-3 text-sm ${i.status==='conflict'?'border-red-200':''}`}>
   <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i.label}</span><Pill tone={i.status==='conflict'?'danger':i.status==='syncing'?'info':'warning'}>{i.status==='conflict'?'Not accepted':i.status==='syncing'?'Sending…':i.attempts?'Retrying':'Waiting'}</Pill><span className="text-xs text-slate-500">captured {dateText(i.createdAt.slice(0,10))} {new Date(i.createdAt).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}</span></div>
   {i.lastError&&<p className="mt-1 text-slate-700">{i.lastError}</p>}
   <div className="mt-2 flex gap-2"><Btn variant="secondary" className="min-h-9 px-2.5 py-1 text-xs" disabled={!o.online||i.status==='syncing'} onClick={()=>void o.sync({force:true,only:i.id})}><RefreshCw aria-hidden className="size-3.5"/>Retry</Btn>
    <Btn variant="danger" className="min-h-9 px-2.5 py-1 text-xs" disabled={i.status==='syncing'} onClick={()=>{if(confirm(`Discard "${i.label}" from this device? It has not been accepted by the office and cannot be recovered.`))void o.discard(i.id);}}><Trash2 aria-hidden className="size-3.5"/>Discard</Btn></div>
  </li>)}</ul>}
 </section>;
}

export const requestId=()=>crypto.randomUUID();
export function isNetworkFailure(e:unknown){return e instanceof TypeError||(e as {status?:number})?.status===0||((e as {status?:number})?.status??0)>=500;}
