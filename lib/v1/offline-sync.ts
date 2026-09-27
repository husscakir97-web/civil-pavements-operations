// Offline queue semantics (pure, isomorphic; storage and network are injected).
// Rules:
//  - an item is removed only after the server accepted it (2xx) or the user
//    explicitly discards it; nothing is ever dropped silently;
//  - network failures, timeouts, 408/429 and 5xx are retried with capped backoff;
//  - 4xx (validation, conflict, permission) stop automatic retries and are shown
//    to the user with the server's message; the user can retry or discard;
//  - every item carries its client request id, so retries are idempotent on the server;
//  - items belong to the user who created them and only sync for that user.

export type QueueStatus='pending'|'syncing'|'failed'|'conflict';
export type QueueItem={
 id:string;// client request id (UUID), sent with every attempt
 userId:string;
 kind:'docket'|'swms-ack'|'incident';
 label:string;
 url:string;
 method:'POST';
 body:Record<string,unknown>;
 createdAt:string;
 attempts:number;
 status:QueueStatus;
 nextAttemptAt:string|null;
 lastError:string|null;
 code:string|null;
};
export type SendResult={ok:true;status:number;body:unknown}|{ok:false;status:number;body:Record<string,unknown>}|{ok:false;status:0;error:string};
export type QueueStore={list():Promise<QueueItem[]>;put(item:QueueItem):Promise<void>;remove(id:string):Promise<void>};
export type Sender=(item:QueueItem)=>Promise<SendResult>;

export const MAX_BACKOFF_MS=5*60_000;
export function backoff(attempts:number){return Math.min(MAX_BACKOFF_MS,2_000*2**Math.max(0,attempts-1));}

export function classify(r:SendResult):'done'|'retry'|'conflict'{
 if(r.ok)return 'done';
 if(r.status===0||r.status===408||r.status===429||r.status>=500)return 'retry';
 return 'conflict';
}

export function newItem(input:Pick<QueueItem,'id'|'userId'|'kind'|'label'|'url'|'body'>,now=new Date()):QueueItem{
 return {...input,method:'POST',body:{...input.body,clientRequestId:input.id},createdAt:now.toISOString(),attempts:0,status:'pending',nextAttemptAt:null,lastError:null,code:null};
}

export type SyncOutcome={id:string;kind:QueueItem['kind'];label:string;result:'done'|'retry'|'conflict';body?:unknown;error?:string};
/**
 * Sends due items for `userId` oldest first. `force` ignores backoff and retries
 * conflicted items (a manual "Retry"). `reconnected` ignores backoff for retryable
 * items only (the connection just came back), never for conflicts.
 */
export async function syncQueue(store:QueueStore,send:Sender,userId:string,opts:{now?:Date;force?:boolean;only?:string;reconnected?:boolean}={}):Promise<SyncOutcome[]>{
 const now=opts.now||new Date(),out:SyncOutcome[]=[];
 const items=(await store.list()).filter(i=>i.userId===userId&&(!opts.only||i.id===opts.only)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 for(const item of items){
  const due=opts.force||(item.status!=='conflict'&&(opts.reconnected||!item.nextAttemptAt||item.nextAttemptAt<=now.toISOString()));
  if(!due)continue;
  await store.put({...item,status:'syncing'});
  let r:SendResult;
  try{r=await send(item);}catch(e){r={ok:false,status:0,error:e instanceof Error?e.message:'Network error'};}
  const c=classify(r);
  if(c==='done'){await store.remove(item.id);out.push({id:item.id,kind:item.kind,label:item.label,result:'done',body:r.ok?r.body:undefined});continue;}
  const attempts=item.attempts+1;
  const message='error' in r?`Not sent: ${r.error}`:String((r.body as Record<string,unknown>)?.error||`Server returned ${r.status}`);
  const code='body' in r&&r.body&&typeof r.body==='object'?String((r.body as Record<string,unknown>).code||'')||null:null;
  await store.put({...item,attempts,status:c==='retry'?'failed':'conflict',nextAttemptAt:c==='retry'?new Date(now.getTime()+backoff(attempts)).toISOString():null,lastError:message,code});
  out.push({id:item.id,kind:item.kind,label:item.label,result:c,error:message});
  // Stop on connectivity loss: later items would fail the same way.
  if(c==='retry'&&r.status===0)break;
 }
 return out;
}

/** Items stuck in `syncing` (tab closed mid-request) are reset so they are retried; the id keeps it idempotent. */
export async function recoverInterrupted(store:QueueStore){
 for(const i of await store.list())if(i.status==='syncing')await store.put({...i,status:'failed',lastError:i.lastError||'Interrupted before the server replied; will retry.'});
}
