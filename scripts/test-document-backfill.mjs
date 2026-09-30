// Migration test for the 0022 managed-document backfill against real MySQL (disposable database).
// Proves: single current file, safe supersedes chain, ambiguous shapes left alone, evidence contexts
// (Forms, corrective action, commercial) never converted, tenant separation, no raw row or id changed,
// no invented metadata, and that reruns are no-ops.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import mysql from 'mysql2/promise';
import {mysqlOptions,identifier} from './mysql-config.mjs';
import {backfillDocuments,planAdoption} from './backfill-documents.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');

// Pure planner first: shapes without a database.
{
 const r=(id,o={})=>({id,supersedes_id:null,version:1,status:'current',context_type:'project',context_id:'p1',project_id:'p1',created_at:'2026-01-01T00:00:00.000Z',...o});
 const chain=planAdoption([r('a',{status:'superseded'}),r('b',{supersedes_id:'a',version:2,status:'superseded'}),r('c',{supersedes_id:'b',version:3})]);
 assert.deepEqual(chain.groups.map(g=>g.map(x=>x.id)),[['a','b','c']]);assert.equal(chain.ambiguous.length,0);
 assert.equal(planAdoption([r('x',{status:'superseded'})]).groups.length,0,'superseded with no successor is ambiguous');
 assert.equal(planAdoption([r('a',{status:'superseded'}),r('b',{supersedes_id:'a',version:2}),r('c',{supersedes_id:'a',version:2})]).groups.length,0,'branching chain is ambiguous');
 assert.equal(planAdoption([r('a',{status:'superseded'}),r('b',{supersedes_id:'a',version:3})]).groups.length,0,'version gap is ambiguous');
 assert.equal(planAdoption([r('a',{status:'superseded'}),r('b',{supersedes_id:'a',version:2,context_id:'p2',project_id:'p2'})]).groups.length,0,'crossing contexts is ambiguous');
 assert.equal(planAdoption([r('b',{supersedes_id:'gone',version:2})]).groups.length,0,'dangling pointer is ambiguous');
}

