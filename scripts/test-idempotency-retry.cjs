// Deterministic tests for lib/platform/idempotency.ts: deadlock retry, retry exhaustion, winner-result replay, rollback and no duplicates.
// The real module is transpiled and run against an in-memory transactional store (snapshot on begin, discard on error), so every retry path
// executes on every run instead of depending on a timing race in a real database.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function build(script={}){
 const committed={client_requests:[],service:[],meter:[],audit:[],event:[]};
 const state={committed,attempts:0,txStarts:0,script};
 const clone=o=>JSON.parse(JSON.stringify(o));
 const tableOf=conn=>conn?conn.work:committed;
 const sql={
  nowIso:()=>'2026-10-01T00:00:00.000Z',uuid:()=>'id-'+Math.random().toString(16).slice(2),
  async one(text,params,conn){
   assert.match(text,/FROM client_requests/);
   const row=tableOf(conn).client_requests.find(r=>r.organisation_id===params[0]&&r.client_request_id===params[1]);
   return row?{user_id:row.user_id,kind:row.kind,response:row.response}:undefined;
  },
  async exec(text,params,conn){
   assert.match(text,/INSERT INTO client_requests/);
   const t=tableOf(conn);
   if(script.raceOnInsert&&!state.raced){ // another delivery commits the same request between our check and our insert
    state.raced=true;script.raceOnInsert(committed);
    throw Object.assign(new Error('Duplicate entry'),{code:'ER_DUP_ENTRY'});
   }
   if(t.client_requests.some(r=>r.organisation_id===params[1]&&r.client_request_id===params[2]))throw Object.assign(new Error('Duplicate entry'),{code:'ER_DUP_ENTRY'});
   t.client_requests.push({id:params[0],organisation_id:params[1],client_request_id:params[2],user_id:params[3],kind:params[4],response:params[9]});
  },
  async tx(fn){
   state.txStarts++;const work=clone(committed),conn={work};
   const out=await fn(conn); // throws => work is discarded: a full rollback
   const fault=script.failAtCommit?.(state.txStarts);if(fault)throw fault; // e.g. a deadlock raised when the transaction tries to finish
   for(const k of Object.keys(committed))committed[k]=work[k];
   return out;
  },
 };
 const http={fail:(status,message,details)=>{throw Object.assign(new Error(message),{status,details});}};
 const ctx={actorContext:{getStore:()=>({organisationId:'org-1',userId:'user-1'})}};
 const mods={'./sql':sql,'./http':http,'./context':ctx};
 const code=ts.transpileModule(fs.readFileSync('lib/platform/idempotency.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(n=>mods[n]||require(n),m,m.exports);
 return {idempotent:m.exports.idempotent,state,committed};
}
const REQ='abcdef0123456789abcdef',deadlock=()=>Object.assign(new Error('Deadlock found when trying to get lock'),{code:'ER_LOCK_DEADLOCK',errno:1213});
// The write a real service does: service history, meter history, audit and domain event, all through the transaction's connection.
const service=state=>async conn=>{state.attempts++;const n=state.attempts;for(const t of ['service','meter','audit','event'])conn.work[t].push({n});return {id:'svc',n};};
const counts=c=>({service:c.service.length,meter:c.meter.length,audit:c.audit.length,event:c.event.length,requests:c.client_requests.length});
const once={service:1,meter:1,audit:1,event:1,requests:1},none={service:0,meter:0,audit:0,event:0,requests:0};

(async()=>{
 // 1. A deadlock rolls the whole attempt back; the retry succeeds and records everything exactly once.
 {const {idempotent,state,committed}=build({failAtCommit:n=>n===1?deadlock():null});
  const r=await idempotent('workshop.service',REQ,service(state),()=>({type:'asset',id:'a1'}),{x:1});
  assert.equal(state.attempts,2,'the body ran again after the deadlock');assert.equal(state.txStarts,2);assert.equal(r.replay,false);assert.equal(r.result.n,2);
  assert.deepEqual(counts(committed),once,'one service, meter, audit, event and request record: nothing from the deadlocked attempt survives');
  assert.deepEqual(committed.service,[{n:2}],'the surviving record is the retried attempt\'s, not the rolled-back one');}
 // 2. Repeated deadlocks exhaust the limit (3 attempts), surface the error, and leave nothing behind.
 {const {idempotent,state,committed}=build({failAtCommit:()=>deadlock()});
  await assert.rejects(idempotent('workshop.service',REQ,service(state),()=>({type:'asset',id:'a1'}),{x:1}),e=>e.code==='ER_LOCK_DEADLOCK');
  assert.equal(state.attempts,3,'exactly three attempts');assert.equal(state.txStarts,3);assert.deepEqual(counts(committed),none,'full rollback: no service, meter, audit, event or request record');}
 // 3. Two deadlocks then success still lands once (attempt limit not exceeded).
 {const {idempotent,state,committed}=build({failAtCommit:n=>n<=2?deadlock():null});
  const r=await idempotent('workshop.service',REQ,service(state),()=>({type:'asset',id:'a1'}),{x:1});
  assert.equal(state.attempts,3);assert.equal(r.result.n,3);assert.deepEqual(counts(committed),once);}
 // 4. Winner-result replay: another delivery commits the same request first (duplicate key on our insert). We return ITS result and keep nothing of ours.
 {const {idempotent,state,committed}=build({raceOnInsert:c=>{for(const t of ['service','meter','audit','event'])c[t].push({n:'winner'});c.client_requests.push({id:'w',organisation_id:'org-1',client_request_id:REQ,user_id:'user-1',kind:'workshop.service',response:JSON.stringify({result:{id:'svc',n:'winner'},fingerprint:require('node:crypto').createHash('sha256').update(JSON.stringify({x:1})).digest('hex')})});}});
  const r=await idempotent('workshop.service',REQ,service(state),()=>({type:'asset',id:'a1'}),{x:1});
  assert.equal(r.replay,true);assert.equal(r.result.n,'winner');assert.equal(state.attempts,1,'the loser ran once and rolled back');
  assert.deepEqual(counts(committed),once,'no duplicate records: only the winner\'s');assert.deepEqual(committed.service,[{n:'winner'}]);}
 // 5. A loser that wakes to a stale-revision conflict (409) after the winner committed replays the winner; with no winner the 409 is NOT swallowed.
 {const winnerRow=fp=>({id:'w',organisation_id:'org-1',client_request_id:REQ,user_id:'user-1',kind:'workshop.service',response:JSON.stringify({result:{id:'svc',n:'winner'},fingerprint:fp})});
  const fp=require('node:crypto').createHash('sha256').update(JSON.stringify({x:1})).digest('hex');
  {const {idempotent,state,committed}=build();
   const r=await idempotent('workshop.service',REQ,async conn=>{state.attempts++;conn.work.service.push({n:'loser'});committed.client_requests.push(winnerRow(fp));committed.service.push({n:'winner'});throw Object.assign(new Error('This asset changed.'),{status:409});},()=>({type:'asset',id:'a1'}),{x:1});
   assert.equal(r.replay,true);assert.equal(r.result.n,'winner');assert.deepEqual(committed.service,[{n:'winner'}],'the loser\'s write was rolled back');}
  {const {idempotent,state,committed}=build();
   await assert.rejects(idempotent('workshop.service',REQ,async conn=>{state.attempts++;conn.work.service.push({n:'x'});throw Object.assign(new Error('This asset changed.'),{status:409});},()=>({type:'asset',id:'a1'}),{x:1}),e=>e.status===409);
   assert.equal(state.attempts,1,'a genuine conflict is not retried');assert.deepEqual(counts(committed),none);}}
 // 6. Same request id with different content is refused, never replayed; errors that are not deadlocks are not retried.
 {const {idempotent,state,committed}=build();
  await idempotent('workshop.service',REQ,service(state),()=>({type:'asset',id:'a1'}),{x:1});
  await assert.rejects(idempotent('workshop.service',REQ,service(state),()=>({type:'asset',id:'a1'}),{x:2}),e=>e.status===409&&e.details?.code==='REQUEST_ID_REUSED');
  const replay=await idempotent('workshop.service',REQ,service(state),()=>({type:'asset',id:'a1'}),{x:1});
  assert.equal(replay.replay,true);assert.equal(state.attempts,1,'a retry never re-runs the body');assert.deepEqual(counts(committed),once);}
 {const {idempotent,state,committed}=build();
  await assert.rejects(idempotent('workshop.service','zzzzzzzzzzzzzzzzzzzzzz',async conn=>{state.attempts++;conn.work.service.push({n:1});throw new Error('boom');},()=>({type:'asset',id:'a1'}),{x:1}),/boom/);
  assert.equal(state.attempts,1,'other errors are not retried');assert.deepEqual(counts(committed),none,'and roll back completely');}
 // Without a request id there is no idempotency and no retry wrapper: the body runs in one transaction.
 {const {idempotent,state,committed}=build();await idempotent('x',null,service(state));assert.equal(committed.service.length,1);assert.equal(committed.client_requests.length,0);}
 console.log('PASS idempotency retry: deadlock then success, retry exhaustion, winner-result replay (duplicate key and stale conflict), full rollback and no duplicate service/meter/audit/event records');
})().catch(e=>{console.error(e);process.exitCode=1;});
