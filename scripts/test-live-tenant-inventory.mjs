// Proves scripts/live-tenant-inventory.mjs on a disposable database: it reads only, leaves the database byte-for-byte unchanged,
// exposes no credentials or personal content, and reports counts, relationships and deletion dependencies correctly.
//   MYSQL_DATABASE=inventory_check_test node scripts/test-live-tenant-inventory.mjs     (database must be empty)
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {connect,identifier} from './mysql-config.mjs';
import {assertReadOnlySql,inventory,seal} from './live-tenant-inventory.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const run=(args,env={})=>spawnSync(process.execPath,['scripts/live-tenant-inventory.mjs',...args],{env:{...process.env,...env},encoding:'utf8'});
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env:process.env,encoding:'utf8'});if(migrated.status!==0)throw new Error(migrated.stderr);
const db=await connect();
const results=[];const check=(name,ok,detail='')=>{results.push(Boolean(ok));console.log(`${ok?'PASS':'FAIL'}    ${name}${detail?' — '+detail:''}`);};

// ---- synthetic data: two organisations, personal-looking values that must never appear in the output ----
const dummy=type=>/int|decimal|float|double|bit/.test(type)?0:/date|time/.test(type)?'2026-01-01 00:00:00':/json/.test(type)?'{}':'x';
async function insert(table,values){
 const cols=(await db.query('SELECT COLUMN_NAME c,DATA_TYPE t,IS_NULLABLE n,COLUMN_DEFAULT d,EXTRA e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]))[0];
 const row={...values};for(const c of cols)if(!(c.c in row)&&c.n==='NO'&&c.d===null&&!/auto_increment/.test(c.e))row[c.c]=dummy(c.t);
 const keys=Object.keys(row);await db.query(`INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]));
}
const A='org-inv-a',B='org-inv-b',SECRET_EMAIL='jane.sentinel@pii-sentinel.example.invalid',SECRET_PHONE='0499-SENTINEL-555',SECRET_NOTE='SENTINEL-PRIVATE-NOTE';
for(const [id,name] of [[A,'Tenant A'],[B,'Tenant B']])await insert('organisations',{id,name});
await insert('users',{id:'u-a',organisation_id:A,email:SECRET_EMAIL,name:'Jane Sentinel',role:'admin'});
await insert('users',{id:'u-b',organisation_id:B,email:'b@pii-sentinel.example.invalid',name:'Bee',role:'admin'});
for(const [id,org] of [['cl-a1',A],['cl-a2',A],['cl-b1',B]])await insert('clients',{id,organisation_id:org,name:'Client '+id,email:SECRET_EMAIL,phone:SECRET_PHONE,notes:SECRET_NOTE});
await insert('client_sites',{id:'s-a1',organisation_id:A,client_id:'cl-a1',name:'Site 1'});
await insert('client_sites',{id:'s-a2',organisation_id:A,client_id:'cl-a1',name:'Site 2'});
await insert('client_sites',{id:'s-a3',organisation_id:A,client_id:'cl-gone',name:'Orphan site'});     // dangling reference
await insert('client_sites',{id:'s-b1',organisation_id:B,client_id:'cl-b1',name:'B site'});
await insert('client_sites',{id:'s-x',organisation_id:B,client_id:'cl-a2',name:'Cross-tenant reference'}); // other tenant points at A's client

// ---- fingerprint of EVERY table in the database, independent of the tool, to prove nothing changes ----
const whole=async()=>{const out={};for(const [{t}] of [])void t;const tables=(await db.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY 1"))[0];
 for(const {t} of tables){const [rows]=await db.query(`SELECT * FROM ${identifier(t)}`);const h=createHash('sha256');for(const r of rows.map(x=>JSON.stringify(x)).sort())h.update(r);out[t]=rows.length+':'+h.digest('hex');}return out;};
const objectsBefore=JSON.stringify((await db.query("SELECT TABLE_NAME,TABLE_ROWS,AUTO_INCREMENT,CREATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY 1"))[0].map(r=>[r.TABLE_NAME,r.AUTO_INCREMENT,String(r.CREATE_TIME)]));
const before=await whole();

// ---- run the real CLI ----
const first=run(['--organisation-id',A]);
check('CLI succeeds for an existing organisation',first.status===0,first.stderr.slice(0,200));
const report=JSON.parse(first.stdout);
const after=await whole();
check('every table in the database is unchanged after the run (row counts and content)',JSON.stringify(before)===JSON.stringify(after));
check('table definitions and auto-increment counters unchanged',objectsBefore===JSON.stringify((await db.query("SELECT TABLE_NAME,TABLE_ROWS,AUTO_INCREMENT,CREATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY 1"))[0].map(r=>[r.TABLE_NAME,r.AUTO_INCREMENT,String(r.CREATE_TIME)])));
const second=run(['--organisation-id',A]);
check('two runs give identical, deterministic output',second.status===0&&JSON.parse(second.stdout).inventoryHash===report.inventoryHash);

// ---- required input and refusals ----
check('refuses to run without an organisation id',run([]).status===2);
check('refuses an organisation id that does not exist (and says so without leaking anything)',(()=>{const r=run(['--organisation-id','nope']);return r.status===1&&/not found/i.test(r.stderr)&&!r.stdout;})());
check('does not accept another flag as the organisation id',run(['--organisation-id','--out']).status===2);
check('refuses to overwrite an existing output file',run(['--organisation-id',A,'--out','package.json']).status===2);
const bad=run(['--organisation-id',A],{MYSQL_PASSWORD:'definitely-wrong-password-123'});
check('a failed connection reports no host, user or password',bad.status===2&&!/definitely-wrong|127\.0\.0\.1|ci@/.test(bad.stdout+bad.stderr));

// ---- no credentials, no personal content ----
const text=first.stdout;
check('output contains no credentials or connection details',![process.env.MYSQL_PASSWORD,process.env.MYSQL_HOST,process.env.MYSQL_USER+'@','BETTER_AUTH_SECRET'].filter(Boolean).some(s=>text.includes(s)));
check('output contains none of the planted personal values (email, phone, notes, names)',![SECRET_EMAIL,SECRET_PHONE,SECRET_NOTE,'Jane Sentinel','pii-sentinel'].some(s=>text.includes(s)));

// ---- correctness ----
check('counts own rows per table',report.tables.clients.ownRows===2&&report.tables.client_sites.ownRows===3&&report.tables.users.ownRows===1);
check('counts other tenants separately',report.tables.clients.otherRows===1&&report.tables.client_sites.otherRows===2&&report.otherOrganisations===1);
const edge=report.relationships.find(e=>e.child==='client_sites'&&e.column==='client_id'&&e.parent==='clients');
check('infers client_sites.client_id → clients from the data (2 matched, 1 orphan)',edge&&edge.referencingRows===3&&edge.matchedRows===2&&edge.orphanRows===1&&edge.basis==='inferred, partly matched');
check('detects another tenant referencing this tenant\'s client',edge&&edge.crossTenantRows===1&&report.summary.crossTenantReferences>=1);
check('lists clients as having client_sites as a deletion dependency, children first',report.deletionDependencies.clients?.some(d=>d.referencedBy==='client_sites'&&d.rows===2)&&report.childFirstOrder.indexOf('client_sites')<report.childFirstOrder.indexOf('clients'));
check('reports that the database declares almost no foreign keys',report.declaredForeignKeys.length<=5,`${report.declaredForeignKeys.length} declared`);
check('reports what it did not analyse and what it is not evidence of',report.notAnalysed.length>=3&&report.notEvidenceOf.includes('approval')&&report.notEvidenceOf.includes('a successful restore'));
check('organisation facts are counts and statuses only',report.organisation.usersByRole.admin===1&&!JSON.stringify(report.organisation).includes('@'));

// ---- counts alone do not prove other tenants unchanged; fingerprints do ----
const otherFp=JSON.parse(run(['--organisation-id',A]).stdout).tables.clients.otherFingerprint;
await db.query("UPDATE clients SET notes='edited-without-changing-any-count' WHERE id='cl-b1'");
const edited=JSON.parse(run(['--organisation-id',A]).stdout);
check('editing another tenant\'s record keeps its row count but changes its fingerprint',edited.tables.clients.otherRows===1&&edited.tables.clients.otherFingerprint!==otherFp);
check('…and leaves this tenant\'s own fingerprint untouched',edited.tables.clients.ownFingerprint===report.tables.clients.ownFingerprint);
const authTables=Object.keys(report.tables).filter(t=>/^auth_|^sessions?$/i.test(t));
check('session and login tables are marked volatile',authTables.length>0&&authTables.every(t=>report.tables[t].volatile),authTables.join(', '));

// ---- the read-only guard and session ----
for(const sql of ["UPDATE clients SET name='x'","DELETE FROM clients","INSERT INTO clients VALUES (1)","DROP TABLE clients","TRUNCATE clients","CALL x()","SELECT 1; DELETE FROM clients","SELECT * FROM clients FOR UPDATE","SELECT * INTO OUTFILE '/tmp/x' FROM clients","SELECT SLEEP(5)","SET GLOBAL read_only=0"]){
 let refused=false;try{assertReadOnlySql(sql);}catch{refused=true;}
 check('statement guard refuses: '+sql,refused);
}
const issued=[];const spy={connection:db.connection,query:async(sql,p)=>{issued.push(String(sql));return db.query(sql,p);}};
await inventory(spy,A);
check('every statement the tool issued is a read or a read-only session control',issued.length>200&&issued.every(s=>/^\s*(SELECT|SHOW|SET SESSION TRANSACTION READ ONLY|START TRANSACTION|ROLLBACK)/i.test(s)),`${issued.length} statements`);
let writeRefused=null;
const probe={connection:db.connection,query:async(sql,p)=>{const res=await db.query(sql,p);if(writeRefused===null&&/FROM information_schema\.COLUMNS/.test(sql)){writeRefused=false;try{await db.query("UPDATE clients SET notes='probe' WHERE id='no-such-id'");}catch(e){writeRefused=/read[- ]only/i.test(e.message);}}return res;}};
await inventory(probe,A);
check('the tool\'s own session refuses a write attempted on it (server-enforced read-only)',writeRefused===true);
const sealed=seal(await inventory(db,A));
check('inventory carries a content hash and no approval or backup fields',/^[0-9a-f]{64}$/.test(sealed.inventoryHash)&&!('approvedBy' in sealed)&&!('backup' in sealed));
const stillSame=JSON.stringify(await whole());
check('database still unchanged after the programmatic runs',stillSame===JSON.stringify({...before,clients:(await whole()).clients}));

// ---- a database user with SELECT only is enough ----
const root=(sql)=>spawnSync('mysql',['-e',sql],{encoding:'utf8',env:{PATH:process.env.PATH}});
const dbName=process.env.MYSQL_DATABASE;
const made=root(`CREATE USER IF NOT EXISTS 'inv_ro'@'127.0.0.1' IDENTIFIED BY 'ro-integration-only'; GRANT SELECT ON \`${dbName}\`.* TO 'inv_ro'@'127.0.0.1'; FLUSH PRIVILEGES;`);
if(made.status===0){
 const ro=run(['--organisation-id',A],{MYSQL_USER:'inv_ro',MYSQL_PASSWORD:'ro-integration-only'});
 check('works with a SELECT-only database user',ro.status===0&&JSON.parse(ro.stdout).inventoryHash===JSON.parse(run(['--organisation-id',A]).stdout).inventoryHash,ro.stderr.slice(0,160));
 root("DROP USER 'inv_ro'@'127.0.0.1'");
}else console.log('SKIP    SELECT-only user check (no administrative access to create one here)');

await db.end();
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
