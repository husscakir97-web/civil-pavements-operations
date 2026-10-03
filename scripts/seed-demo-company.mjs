// Fictional demo company ("Kestrel Civil & Pavements") for Infrastruct. TEST DATABASES ONLY.
//
//   node scripts/seed-demo-company.mjs --base-url http://127.0.0.1:3191 [--seed-date 2026-10-05] [--manifest out.json]
//
// Environment: MYSQL_* of the SAME database the app at --base-url uses (must end in _test), and DEMO_SEED_EMAIL / DEMO_SEED_PASSWORD
// of an administrator of the organisation to fill. The seed writes through the application's own HTTP API so every business rule,
// state machine and audit trail applies; SQL is used read-only (to find what already exists) and only for a few clearly marked
// back-dated test conditions. It is idempotent: every record is found by a deterministic natural key (employee number, plant number,
// DEMO- references) and created only when missing, so reruns create nothing new. Nothing leaves the machine: no email, SMS, payment,
// webhook or AI integration is configured or triggered; contact details use the non-deliverable `.invalid` TLD.
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {connect} from './mysql-config.mjs';
import {STAGES,hydrate} from './demo/stages.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
export const SEED_DATE=arg('--seed-date','2026-10-05');
if(!/^\d{4}-\d{2}-\d{2}$/.test(SEED_DATE)||Number.isNaN(Date.parse(SEED_DATE)))throw new Error('--seed-date must be a valid YYYY-MM-DD date');
const base=arg('--base-url');
const only=arg('--only');

// ---------------------------------------------------------------------------------------------- safety
const REFUSE=[];
const need=(ok,why)=>{if(!ok)REFUSE.push(why);};
need(/_test$/.test(process.env.MYSQL_DATABASE||''),'MYSQL_DATABASE must end in _test');
need(['127.0.0.1','localhost','::1'].includes(process.env.MYSQL_HOST||''),'MYSQL_HOST must be this machine (127.0.0.1 or localhost); remote databases are refused');
need(process.env.NODE_ENV!=='production','NODE_ENV=production is refused');
need(Boolean(base)&&/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base),'--base-url must point at a local app (http://127.0.0.1:PORT)');
for(const name of ['SMTP_HOST','SMTP_USER','BILLING_PROVIDER','BILLING_WEBHOOK_SECRET','ABR_GUID','AI_API_KEY','OPENAI_API_KEY','TWILIO_AUTH_TOKEN','SMS_PROVIDER'])need(!process.env[name],`${name} is set: external integrations must be unconfigured while seeding`);
for(const name of ['EMAIL_ENABLED','AI_ENABLED'])need(String(process.env[name]||'false').toLowerCase()!=='true',`${name}=true is refused`);
const email=process.env.DEMO_SEED_EMAIL,password=process.env.DEMO_SEED_PASSWORD;
need(Boolean(email&&password),'DEMO_SEED_EMAIL and DEMO_SEED_PASSWORD (an administrator of the demo organisation) are required');
// Environment checks come first: a refused run never even opens a database connection.
if(REFUSE.length){console.error('Refusing to seed:\n - '+REFUSE.join('\n - '));process.exit(2);}
const db=await connect();
const [[marker]]=await db.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (\'organisations\',\'users\',\'jobs\')');
if(Number(marker.n)!==3){console.error('Refusing to seed: this does not look like an Infrastruct database (migrations missing).');await db.end();process.exit(2);}
const [[user]]=await db.query('SELECT id,organisation_id,role FROM users WHERE email=?',[email]);
if(!user){console.error(`Refusing to seed: ${email} is not a user of THIS database. The app at --base-url must use the same database as MYSQL_DATABASE.`);await db.end();process.exit(2);}
if(user.role!=='admin'){console.error('Refusing to seed: the seed account must be an organisation administrator.');await db.end();process.exit(2);}
const org=user.organisation_id;
const [[billing]]=await db.query('SELECT (SELECT COUNT(*) FROM billing_subscriptions WHERE organisation_id=?)+(SELECT COUNT(*) FROM billing_customers WHERE organisation_id=?) AS n',[org,org]);
if(Number(billing.n)){console.error('Refusing to seed: this organisation has a billing relationship; demo data is for organisations without payment activity.');await db.end();process.exit(2);}

// ---------------------------------------------------------------------------------------------- context
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
let r;for(let attempt=0;attempt<6;attempt++){r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,(Number(r.headers.get('retry-after'))||15)*1000));}
if(!r.ok){console.error('Refusing to seed: sign-in failed ('+r.status+').');await db.end();process.exit(2);}
const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
const call=async(path,method='GET',body)=>{const res=await fetch(base+path,{method,headers:{origin:base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await res.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:res.status,body:json};};
const form=async(path,fields)=>{const f=new FormData();for(const [k,v] of Object.entries(fields))f.set(k,typeof v==='string'?v:JSON.stringify(v));const res=await fetch(base+path,{method:'POST',headers:{origin:base,cookie},body:f});const text=await res.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:res.status,body:json};};
const must=async(promise,codes,label)=>{const res=await promise;if(!codes.includes(res.status))throw new Error(`${label} -> ${res.status} ${JSON.stringify(res.body).slice(0,300)}`);return res.body;};
const one=async(sql,params=[])=>(await db.query(sql,params))[0][0]??null;
const all=async(sql,params=[])=>(await db.query(sql,params))[0];
const log=(...a)=>console.log(...a);
const ctx={db,org,user,base,call,form,must,one,all,log,SEED_DATE,d:n=>addDays(SEED_DATE,n),addDays,created:{},ids:{},note:(kind,n=1)=>{ctx.created[kind]=(ctx.created[kind]||0)+n;},
 tag:createHash('sha1').update(org).digest('hex').slice(0,8)};

// ---------------------------------------------------------------------------------------------- run
try{
 await hydrate(ctx);
 for(const [name,fn] of STAGES){
  if(only&&only!==name)continue;
  log(`== ${name}`);
  await fn(ctx);
 }
 log('\nCreated in this run:',JSON.stringify(ctx.created));
 if(arg('--manifest'))writeFileSync(arg('--manifest'),JSON.stringify({seedDate:SEED_DATE,organisationTag:ctx.tag,created:ctx.created,manifest:ctx.manifest,ids:ctx.ids},null,1));
}finally{await db.end();}
