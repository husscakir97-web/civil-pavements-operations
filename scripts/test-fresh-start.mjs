// Integration test: use an EMPTY, disposable database whose name ends in _test.
// Runs the production Next server, real Better Auth + MySQL, and local SMTP/S3 fixtures.
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {createServer as httpServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {spawn} from 'node:child_process';
import {connect,identifier} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const db=await connect();
const run=(file,args=[],extra={})=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file,...args],{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
const mails=[];
// Stopping the production child can reset the SMTP fixture's QUIT connection.
const smtp=netServer(socket=>{socket.on('error',error=>{if(error.code!=='ECONNRESET')throw error;});socket.setEncoding('utf8');socket.write('220 localhost test SMTP\r\n');let buffer='',data=false,body='';socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);if(data){if(line==='.') {mails.push(body);body='';data=false;socket.write('250 Accepted\r\n');}else body+=line+'\r\n';continue;}if(/^EHLO|^HELO/.test(line))socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');else if(/^AUTH/.test(line))socket.write('235 Authenticated\r\n');else if(/^DATA/.test(line)){data=true;socket.write('354 Send message\r\n');}else if(/^QUIT/.test(line)){socket.end('221 Bye\r\n');}else socket.write('250 OK\r\n');}});});
await new Promise(r=>smtp.listen(0,'127.0.0.1',r));
const objects=new Map([['legacy/docket.pdf',Buffer.from('original docket fixture')]]);
const s3=httpServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.searchParams.get('list-type')==='2'){const second=url.searchParams.has('continuation-token');res.setHeader('Content-Type','application/xml');res.end(`<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>test-bucket</Name><IsTruncated>${!second}</IsTruncated>${second?'':'<NextContinuationToken>page2</NextContinuationToken>'}<Contents><Key>${second?'unused/evidence.txt':'legacy/docket.pdf'}</Key><Size>23</Size><ETag>fixture</ETag><LastModified>2026-01-01T00:00:00Z</LastModified></Contents></ListBucketResult>`);return;}const key=decodeURIComponent(url.pathname.replace(/^\/test-bucket\//,''));if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);objects.set(key,Buffer.concat(chunks));res.end();}else if(req.method==='GET'){if(!objects.has(key)){res.writeHead(404,{'Content-Type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code></Error>');return;}res.setHeader('Content-Type','application/octet-stream');res.end(objects.get(key));}else if(req.method==='DELETE'){objects.delete(key);res.end();}else res.end();});
await new Promise(r=>s3.listen(0,'127.0.0.1',r));
Object.assign(process.env,{R2_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,R2_ACCESS_KEY_ID:'fixture-key',R2_SECRET_ACCESS_KEY:'fixture-secret',R2_BUCKET_NAME:'test-bucket',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.address().port),SMTP_SECURE:'false',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',MAIL_FROM:'test@example.invalid',BETTER_AUTH_SECRET:'integration-test-secret-with-at-least-32-characters',BETTER_AUTH_URL:'http://localhost:33179'});

let app,appLog='';
process.env.EMAIL_ENABLED='true';
const originalDatabase=process.env.MYSQL_DATABASE;
const freshDatabase=originalDatabase+'_fresh_test',emptyDatabase=originalDatabase+'_empty_test',noEmailDatabase=originalDatabase+'_noemail_test',created=[];
const stop=async()=>{if(app&&app.exitCode===null){await new Promise(resolve=>{app.once('exit',resolve);app.kill();});}app=undefined;};
const start=async(database,demo,directNext=false)=>{process.env.MYSQL_DATABASE=database;process.env.SEED_DEMO_DATA=demo;appLog='';app=spawn(process.execPath,directNext?['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1']:['scripts/start.mjs'],{env:{...process.env,PORT:'33179'},stdio:['ignore','pipe','pipe']});app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);for(let i=0;i<120;i++){try{if((await fetch(process.env.BETTER_AUTH_URL+'/login')).ok)return;}catch{}if(app.exitCode!==null||i===119)throw new Error(appLog);await new Promise(r=>setTimeout(r,500));}};
try{
 for(const name of [freshDatabase,emptyDatabase,noEmailDatabase]){await db.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');created.push(name);}
 const buildMigrationLog=await run('scripts/migrate-on-build.mjs',[],{MYSQL_DATABASE:freshDatabase});
 assert(buildMigrationLog.includes('Database migrations ready'));
 await run('scripts/migrate-on-build.mjs',[],{MYSQL_DATABASE:freshDatabase});
 await start(freshDatabase,'true',true);
 const fresh=await connect();
 try{
 const base=process.env.BETTER_AUTH_URL;
 const call=async(path,method='GET',body,cookie,headers={})=>{for(let attempt=0;;attempt++){const response=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:'manual'});if(response.status!==429||attempt>=2)return response;const seconds=Math.min(61,Math.max(1,Number(response.headers.get('retry-after')||10)));console.log('Respecting auth rate limit:',seconds,'seconds');await new Promise(r=>setTimeout(r,seconds*1000+100));}};
 const cookieOf=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
 const signup=async(email)=>{const before=mails.length;let r=await call('/api/auth/sign-up/email','POST',{name:email.split('@')[0],email,password:'Very-strong-test-password-42',callbackURL:'/'});assert.equal(r.status,200,await r.clone().text());const user=(await r.json()).user;const denied=await call('/api/auth/sign-in/email','POST',{email,password:'Very-strong-test-password-42'});assert.equal(denied.status,403,'Email verification is required');assert(mails.length>before,'Verification email must be sent');const mail=mails.at(-1).replace(/=\r\n/g,'').replaceAll('=3D','=');const url=mail.match(/http:\/\/localhost:33179\/api\/auth\/verify-email[^\s<>]+/)?.[0];assert(url,'Verification link must be present');r=await fetch(url,{redirect:'manual'});assert([200,302].includes(r.status),await r.text());r=await call('/api/auth/sign-in/email','POST',{email,password:'Very-strong-test-password-42'});assert.equal(r.status,200,await r.clone().text());const cookie=cookieOf(r);assert(cookie);return {user,cookie};};

 const a=await signup('first-demo@example.invalid'),b=await signup('second-demo@example.invalid');
 let r=await call('/api/invitations','GET',undefined,a.cookie);const me=await r.json();assert.equal(me.role,'admin');
 const [counts]=await fresh.query('SELECT organisation_id,COUNT(*) AS count FROM dockets GROUP BY organisation_id');assert.deepEqual(counts,[{organisation_id:me.organisationId,count:6}]);
 const [jobs]=await fresh.query('SELECT organisation_id,metadata FROM jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].organisation_id,me.organisationId);assert(JSON.parse(jobs[0].metadata).approvedBudget);
 for(const path of ['/','/forgot-password','/reset-password','/api/dockets','/api/reports','/api/estimates','/api/commercial','/api/delivery','/api/field','/api/ims','/api/workspace','/api/preparation','/api/job-hub']){r=await call(path,'GET',undefined,a.cookie);assert.equal(r.status,200,path+': '+await r.clone().text());}
 const fullReport=await (await call('/api/reports','GET',undefined,a.cookie)).json();
 const compactReport=await (await call('/api/reports?summary=1','GET',undefined,a.cookie)).json();
 assert.deepEqual(compactReport.summary,fullReport.summary);assert(!('records' in compactReport));
 console.log('Report bytes: full',JSON.stringify(fullReport).length,'summary',JSON.stringify(compactReport).length);
 const search=await (await call('/api/search?q=Council','GET',undefined,a.cookie)).json();
 assert.equal(search.results.filter(x=>x.type==='Docket').length,6,'Search must find dockets by client in MySQL');
 const foreignSearch=await (await call('/api/search?q=Council','GET',undefined,b.cookie)).json();assert.equal(foreignSearch.results.length,0);
 const commercial=await (await call('/api/commercial','GET',undefined,a.cookie)).json();assert.equal(commercial.jobs[0].current.unbilled,4500);
 r=await call('/api/dockets','GET',undefined,b.cookie);assert(!JSON.stringify(await r.json()).includes('DEMO-'));
 const [shift]=await fresh.query('SELECT id FROM shifts');r=await call('/api/field?shiftId='+shift[0].id,'GET',undefined,a.cookie);assert.equal(r.status,200);
 r=await call('/api/auth/request-password-reset','POST',{email:a.user.email,redirectTo:'/reset-password'});assert.equal(r.status,200,await r.clone().text());
 const mail=mails.at(-1).replace(/=\r\n/g,'').replaceAll('=3D','=');const link=mail.match(/http:\/\/localhost:33179\/api\/auth\/reset-password[^\s<>]+/)?.[0];assert(link,'SMTP reset link is missing');
 r=await fetch(link,{redirect:'manual'});assert.equal(r.status,302);const resetURL=new URL(r.headers.get('location'),base),token=resetURL.searchParams.get('token');assert(token);assert.equal(resetURL.pathname,'/reset-password');
 r=await call('/api/auth/reset-password','POST',{token,newPassword:'New-strong-test-password-43'});assert.equal(r.status,200,await r.clone().text());
 r=await call('/api/invitations','GET',undefined,a.cookie);assert.equal(r.status,401,'Reset revokes old sessions');
 r=await call('/api/auth/reset-password','POST',{token,newPassword:'Another-strong-test-password-44'});assert.notEqual(r.status,200,'Reset tokens are single use');
 r=await call('/api/auth/sign-in/email','POST',{email:a.user.email,password:'Very-strong-test-password-42'});assert.equal(r.status,401);
 r=await call('/api/auth/sign-in/email','POST',{email:a.user.email,password:'New-strong-test-password-43'});assert.equal(r.status,200);const newCookie=cookieOf(r);
 await stop();await start(freshDatabase,'true');r=await call('/api/invitations','GET',undefined,newCookie);assert.equal(r.status,200,'Sessions persist over restart');assert.equal((await fresh.query('SELECT COUNT(*) AS n FROM dockets'))[0][0].n,6);
 await stop();
 // Simulate loss of the completion write after successful table/index/FK DDL.
 await fresh.query("DELETE FROM app_migrations WHERE name='0000_clear_doctor_faustus.sql'");
 await fresh.query("UPDATE app_migration_steps SET complete=FALSE WHERE name='0000_clear_doctor_faustus.sql' AND step IN (0,38,40)");
 await fresh.query('DROP INDEX idx_attachments_org ON attachments'); // Simulate interruption before this index DDL.
 await Promise.all([run('scripts/migrate.mjs'),run('scripts/migrate.mjs')]);
 assert.equal((await fresh.query('SELECT COUNT(*) AS n FROM app_migrations'))[0][0].n,(await readdir('migrations/mysql')).filter(f=>f.endsWith('.sql')).length);
 assert.equal((await fresh.query('SELECT COUNT(*) AS n FROM dockets'))[0][0].n,6);
 // An interrupted ADD COLUMN is recoverable without changing existing access.
 await fresh.query("DELETE FROM app_migrations WHERE name='0002_team_access.sql'");
 await fresh.query("UPDATE app_migration_steps SET complete=FALSE WHERE name='0002_team_access.sql'");
 await run('scripts/migrate.mjs');
 assert.equal((await fresh.query('SELECT MIN(active) AS active FROM users'))[0][0].active,1);
 await fresh.query("UPDATE app_migrations SET sha256=REPEAT('0',64) WHERE name='0001_amusing_cable.sql'");
 await assert.rejects(run('scripts/start.mjs'),/checksum changed/);
 console.log('PASS fresh automatic startup, first admin, demo scope/once, module screens, SMTP reset, revoked sessions, restart persistence, concurrent/recoverable migrations, checksum fail-closed');
 }finally{await fresh.end();}
 await db.query('CREATE TABLE '+identifier(emptyDatabase)+'.attachments (id INT PRIMARY KEY)');
 await assert.rejects(run('scripts/start.mjs',[],{MYSQL_DATABASE:emptyDatabase}),/Untracked database object/);
 await db.query('DROP TABLE '+identifier(emptyDatabase)+'.attachments');
 await start(emptyDatabase,'false');
 const empty=await connect();try{
 const base=process.env.BETTER_AUTH_URL;
 const call=async(path,method='GET',body,cookie,headers={})=>{for(let attempt=0;;attempt++){const response=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:'manual'});if(response.status!==429||attempt>=2)return response;const seconds=Math.min(61,Math.max(1,Number(response.headers.get('retry-after')||10)));console.log('Respecting auth rate limit:',seconds,'seconds');await new Promise(r=>setTimeout(r,seconds*1000+100));}};
 const cookieOf=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
 const signup=async(email)=>{const before=mails.length;let r=await call('/api/auth/sign-up/email','POST',{name:email.split('@')[0],email,password:'Very-strong-test-password-42',callbackURL:'/'});assert.equal(r.status,200,await r.clone().text());const user=(await r.json()).user;const denied=await call('/api/auth/sign-in/email','POST',{email,password:'Very-strong-test-password-42'});assert.equal(denied.status,403,'Email verification is required');assert(mails.length>before,'Verification email must be sent');const mail=mails.at(-1).replace(/=\r\n/g,'').replaceAll('=3D','=');const url=mail.match(/http:\/\/localhost:33179\/api\/auth\/verify-email[^\s<>]+/)?.[0];assert(url,'Verification link must be present');r=await fetch(url,{redirect:'manual'});assert([200,302].includes(r.status),await r.text());r=await call('/api/auth/sign-in/email','POST',{email,password:'Very-strong-test-password-42'});assert.equal(r.status,200,await r.clone().text());const cookie=cookieOf(r);assert(cookie);return {user,cookie};};

 const user=await signup('first-empty@example.invalid');const r=await call('/api/invitations','GET',undefined,user.cookie);assert.equal((await r.json()).role,'admin');assert.equal((await empty.query('SELECT COUNT(*) AS n FROM dockets'))[0][0].n,0);assert.equal((await empty.query('SELECT COUNT(*) AS n FROM jobs'))[0][0].n,0);
 await stop();await start(emptyDatabase,'true');await signup('later-empty@example.invalid');assert.equal((await empty.query('SELECT COUNT(*) AS n FROM dockets'))[0][0].n,0);
 console.log('PASS untracked schema rejected, first account without demo empty, enabling demo later does not backfill');
 }finally{await empty.end();}
 await stop();process.env.EMAIL_ENABLED='false';
 const smtpValues=Object.fromEntries(['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','MAIL_FROM'].map(k=>[k,process.env[k]]));for(const key of Object.keys(smtpValues))delete process.env[key];
 await start(noEmailDatabase,'true');
 const base=process.env.BETTER_AUTH_URL,before=mails.length;
 const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{origin:base,'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 let response=await post('/api/auth/sign-up/email',{name:'No email admin',email:'no-email@example.invalid',password:'Strong-no-email-password-42'});assert.equal(response.status,200,await response.clone().text());const account=(await response.json()).user;assert.equal(account.emailVerified,false);
 response=await post('/api/auth/sign-in/email',{email:account.email,password:'Strong-no-email-password-42'});assert.equal(response.status,200,await response.clone().text());const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');assert(cookie);
 response=await fetch(base+'/api/invitations',{headers:{cookie}});const membership=await response.json();assert.equal(membership.role,'admin');assert.equal(membership.emailEnabled,false);
 response=await fetch(base+'/api/dockets',{headers:{cookie}});assert.equal(response.status,200);assert((await response.text()).includes('DEMO-006'));
 response=await fetch(base+'/api/auth-config');assert.equal((await response.json()).emailEnabled,false);
 response=await post('/api/invitations',{email:'colleague@example.invalid',role:'field'},cookie);assert.equal(response.status,503);
 for(const path of ['/api/auth/request-password-reset','/api/auth/reset-password','/api/auth/send-verification-email']){response=await post(path,{email:account.email});assert.equal(response.status,503);}
 response=await fetch(base+'/api/invitations',{method:'PUT',headers:{cookie,origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:'a'.repeat(64)})});assert.equal(response.status,503);assert.equal(mails.length,before,'Disabled email must never send messages');
 await stop();process.env.EMAIL_ENABLED='true';Object.assign(process.env,smtpValues);await start(noEmailDatabase,'false');
 response=await fetch(base+'/api/invitations',{method:'PUT',headers:{cookie,origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:'a'.repeat(64)})});assert.equal(response.status,403);assert.match(await response.text(),/Verify your email/);
 response=await post('/api/auth/sign-in/email',{email:account.email,password:'Strong-no-email-password-42'});assert.equal(response.status,403);assert(mails.length>before,'Enabling email must require verification on sign-in');
 console.log('PASS first admin and demo without SMTP, immediate login, email endpoints blocked, no email sent, later verification required before invite acceptance');
}catch(error){console.error(appLog);throw error;}finally{await stop();smtp.close();s3.close();process.env.MYSQL_DATABASE=originalDatabase;for(const name of created)await db.query('DROP DATABASE '+identifier(name));await db.end();}
