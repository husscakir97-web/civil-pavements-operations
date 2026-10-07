// Regression: START TRANSACTION WITH CONSISTENT SNAPSHOT must never rely on the server's default isolation level.
// Hosted MyRocks (RocksDB) rejects it unless the session is REPEATABLE READ ("Only REPEATABLE READ isolation level is supported for START TRANSACTION
// WITH CONSISTENT SNAPSHOT in RocksDB Storage Engine"), which failed `plan` before it returned a plan. No database needed: a fake connection behaves like it.
import {readFileSync,readdirSync} from 'node:fs';
import {beginConsistentReadOnlySnapshot,assertReadOnlySql} from './live-tenant-inventory.mjs';

let failed=0;
const check=(name,ok,detail='')=>{console.log((ok?'PASS ':'FAIL ')+name+(ok||!detail?'':' — '+detail));if(!ok)failed++;};

/** A single-connection stand-in for a RocksDB server whose default level is `serverDefault`. */
function fakeServer({serverDefault='READ-COMMITTED',honoursSet=true,variable='transaction_isolation'}={}){
 const log=[];let level=serverDefault,readOnly=false,inTx=false;
 const rows=async sql=>{
  log.push(sql);
  if(/^SHOW SESSION VARIABLES/i.test(sql))return [{Variable_name:variable,Value:level}];
  let m=sql.match(/^SET SESSION TRANSACTION ISOLATION LEVEL (.+)$/i);
  if(m){if(honoursSet)level=m[1].replace(/ /g,'-');return [];}
  if(/^SET SESSION TRANSACTION READ ONLY$/i.test(sql)){readOnly=true;return [];}
  if(/^START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY$/i.test(sql)){
   if(level!=='REPEATABLE-READ')throw new Error('Only REPEATABLE READ isolation level is supported for START TRANSACTION WITH CONSISTENT SNAPSHOT in RocksDB Storage Engine.');
   if(!readOnly)throw new Error('read-only expected');inTx=true;return [];}
  throw new Error('unexpected statement: '+sql);
 };
 return {rows,log,get level(){return level;},get inTx(){return inTx;}};
};

// 1. the old sequence (no isolation request) fails exactly as hosted, so the fake is a faithful reproduction
{const s=fakeServer();let msg='';try{await s.rows('SET SESSION TRANSACTION READ ONLY');await s.rows('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');}catch(e){msg=e.message;}
 check('reproduction: inheriting a READ COMMITTED default fails with the RocksDB error',/Only REPEATABLE READ isolation level is supported/.test(msg));}

// 2. the fix: isolation requested on the same connection, confirmed, and only then the snapshot starts
for(const variable of ['transaction_isolation','tx_isolation']){
 const s=fakeServer({variable});const restore=await beginConsistentReadOnlySnapshot(s.rows);
 const i=sql=>s.log.findIndex(x=>x.startsWith(sql));
 check(`snapshot starts under a RocksDB-like READ COMMITTED default (${variable})`,s.inTx);
 check('isolation is requested before the transaction starts',i('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')>=0&&i('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')<i('START TRANSACTION'));
 check('the effective level is read back after the request and before the snapshot',s.log.findIndex((x,n)=>/^SHOW SESSION VARIABLES/.test(x)&&n>i('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'))<i('START TRANSACTION')&&s.log.findIndex((x,n)=>/^SHOW SESSION VARIABLES/.test(x)&&n>i('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'))>0);
 check('the consistent-snapshot, read-only transaction is still the one that is started',s.log.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
 await restore();
 check('the session\'s previous isolation level is restored afterwards',s.level==='READ-COMMITTED');
}

// 3. fail closed: if the server does not confirm REPEATABLE READ, no snapshot is attempted
{const s=fakeServer({honoursSet:false});let msg='';try{await beginConsistentReadOnlySnapshot(s.rows);}catch(e){msg=e.message;}
 check('an unconfirmed isolation level aborts before any transaction starts',/did not confirm a REPEATABLE READ session/.test(msg)&&!s.inTx&&!s.log.some(x=>/^START TRANSACTION/.test(x)));}

// 4. already REPEATABLE READ: nothing to restore, still works
{const s=fakeServer({serverDefault:'REPEATABLE-READ'});const restore=await beginConsistentReadOnlySnapshot(s.rows);const before=s.log.length;await restore();
 check('a REPEATABLE READ default works and restore is a no-op',s.inTx&&s.log.length===before&&s.level==='REPEATABLE-READ');}

// 5. the guarded read-only channel accepts only the isolation request it needs, nothing broader
for(const ok of ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ','SET SESSION TRANSACTION READ ONLY','START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY']){
 let refused=false;try{assertReadOnlySql(ok);}catch{refused=true;}check('guard allows: '+ok,!refused);}
for(const bad of ['SET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED','SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ; DELETE FROM clients','SET SESSION TRANSACTION READ WRITE','SET SESSION TRANSACTION ISOLATION LEVEL BOGUS']){
 let refused=false;try{assertReadOnlySql(bad);}catch{refused=true;}check('guard refuses: '+bad,refused);}

// 6. no script starts a consistent snapshot except through the helper
const dir=new URL('./',import.meta.url);const offenders=[];
for(const f of readdirSync(dir).filter(n=>/\.(mjs|cjs|js)$/.test(n)&&!n.startsWith('test-'))){
 const t=readFileSync(new URL(f,dir),'utf8').split('\n');
 t.forEach((line,n)=>{if(/WITH CONSISTENT SNAPSHOT/.test(line)&&!/^\s*\/\//.test(line)&&!/\bALLOWED\b|rows\('START TRANSACTION WITH CONSISTENT SNAPSHOT/.test(line))offenders.push(`${f}:${n+1}`);});}
check('every WITH CONSISTENT SNAPSHOT goes through beginConsistentReadOnlySnapshot',offenders.length===0,offenders.join(', '));

console.log(failed?`\n${failed} check(s) FAILED`:'\nsnapshot isolation: all checks passed');
process.exit(failed?1:0);
