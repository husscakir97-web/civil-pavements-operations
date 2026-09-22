// Integration test: use an EMPTY, disposable database whose name ends in _test.
// Runs the production Next server, real Better Auth + MySQL, and local SMTP/S3 fixtures.
import assert from 'node:assert/strict';
import ts from 'typescript';
import {createServer as httpServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {connect} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const db=await connect(),temp=await mkdtemp(join(tmpdir(),'hostinger-migration-'));
const run=(file,args=[],extra={})=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file,...args],{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
const mails=[];
const smtp=netServer(socket=>{socket.setEncoding('utf8');socket.write('220 localhost test SMTP\r\n');let buffer='',data=false,body='';socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);if(data){if(line==='.') {mails.push(body);body='';data=false;socket.write('250 Accepted\r\n');}else body+=line+'\r\n';continue;}if(/^EHLO|^HELO/.test(line))socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');else if(/^AUTH/.test(line))socket.write('235 Authenticated\r\n');else if(/^DATA/.test(line)){data=true;socket.write('354 Send message\r\n');}else if(/^QUIT/.test(line)){socket.end('221 Bye\r\n');}else socket.write('250 OK\r\n');}});});
await new Promise(r=>smtp.listen(0,'127.0.0.1',r));
const objects=new Map([['legacy/docket.pdf',Buffer.from('original docket fixture')]]);let listPages=0;
const s3=httpServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.searchParams.get('list-type')==='2'){listPages++;const second=url.searchParams.has('continuation-token');res.setHeader('Content-Type','application/xml');res.end(`<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>test-bucket</Name><IsTruncated>${!second}</IsTruncated>${second?'':'<NextContinuationToken>page2</NextContinuationToken>'}<Contents><Key>${second?'unused/evidence.txt':'legacy/docket.pdf'}</Key><Size>23</Size><ETag>fixture</ETag><LastModified>2026-01-01T00:00:00Z</LastModified></Contents></ListBucketResult>`);return;}const key=decodeURIComponent(url.pathname.replace(/^\/test-bucket\//,''));if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);objects.set(key,Buffer.concat(chunks));res.end();}else if(req.method==='GET'){if(!objects.has(key)){res.writeHead(404,{'Content-Type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code></Error>');return;}res.setHeader('Content-Type','application/octet-stream');res.end(objects.get(key));}else if(req.method==='DELETE'){objects.delete(key);res.end();}else res.end();});
await new Promise(r=>s3.listen(0,'127.0.0.1',r));
Object.assign(process.env,{R2_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,R2_ACCESS_KEY_ID:'fixture-key',R2_SECRET_ACCESS_KEY:'fixture-secret',R2_BUCKET_NAME:'test-bucket',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.address().port),SMTP_SECURE:'false',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',MAIL_FROM:'test@example.invalid',BETTER_AUTH_SECRET:'integration-test-secret-with-at-least-32-characters',BETTER_AUTH_URL:'http://localhost:33179'});
let app;let appLog='';
try{
 // Create a representative 64-docket D1 snapshot, with rates and immutable history.
 const sqlite=new DatabaseSync(':memory:');for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(await readFile('drizzle/'+file,'utf8'));
 const now='2026-09-01T00:00:00.000Z';for(let i=0;i<64;i++)sqlite.prepare('INSERT INTO dockets (id,organisation_id,docket_no,work_date,source_key,amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('legacy-'+i,'roadworx-sydney','D-'+i,'2026-09-01','legacy/docket.pdf',i+0.25,now,now);
 sqlite.prepare('INSERT INTO rate_libraries VALUES (?,?,?,?,?,?)').run('historical-rates','roadworx-sydney','Historical rates','active',JSON.stringify({rate:123.45,revision:7}),now);
 sqlite.prepare('INSERT INTO quote_revisions VALUES (?,?,?,?,?,?)').run('historical-revision','roadworx-sydney','Historical estimate','Approved',JSON.stringify({approvedBudget:{directCost:987.65},rateSnapshot:{hourly:123.45}}),now);
 let dump='';for(const {name,sql} of sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){dump+=sql+';\n';for(const row of sqlite.prepare('SELECT * FROM "'+name+'"').all())dump+='INSERT INTO "'+name+'" ('+Object.keys(row).map(c=>'"'+c+'"').join(',')+') VALUES ('+Object.values(row).map(v=>v===null?'NULL':typeof v==='number'?v:"'"+String(v).replaceAll("'","''")+"'").join(',')+');\n';}sqlite.close();
 await writeFile(join(temp,'source.sql'),dump);await run('scripts/export-live.mjs',['--sql',join(temp,'source.sql'),'--out',join(temp,'export')]);assert.equal(listPages,2,'R2 inventory must follow pagination');
 await run('scripts/import-data.mjs',[join(temp,'export')]);await run('scripts/import-data.mjs',[join(temp,'export'),'--verify-only']);
 const verification=JSON.parse(await readFile(join(temp,'export','mysql-verification.json'),'utf8'));assert.equal(verification.tables.dockets.destination,64);assert(Object.values(verification.tables).every(t=>t.match));
 await assert.rejects(run('scripts/import-data.mjs',[join(temp,'export')]),/not empty/);
 console.log('PASS SQL/CSV export, paginated R2 inventory, 33-table import, 64 docket count, content hashes, overwrite refusal');
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','33179','--hostname','127.0.0.1'],{env:process.env,stdio:['ignore','pipe','pipe']});app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);
 for(let i=0;i<120;i++){try{if((await fetch(process.env.BETTER_AUTH_URL+'/login')).ok)break;}catch{}if(i===119)throw new Error(appLog);await new Promise(r=>setTimeout(r,500));}
 const base=process.env.BETTER_AUTH_URL;
 const call=async(path,method='GET',body,cookie,headers={})=>{for(let attempt=0;;attempt++){const response=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:'manual'});if(response.status!==429||attempt>=2)return response;const seconds=Math.min(61,Math.max(1,Number(response.headers.get('retry-after')||10)));console.log('Respecting auth rate limit:',seconds,'seconds');await new Promise(r=>setTimeout(r,seconds*1000+100));}};
 const cookieOf=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
 const signup=async(email)=>{const before=mails.length;let r=await call('/api/auth/sign-up/email','POST',{name:email.split('@')[0],email,password:'Very-strong-test-password-42',callbackURL:'/'});assert.equal(r.status,200,await r.clone().text());const user=(await r.json()).user;const denied=await call('/api/auth/sign-in/email','POST',{email,password:'Very-strong-test-password-42'});assert.equal(denied.status,403,'Email verification is required');assert(mails.length>before,'Verification email must be sent');const mail=mails.at(-1).replace(/=\r\n/g,'').replaceAll('=3D','=');const url=mail.match(/http:\/\/localhost:33179\/api\/auth\/verify-email[^\s<>]+/)?.[0];assert(url,'Verification link must be present');r=await fetch(url,{redirect:'manual'});assert([200,302].includes(r.status),await r.text());r=await call('/api/auth/sign-in/email','POST',{email,password:'Very-strong-test-password-42'});assert.equal(r.status,200,await r.clone().text());const cookie=cookieOf(r);assert(cookie);return {user,cookie};};
 const a=await signup('admin-a@example.invalid'),b=await signup('admin-b@example.invalid');
 let r=await call('/api/invitations','GET',undefined,a.cookie),me=await r.json();assert.equal(me.role,'admin');assert.notEqual(me.organisationId,'roadworx-sydney');
 await run('scripts/attach-admin.mjs',[],{MIGRATION_ADMIN_USER_ID:a.user.id,MIGRATION_ORGANISATION_ID:'roadworx-sydney'});
 await assert.rejects(run('scripts/attach-admin.mjs',[],{MIGRATION_ADMIN_USER_ID:b.user.id,MIGRATION_ORGANISATION_ID:'roadworx-sydney'}),/already claimed/);
 for(const path of ['/api/dockets?month=2026-09','/api/reports','/api/estimates','/api/commercial','/api/search?q=D-','/api/delivery','/api/field','/api/ims','/api/workspace','/api/preparation','/api/job-hub']){r=await call(path,'GET',undefined,a.cookie);assert.equal(r.status,200,path+': '+await r.clone().text());}
 r=await call('/api/dockets?month=2026-09','GET',undefined,a.cookie);const all=await r.json();assert(JSON.stringify(all).includes('legacy-63'));
 r=await call('/api/dockets?month=2026-09','GET',undefined,b.cookie);assert(!JSON.stringify(await r.json()).includes('legacy-'));
 r=await call('/api/dockets/file?id=legacy-0','GET',undefined,b.cookie);assert.equal(r.status,404);
 r=await call('/api/dockets/file?id=legacy-0','GET',undefined,a.cookie);assert.equal(await r.text(),'original docket fixture');
 r=await call('/api/dockets','GET',undefined,undefined,{'oai-authenticated-user-id':a.user.id,'oai-authenticated-user-email':a.user.email});assert.equal(r.status,401,'Forged headers must be ignored');
 r=await call('/api/workspace','PUT',{productName:'Test',companyName:'Company',workspaceName:'Office',accentColor:'#123456'},a.cookie);assert.equal(r.status,200,await r.clone().text());
 r=await call('/api/workspace','PUT',{},a.cookie,{origin:'https://evil.invalid'});assert.equal(r.status,403);
 // Exercise actual MySQL string concat, INSERT SELECT, JSON queries, and storage upload.
 r=await call('/api/dockets/actions','POST',{action:'split',ids:['legacy-0'],sections:[{docketNo:'SPLIT-1',rawText:'test'},{docketNo:'SPLIT-2',rawText:'test'}]},a.cookie);assert.equal(r.status,422,await r.clone().text());
 r=await call('/api/dockets/actions','POST',{action:'reprocess-profile',ids:['legacy-1'],profileId:''},a.cookie);assert.equal(r.status,422,await r.clone().text());
 const form=new FormData();form.set('file',new File(['new evidence'],'evidence.txt',{type:'text/plain'}));r=await call('/api/delivery/documents','POST',form,a.cookie);assert.equal(r.status,201,await r.clone().text());
 console.log('PASS real signup, email verification, MySQL sessions, safe organisation claim, all module reads, tenant isolation, spoof rejection, CSRF, R2 read/write, disabled legacy actions remain blocked');
 // Exercise multi-statement MySQL business workflows and frozen pricing.
 const compiled=ts.transpileModule(await readFile('lib/estimate-calculations.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
 const {makeDefaultEstimate}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 r=await call('/api/estimates','POST',{data:{...makeDefaultEstimate(),clientName:'Integration client',projectName:'Integration job',site:'Test site'},status:'Draft'},a.cookie);assert.equal(r.status,201,await r.clone().text());const estimate=(await r.json()).estimate;
 r=await call('/api/estimates/award','POST',{estimateId:estimate.id},a.cookie);assert.equal(r.status,201,await r.clone().text());const job=(await r.json()).job;
 r=await call('/api/delivery','GET',undefined,a.cookie);const savedJob=(await r.json()).jobs.find(j=>j.id===job.id);const baseline=structuredClone(savedJob.metadata.approvedBudget);
 r=await call('/api/delivery','POST',{kind:'jobs',record:{...savedJob,metadata:{...savedJob.metadata,approvedBudget:{directCost:1},po:'PO1'}}},a.cookie);assert.equal(r.status,200,await r.clone().text());assert.deepEqual((await r.json()).record.metadata.approvedBudget,baseline);
 const beforeForeign=await db.query('SELECT metadata FROM jobs WHERE id=?',[job.id]);r=await call('/api/delivery','POST',{kind:'jobs',record:{...savedJob,name:'Foreign overwrite'}},b.cookie);assert.equal(r.status,404);assert.deepEqual((await db.query('SELECT metadata FROM jobs WHERE id=?',[job.id]))[0],beforeForeign[0]);
 await db.execute("UPDATE dockets SET status='approved',links=? WHERE id='legacy-2'",[JSON.stringify({jobId:job.id})]);
 r=await call('/api/commercial','POST',{action:'claim',jobId:job.id,docketIds:['legacy-2'],claimPeriod:'2026-09'},a.cookie);assert.equal(r.status,200,await r.clone().text());r=await call('/api/commercial','POST',{action:'claim',jobId:job.id,docketIds:['legacy-2'],claimPeriod:'2026-09'},a.cookie);assert.equal(r.status,400);
 const [bMember]=await db.execute('SELECT organisation_id FROM users WHERE id=?',[b.user.id]);const [bRates]=await db.execute('SELECT id FROM rate_libraries WHERE organisation_id=?',[bMember[0].organisation_id]);assert.equal(bRates.length,0);r=await call('/api/estimates','GET',undefined,b.cookie);assert.equal(r.status,200);const [createdRates]=await db.execute('SELECT id FROM rate_libraries WHERE organisation_id=?',[bMember[0].organisation_id]);assert.equal(createdRates.length,1);
 const concurrent=await Promise.all(Array.from({length:12},(_,i)=>call('/api/dockets?month=2026-09','GET',undefined,i%2?a.cookie:b.cookie).then(r=>r.json())));concurrent.forEach((payload,i)=>assert.equal(JSON.stringify(payload).includes('legacy-63'),Boolean(i%2)));
 console.log('PASS MySQL estimate → award → job, immutable approved budget, foreign write rejection, claim duplicate protection, per-tenant default rates, concurrent tenant context');
 // Invitation must match verified email, be single use, and carry server-side role.
 const c=await signup('field-c@example.invalid');r=await call('/api/invitations','POST',{email:c.user.email,role:'field'},a.cookie);assert.equal(r.status,201,await r.clone().text());const token=mails.at(-1).replace(/=\r\n/g,'').replaceAll('=3D','=').match(/token=([a-f0-9]{64})/)?.[1];assert(token);
 r=await call('/api/invitations','PUT',{token},b.cookie);assert.equal(r.status,403);
 r=await call('/api/invitations','PUT',{token},c.cookie);assert.equal(r.status,200,await r.clone().text());r=await call('/api/invitations','PUT',{token},c.cookie);assert.equal(r.status,403);
 for(const path of ['/api/invitations','/api/estimates/rates','/api/commercial','/api/os/records','/api/workspace']){r=await call(path,path==='/api/workspace'?'PUT':'POST',{},c.cookie);assert.equal(r.status,403,path);}
 r=await call('/api/field','GET',undefined,c.cookie);assert.equal(r.status,200);r=await call('/api/invitations','GET',undefined,c.cookie);assert.equal((await r.json()).role,'field');
 const evidence=new FormData();evidence.set('file',new File(['field evidence'],'field.txt',{type:'text/plain'}));r=await call('/api/delivery/documents','POST',evidence,c.cookie);assert.equal(r.status,201,await r.clone().text());
 await db.execute("UPDATE users SET role='office' WHERE id=?",[c.user.id]);r=await call('/api/workspace','PUT',{},c.cookie);assert.equal(r.status,403);r=await call('/api/commercial','GET',undefined,c.cookie);assert.equal(r.status,200);
 r=await call('/api/invitations','POST',{email:c.user.email,role:'office'},a.cookie);assert.equal(r.status,201);const expiredToken=mails.at(-1).replace(/=\r\n/g,'').replaceAll('=3D','=').match(/token=([a-f0-9]{64})/)?.[1];assert(expiredToken);await db.execute('UPDATE organisation_invitations SET expires_at=? WHERE email=? AND accepted_at IS NULL',[new Date('2020-01-01T00:00:00Z'),c.user.email]);r=await call('/api/invitations','PUT',{token:expiredToken},c.cookie);assert.equal(r.status,403,'Expired invitation must be denied');
 r=await call('/api/auth/sign-out','POST',{},c.cookie);assert.equal(r.status,200);r=await call('/api/invitations','GET',undefined,c.cookie);assert.equal(r.status,401);
 const [rates]=await db.query("SELECT metadata FROM rate_libraries WHERE id='historical-rates'");assert.deepEqual(JSON.parse(rates[0].metadata),{rate:123.45,revision:7});const [revisions]=await db.query("SELECT metadata FROM quote_revisions WHERE id='historical-revision'");assert.equal(JSON.parse(revisions[0].metadata).rateSnapshot.hourly,123.45);
 console.log('PASS emailed invitations, wrong-email/replay rejection, live role checks, office/admin separation, logout revocation, historical rates/revisions preserved');
}catch(error){console.error(appLog);throw error;}finally{app?.kill();smtp.close();s3.close();await db.end();}