const name=process.env.MYSQL_DATABASE+'_docs_test';
const admin=await mysql.createConnection({...mysqlOptions(),database:undefined});
await admin.query('DROP DATABASE IF EXISTS '+identifier(name));
await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
const run=(file,env)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[file],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let log='';c.stdout.on('data',b=>log+=b);c.stderr.on('data',b=>log+=b);c.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
const db=await mysql.createConnection({...mysqlOptions(),database:name});
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
try{
 let log=await run('scripts/migrate.mjs',{MYSQL_DATABASE:name});
 assert.match(log,/Applied 0022_document_engine_foundation\.sql/);assert.match(log,/Document backfill: nothing to adopt/);
 const doc=(id,org,o={})=>db.query('INSERT INTO documents (id,organisation_id,context_type,context_id,project_id,category,title,file_name,content_type,size_bytes,storage_key,sha256,version,status,visibility,source,supersedes_id,uploaded_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  [id,org,o.context??'organisation',o.contextId??null,o.project??null,o.category??'General',o.title??id,o.file??id+'.pdf','application/pdf',10,`documents/${org}/${id}`,'h-'+id,o.version??1,o.status??'current','office','upload',o.supersedes??null,'u1',o.at??'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z']);
 const A='org-a',B='org-b';
 await doc('single',A,{title:'Company handbook'});
 await doc('lib-doc',A,{context:'library',title:'Insurance certificate',category:'Insurance'});
 await doc('c1',A,{context:'project',contextId:'p1',project:'p1',title:'Pavement layout',category:'Drawings',version:1,status:'superseded',at:'2026-01-02T00:00:00.000Z'});
 await doc('c2',A,{context:'project',contextId:'p1',project:'p1',title:'Pavement layout',category:'Drawings',version:2,status:'superseded',supersedes:'c1',at:'2026-01-03T00:00:00.000Z'});
 await doc('c3',A,{context:'project',contextId:'p1',project:'p1',title:'Pavement layout Rev C',category:'Drawings',version:3,supersedes:'c2',at:'2026-01-04T00:00:00.000Z'});
 await doc('tender-one',A,{context:'tender',contextId:'t1',title:'Tender schedule'});
 // Ambiguous shapes: stay legacy attachments.
 await doc('amb-orphan',A,{context:'project',contextId:'p1',project:'p1',status:'superseded',version:1});
 await doc('br0',A,{context:'project',contextId:'p2',project:'p2',status:'superseded'});
 await doc('br1',A,{context:'project',contextId:'p2',project:'p2',version:2,supersedes:'br0'});
 await doc('br2',A,{context:'project',contextId:'p2',project:'p2',version:2,supersedes:'br0'});
 await doc('gap0',A,{context:'tender',contextId:'t2',status:'superseded'});
 await doc('gap1',A,{context:'tender',contextId:'t2',version:3,supersedes:'gap0'});
 // Evidence / controlled contexts: never converted.
 await doc('form-ev',A,{context:'form',contextId:'project:p1',project:'p1',category:'Form evidence'});
 await doc('action-ev',A,{context:'action',contextId:'act1',project:'p1'});
 await doc('variation-att',A,{context:'variation',contextId:'v1',project:'p1'});
 await doc('claim-att',A,{context:'claim',contextId:'c1',project:'p1'});
 // Another tenant.
 await doc('b-single',B,{title:'Other org doc'});
 const rawBefore=JSON.stringify(await q('SELECT * FROM documents ORDER BY id'));

 const result=await backfillDocuments(db,()=>{});
 assert.deepEqual(result[A],{managed:4,versions:6,ambiguous:6},'org A: 3 singles + 1 chain adopted; ambiguous shapes recorded');
 assert.deepEqual(result[B],{managed:1,versions:1,ambiguous:0});
 assert.equal(JSON.stringify(await q('SELECT * FROM documents ORDER BY id')),rawBefore,'no raw document row, id or legacy column changed');

 const managed=await q('SELECT * FROM managed_documents ORDER BY id');
 assert.deepEqual(managed.map(m=>m.id),['md-b-single','md-c1','md-lib-doc','md-single','md-tender-one']);
 const chain=managed.find(m=>m.id==='md-c1');
 assert.equal(chain.title,'Pavement layout Rev C');assert.equal(chain.current_version_id,'dv-c3');assert.equal(chain.document_type,'Drawings');
 assert.equal(chain.context_type,'project');assert.equal(chain.context_id,'p1');assert.equal(chain.project_id,'p1');assert.equal(chain.source,'backfill');
 assert.equal(chain.document_number,null);assert.equal(chain.discipline,null);
 assert.equal(managed.find(m=>m.id==='md-single').document_type,null,'default General category is not turned into a type');
 assert.equal(managed.find(m=>m.id==='md-b-single').organisation_id,B);
 const versions=await q("SELECT id,version_number,revision_label,file_document_id,sha256,managed_document_id FROM document_versions WHERE managed_document_id='md-c1' ORDER BY version_number");
 assert.deepEqual(versions.map(v=>[v.id,v.version_number,v.file_document_id,v.sha256,v.revision_label]),[['dv-c1',1,'c1','h-c1',null],['dv-c2',2,'c2','h-c2',null],['dv-c3',3,'c3','h-c3',null]],'order preserved, hashes mirrored, no revision labels invented');
 const adopted=new Set((await q('SELECT file_document_id FROM document_versions')).map(v=>v.file_document_id));
 for(const id of ['amb-orphan','br0','br1','br2','gap0','gap1','form-ev','action-ev','variation-att','claim-att'])assert(!adopted.has(id),id+' stays a legacy/raw attachment');
 assert.equal((await q("SELECT COUNT(*) n FROM data_migration_issues WHERE migration='0022_document_engine_foundation' AND organisation_id=?",[A]))[0].n,6);
 assert.equal((await q("SELECT COUNT(*) n FROM data_migration_issues WHERE organisation_id=?",[B]))[0].n,0,'tenant separation');

 // Rerun (direct and through migrate): nothing new, nothing changed.
 const snapshot=JSON.stringify([await q('SELECT * FROM managed_documents ORDER BY id'),await q('SELECT * FROM document_versions ORDER BY id')]);
 const again=await backfillDocuments(db,()=>{});
 assert.equal(again[A].managed,0);assert.equal(again[A].versions,0);
 log=await run('scripts/migrate.mjs',{MYSQL_DATABASE:name});
 assert.equal(JSON.stringify([await q('SELECT * FROM managed_documents ORDER BY id'),await q('SELECT * FROM document_versions ORDER BY id')]),snapshot);
 assert.equal(JSON.stringify(await q('SELECT * FROM documents ORDER BY id')),rawBefore);
 console.log('Document backfill migration test passed:',JSON.stringify(result));
}finally{await db.end();await admin.query('DROP DATABASE IF EXISTS '+identifier(name));await admin.end();}
