// Idempotent writes for offline/queued clients. The client generates a request id
// (UUID) when the user acts; every retry sends the same id. The first successful
// result is stored in client_requests inside the same transaction as the write, so
// a replay returns the original result and never creates a second record.
// Failed attempts are not stored: a retry after the conflict is resolved runs again.
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from './context';
import {fail} from './http';
import {createHash} from 'node:crypto';
import {one,exec,tx,nowIso,uuid} from './sql';

export const CLIENT_REQUEST_ID=/^[A-Za-z0-9-]{16,80}$/;
export type Replayable<T>={result:T;replay:boolean};

/** Stable hash of the request payload: a request id replayed with different content is refused. */
export function fingerprint(payload:unknown){
 const canon=(v:unknown):unknown=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v as object).sort().filter(k=>k!=='clientRequestId').map(k=>[k,canon((v as Record<string,unknown>)[k])])):v;
 return createHash('sha256').update(JSON.stringify(canon(payload))).digest('hex');
}

async function stored<T>(clientRequestId:string,kind:string,print:string|null,conn?:PoolConnection):Promise<Replayable<T>|null>{
 const a=actorContext.getStore()!;
 const row=await one('SELECT user_id,kind,response FROM client_requests WHERE organisation_id=? AND client_request_id=?'+(conn?' FOR UPDATE':''),[a.organisationId,clientRequestId],conn);
 if(!row)return null;
 const saved=JSON.parse(row.response||'null') as {result:T;fingerprint:string|null}|null;
 if(row.user_id!==a.userId||row.kind!==kind||(print&&saved?.fingerprint&&saved.fingerprint!==print))fail(409,'This request id has already been used for a different action.',{code:'REQUEST_ID_REUSED'});
 return {result:saved?.result as T,replay:true};
}

export async function idempotent<T>(kind:string,clientRequestId:string|null|undefined,run:(conn:PoolConnection)=>Promise<T>,entity?:(result:T)=>{type:string;id:string},payload?:unknown):Promise<Replayable<T>>{
 if(!clientRequestId)return {result:await tx(run),replay:false};
 if(!CLIENT_REQUEST_ID.test(clientRequestId))fail(400,'Invalid request id.');
 const a=actorContext.getStore()!,print=payload===undefined?null:fingerprint(payload);
 try{
  return await tx(async conn=>{
   const previous=await stored<T>(clientRequestId,kind,print,conn);
   if(previous)return previous;
   const result=await run(conn);
   const e=entity?.(result);
   await exec('INSERT INTO client_requests (id,organisation_id,client_request_id,user_id,kind,entity_type,entity_id,status,response_status,response,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[uuid(),a.organisationId,clientRequestId,a.userId,kind,e?.type||null,e?.id||null,'applied',200,JSON.stringify({result,fingerprint:print}),nowIso()],conn);
   return {result,replay:false};
  });
 }catch(e){
  // Two deliveries of the same request raced: the loser rolled back; return the winner's result.
  if((e as {code?:string})?.code==='ER_DUP_ENTRY'){const previous=await stored<T>(clientRequestId,kind,print);if(previous)return previous;}
  throw e;
 }
}
