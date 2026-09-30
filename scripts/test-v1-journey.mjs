// V1 end-to-end business journey against the PRODUCTION server, real Better Auth
// sessions and MySQL (database name must end in _test), with a local S3 fixture.
// Scenarios: A new organisation · B win work · C prepare · D deliver · E money ·
// F field permissions · G tenant attack · plus entitlements, closeout and audit.
// Run after `npm run build`: npm run test:v1
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash as sha} from 'node:crypto';
import {connect} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const run=(file,extra={})=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
await run('scripts/migrate.mjs');
const db=await connect();
const objects=new Map();
const s3=httpServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const key=decodeURIComponent(url.pathname.replace(/^\/test-bucket\//,''));if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);objects.set(key,Buffer.concat(chunks));res.end();}else if(req.method==='GET'){if(!objects.has(key)){res.writeHead(404,{'Content-Type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code></Error>');return;}res.end(objects.get(key));}else{objects.delete(key);res.end();}});
await new Promise(r=>s3.listen(0,'127.0.0.1',r));
// External-service fixtures: the official ABR JSON service shape, an Anthropic-compatible
// messages endpoint and signed billing webhooks. Real providers are never called in tests.
const suffix=Date.now().toString(36);
let aiCalls=0;
const ext=httpServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/abr/AbnDetails.aspx'){
  const abn=url.searchParams.get('abn');res.setHeader('Content-Type','text/javascript');
  if(url.searchParams.get('guid')!=='fixture-guid')return res.end('callback({"Message":"The GUID entered is not recognised as a Registered Party"})');
  if(abn==='51824753556')return res.end('callback({"Abn":"51824753556","AbnStatus":"Active","EntityName":"ALPHA CIVIL PTY LTD","EntityTypeName":"Australian Private Company","Gst":"2001-07-01","BusinessName":["Alpha Civil"],"AddressState":"NSW","AddressPostcode":"2000","Message":""})');
  return res.end('callback({"Abn":"","Message":"No record found"})');
 }
 if(url.pathname==='/v1/messages'&&req.method==='POST'){
  const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks).toString());aiCalls++;
  if(req.headers['x-api-key']!=='fixture-key'){res.writeHead(401);return res.end('{}');}
  if(String(b.messages?.[0]?.content||'').includes('FAIL-PLEASE')){res.writeHead(500);return res.end('{}');}
  const text=/Safe Work Method/.test(b.system)?JSON.stringify({steps:[{index:0,hazards:'Trench wall collapse',controls:'Bench or shore trenches deeper than 1.5 m; exclusion zone',confidence:0.8},{index:99,hazards:'ignored',controls:'ignored'}]})
   :/integrated management system/.test(b.system)?JSON.stringify({title:'Traffic management procedure',content:'1. Purpose\n2. Scope [to confirm]\n3. Responsibilities',confidence:0.7}):'{}';
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({model:b.model,content:[{type:'text',text}],usage:{input_tokens:120,output_tokens:40}}));
 }
 res.writeHead(404);res.end();
});
await new Promise(r=>ext.listen(0,'127.0.0.1',r));
const EXT=`http://127.0.0.1:${ext.address().port}`,OPERATOR=`operator-${suffix}@example.invalid`,BILLING_SECRET='fixture-billing-secret';
Object.assign(process.env,{ABR_GUID:'fixture-guid',ABR_BASE_URL:`${EXT}/abr/`,AI_ENABLED:'true',AI_PROVIDER:'anthropic',AI_API_KEY:'fixture-key',AI_MODEL:'fixture-model',AI_BASE_URL:EXT,BILLING_PROVIDER:'fixture-billing',BILLING_WEBHOOK_SECRET:BILLING_SECRET,PLATFORM_OPERATOR_EMAILS:OPERATOR});
const PORT=33191,base=`http://localhost:${PORT}`;
Object.assign(process.env,{R2_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET_NAME:'test-bucket',EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'journey-test-secret-with-at-least-32-characters',BETTER_AUTH_URL:base});
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env:process.env,stdio:['ignore','pipe','pipe']});
let appLog='';app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);
let step='startup',servicePool=null;
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}if(i===119)throw new Error(appLog);await new Promise(r=>setTimeout(r,500));}
 const call=async(path,method='GET',body,cookie)=>{for(let attempt=0;;attempt++){const r=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body instanceof FormData||body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:'manual'});if(r.status!==429||attempt>=3)return r;await new Promise(res=>setTimeout(res,(Number(r.headers.get('retry-after'))||10)*1000+200));}};
 const json=async(r,expected,label)=>{const text=await r.text();assert.equal(r.status,expected,`${label||step}: ${text.slice(0,600)}`);return text?JSON.parse(text):null;};
 const cookieOf=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
 const signup=async name=>{const email=`${name}-${suffix}@example.invalid`;const r=await call('/api/auth/sign-up/email','POST',{name,email,password:'Journey-strong-password-42'});const body=await json(r,200,'signup '+name);const cookie=cookieOf(r);assert(cookie,'signup must create a session when email is disabled');return {user:body.user,cookie,email};};
 const reg=(key,cookie)=>({list:(q='')=>call(`/api/registers/${key}${q}`,'GET',undefined,cookie),create:(parentId,values)=>call(`/api/registers/${key}`,'POST',{parentId,values},cookie),update:(id,revision,values)=>call(`/api/registers/${key}`,'PATCH',{id,revision,values},cookie),move:(id,transition,note)=>call(`/api/registers/${key}`,'PATCH',{id,transition,note},cookie),remove:id=>call(`/api/registers/${key}?id=${id}`,'DELETE',undefined,cookie)});

 // ---------------------------------------------------------------- Scenario A
 step='A new organisation';
 const A=await signup('admin-a'),B=await signup('admin-b');
 let ws=await json(await call('/api/workspace','GET',undefined,A.cookie),200);
 assert.equal(ws.role,'admin');assert.equal(ws.onboarding.completed,false);assert(Object.values(ws.entitlements).every(s=>s==='active'),'beta trial grants every module');
 const [[memberA]]=await db.execute('SELECT organisation_id FROM users WHERE id=?',[A.user.id]),[[memberB]]=await db.execute('SELECT organisation_id FROM users WHERE id=?',[B.user.id]);
 assert.notEqual(memberA.organisation_id,memberB.organisation_id,'independent signups create separate organisations');
 const [[entCount]]=await db.execute('SELECT COUNT(*) AS n FROM organisation_entitlements WHERE organisation_id=?',[memberA.organisation_id]);assert.equal(Number(entCount.n),12);
 await json(await call('/api/platform/onboarding','PUT',{abn:'12 345 678 901'},A.cookie),400,'invalid ABN rejected');
 await json(await call('/api/platform/onboarding','PUT',{complete:true},A.cookie),422,'legal name required to finish');
 let profile=(await json(await call('/api/platform/onboarding','PUT',{legal_name:'Alpha Civil Pty Ltd',trading_name:'Alpha Civil',abn:'51 824 753 556',business_activities:['Civil construction','Drainage'],operating_regions:['NSW'],workforce_size:'21–50',onboarding_step:4,complete:true},A.cookie),200)).profile;
 assert.equal(profile.completed,true);assert.equal(profile.abn,'51824753556');assert.deepEqual(profile.business_activities,['Civil construction','Drainage']);
 ws=await json(await call('/api/workspace','GET',undefined,A.cookie),200);assert.equal(ws.onboarding.completed,true);assert.equal(ws.brand.companyName,'Alpha Civil');
 const abn=await json(await call('/api/platform/abn?abn=51824753556','GET',undefined,A.cookie),200);assert.equal(abn.valid,true);assert.equal(abn.registry,null,'the register is only queried on request');
 console.log('PASS A: signup, organisation + membership, beta entitlements, onboarding with ABN checksum, company profile, independent second organisation');

 // ---------------------------------------------------------------- Civil Knowledge Engine
 step='A civil knowledge';
 const pack=(await json(await call('/api/platform/knowledge','POST',{action:'savePack',pack:{packKey:'fixture-pavements',name:'Fixture Pavement Knowledge',description:'Journey test only',discipline:'Pavements',jurisdiction:'NSW',contextType:'organisation',contextId:'',versionLabel:'R1'}},A.cookie),200)).id;
 const source=(await json(await call('/api/platform/knowledge','POST',{action:'saveSource',source:{packId:pack,title:'Fixture client specification',authority:'Example Client',sourceType:'client',referenceCode:'SPEC-TEST',revisionLabel:'R1',jurisdiction:'NSW',effectiveFrom:'2026-01-01',effectiveTo:'',sourceUrl:'https://example.invalid/spec-test',documentId:'',licenceNote:'Synthetic test fixture'}},A.cookie),200)).id;
 await json(await call('/api/platform/knowledge','POST',{action:'transition',entity:'source',id:source,status:'current'},A.cookie),200);
 await json(await call('/api/platform/knowledge','POST',{action:'transition',entity:'pack',id:pack,status:'current'},A.cookie),200);
 const rule=(await json(await call('/api/platform/knowledge','POST',{action:'saveRule',rule:{packId:pack,sourceId:source,ruleCode:'fixture.test14.minimum',title:'Fixture TEST14 minimum',discipline:'Pavements',topic:'asphalt',ruleType:'minimum',appliesWhen:{all:[{field:'asphalt.mix',op:'eq',value:'TEST14'}],any:[]},assertion:{field:'asphalt.compactedDepthMm',op:'gte',value:40},severity:'block',message:'Synthetic fixture requires at least 40 mm.',sourceClause:'4.2',sourcePage:'18',effectiveFrom:'2026-01-01',effectiveTo:''}},A.cookie),200)).id;
 await json(await call('/api/platform/knowledge','POST',{action:'transition',entity:'rule',id:rule,status:'current'},A.cookie),200);
 let kc=await json(await call('/api/platform/knowledge/check','POST',{topics:['asphalt'],context:{asphalt:{mix:'TEST14',compactedDepthMm:35}}},A.cookie),200);
 assert.deepEqual([kc.summary.failed,kc.summary.blocking,kc.results[0].actual,kc.results[0].expected],[1,1,35,40]);
 assert.equal(kc.results[0].source.referenceCode,'SPEC-TEST');
 kc=await json(await call('/api/platform/knowledge/check','POST',{topics:['asphalt'],context:{asphalt:{mix:'TEST14',compactedDepthMm:50}}},A.cookie),200);assert.equal(kc.summary.passed,1);
 // Platform knowledge is shared read-only across tenants; organisation knowledge remains isolated.
 const platformPack='platform-pack-'+suffix,platformSource='platform-source-'+suffix,platformRule='platform-rule-'+suffix,nowIso=new Date().toISOString();
 await db.execute("INSERT INTO knowledge_packs (id,organisation_id,pack_key,name,description,discipline,jurisdiction,context_type,version_label,status,locked,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'current',1,1,?,?)",[platformPack,'__infrastruct_platform__','fixture-platform-core-'+suffix,'Fixture Platform Knowledge','Journey test only','General','NSW','organisation','R1',nowIso,nowIso]);
 await db.execute("INSERT INTO knowledge_sources (id,organisation_id,pack_id,title,authority,source_type,reference_code,revision_label,jurisdiction,source_url,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'current',1,?,?)",[platformSource,'__infrastruct_platform__',platformPack,'Fixture public source','Infrastruct Test','public','PLATFORM-TEST','R1','NSW','https://example.invalid/platform-test',nowIso,nowIso]);
 await db.execute("INSERT INTO knowledge_rules (id,organisation_id,pack_id,source_id,rule_code,title,discipline,topic,rule_type,applies_when,assertion,severity,message,source_clause,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'current',1,?,?)",[platformRule,'__infrastruct_platform__',platformPack,platformSource,'platform.fixture.minimum','Fixture shared minimum','General','platform-fixture','minimum',JSON.stringify({all:[{field:'fixture.kind',op:'eq',value:'shared'}],any:[]}),JSON.stringify({field:'fixture.value',op:'gte',value:10}),'warning','Shared fixture requires value 10 or greater.','1.1',nowIso,nowIso]);
 const foreignKnowledge=await json(await call('/api/platform/knowledge','GET',undefined,B.cookie),200);assert(foreignKnowledge.packs.some(p=>p.id===platformPack&&p.origin==='platform'),'platform knowledge is visible across tenants');assert(!foreignKnowledge.packs.some(p=>p.id===pack),'organisation A knowledge stays isolated');
 const foreignKnowledgeCheck=await json(await call('/api/platform/knowledge/check','POST',{topics:['asphalt'],context:{asphalt:{mix:'TEST14',compactedDepthMm:35}}},B.cookie),200);assert.equal(foreignKnowledgeCheck.results.length,0,'another organisation cannot use organisation A rules');
 const sharedA=await json(await call('/api/platform/knowledge/check','POST',{topics:['platform-fixture'],context:{fixture:{kind:'shared',value:5}}},A.cookie),200);
 const sharedB=await json(await call('/api/platform/knowledge/check','POST',{topics:['platform-fixture'],context:{fixture:{kind:'shared',value:5}}},B.cookie),200);
 assert.equal(sharedA.summary.failed,1);assert.equal(sharedB.summary.failed,1);assert.equal(sharedB.results[0].source.origin,'platform');assert.equal(sharedB.results[0].source.referenceCode,'PLATFORM-TEST');
 console.log('PASS knowledge: controlled source + pack + rule lifecycle, deterministic checks, provenance, tenant isolation and shared read-only platform knowledge');


 step='Workshop standalone and isolation';
 const W=await signup('workshop-verifier');await db.execute("UPDATE users SET organisation_id=?,role='office' WHERE id=?",[memberA.organisation_id,W.user.id]);
 const workshop=(b,c=A.cookie)=>call('/api/workshop','POST',b,c);
 await json(await call('/api/platform/entitlements','PUT',{module:'operations',status:'disabled'},A.cookie),200);
 const wa=await json(await workshop({action:'asset',name:'QA Paver',number:'QA-01',category:'Paver',registration:'TEST'}),200);
 const wo=await json(await workshop({action:'defect',assetId:wa.id,title:'Critical brake fault',severity:'critical',note:'Synthetic inspection evidence'}),200);
 await json(await workshop({action:'meter',assetId:wa.id,meterType:'hours',reading:100,nextService:90,note:'Inspection reading'}),200);
 await json(await workshop({action:'meter',assetId:wa.id,meterType:'hours',reading:99,nextService:200,note:'Backwards reading'}),409);
 await json(await workshop({action:'meter',assetId:wa.id,meterType:'hours',reading:110,nextService:200,note:'Foreign reading'},B.cookie),404);
 await json(await call('/api/platform/entitlements','PUT',{module:'operations',status:'active'},A.cookie),200);
 // Simulate a legacy availability edit: the separate safety hold must still block allocation.
 await db.execute("UPDATE plant SET status='Available' WHERE organisation_id=? AND id=?",[memberA.organisation_id,wa.id]);
 const held=await json(await call('/api/delivery','POST',{kind:'shifts',check:true,record:{id:'',name:'Safety check',status:'Planned',metadata:{date:'2026-10-01',start:'07:00',finish:'17:00',assignments:[{category:'plant',resourceId:wa.id}]}},candidates:[]},A.cookie),200);assert(held.conflicts.some(c=>c.code==='RESOURCE_UNAVAILABLE'),'workshop hold overrides ordinary availability');
 await json(await call('/api/platform/entitlements','PUT',{module:'operations',status:'disabled'},A.cookie),200);
 await json(await workshop({action:'defect',assetId:wa.id,title:'Foreign defect',severity:'minor',note:'foreign'},B.cookie),404);
 let wview=await json(await call('/api/workshop','GET',undefined,A.cookie),200);assert.equal(wview.assets.find(a=>a.id===wa.id).status,'Out of service');
 const foreign=await json(await call('/api/workshop','GET',undefined,B.cookie),200);assert(!foreign.orders.some(o=>o.id===wo.id));
 const wo2=await json(await workshop({action:'defect',assetId:wa.id,title:'Second critical fault',severity:'critical',note:'Independent second fault'}),200);
 await json(await workshop({action:'repair',id:wo.id,revision:1,note:'Replaced brake assembly',labourHours:2,parts:'Brake assembly'}),200);
 await json(await workshop({action:'verify',id:wo.id,revision:2,note:'Self verification',accepted:true}),403);
 await json(await workshop({action:'verify',id:wo.id,revision:2,note:'Independent functional inspection passed',accepted:true},W.cookie),200);
 wview=await json(await call('/api/workshop','GET',undefined,A.cookie),200);assert.equal(wview.assets.find(a=>a.id===wa.id).status,'Out of service','another critical defect keeps hold');
 await json(await workshop({action:'repair',id:wo2.id,revision:1,note:'Second fault repaired',labourHours:1,parts:''}),200);
 await json(await workshop({action:'verify',id:wo2.id,revision:2,note:'Second independent inspection',accepted:true},W.cookie),200);
 wview=await json(await call('/api/workshop','GET',undefined,A.cookie),200);assert.equal(wview.assets.find(a=>a.id===wa.id).status,'Available');assert.equal(wview.entries.filter(e=>e.order_id===wo.id).length,3);
 await json(await workshop({action:'repair',id:wo.id,revision:1,note:'stale',labourHours:0,parts:''}),409);
 await json(await call('/api/platform/entitlements','PUT',{module:'workshop',status:'read_only'},A.cookie),200);
 await json(await workshop({action:'asset',name:'Denied',number:'',category:'',registration:''}),403);
 await json(await call('/api/workshop','GET',undefined,A.cookie),200);
 await json(await call('/api/platform/entitlements','PUT',{module:'workshop',status:'active'},A.cookie),200);
 await json(await call('/api/platform/entitlements','PUT',{module:'operations',status:'active'},A.cookie),200);
 console.log('PASS Workshop: standalone asset/defect/repair/independent verification, immutable history, tenant denial, stale update and read-only refusal');
 // ---------------------------------------------------------------- Scenario B
 step='B win work';
 const upload=async(cookie,fields,name='evidence.pdf',content='%PDF-1.4 fixture')=>{const f=new FormData();for(const [k,v] of Object.entries(fields))f.set(k,v);f.set('file',new File([content],name,{type:'application/pdf'}));return call('/api/documents','POST',f,cookie);};
 // Central Documents workspace: search/filter/version behavior over the existing secure file model.
 const companyDoc=(await json(await upload(A.cookie,{contextType:'organisation',category:'Quality',title:'Journey Quality Manual'},'quality-manual-v1.pdf'),201,'company document v1')).document;
 let documentSearch=await json(await call('/api/documents?q=Journey%20Quality','GET',undefined,A.cookie),200,'search company documents');
 assert(documentSearch.documents.some(d=>d.id===companyDoc.id&&d.category==='Quality'),'document workspace searches title/category');
 assert(documentSearch.documents.find(d=>d.id===companyDoc.id).uploadedByName,'document workspace resolves uploader');
 assert.equal((await json(await call('/api/documents?category=Quality','GET',undefined,A.cookie),200)).documents.some(d=>d.id===companyDoc.id),true,'document category filter');
 const companyDocV2=(await json(await upload(A.cookie,{contextType:'organisation',category:'Quality',title:'Journey Quality Manual',supersedesId:companyDoc.id},'quality-manual-v2.pdf'),201,'company document v2')).document;
 documentSearch=await json(await call('/api/documents?q=Journey%20Quality','GET',undefined,A.cookie),200);
 assert(!documentSearch.documents.some(d=>d.id===companyDoc.id)&&documentSearch.documents.some(d=>d.id===companyDocV2.id&&d.version===2),'current view shows only latest document version');
 const allDocumentVersions=await json(await call('/api/documents?q=Journey%20Quality&all=1','GET',undefined,A.cookie),200);
 assert(allDocumentVersions.documents.some(d=>d.id===companyDoc.id&&d.status==='superseded')&&allDocumentVersions.documents.some(d=>d.id===companyDocV2.id&&d.status==='current'),'superseded filter exposes document history');
 const insuranceDoc=(await json(await upload(A.cookie,{contextType:'library',category:'Insurance',title:'Public liability certificate'}),201)).document;
 await json(await upload(A.cookie,{contextType:'library'},'malware.exe'),415,'unsupported file type rejected');
 const lib=reg('library',A.cookie);
 const libItem=(await json(await lib.create(null,{category:'Insurance',title:'Public liability $20m',document_id:insuranceDoc.id,expiry_date:'2099-06-30',owner_name:'Office'}),201)).record;
 await json(await lib.move(libItem.id,'current'),200);
 const libWords=await json(await lib.create(null,{category:'Insurance',title:'Public & Products Liability Insurance',owner_name:'Office'}),201);
 const liabilitySearch=await json(await call('/api/search?q='+encodeURIComponent('public liability'),'GET',undefined,A.cookie),200);
 assert(liabilitySearch.results.some(r=>r.id===libWords.record.id),'search matches each word, not only the exact phrase');
 assert(liabilitySearch.results.some(r=>r.id===libItem.id),'exact phrase still found');
 const foreignLiability=await json(await call('/api/search?q='+encodeURIComponent('public liability'),'GET',undefined,B.cookie),200);
 assert(!foreignLiability.results.some(r=>[libWords.record.id,libItem.id].includes(r.id)),'library search stays in the organisation');
 // Core clients: create once, select everywhere, carried opportunity → tender → project.
 const clientsApi=(body,cookie=A.cookie)=>call('/api/platform/clients','POST',body,cookie);
 const riverside=(await json(await clientsApi({action:'create',client:{name:'Riverside Council',contactName:'Pat Lee',site:{name:'Riverside Rd',address:'1 Riverside Rd, Parramatta NSW 2150'}}}),201)).client;
 assert.equal(riverside.sites.length,1);const riversideSite=riverside.sites[0];
 const sameClient=await json(await clientsApi({action:'create',client:{name:'  riverside council '}}),201);
 assert.equal(sameClient.client.id,riverside.id);assert.equal(sameClient.existing,true,'exact name returns the existing client');
 await json(await reg('clients',A.cookie).create(null,{name:'Riverside Council'}),409,'register refuses a duplicate client name');
 assert((await json(await call('/api/search?q=riverside%20council','GET',undefined,A.cookie),200)).results.some(r=>r.type==='Client'&&r.id===riverside.id),'global search is case-insensitive on legacy tables');
 const clientMatches=(await json(await call('/api/platform/clients?q=river','GET',undefined,A.cookie),200)).clients;assert(clientMatches.some(c=>c.id===riverside.id),'client search by partial name');
 assert(!(await json(await call('/api/platform/clients?q=river','GET',undefined,B.cookie),200)).clients.some(c=>c.id===riverside.id),'clients stay in their organisation');
 await json(await clientsApi({action:'createSite',site:{clientId:riverside.id,address:'Foreign site'}},B.cookie),400,'foreign client cannot receive sites');
 await json(await call('/api/projects','POST',{name:'Foreign use',clientId:riverside.id},B.cookie),400,'foreign client id refused');
 let withContacts=(await json(await clientsApi({action:'addContact',clientId:riverside.id,contact:{name:'Jo Accounts',role:'Accounts',email:'jo@example.invalid',isPrimary:true}}),201)).client;
 withContacts=(await json(await clientsApi({action:'addContact',clientId:riverside.id,contact:{name:'Max Site',role:'Site manager',isPrimary:true}}),201)).client;
 assert.deepEqual(withContacts.contacts.map(c=>[c.name,c.isPrimary]),[['Max Site',true],['Jo Accounts',false]],'one primary contact at a time');
 const jo=withContacts.contacts.find(c=>c.name==='Jo Accounts');
 await json(await clientsApi({action:'updateContact',id:jo.id,revision:jo.revision,contact:{archived:true}},B.cookie),404,'foreign contact edit refused');
 await json(await clientsApi({action:'addContact',clientId:riverside.id,contact:{name:'Intruder'}},B.cookie),400,'foreign client cannot receive contacts');
 withContacts=(await json(await clientsApi({action:'updateContact',id:jo.id,revision:jo.revision,contact:{archived:true}}),200)).client;
 assert.deepEqual(withContacts.contacts.map(c=>c.name),['Max Site'],'removed contact is archived, not listed');
 await json(await clientsApi({action:'updateContact',id:jo.id,revision:jo.revision,contact:{name:'Stale'}}),409,'stale contact edit refused');
 const opps=reg('opportunities',A.cookie);
 const maxSite=withContacts.contacts.find(c=>c.name==='Max Site');
 await json(await opps.create(null,{name:'Wrong contact',client_id:riverside.id,contact_id:'forged-contact'}),400,'contact must exist');
 const opp=(await json(await opps.create(null,{name:'Riverside drainage upgrade',client_id:riverside.id,site_id:riversideSite.id,contact_id:maxSite.id,estimated_value:850000,probability:60,closing_date:'2099-01-15'}),201)).record;
 assert.equal(opp.contact_id,maxSite.id,'opportunity keeps the chosen client contact');
 assert.equal(opp.client_name,'Riverside Council','client name kept as a snapshot');assert.match(String(opp.location),/Riverside Rd/,'site fills location');
 assert.equal(opp.stage,'lead');
 await json(await call('/api/tenders/register','POST',{opportunityId:opp.id},A.cookie),409,'unqualified opportunity cannot convert');
 await json(await opps.move(opp.id,'converted'),409,'conversion is a dedicated action');
 await json(await opps.move(opp.id,'qualified'),200);
 const {tenderId}=await json(await call('/api/tenders/register','POST',{opportunityId:opp.id},A.cookie),201);
 const tenderClient=(await json(await call('/api/tenders/workspace?id='+tenderId,'GET',undefined,A.cookie),200)).tender;
 assert.equal(tenderClient.clientId,riverside.id,'tender inherits client');assert.equal(tenderClient.contactId,maxSite.id,'tender inherits the contact');assert.equal(tenderClient.siteId,riversideSite.id,'tender inherits site');assert.equal(tenderClient.clientName,'Riverside Council');
 await json(await call('/api/tenders/register','POST',{opportunityId:opp.id},A.cookie),409,'one tender per opportunity');
 const tf=new FormData();tf.set('opportunityId',opp.id);tf.set('file',new File(['Tender scope: drainage'],'tender-scope.txt',{type:'text/plain'}));await json(await call('/api/tenders','POST',tf,A.cookie),201,'tender document upload');
 const reqs=reg('requirements',A.cookie),rets=reg('returnables',A.cookie);
 const req1=(await json(await reqs.create(tenderId,{title:'Provide ISO 45001 aligned WHS management plan',category:'HSEQ',mandatory:true,source_document:'tender-scope.txt',source_page:'s4.2'}),201)).record;
 assert.equal(req1.status,'open','manual requirements start open (not suggested)');
 const minimal=(await json(await reqs.create(tenderId,{title:'Minimal requirement from the browser form',source_document:null,source_page:null,response:null,due_date:null}),201,'blank optional fields are accepted')).record;
 await json(await reqs.move(minimal.id,'not_applicable','Covered by standard terms'),200);
 const ret1=(await json(await rets.create(tenderId,{title:'Insurance certificates',category:'insurance',mandatory:true,library_item_id:libItem.id}),201)).record;
 let t=(await json(await call('/api/tenders/workspace?id='+tenderId,'GET',undefined,A.cookie),200)).tender;
 assert.equal(t.stage,'draft');assert.equal(t.stats.documents,1);assert.equal(t.nextAction,'Start the bid / no-bid review');
 await json(await call('/api/tenders/workspace','POST',{action:'bid-decision',id:tenderId,decision:'bid',reason:'fit'},A.cookie),409,'decision requires a bid review');
 await json(await call('/api/tenders/workspace','POST',{action:'bid-review',id:tenderId,values:{strategic_fit:'Core drainage client',capacity:'Crew available Feb',recommendation:'bid',recommendation_reason:'Strong fit'}},A.cookie),200);
 await json(await call('/api/tenders/workspace','POST',{action:'bid-decision',id:tenderId,decision:'bid',reason:'Strategic client'},A.cookie),200);
 const {estimateId}=await json(await call('/api/tenders/workspace','POST',{action:'create-estimate',id:tenderId,mode:'general'},A.cookie),200);
 let est=(await json(await call('/api/estimates?id='+estimateId,'GET',undefined,A.cookie),200)).estimate;
 assert.equal(est.data.includePaving,false,'general estimates are discipline-neutral');
 const items=[{section:'Drainage',costCode:'100',category:'labour',description:'Pipe laying crew',quantity:120,unit:'m',productivity:10,rateBasis:'hour',rate:95},{section:'Drainage',costCode:'300',category:'material',description:'375mm RCP',quantity:120,unit:'m',productivity:0,rateBasis:'unit',rate:180},{section:'Drainage',costCode:'200',category:'plant',description:'20t excavator',quantity:12,unit:'h',productivity:0,rateBasis:'unit',rate:210}];
 est=(await json(await call('/api/estimates','PUT',{id:estimateId,data:{...est.data,clientName:'Riverside Council',projectName:'Riverside drainage upgrade',workType:'Drainage',items,marginValue:15,overheadsPct:8,contingencyPct:3}},A.cookie),200)).estimate;
 const tenderApprovalEarly=await call('/api/tenders/workspace','POST',{action:'submit',id:tenderId,method:'Portal'},A.cookie);assert.equal(tenderApprovalEarly.status,409,'cannot submit before approval stage');
 await json(await call('/api/estimates/approval','POST',{estimateId,action:'submit'},A.cookie),200);
 let actionHome=await json(await call('/api/platform/home','GET',undefined,A.cookie),200);const estimateAction=actionHome.myActions.find(x=>x.key===`estimate-approval-${estimateId}`);assert.deepEqual(estimateAction?.target,{type:'tender',id:tenderId,tab:'estimate'},'Home opens estimate approval in the tender context');
 await json(await call('/api/estimates','PUT',{id:estimateId,data:est.data},A.cookie),409,'estimate in review is locked');
 await json(await call('/api/estimates/approval','POST',{estimateId,action:'approve',notes:'Checked rates'},A.cookie),200);
 const approval=await json(await call('/api/estimates/approval?estimateId='+estimateId,'GET',undefined,A.cookie),200);
 assert.equal(approval.state,'approved');const approvedSell=approval.revisions[0].sellPrice;assert(approvedSell>0);
 // direct cost = 120/10*95 + 120*180 + 12*210 = 1140+21600+2520 = 25260
 assert.equal(approval.revisions[0].directCost,25260,'deterministic estimate arithmetic');
 await json(await call('/api/tenders/workspace','POST',{action:'request-approval',id:tenderId},A.cookie),200);
 actionHome=await json(await call('/api/platform/home','GET',undefined,A.cookie),200);const tenderAction=actionHome.myActions.find(x=>x.key===`tender-approval-${tenderId}`);assert.deepEqual(tenderAction?.target,{type:'tender',id:tenderId,tab:'approval'},'Home opens tender approval at the approval step');
 await json(await call('/api/tenders/workspace','POST',{action:'approval-decision',id:tenderId,approve:true,notes:'Approved to submit'},A.cookie),200);
 const blocked=await json(await call('/api/tenders/workspace','POST',{action:'submit',id:tenderId,method:'Portal'},A.cookie),422,'mandatory items gate submission');
 assert.deepEqual(blocked.checks.map(c=>c.key).sort(),['requirements','returnables']);
 await json(await reqs.move(req1.id,'complete'),200);await json(await rets.move(ret1.id,'complete'),200);
 t=(await json(await call('/api/tenders/workspace','POST',{action:'submit',id:tenderId,method:'Client portal',version:'Rev A',notes:'Uploaded 4pm'},A.cookie),200)).tender;
 assert.equal(t.stage,'submitted');assert(t.submittedAt);
 const clar=(await json(await reg('clarifications',A.cookie).create(tenderId,{question:'Confirm pipe class',received_date:'2099-01-20',due_date:'2099-01-22',price_impact:0}),201)).record;
 assert.equal(clar.reference,'CLR-001');
 await json(await reg('clarifications',A.cookie).update(clar.id,clar.revision,{response:'Class 3 as specified'}),200);
 await json(await reg('clarifications',A.cookie).move(clar.id,'responded'),200);
 const award=await json(await call('/api/tenders/workspace','POST',{action:'award',id:tenderId},A.cookie),200);
 assert.equal(award.projectCreated,true);const projectId=award.jobId;
 const activity={projectId,name:'Excavation',startDate:'2026-10-01',durationDays:3,predecessorId:null,responsible:'QA lead',workPackage:'Drainage',resourceRequirement:'Excavator',plannedQuantity:120,quantityUnit:'m',productionPerDay:40,status:'planned'};
 const pa=await json(await call('/api/projects/program','POST',activity,A.cookie),200);
 const pb=await json(await call('/api/projects/program','POST',{...activity,name:'Pipework',predecessorId:pa.id},A.cookie),200);
 const program=await json(await call('/api/projects/program?projectId='+projectId,'GET',undefined,A.cookie),200);assert.equal(program.activities.find(a=>a.id===pb.id).start,'2026-10-04');
 await json(await call('/api/projects/program','POST',{...activity,id:pa.id,revision:1,predecessorId:pb.id},A.cookie),400,'dependency cycle refused');
 await json(await call('/api/projects/program','POST',{...activity,id:pa.id,revision:99},A.cookie),409,'stale activity refused');
 await json(await call('/api/projects/program?projectId='+projectId,'GET',undefined,B.cookie),404,'foreign programme hidden');
 await json(await call('/api/projects/program','POST',{...activity,id:pa.id,revision:1},B.cookie),404,'foreign programme write refused');
 console.log('PASS programme dependency projection, cycle refusal, stale revision and tenant isolation');
 // Quick programme edits: order, inline change, duplicate — same graph, revision and tenant rules.
 const listed=async()=>(await json(await call('/api/projects/program?projectId='+projectId,'GET',undefined,A.cookie),200)).activities;
 let acts=await listed();assert.deepEqual(acts.map(a=>a.id),[pa.id,pb.id],'new activities keep entry order');
 await json(await call('/api/projects/program','PATCH',{action:'reorder',projectId,ids:[pb.id,pa.id]},A.cookie),200);
 acts=await listed();assert.deepEqual(acts.map(a=>a.id),[pb.id,pa.id],'reordered');
 await json(await call('/api/projects/program','PATCH',{action:'reorder',projectId,ids:[pa.id]},A.cookie),409,'partial reorder refused');
 await json(await call('/api/projects/program','PATCH',{action:'reorder',projectId,ids:[pa.id,pb.id]},B.cookie),404,'foreign reorder refused');
 const a1=acts.find(a=>a.id===pa.id);
 await json(await call('/api/projects/program','PATCH',{action:'update',projectId,id:pa.id,revision:a1.revision,changes:{startDate:'2026-10-06',status:'in_progress'}},A.cookie),200);
 await json(await call('/api/projects/program','PATCH',{action:'update',projectId,id:pa.id,revision:a1.revision,changes:{durationDays:2}},A.cookie),409,'stale inline edit refused');
 acts=await listed();assert.equal(acts.find(a=>a.id===pa.id).start_date,'2026-10-06');assert.equal(acts.find(a=>a.id===pb.id).start,'2026-10-09','dependant moved by inline date change');
 const dup=await json(await call('/api/projects/program','PATCH',{action:'duplicate',projectId,id:pb.id},A.cookie),200);
 acts=await listed();assert.deepEqual(acts.map(a=>a.id),[pb.id,dup.id,pa.id],'duplicate sits after its source');assert.equal(acts[1].status,'planned');
 console.log('PASS programme reorder, inline edit with dependency move, stale refusal, duplicate and tenant isolation');
 const again=await json(await call('/api/tenders/workspace','POST',{action:'award',id:tenderId},A.cookie),200);assert.equal(again.alreadyAwarded,true,'award is idempotent');
 const estSearch=await json(await call('/api/search?q=Riverside','GET',undefined,A.cookie),200);
 assert.equal(estSearch.results.find(r=>r.type==='Estimate')?.tenderId,tenderId,'search links an estimate to its tender so it opens in the tender workspace');
 const foreignSearch=await json(await call('/api/search?q=Riverside','GET',undefined,B.cookie),200);assert(!foreignSearch.results.length,'another organisation finds nothing');
 console.log('PASS B: library + documents, opportunity → tender lineage, documents, requirements, bid review/decision, estimate items, approval lock, internal approval, submission gate, clarification, award');

 // ---------------------------------------------------------------- Scenario C
 step='C prepare';
 let pw=await json(await call('/api/projects/workspace?id='+projectId,'GET',undefined,A.cookie),200);
 assert.equal(pw.project.stage,'setup');assert.equal(pw.project.sourceTenderId,tenderId);assert.equal(pw.project.clientId,riverside.id,'awarded project inherits client');assert.equal(pw.project.siteId,riversideSite.id,'awarded project inherits site');assert.equal(pw.project.contactId,maxSite.id,'awarded project inherits the contact (enter once)');
 await json(await reg('clients',A.cookie).remove(riverside.id),409,'client in use cannot be deleted');
 const direct=await json(await call('/api/projects','POST',{name:'Direct client project',clientId:riverside.id},A.cookie),201);
 const directPw=await json(await call('/api/projects/workspace?id='+direct.projectId,'GET',undefined,A.cookie),200);
 assert.equal(directPw.project.clientName,'Riverside Council');assert.equal(directPw.project.siteId,null);
assert.equal(pw.project.sourceEstimateId,estimateId);
 assert.equal(pw.baselines.length,1);assert.equal(pw.baselines[0].contractValue,approvedSell,'baseline inherits the approved revision');assert.equal(pw.baselines[0].estimateRevisionId,approval.revisions[0].id);
 assert.equal(pw.baselines[0].clarifications[0].reference,'CLR-001','clarifications preserved in baseline');
 assert(pw.readiness.blockers.some(b=>b.startsWith('SWMS')),'readiness blocked without SWMS');
 assert.equal(pw.project.nextAction,'Approve SWMS before mobilisation');
 pw=await json(await call('/api/projects/workspace','PATCH',{id:projectId,revision:pw.project.revision,projectManagerName:'Pat Manager',startDate:'2099-02-01',contractNumber:'RC-2099-01'},A.cookie),200);
 await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'ready'},A.cookie),422,'cannot mark ready with blockers');
 const risks=reg('risks',A.cookie);
 const risk=(await json(await risks.create(projectId,{title:'Trench collapse',category:'safety',initial_likelihood:4,initial_consequence:5,residual_likelihood:2,residual_consequence:4}),201)).record;
 assert.equal(risk.initial_rating,'Extreme');assert.equal(risk.residual_rating,'Medium','deterministic risk rating');
 await json(await risks.move(risk.id,'controlled'),422,'controls required before approval');
 await json(await risks.update(risk.id,risk.revision,{controls:'Shoring boxes; competent person inspection'}),200);
 await json(await risks.move(risk.id,'controlled'),200);
 const sw=await json(await call('/api/hseq/swms','POST',{action:'create',projectId,title:'Pipe laying in trench',questionnaire:{activity:'Excavate and lay stormwater pipe',workSteps:['Excavate trench','Install shoring','Lay pipe','Backfill'],highRiskWork:['excavation','mobile-plant'],ppe:['Hard hat','Safety boots'],emergency:'Call 000; first aider on site',responsiblePeople:'Site supervisor'}},A.cookie),201);
 let swms=await json(await call('/api/hseq/swms?id='+sw.swmsId,'GET',undefined,A.cookie),200);
 assert.equal(swms.revisions[0].origin,'template');
 const gaps=await json(await call('/api/hseq/swms','POST',{action:'transition',id:sw.swmsId,to:'review'},A.cookie),422,'incomplete SWMS cannot go to review');assert(gaps.gaps.length);
 const content={...swms.revisions[0].content,workSteps:swms.revisions[0].content.workSteps.map(s=>({...s,hazards:s.hazards||'Plant, trench collapse',controls:s.controls||'Exclusion zone, shoring'}))};
 swms=await json(await call('/api/hseq/swms','POST',{action:'save',id:sw.swmsId,revisionId:sw.revisionId,updatedAt:swms.revisions[0].updated_at,content},A.cookie),200);
 for(const to of ['review','approved','issued'])swms=await json(await call('/api/hseq/swms','POST',{action:'transition',id:sw.swmsId,to},A.cookie),200,'swms '+to);
 assert.equal(swms.swms.status,'issued');
 await json(await call('/api/hseq/swms','POST',{action:'save',id:sw.swmsId,revisionId:sw.revisionId,updatedAt:swms.revisions[0].updated_at,content},A.cookie),409,'issued SWMS is immutable');
 const pdf=await call(`/api/hseq/swms?id=${sw.swmsId}&format=pdf`,'GET',undefined,A.cookie);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert((await pdf.arrayBuffer()).byteLength>500);
 await json(await reg('itps',A.cookie).create(projectId,{title:'Pipe installation ITP',activity:'Pipe laying'}),201);
 // IMS pack items not needed for this job are marked not applicable with a recorded reason (approver only).
 const ims=await json(await call('/api/ims?jobId='+projectId,'GET',undefined,A.cookie),200);
 for(const item of ims.jobPack||ims.job_pack||[])await json(await call('/api/ims','PATCH',{kind:'job-pack',id:item.id,status:'Not Applicable',reason:'Covered by company IMS for this minor works contract'},A.cookie),200,'ims n/a');
 pw=await json(await call('/api/projects/workspace?id='+projectId,'GET',undefined,A.cookie),200);
 const checklist=reg('readiness',A.cookie);
 for(const cat of pw.readiness.categories)for(const item of cat.items.filter(i=>i.source==='checklist'&&!i.ok))await json(await checklist.move(item.id,'complete'),200);
 pw=await json(await call('/api/projects/workspace?id='+projectId,'GET',undefined,A.cookie),200);
 assert.deepEqual(pw.readiness.blockers,[],'readiness complete');assert.equal(pw.readiness.percent,100);
 await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'ready'},A.cookie),200);
 pw=await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'active'},A.cookie),200);
 assert.equal(pw.project.stage,'active');
 console.log('PASS C: project from award, inherited baseline + lineage + clarifications, setup, risk rating/controls, SWMS draft→review→approve→issue, immutable issue, PDF, ITP, readiness gate → ready → active');

 // ---------------------------------------------------------------- Scenario D + F
 step='D deliver';
 const C=await signup('field-c');
 await db.execute("UPDATE users SET organisation_id=?,role='field' WHERE id=?",[memberA.organisation_id,C.user.id]);
 const workerId=`worker-${suffix}`;
 await db.execute('INSERT INTO workers (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[workerId,memberA.organisation_id,'Casey Field','active',JSON.stringify({role:'Pipe layer',hourlyRate:88,competencyExpiry:'2099-12-31',userId:C.user.id}),new Date().toISOString()]);
 // Bulk spreadsheet migration: preview first, valid rows import while invalid rows are skipped, and reruns update stable matches.
 step='D resource spreadsheet import';
 const importCsv=async(kind,mode,csv,cookie=A.cookie,updateExisting=true,mapping={})=>{const form=new FormData();form.set('kind',kind);form.set('mode',mode);form.set('updateExisting',String(updateExisting));form.set('mapping',JSON.stringify(mapping));form.set('file',new File([csv],`bulk-${kind}.csv`,{type:'text/csv'}));return call('/api/operations/resource-import','POST',form,cookie);};
 const employeeNo=`EMP-BULK-${suffix}`;
 const employeeCsv=`Payroll ID,Full Name,Mobile,Trade,Employment Type,Depot,Status,Hourly Rate\n${employeeNo},Jordan Import,0412 345 678,Labourer,employee,Sydney,Active,72.50\nBAD-${suffix},Broken Rate,0400 000 001,Labourer,employee,Sydney,Active,not-a-rate`;
 let importPreview=await json(await importCsv('workers','preview',employeeCsv),200,'employee import preview');
 assert.equal(importPreview.summary.total,2);assert.equal(importPreview.summary.create,1);assert.equal(importPreview.summary.error,1,'bad rows are surfaced before import');
 const duplicateIdentityCsv=`Payroll ID,Email,Full Name,Status\nDUP-A-${suffix},same-${suffix}@example.invalid,Duplicate One,Active\nDUP-B-${suffix},same-${suffix}@example.invalid,Duplicate Two,Active`;
 const duplicatePreview=await json(await importCsv('workers','preview',duplicateIdentityCsv),200,'duplicate employee identity preview');assert.equal(duplicatePreview.summary.error,1,'same email across different spreadsheet rows is flagged before import');
 let importApplied=await json(await importCsv('workers','apply',employeeCsv),200,'employee import apply');
 assert.equal(importApplied.summary.created,1);assert.equal(importApplied.summary.skipped,1,'invalid row is skipped while valid row imports');
 let [[bulkWorker]]=await db.execute('SELECT id,name,employee_number,phone,role_title,hourly_rate,location FROM workers WHERE organisation_id=? AND employee_number=?',[memberA.organisation_id,employeeNo]);
 assert.equal(bulkWorker.name,'Jordan Import');assert.equal(bulkWorker.phone,'0412 345 678');assert.equal(bulkWorker.role_title,'Labourer');assert.equal(Number(bulkWorker.hourly_rate),72.5);
 const employeeUpdate=`Payroll ID,Full Name,Legacy Position,Depot,Status\n${employeeNo},Jordan Import,Team Leader,Wollongong,Active`;
 importPreview=await json(await importCsv('workers','preview',employeeUpdate),200,'employee unmapped preview');assert(importPreview.unmappedHeaders.includes('Legacy Position'),'unknown legacy headings are surfaced for mapping');
 const employeeMapping={'Legacy Position':'roleTitle'};
 importPreview=await json(await importCsv('workers','preview',employeeUpdate,A.cookie,true,employeeMapping),200,'employee mapped rerun preview');assert.equal(importPreview.summary.update,1);assert.equal(importPreview.summary.create,0,'stable employee number matches the existing worker');assert(!importPreview.unmappedHeaders.includes('Legacy Position'),'manual column mapping is applied before import');
 importApplied=await json(await importCsv('workers','apply',employeeUpdate,A.cookie,true,employeeMapping),200,'employee rerun apply');assert.equal(importApplied.summary.updated,1);
 [[bulkWorker]]=await db.execute('SELECT phone,role_title,location FROM workers WHERE organisation_id=? AND employee_number=?',[memberA.organisation_id,employeeNo]);
 assert.equal(bulkWorker.phone,'0412 345 678','blank update cells preserve existing values');assert.equal(bulkWorker.role_title,'Team Leader');assert.equal(bulkWorker.location,'Wollongong');
 const plantNo=`PL-BULK-${suffix}`,rego=`RG${suffix.slice(-5).toUpperCase()}`;
 const plantCsv=`Asset Number,Rego,Equipment Name,Type,Make,Model,Ownership,Expiry Date,Depot,Status,Hourly Rate,Day Rate\n${plantNo},${rego},Excavator Import,Excavator,Kubota,U55-4,owned,31/12/2099,Sydney,Available,95,760`;
 importPreview=await json(await importCsv('plant','preview',plantCsv),200,'plant import preview');assert.equal(importPreview.summary.create,1);
 importApplied=await json(await importCsv('plant','apply',plantCsv),200,'plant import apply');assert.equal(importApplied.summary.created,1);
 let [[bulkPlant]]=await db.execute('SELECT id,name,plant_number,registration,status,compliance_expiry FROM plant WHERE organisation_id=? AND plant_number=?',[memberA.organisation_id,plantNo]);
 assert.equal(bulkPlant.registration,rego);assert.equal(bulkPlant.compliance_expiry,'2099-12-31');
 const plantUpdate=`Asset Number,Equipment Name,Status,Depot\n${plantNo},Excavator Import,Maintenance,Unanderra`;
 importApplied=await json(await importCsv('plant','apply',plantUpdate),200,'plant rerun apply');assert.equal(importApplied.summary.updated,1);
 [[bulkPlant]]=await db.execute('SELECT registration,status,location FROM plant WHERE organisation_id=? AND plant_number=?',[memberA.organisation_id,plantNo]);
 assert.equal(bulkPlant.registration,rego,'blank plant fields preserve existing values');assert.equal(bulkPlant.status,'Maintenance');assert.equal(bulkPlant.location,'Unanderra');
 const template=await call('/api/operations/resource-import?kind=workers&template=1','GET',undefined,A.cookie);assert.equal(template.status,200);assert.match(template.headers.get('content-type')||'',/spreadsheetml/);const templateBytes=await template.arrayBuffer();assert(templateBytes.byteLength>1000,'employee template is a real XLSX workbook');
 const templateForm=new FormData();templateForm.set('kind','workers');templateForm.set('mode','preview');templateForm.set('updateExisting','true');templateForm.set('mapping','{}');templateForm.set('file',new File([templateBytes],'employee-template.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const templatePreview=await json(await call('/api/operations/resource-import','POST',templateForm,A.cookie),200,'generated XLSX template roundtrip');assert.equal(templatePreview.summary.total,1);assert.equal(templatePreview.unmappedHeaders.length,0,'generated template uploads back without remapping');
 const foreignPreview=await json(await importCsv('workers','preview',employeeUpdate,B.cookie,true,employeeMapping),200,'tenant import preview');assert.equal(foreignPreview.summary.create,1,'another organisation cannot match organisation A workers');
 assert.equal((await importCsv('workers','preview',employeeUpdate,C.cookie,true,employeeMapping)).status,403,'field users cannot bulk import resources');
 console.log('PASS D import: XLSX template, CSV preview, partial valid import, employee/plant safe reruns, blank preservation, tenant isolation and role denial');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const shift=(await json(await call('/api/delivery','POST',{kind:'shifts',record:{id:'',name:'Pipe laying day 1',status:'Planned',metadata:{jobId:projectId,date:today,start:'07:00',finish:'15:30',scope:'Lay 40m of 375 RCP',instructions:'Shoring inspected before entry',assignments:[{resourceId:workerId,category:'workers',name:'Casey Field',role:'Pipe layer',hours:8,rate:88,payload:0,trips:0,userId:C.user.id}]}}},A.cookie),201)).record;
 // Planner availability check: read-only, same engine, tenant-scoped, write roles only.
 const [[shiftCountBefore]]=await db.execute('SELECT COUNT(*) AS n FROM shifts WHERE organisation_id=?',[memberA.organisation_id]);
 const check=await json(await call('/api/delivery','POST',{kind:'shifts',check:true,candidates:[{category:'workers',resourceId:workerId}],record:{id:'',name:'Trial',status:'Planned',metadata:{jobId:projectId,date:today,start:'08:00',finish:'12:00',assignments:[]}}},A.cookie),200,'availability check');
 assert(check.availability[workerId].some(c=>c.code==='WORKER_DOUBLE_BOOKED'&&c.severity==='block'),'a worker already on an overlapping shift shows as booked before saving');
 const [[shiftCountAfter]]=await db.execute('SELECT COUNT(*) AS n FROM shifts WHERE organisation_id=?',[memberA.organisation_id]);assert.equal(Number(shiftCountAfter.n),Number(shiftCountBefore.n),'the availability check writes nothing');
 const foreignCheck=await json(await call('/api/delivery','POST',{kind:'shifts',check:true,candidates:[{category:'workers',resourceId:workerId}],record:{id:'',name:'Trial',status:'Planned',metadata:{date:today,start:'08:00',finish:'12:00',assignments:[]}}},B.cookie),200,'foreign availability check');
 assert.deepEqual(foreignCheck.availability[workerId].map(c=>c.code),['RESOURCE_MISSING'],'another organisation learns nothing about the worker');assert(!JSON.stringify(foreignCheck).includes('Casey'),'no foreign names leak');
 assert.equal((await call('/api/delivery','POST',{kind:'shifts',check:true,candidates:[],record:{id:'',name:'x',status:'Draft',metadata:{}}},C.cookie)).status,403,'field users cannot run planner checks');
 let day=await json(await call('/api/field/today','GET',undefined,C.cookie),200);
 const mine=day.today.find(s=>s.id===shift.id);assert(mine,'field user sees assigned shift today');assert.equal(mine.swmsOutstanding,1);
 const fieldText=JSON.stringify(day);for(const k of ['"rate"','contractValue','approvedBudget','hourlyRate','sellPrice'])assert(!fieldText.includes(k),'field Today leaked '+k);
 const demand={id:'',name:'Requirement shortage test',status:'Draft',metadata:{jobId:projectId,date:today,start:'19:00',finish:'20:00',assignments:[],requirements:[{category:'plant',role:'Paver',quantity:1}]}};
 const demandSaved=(await json(await call('/api/delivery','POST',{kind:'shifts',record:demand},A.cookie),201)).record;
 const shortage=await json(await call('/api/delivery','POST',{kind:'shifts',record:{...demandSaved,status:'Planned'}},A.cookie),409);assert(shortage.conflicts.some(c=>c.code==='REQUIREMENT_SHORTAGE'));
 const [[demandCount]]=await db.execute('SELECT COUNT(*) n FROM shift_requirements WHERE organisation_id=? AND shift_id=?',[memberA.organisation_id,demandSaved.id]);assert.equal(Number(demandCount.n),1);
 const ack=await json(await call('/api/hseq/swms','POST',{action:'acknowledge',id:sw.swmsId,shiftId:shift.id},C.cookie),200);assert.equal(ack.acknowledged,true);
 const ack2=await json(await call('/api/hseq/swms','POST',{action:'acknowledge',id:sw.swmsId,shiftId:shift.id},C.cookie),200);assert.equal(ack2.alreadyAcknowledged,true,'acknowledgement is idempotent');
 day=await json(await call('/api/field/today','GET',undefined,C.cookie),200);assert.equal(day.today.find(s=>s.id===shift.id).swmsOutstanding,0);
 const inc=await json(await reg('incidents',C.cookie).create(projectId,{incident_type:'near miss',occurred_at:`${today}T10:30`,description:'Spoil fell near edge'}),201,'field reports incident');assert.equal(inc.record.status,'reported');
 const fd=await json(await call('/api/field/today','POST',{shiftId:shift.id,docketNo:`D-${suffix}`,workDate:today,labourHours:8,quantity:40,quantityUnit:'m',notes:'40m laid',lines:[{description:'Pipe laying crew',quantity:8,unit:'h'}]},C.cookie),201);
 assert.equal(fd.status,'review');
 step='D offline sync';
 // Offline sync rules: idempotent replay, duplicate docket, shift changed/rescheduled/cancelled after capture, SWMS superseded offline.
 const rid=()=>crypto.randomUUID();
 const off={shiftId:shift.id,docketNo:`OFF-${suffix}`,workDate:today,labourHours:4,quantity:10,quantityUnit:'m',notes:'captured offline',lines:[],clientRequestId:rid(),shiftVersion:mine.version,capturedAt:new Date().toISOString()};
 assert(mine.version,'Today exposes the shift version for offline capture');
 const s1=await json(await call('/api/field/today','POST',off,C.cookie),201);
 const s2=await json(await call('/api/field/today','POST',off,C.cookie),200,'replay of the same request');
 assert.equal(s2.docketId,s1.docketId);assert.equal(s2.replay,true);
 const [[once]]=await db.execute('SELECT COUNT(*) AS n FROM dockets WHERE organisation_id=? AND docket_no=?',[memberA.organisation_id,off.docketNo]);assert.equal(Number(once.n),1,'a replayed sync never duplicates a docket');
 const dupe=await json(await call('/api/field/today','POST',{...off,clientRequestId:rid()},C.cookie),409,'same docket from another device');assert.equal(dupe.code,'DUPLICATE_DOCKET');
 assert.equal((await call('/api/field/today','POST',{...off,shiftId:'not-a-shift'},C.cookie)).status,409,'a request id cannot be reused for a different payload/user action');
 const office=(meta,status='Planned')=>call('/api/delivery','POST',{kind:'shifts',record:{...shift,status,metadata:{...shift.metadata,...meta}}},A.cookie);
 await json(await office({instructions:'Changed by office: use the northern access'}),200);
 const changed=await json(await call('/api/field/today','POST',{...off,docketNo:`OFF2-${suffix}`,clientRequestId:rid()},C.cookie),201,'minor office change is accepted');
 assert.equal(changed.warnings.length,1,'flagged to the worker');
 const [[flag]]=await db.execute('SELECT links,notes FROM dockets WHERE id=?',[changed.docketId]);assert.equal(JSON.parse(flag.links).shiftChangedAfterCapture,true);assert.match(flag.notes,/Shift changed after capture/);
 const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 await json(await office({date:tomorrow}),200);
 const moved=await json(await call('/api/field/today','POST',{...off,docketNo:`OFF3-${suffix}`,clientRequestId:rid()},C.cookie),409);assert.equal(moved.code,'SHIFT_RESCHEDULED');
 await json(await office({date:today},'Cancelled'),200);
 const cancelled=await json(await call('/api/field/today','POST',{...off,docketNo:`OFF4-${suffix}`,clientRequestId:rid()},C.cookie),409);assert.equal(cancelled.code,'SHIFT_CANCELLED');
 await json(await office({date:today}),200);
 const oldRevision=ack.revisionId;
 await json(await call('/api/hseq/swms','POST',{action:'revise',id:sw.swmsId,reason:'Groundwater found'},A.cookie),200);
 for(const to of ['review','approved','issued'])await json(await call('/api/hseq/swms','POST',{action:'transition',id:sw.swmsId,to},A.cookie),200,'revision '+to);
 const superseded=await json(await call('/api/hseq/swms','POST',{action:'acknowledge',id:sw.swmsId,shiftId:shift.id,revisionId:oldRevision,clientRequestId:rid()},C.cookie),409,'offline acknowledgement of a superseded revision');
 assert.equal(superseded.code,'SWMS_SUPERSEDED');assert.notEqual(superseded.currentRevisionId,oldRevision);
 const fresh=await json(await call('/api/hseq/swms','POST',{action:'acknowledge',id:sw.swmsId,shiftId:shift.id,revisionId:superseded.currentRevisionId},C.cookie),200);assert.equal(fresh.alreadyAcknowledged,false);
 const incId=rid(),incBody={parentId:projectId,values:{incident_type:'near miss',occurred_at:`${today}T11:00`,description:'Captured offline'},clientRequestId:incId};
 const i1=await json(await call('/api/registers/incidents','POST',incBody,C.cookie),201),i2=await json(await call('/api/registers/incidents','POST',incBody,C.cookie),200);
 assert.equal(i2.record.id,i1.record.id);assert.equal(i2.replay,true);
 console.log('PASS D offline sync: idempotent replay (docket, incident), duplicate docket refused, shift changed → flagged, rescheduled/cancelled → kept for review, SWMS superseded offline → refused until the new revision is read');
 step='F field permissions';
 for(const path of ['/api/estimates','/api/estimates/rates','/api/tenders/register',`/api/tenders/workspace?id=${tenderId}`,`/api/commercial/claims?projectId=${projectId}`,`/api/projects/control?id=${projectId}`,'/api/commercial/portfolio','/api/reports/v1','/api/team',`/api/projects/workspace?id=${projectId}`,'/api/platform/audit','/api/registers/variations?parentId='+projectId,'/api/registers/opportunities'])assert.equal((await call(path,'GET',undefined,C.cookie)).status,403,'field denied '+path);
 assert.equal((await call('/api/estimates/rates','POST',{name:'x'},C.cookie)).status,403);
 assert.equal((await call('/api/registers/risks','POST',{parentId:projectId,values:{title:'x'}},C.cookie)).status,403,'field cannot create risks');
 const fieldSwms=await json(await call('/api/hseq/swms?projectId='+projectId,'GET',undefined,C.cookie),200);assert.equal(fieldSwms.swms.length,1,'field sees issued SWMS only');
 const fieldSearch=await json(await call('/api/search?q=Riverside','GET',undefined,C.cookie),200);assert(!fieldSearch.results.some(r=>['Tender','Opportunity','Estimate','Variation','Claim','Invoice','Docket'].includes(r.type)),'field search has no commercial records');
 const fieldHome=await json(await call('/api/platform/home','GET',undefined,C.cookie),200);assert(!JSON.stringify(fieldHome).match(/docket|variation|claim|invoice/i),'field home has no commercial actions');
 console.log('PASS D/F: schedule + assignment, field Today, SWMS acknowledgement (idempotent), incident report, field docket; field denied rates/estimates/tenders/claims/margin/admin/audit, no commercial search or home leakage');

 // ---------------------------------------------------------------- Scenario E
 step='E money';
 const docket=(await json(await call(`/api/dockets?month=${today.slice(0,7)}`,'GET',undefined,A.cookie),200)).dockets.find(d=>d.id===fd.docketId);
 assert(docket,'office sees the field docket');
 const priced={...docket,amount:1200,lineItems:[{description:'Pipe laying crew',quantity:8,unit:'h',rate:150,amount:1200}],status:'approved'};
 const docketSearch=await json(await call(`/api/search?q=${encodeURIComponent(`D-${suffix}`)}`,'GET',undefined,A.cookie),200);
 assert.equal(docketSearch.results.find(r=>r.type==='Docket')?.projectId,projectId,'search links a docket to its project');
 const approved=await json(await call('/api/dockets','PUT',priced,A.cookie),200);assert.equal(approved.costLinesPosted,1);
 await json(await call('/api/dockets','PUT',priced,A.cookie),200);
 const [[costs]]=await db.execute("SELECT COUNT(*) AS n,SUM(amount) AS total FROM cost_transactions WHERE organisation_id=? AND source_id=? AND status='actual'",[memberA.organisation_id,docket.id]);
 assert.equal(Number(costs.n),1,'re-approval does not duplicate costs');assert.equal(Number(costs.total),1200);
 await json(await call('/api/dockets','PUT',{...priced,status:'review'},A.cookie),200);
 const [[reversed]]=await db.execute("SELECT COUNT(*) AS n FROM cost_transactions WHERE organisation_id=? AND source_id=? AND status='actual'",[memberA.organisation_id,docket.id]);assert.equal(Number(reversed.n),0,'unapproving reverses cost');
 await json(await call('/api/dockets','PUT',priced,A.cookie),200);
 const vars=reg('variations',A.cookie);
 const v=(await json(await vars.create(projectId,{title:'Additional pit',cause:'client instruction',value:9000,cost:6000,notice_date:today}),201)).record;
 assert.equal(v.reference,'VAR-001');
 await json(await vars.move(v.id,'approved'),409,'variation must be submitted first');
 await json(await vars.move(v.id,'submitted'),200);await json(await vars.move(v.id,'approved','Client email 12/1'),200);
 await json(await vars.update(v.id,3,{value:1}),409,'approved variation locked');
 let claims=await json(await call('/api/commercial/claims?projectId='+projectId,'GET',undefined,A.cookie),200);
 const contractLine=claims.claimable.find(l=>l.lineType==='contract'),varLine=claims.claimable.find(l=>l.lineType==='variation'),docketLine=claims.claimable.find(l=>l.lineType==='docket');
 assert(contractLine&&varLine&&docketLine,'contract, approved variation and approved docket are claimable');
 await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'contract',sourceId:contractLine.sourceId,thisClaim:contractLine.contractValue+1}]},A.cookie),422,'cannot claim beyond contract value');
 const claim=await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'contract',sourceId:contractLine.sourceId,thisClaim:10000},{lineType:'variation',sourceId:varLine.sourceId,thisClaim:9000},{lineType:'docket',sourceId:docketLine.sourceId,thisClaim:1200}]},A.cookie),201);
 assert.equal(claim.grossAmount,20200);
 await json(await call('/api/dockets','PUT',{...priced,status:'review'},A.cookie),409,'claimed docket is locked');
 await json(await call('/api/commercial/claims','POST',{action:'transition',claimId:claim.claimId,to:'internal_approval'},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'docket',sourceId:docketLine.sourceId,thisClaim:1200}]},A.cookie),409,'open claim / docket already claimed');
 await json(await call('/api/commercial/claims','POST',{action:'transition',claimId:claim.claimId,to:'submitted'},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'certify',claimId:claim.claimId,certifiedAmount:19800},A.cookie),200);
 const inv=await json(await call('/api/commercial/claims','POST',{action:'invoice',claimId:claim.claimId,invoiceNumber:`INV-${suffix}`,invoiceDate:today,dueDate:today},A.cookie),201);
 assert.equal(inv.gst,1980);assert.equal(inv.total,21780);
 await json(await call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv.invoiceId,invoiceAction:'issue'},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv.invoiceId,invoiceAction:'payment',amount:30000,date:today},A.cookie),422,'overpayment rejected');
 await json(await call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv.invoiceId,invoiceAction:'payment',amount:21780,date:today},A.cookie),200);
 claims=await json(await call('/api/commercial/claims?projectId='+projectId,'GET',undefined,A.cookie),200);assert.equal(claims.claims[0].status,'paid');assert.equal(claims.claims[0].variance,-400);
 const control=await json(await call('/api/projects/control?id='+projectId,'GET',undefined,A.cookie),200);const f=control.financials.forecast;
 assert.equal(f.currentContract,Math.round((approvedSell+9000)*100)/100,'approved variation updates current contract, not original');assert.equal(f.originalContract,approvedSell);
 assert.equal(f.actual,1200);assert.equal(f.claimed,20200);assert.equal(f.certified,19800);assert.equal(f.invoiced,19800);assert.equal(f.paid,19800,'paid is reported ex-GST like invoiced');assert.equal(f.outstanding,0);
 assert.equal(control.estimateVsActual.available,true);assert.equal(control.estimateVsActual.categories.find(c=>c.category==='labour').actual,1200);
 const report=await json(await call('/api/reports/v1','GET',undefined,A.cookie),200);assert(report.commercial.totals.currentContract>=f.currentContract);assert.equal(report.pipeline.conversionPct,100);
 console.log('PASS E: docket approval posts cost idempotently + reversal, variation lifecycle and lock, claim limits, no double docket claim, internal approval → submit → certify → invoice (GST) → payment, forecast/control, estimate vs actual, reports');

 // ---------------------------------------------------------------- Scenario G
 step='G tenant attack';
 const attacks=[['GET',`/api/tenders/workspace?id=${tenderId}`],['GET',`/api/projects/workspace?id=${projectId}`],['GET',`/api/projects/control?id=${projectId}`],['GET',`/api/commercial/claims?projectId=${projectId}`],['GET',`/api/hseq/swms?id=${sw.swmsId}`],['GET',`/api/documents?id=${insuranceDoc.id}`],['GET',`/api/tenders/export?id=${tenderId}`],['GET',`/api/registers/risks?parentId=${projectId}`],['GET',`/api/registers/requirements?parentId=${tenderId}`]];
 for(const [method,path] of attacks)assert.equal((await call(path,method,undefined,B.cookie)).status,404,'foreign read '+path);
 assert.equal((await call('/api/registers/risks','PATCH',{id:risk.id,revision:9,values:{title:'hacked'}},B.cookie)).status,404,'foreign update');
 assert.equal((await call('/api/registers/risks','PATCH',{id:risk.id,transition:'closed'},B.cookie)).status,404,'foreign transition');
 assert.equal((await call(`/api/registers/library?id=${libItem.id}`,'DELETE',undefined,B.cookie)).status,404,'foreign delete');
 assert.equal((await call('/api/registers/risks','POST',{parentId:projectId,values:{title:'plant'}},B.cookie)).status,404,'foreign parent write');
 assert.equal((await call('/api/tenders/workspace','POST',{action:'award',id:tenderId},B.cookie)).status,404,'foreign award');
 assert.equal((await call('/api/commercial/claims','POST',{action:'certify',claimId:claim.claimId,certifiedAmount:1},B.cookie)).status,404,'foreign claim');
 assert.equal((await call('/api/hseq/swms','POST',{action:'acknowledge',id:sw.swmsId},B.cookie)).status,404,'foreign SWMS');
 // Resources, shifts, dockets, variations, invoices and documents by known IDs.
 const bWorkers=await json(await call('/api/operations/resources?kind=workers','GET',undefined,B.cookie),200);assert(!bWorkers.workers.some(w=>w.id===workerId),'no cross-tenant resources');
 assert.equal((await call('/api/operations/resources','POST',{action:'saveWorker',id:workerId,worker:{firstName:'Hacked',status:'Active'}},B.cookie)).status,404,'foreign worker update');
 assert.equal((await call('/api/operations/resources','POST',{action:'saveCompetency',workerId,competency:{competencyType:'x'}},B.cookie)).status,404,'foreign competency');
 assert.equal((await call('/api/delivery','POST',{kind:'shifts',record:{...shift,name:'Hijack'}},B.cookie)).status,404,'foreign shift update');
 const bDelivery=await json(await call('/api/delivery','GET',undefined,B.cookie),200);assert(!bDelivery.shifts.some(x=>x.id===shift.id),'no cross-tenant shifts');
 assert.notEqual((await call('/api/dockets','PUT',{...priced,notes:'hacked'},B.cookie)).status,200,'foreign docket update refused');
 const [[docketAfter]]=await db.execute('SELECT notes,organisation_id FROM dockets WHERE id=?',[priced.id]);assert.notEqual(docketAfter.notes,'hacked');assert.equal(docketAfter.organisation_id,memberA.organisation_id);
 assert.equal((await call('/api/registers/variations','PATCH',{id:v.id,transition:'rejected'},B.cookie)).status,404,'foreign variation');
 assert.equal((await call('/api/commercial/claims?invoiceId='+inv.invoiceId,'GET',undefined,B.cookie)).status,404,'foreign invoice PDF');
 assert.equal((await call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv.invoiceId,invoiceAction:'void'},B.cookie)).status,404,'foreign invoice action');
 assert.equal((await call('/api/documents?id='+insuranceDoc.id,'GET',undefined,B.cookie)).status,404,'foreign document download');
 const bSearch=await json(await call('/api/search?q=Riverside','GET',undefined,B.cookie),200);assert.equal(bSearch.results.length,0,'no cross-tenant search');
 const bLists=await json(await call('/api/registers/library','GET',undefined,B.cookie),200);assert.equal(bLists.records.length,0);
 const bReport=await json(await call('/api/reports/v1','GET',undefined,B.cookie),200);assert.equal(bReport.commercial.projects.length,0,'no cross-tenant reporting');
 const [[unchanged]]=await db.execute('SELECT title FROM risks WHERE id=?',[risk.id]);assert.equal(unchanged.title,'Trench collapse');
 console.log('PASS G: organisation B cannot read, update, transition, delete, award, certify, acknowledge, search, list, report or export organisation A records by known IDs');

 // ---------------------------------------------------------------- Entitlements, closeout, audit
 step='entitlements';
 await json(await call('/api/platform/entitlements','PUT',{module:'commercial',status:'read_only'},A.cookie),200);
 await json(await call('/api/commercial/claims?projectId='+projectId,'GET',undefined,A.cookie),200,'read-only keeps data readable');
 assert.equal((await call('/api/registers/variations','POST',{parentId:projectId,values:{title:'x',value:1}},A.cookie)).status,403,'read-only blocks writes');
 await json(await call('/api/platform/entitlements','PUT',{module:'commercial',status:'disabled'},A.cookie),200);
 assert.equal((await call('/api/commercial/claims?projectId='+projectId,'GET',undefined,A.cookie)).status,404,'disabled module 404s');
 ws=await json(await call('/api/workspace','GET',undefined,A.cookie),200);assert.equal(ws.entitlements.commercial,'disabled');
 const [[kept]]=await db.execute('SELECT COUNT(*) AS n FROM progress_claims WHERE organisation_id=?',[memberA.organisation_id]);assert.equal(Number(kept.n),1,'downgrade never deletes data');
 await json(await call('/api/platform/entitlements','PUT',{module:'commercial',status:'active'},A.cookie),200);
 await json(await call('/api/platform/entitlements','PUT',{module:'commercial',status:'active'},C.cookie),403,'field cannot manage entitlements');
 step='retention';
 // Retention: 5% capped at 70 (ex GST); certified retention recomputed; release carried on a later claim; history untouched.
 let pws=await json(await call('/api/projects/workspace?id='+projectId,'GET',undefined,A.cookie),200);
 await json(await call('/api/projects/workspace','PATCH',{id:projectId,revision:pws.project.revision,retentionEnabled:true,retentionPct:5,retentionCapAmount:70},A.cookie),200);
 claims=await json(await call('/api/commercial/claims?projectId='+projectId,'GET',undefined,A.cookie),200);
 assert.deepEqual([claims.retention.enabled,claims.retention.pct,claims.retention.cap,claims.retention.held],[true,5,70,0]);
 const cl=claims.claimable.find(l=>l.lineType==='contract');
 const c2=await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'contract',sourceId:cl.sourceId,thisClaim:1000}]},A.cookie),201);
 assert.deepEqual([c2.grossAmount,c2.retentionWithheld,c2.netAmount],[1000,50,950]);
 await json(await call('/api/commercial/claims','POST',{action:'transition',claimId:c2.claimId,to:'internal_approval'},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'transition',claimId:c2.claimId,to:'submitted'},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'certify',claimId:c2.claimId,certifiedAmount:800},A.cookie),200);
 const inv2=await json(await call('/api/commercial/claims','POST',{action:'invoice',claimId:c2.claimId,invoiceNumber:`INV-R-${suffix}`,invoiceDate:today},A.cookie),201);
 assert.deepEqual([inv2.amountExGst,inv2.gst,inv2.total],[760,76,836],'invoice = certified net + GST on the net');
 const invPdf=await call('/api/commercial/claims?invoiceId='+inv2.invoiceId,'GET',undefined,A.cookie);assert.equal(invPdf.status,200);assert.equal(invPdf.headers.get('content-type'),'application/pdf');const pdfBytes=Buffer.from(await invPdf.arrayBuffer());assert(pdfBytes.subarray(0,5).toString()==='%PDF-'&&pdfBytes.length>800,'tax invoice PDF');
 assert.equal((await call('/api/commercial/claims?invoiceId='+inv2.invoiceId,'GET',undefined,C.cookie)).status,403,'field cannot download invoices');
 assert.equal((await call('/api/commercial/claims?invoiceId='+inv2.invoiceId,'GET',undefined,B.cookie)).status,404,'other organisations cannot download invoices');
 await json(await call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv2.invoiceId,invoiceAction:'issue'},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv2.invoiceId,invoiceAction:'payment',amount:836,date:today},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'contract',sourceId:cl.sourceId,thisClaim:1000}],retentionRelease:{amount:500,reason:'too much'}},A.cookie),422,'release cannot exceed retention held');
 await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[],retentionRelease:{amount:20,reason:''}},A.cookie),422,'release needs a reason');
 const c3=await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'contract',sourceId:cl.sourceId,thisClaim:1000}],retentionRelease:{amount:20,reason:'Practical completion'}},A.cookie),201);
 assert.deepEqual([c3.retentionWithheld,c3.retentionReleased,c3.netAmount],[30,20,990],'cap limits withholding to 70 in total; release is added to net');
 await json(await call('/api/commercial/claims','POST',{action:'transition',claimId:c3.claimId,to:'internal_approval'},A.cookie),200);
 await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'contract',sourceId:cl.sourceId,thisClaim:1000}]},A.cookie),409,'one unsent claim at a time, so unsent retention can never be double-counted against the cap');
 await json(await call('/api/commercial/claims','POST',{action:'transition',claimId:c3.claimId,to:'draft'},A.cookie),200);
 claims=await json(await call('/api/commercial/claims?projectId='+projectId,'GET',undefined,A.cookie),200);
 const h2=claims.claims.find(c=>c.id===c2.claimId);
 assert.deepEqual([h2.grossAmount,h2.retentionWithheld,h2.netAmount,h2.certifiedAmount,h2.certifiedRetention,h2.certifiedNet],[1000,50,950,800,40,760],'earlier claim history is never rewritten');
 assert.deepEqual([claims.retention.withheld,claims.retention.released,claims.retention.held],[40,0,40],'a draft claim neither withholds nor releases retention');
 const portfolio=await json(await call('/api/commercial/portfolio','GET',undefined,A.cookie),200);assert.equal(portfolio.projects.find(x=>x.id===projectId).retentionHeld,40,'portfolio uses the same definition');
 await json(await call('/api/commercial/claims','POST',{action:'delete',claimId:c3.claimId},A.cookie),200);
 const releaseOnly=await json(await call('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[],retentionRelease:{amount:40,reason:'End of defects period'}},A.cookie),201);
 assert.deepEqual([releaseOnly.grossAmount,releaseOnly.retentionWithheld,releaseOnly.netAmount],[0,0,40],'release-only claim');
 await json(await call('/api/commercial/claims','POST',{action:'delete',claimId:releaseOnly.claimId},A.cookie),200);
 const ctl=await json(await call('/api/projects/control?id='+projectId,'GET',undefined,A.cookie),200);
 assert.equal(ctl.financials.retention.held,40,'project control reports retention held on received claims');
 console.log('PASS retention: % and cap, certified retention/net, invoice on certified net + GST, release validation and reason, release-only claim, history unchanged, held/released/outstanding');
 step='closeout';
 await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'practical_completion'},A.cookie),200);
 pw=await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'closeout'},A.cookie),200);
 const close=await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'closed'},A.cookie),422,'closeout checklist gates closure');assert(close.blockers.length);
 const closeoutItems=await json(await reg('closeout',A.cookie).list('?parentId='+projectId),200);
 for(const item of closeoutItems.records)await json(await reg('closeout',A.cookie).move(item.id,'complete'),200);
 pw=await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'closed'},A.cookie),200);assert.equal(pw.project.stage,'closed');
 assert.equal((await call('/api/delivery','POST',{kind:'shifts',record:{id:'',name:'Late shift',status:'Planned',metadata:{jobId:projectId,date:today,start:'07:00',finish:'15:00',assignments:[]}}},A.cookie)).status,409,'closed project refuses new shifts');
 assert.equal((await call('/api/registers/risks','POST',{parentId:projectId,values:{title:'late'}},A.cookie)).status,409,'closed project refuses new records');
 await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'closeout'},A.cookie),422,'reopening needs a reason');
 await json(await call('/api/projects/workspace','POST',{action:'transition',id:projectId,to:'closeout',reason:'Defect rectification'},A.cookie),200);
 step='audit';
 const audit=await json(await call('/api/platform/audit?projectId='+projectId,'GET',undefined,A.cookie),200);
 for(const e of ['project.created','baseline.created','swms.approved','swms.acknowledged','docket.approved','variations.approved','claim.submitted','claim.certified','invoice.paid','project.closed'])assert(audit.events.some(x=>x.event_type===e),'audit missing '+e);
 const orgAudit=await json(await call('/api/platform/audit','GET',undefined,A.cookie),200);
 for(const e of ['estimate.approved','tender.submitted','tender.awarded','entitlement.changed','organisation.onboarding.completed'])assert(orgAudit.events.some(x=>x.event_type===e),'audit missing '+e);
 console.log('PASS entitlements (read-only, disabled 404, nav flag, data retained), closeout gate, closed-project write refusal, reopen with reason, audit trail');

 // Modular foundation: journal visibility and standalone Core summaries.
 step='modular foundation';
 const events=await json(await call('/api/platform/events','GET',undefined,A.cookie),200);
 assert(events.events.some(e=>e.event_type==='project.awarded'&&e.entity_id===projectId));
 assert(events.events.some(e=>e.event_type==='docket.approved'));
 const foreignEvents=await json(await call('/api/platform/events?organisationId='+memberA.organisation_id,'GET',undefined,B.cookie),200);
 assert(!foreignEvents.events.some(e=>events.events.some(a=>a.id===e.id)),'query tenant ID cannot change event ownership');
 await json(await call('/api/platform/events?limit=0','GET',undefined,A.cookie),400);
 await json(await call('/api/platform/events?type=unknown','GET',undefined,A.cookie),404);
 const [[eventCount]]=await db.execute('SELECT COUNT(*) AS n FROM domain_events WHERE organisation_id=?',[memberA.organisation_id]);
 const [[existingEvent]]=await db.execute('SELECT * FROM domain_events WHERE organisation_id=? LIMIT 1',[memberA.organisation_id]);
 await db.execute('INSERT INTO domain_events (id,organisation_id,event_type,event_version,module,entity_type,entity_id,occurrence_id,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[crypto.randomUUID(),existingEvent.organisation_id,existingEvent.event_type,1,existingEvent.module,existingEvent.entity_type,existingEvent.entity_id,existingEvent.occurrence_id,existingEvent.actor_user_id,existingEvent.created_at]);
 const [[dedup]]=await db.execute('SELECT COUNT(*) AS n FROM domain_events WHERE organisation_id=?',[memberA.organisation_id]);assert.equal(dedup.n,eventCount.n,'same occurrence is idempotent');
 await db.beginTransaction();
 await db.execute('INSERT INTO domain_events SELECT ?,organisation_id,event_type,event_version,module,entity_type,entity_id,?,actor_user_id,created_at FROM domain_events WHERE id=?',[crypto.randomUUID(),crypto.randomUUID(),existingEvent.id]);
 await db.rollback();
 const [[rolledBack]]=await db.execute('SELECT COUNT(*) AS n FROM domain_events WHERE organisation_id=?',[memberA.organisation_id]);assert.equal(rolledBack.n,eventCount.n,'event rollback retains source atomicity');
 const [savedEntitlements]=await db.execute('SELECT module,status FROM organisation_entitlements WHERE organisation_id=?',[memberA.organisation_id]);
 for(const standalone of ['operations','ims']){
  await db.execute("UPDATE organisation_entitlements SET status=CASE WHEN module IN ('core',?) THEN 'active' ELSE 'disabled' END WHERE organisation_id=?",[standalone,memberA.organisation_id]);
  const overview=await json(await call('/api/platform/overview','GET',undefined,A.cookie),200,'standalone summary without Reports');
  assert(overview[standalone==='ims'?'hseq':'operations']);
  if(standalone==='operations'){const delivery=await json(await call('/api/delivery','GET',undefined,A.cookie),200);assert(!/"(rate|hourlyRate|approvedBudget|contractValue|materialCost)"/.test(JSON.stringify(delivery)),'Operations-only admin sees no commercial data');}
  for(const key of ['pipeline','projects','commercial','learn','dockets'])assert.equal(overview[key],undefined);
  await json(await call('/api/reports/v1','GET',undefined,A.cookie),404);
  const hiddenEvents=await json(await call('/api/platform/events','GET',undefined,A.cookie),200);assert.equal(hiddenEvents.events.length,0);
 }
 for(const e of savedEntitlements)await db.execute('UPDATE organisation_entitlements SET status=? WHERE organisation_id=? AND module=?',[e.status,memberA.organisation_id,e.module]);
 const restored=await json(await call('/api/platform/events','GET',undefined,A.cookie),200);assert.equal(restored.events.length,events.events.length,'reenabling modules restores historical journal visibility');
 console.log('PASS modularity: Operations/IMS standalone summaries, Reports independence, event tenant isolation, pagination validation, idempotency, rollback and retained history');


 // ---------------------------------------------------------------- Scenario R: role matrix (one member, role changed between checks)
 step='R roles';
 const R=await signup('role-r');
 await db.execute('UPDATE users SET organisation_id=? WHERE id=?',[memberA.organisation_id,R.user.id]);
 const as=async role=>db.execute('UPDATE users SET role=? WHERE id=?',[role,R.user.id]);
 const expect=async(role,checks)=>{await as(role);for(const [method,path,status,body] of checks){const r=await call(path,method,body,R.cookie);assert.equal(r.status,status,`${role} ${method} ${path}: ${(await r.text()).slice(0,200)}`);}};
 const noRates=async(role)=>{await as(role);const d=await json(await call('/api/delivery','GET',undefined,R.cookie),200);assert(!/"(rate|hourlyRate|approvedBudget|contractValue|materialCost)"/.test(JSON.stringify(d)),role+' sees no rates in the schedule');};
 await expect('office',[['GET','/api/commercial/claims?projectId='+projectId,200],['GET','/api/team',403],['GET','/api/estimates/rates',200]]);
 await expect('estimator',[['GET','/api/tenders/register',200],['GET','/api/estimates',200],['GET','/api/commercial/claims?projectId='+projectId,200],['GET','/api/operations/resources?kind=workers',200],['POST','/api/operations/resources',403,{action:'savePlant',plant:{name:'x',status:'Available'}}],['GET','/api/team',403],['POST','/api/estimates/approval',403,{estimateId,action:'approve'}]]);
 await expect('scheduler',[['GET','/api/operations/resources?kind=workers',200],['GET','/api/commercial/claims?projectId='+projectId,403],['GET','/api/estimates',403],['GET','/api/tenders/register',403],['GET','/api/dockets',403],['GET','/api/platform/knowledge',200],['POST','/api/platform/knowledge',403,{action:'savePack',pack:{}}]]);await noRates('scheduler');
 const sched=await json(await call('/api/operations/resources?kind=workers','GET',undefined,R.cookie),200);assert(sched.workers.every(w=>!('hourly_rate' in w)),'scheduler never receives worker rates');
 // Operational saves must preserve hidden assignment pricing server-side. A scheduler cannot erase
 // or forge a rate by saving the rate-stripped schedule payload.
 const schedDelivery=await json(await call('/api/delivery','GET',undefined,R.cookie),200),schedShift=schedDelivery.shifts.find(s=>s.id===shift.id);
 assert(schedShift&&!JSON.stringify(schedShift).includes('"rate"'),'scheduler receives the existing shift without rate');
 const forgedAssignments=(schedShift.metadata.assignments||[]).map(a=>({...a,rate:9999}));
 const schedSaved=await json(await call('/api/delivery','POST',{kind:'shifts',record:{...schedShift,metadata:{...schedShift.metadata,assignments:forgedAssignments}}},R.cookie),200,'scheduler operational save');
 assert(!JSON.stringify(schedSaved).includes('"rate"'),'scheduler save response still hides rates');
 const [[pricedShift]]=await db.execute('SELECT metadata FROM shifts WHERE id=?',[shift.id]);const pricedMeta=JSON.parse(pricedShift.metadata);
 assert.equal(Number(pricedMeta.assignments.find(a=>a.resourceId===workerId).rate),88,'server preserves hidden assignment rate instead of browser-forged value');
 await expect('project_manager',[['GET',`/api/projects/control?id=${projectId}`,200],['GET','/api/commercial/claims?projectId='+projectId,200],['POST','/api/estimates/approval',403,{estimateId,action:'approve'}],['GET','/api/team',403],['GET','/api/tenders/register',200]]);
 await expect('supervisor',[['GET','/api/field/today',200],['GET','/api/commercial/claims?projectId='+projectId,403],['GET','/api/dockets',403],['GET','/api/estimates',403]]);await noRates('supervisor');
 await expect('accounts',[['GET','/api/commercial/claims?projectId='+projectId,200],['GET','/api/dockets',200],['GET','/api/tenders/register',403],['POST','/api/operations/resources',403,{action:'savePlant',plant:{name:'x',status:'Available'}}],['GET','/api/estimates',403]]);
 await expect('read_only',[['GET','/api/projects',200],['GET','/api/registers/risks?parentId='+projectId,200],['POST','/api/registers/risks',403,{parentId:projectId,values:{title:'x'}}],['GET','/api/commercial/claims?projectId='+projectId,403],['POST','/api/field/today',403,{shiftId:shift.id,workDate:today}],['GET','/api/team',403]]);await noRates('read_only');
 // Project Engineer / Site Engineer: delivery access without money, pricing, rates, approvals or administration (server-enforced).
 const engineerDenied=[['GET','/api/commercial/claims?projectId='+projectId,403],['GET','/api/estimates',403],['GET','/api/estimates/rates',403],['GET','/api/tenders/register',403],['GET','/api/dockets',403],['GET','/api/team',403],['POST','/api/estimates/approval',403,{estimateId,action:'approve'}],['POST','/api/operations/resources',403,{action:'savePlant',plant:{name:'x',status:'Available'}}]];
 await expect('project_engineer',[['GET','/api/projects',200],['GET','/api/registers/risks?parentId='+projectId,404],['GET','/api/projects/workspace?id='+projectId,404],['GET','/api/operations/resources?kind=workers',200],['GET','/api/field/today',200],...engineerDenied]);await noRates('project_engineer');
 await expect('site_engineer',[['GET','/api/projects',200],['GET','/api/field/today',200],['GET','/api/reports/v1',403],...engineerDenied]);await noRates('site_engineer');
 const [orgJobs]=await db.execute('SELECT id FROM jobs WHERE organisation_id=?',[memberA.organisation_id]);const orgJobIds=new Set(orgJobs.map(j=>j.id));
 for(const role of ['project_engineer','site_engineer','scheduler']){
  await as(role);const home=await json(await call('/api/platform/home','GET',undefined,R.cookie),200);
  const text=JSON.stringify(home);
  assert(!/variation|claim|invoice|unclaimed|estimate-approval|tender/i.test([...home.myActions,...home.needsAttention].map(i=>i.key).join(' ')),role+' Home has no commercial or tender items');
  assert(!/"(rate|hourlyRate|contractValue|currentContract|forecastMarginPct|unbilled)"/.test(text),role+' Home carries no money');
  assert(Array.isArray(home.indicators)&&home.indicators.every(i=>typeof i.value==='string'&&i.area),role+' indicators are counts linked to an area');
  assert((home.myProjects||[]).every(p=>orgJobIds.has(p.id)),role+' Home projects stay in the organisation');
  for(const i of [...home.myActions,...home.needsAttention,...home.today])if(i.target?.type==='project')assert(orgJobIds.has(i.target.id),'Home links stay in the organisation');
 }
 await as('scheduler');const schedHome=await json(await call('/api/platform/home','GET',undefined,R.cookie),200);
 const [[tomorrowShifts]]=await db.execute("SELECT COUNT(*) AS n FROM shifts WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date'))=DATE_FORMAT(DATE_ADD(?,INTERVAL 1 DAY),'%Y-%m-%d') AND status NOT IN ('Cancelled','Archived','Draft')",[memberA.organisation_id,schedHome.date]);
 const ind=schedHome.indicators.find(i=>i.key==='tomorrow-resourced');
 if(Number(tomorrowShifts.n))assert.equal(ind?.value.split(' / ')[1],String(tomorrowShifts.n),'tomorrow indicator counts the real shifts');else assert.equal(ind,undefined,'no indicator without shifts');
 // Documents follow the record they belong to: tender pricing never reaches scheduling roles.
 await as('admin');
 const pricing=(await json(await upload(A.cookie,{contextType:'tender',contextId:tenderId,category:'Pricing',title:'Priced schedule'}),201)).document;
 const fieldTrap=(await json(await upload(A.cookie,{contextType:'tender',contextId:tenderId,category:'Pricing',title:'Tender field-visible trap',visibility:'field'}),201)).document;
 assert.equal((await call('/api/documents?id='+fieldTrap.id,'GET',undefined,C.cookie)).status,404,'field-visible flag cannot expose tender documents to Field Worker');
 assert(!(await json(await call('/api/search?q=Tender%20field-visible%20trap','GET',undefined,C.cookie),200)).results.some(r=>r.id===fieldTrap.id),'Field Worker search cannot find field-visible tender documents');
 await as('scheduler');
 assert.equal((await call('/api/documents?id='+pricing.id,'GET',undefined,R.cookie)).status,403,'scheduler cannot open tender documents');
 const schedDocs=await json(await call('/api/documents?contextType=tender&contextId='+tenderId,'GET',undefined,R.cookie),200);assert.equal(schedDocs.documents.length,0,'nor list them');
 const schedSearch=await json(await call('/api/search?q=Priced','GET',undefined,R.cookie),200);assert(!schedSearch.results.some(r=>r.id===pricing.id),'nor find them in search');
 await as('estimator');
 assert.equal((await call('/api/documents?id='+pricing.id,'GET',undefined,R.cookie)).status,200,'estimator can open tender documents');
 // Documents is Core, but it must respect the entitlement of the record that owns the file.
 await json(await call('/api/platform/entitlements','PUT',{module:'pipeline',status:'read_only'},A.cookie),200,'pipeline read-only');
 assert.equal((await call('/api/documents?id='+pricing.id,'GET',undefined,R.cookie)).status,200,'read-only module keeps existing tender documents viewable');
 assert.equal((await upload(A.cookie,{contextType:'tender',contextId:tenderId,category:'Pricing',title:'Denied read-only upload'})).status,403,'read-only module refuses document writes');
 await json(await call('/api/platform/entitlements','PUT',{module:'pipeline',status:'disabled'},A.cookie),200,'pipeline disabled');
 assert.equal((await call('/api/documents?id='+pricing.id,'GET',undefined,R.cookie)).status,404,'disabled module hides its document by direct id');
 assert.equal((await json(await call('/api/documents?contextType=tender&contextId='+tenderId,'GET',undefined,R.cookie),200)).documents.length,0,'disabled module hides its documents from All Documents');
 assert(!(await json(await call('/api/search?q=Priced','GET',undefined,R.cookie),200)).results.some(r=>r.id===pricing.id),'disabled module hides its documents from global search');
 await json(await call('/api/platform/entitlements','PUT',{module:'pipeline',status:'active'},A.cookie),200,'pipeline restored');
 assert.equal((await call('/api/documents?id='+pricing.id,'GET',undefined,R.cookie)).status,200,'re-enable restores document access without data loss');
 await as('estimator');
 const sup=new FormData();sup.set('contextType','library');sup.set('supersedesId',insuranceDoc.id);sup.set('file',new File(['%PDF-1.4 v2'],'v2.pdf',{type:'application/pdf'}));
 assert.equal((await call('/api/documents','POST',sup,R.cookie)).status,403,'only the uploader or a document approver can replace a document');
 const supC=new FormData();supC.set('contextType','library');supC.set('supersedesId',insuranceDoc.id);supC.set('file',new File(['%PDF-1.4 v2'],'v2.pdf',{type:'application/pdf'}));
 assert.equal((await call('/api/documents','POST',supC,C.cookie)).status,404,'field cannot see or replace office documents');
 await json(await call('/api/team','PATCH',{userId:R.user.id,expected:{role:'estimator',active:true},next:{role:'accounts',active:true}},A.cookie),200,'admin assigns a V1 role');
 await json(await call('/api/team','PATCH',{userId:A.user.id,expected:{role:'admin',active:true},next:{role:'read_only',active:true}},A.cookie),409,'last admin protected');
 console.log('PASS R roles: office, estimator, scheduler, project manager, project engineer, site engineer, supervisor, accounts, read-only gates; role-aware Home without money or cross-tenant links; real shift indicator; money hidden from non-commercial roles; document supersede authorisation; role change + last-admin protection');

 // ---------------------------------------------------------------- Scenario P: project membership scopes Project/Site Engineers
 step='P project scope';
 const pA=(await json(await call('/api/projects','POST',{name:'Scope Project Alpha'},A.cookie),201)).projectId;
 const pB=(await json(await call('/api/projects','POST',{name:'Scope Project Bravo'},A.cookie),201)).projectId;
 const S=await signup('site-s');
 await db.execute('UPDATE users SET organisation_id=?,role=? WHERE id=?',[memberA.organisation_id,'site_engineer',S.user.id]);
 await as('project_engineer');
 const team=await json(await call('/api/projects/team','POST',{projectId:pA,userId:R.user.id,projectRole:'project_engineer'},A.cookie),200,'admin assigns PE');
 assert(team.canManage&&team.members.some(m=>m.userId===R.user.id&&m.projectRole==='project_engineer'));
 await json(await call('/api/projects/team','POST',{projectId:pA,userId:S.user.id,projectRole:'site_engineer'},A.cookie),200,'admin assigns SE');
 await json(await call('/api/projects/team','POST',{projectId:pA,userId:S.user.id,projectRole:'site_engineer'},A.cookie),200,'re-assigning is idempotent');
 const [[dupes]]=await db.execute('SELECT COUNT(*) AS n FROM project_members WHERE organisation_id=? AND project_id=? AND user_id=?',[memberA.organisation_id,pA,S.user.id]);assert.equal(Number(dupes.n),1,'no duplicate memberships');
 await json(await call('/api/projects/team','POST',{projectId:pB,userId:R.user.id,projectRole:'project_engineer'},R.cookie),403,'engineers cannot change project teams');
 const addShift=async(name,jobId,date)=>{const id=crypto.randomUUID();await db.execute('INSERT INTO shifts (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[id,memberA.organisation_id,name,'Planned',JSON.stringify({jobId,date,start:'06:00',finish:'14:00',assignments:[]}),new Date().toISOString()]);return id;};
 const tomorrowDate=new Date(Date.parse(today)+86400000).toISOString().slice(0,10);
 const shiftA=await addShift('Alpha kerb pour',pA,today),shiftB=await addShift('Bravo milling',pB,today),upA=await addShift('Alpha upcoming',pA,tomorrowDate),upB=await addShift('Bravo upcoming',pB,tomorrowDate);
 const docA=(await json(await upload(A.cookie,{contextType:'project',contextId:pA,projectId:pA,title:'Alpha drawing'}),201)).document;
 const docB=(await json(await upload(A.cookie,{contextType:'project',contextId:pB,projectId:pB,title:'Bravo drawing'}),201)).document;
 const docBContextOnly=(await json(await upload(A.cookie,{contextType:'project',contextId:pB,title:'Bravo context-only secret'}),201,'project-context document without project_id')).document;
 // Tranche 7: contextual communication, acknowledgement receipts, notifications and secure external links.
 const [[alphaShiftRow]]=await db.execute('SELECT metadata FROM shifts WHERE organisation_id=? AND id=?',[memberA.organisation_id,shiftA]);
 const alphaShiftMeta=JSON.parse(alphaShiftRow.metadata);// A non-overlapping window: Casey already works Pipe laying day 1 (07:00–15:30) today; this test is about notifications, not double-booking.
 alphaShiftMeta.start='16:00';alphaShiftMeta.finish='20:00';alphaShiftMeta.assignments=[{resourceId:workerId,category:'workers',name:'Casey Field',role:'Worker',hours:8,rate:88,payload:0,trips:0,userId:C.user.id}];
 await db.execute('UPDATE shifts SET metadata=? WHERE organisation_id=? AND id=?',[JSON.stringify(alphaShiftMeta),memberA.organisation_id,shiftA]);
 alphaShiftMeta.start='16:30';
 await json(await call('/api/delivery','POST',{kind:'shifts',record:{id:shiftA,name:'Alpha kerb pour',status:'Planned',metadata:alphaShiftMeta}},A.cookie),200,'office changes assigned shift time');
 const fieldInboxAfterChange=await json(await call('/api/communications/notifications','GET',undefined,C.cookie),200,'field shift-change notification');
 assert(fieldInboxAfterChange.notifications.some(n=>n.kind==='shift_changed'&&n.title.includes('Alpha kerb pour')),'assigned worker receives shift-change notification');
 const projectMessage=await json(await call('/api/communications','POST',{action:'send',contextType:'project',contextId:pA,body:'Confirm the hold point before concrete placement.',recipientUserIds:[R.user.id,S.user.id],mentionedUserIds:[R.user.id],requiresAck:true},A.cookie),200,'admin sends project acknowledgement');
 const peThread=await json(await call('/api/communications?contextType=project&contextId='+pA,'GET',undefined,R.cookie),200,'PE opens project discussion');
 assert(peThread.messages.some(m=>m.id===projectMessage.id&&m.requiresAck),'project discussion contains acknowledgement-required message');
 assert(peThread.people.some(p=>p.id===S.user.id),'project discussion recipient list is project-scoped');
 await json(await call('/api/communications','POST',{action:'acknowledge',messageId:projectMessage.id},R.cookie),200,'PE acknowledges project instruction');
 const adminThread=await json(await call('/api/communications?contextType=project&contextId='+pA,'GET',undefined,A.cookie),200,'admin reads receipts');
 const receipt=adminThread.messages.find(m=>m.id===projectMessage.id).receipts.find(x=>x.userId===R.user.id);assert(receipt.readAt&&receipt.acknowledgedAt,'read and acknowledgement receipts are retained');
 await json(await call('/api/communications','POST',{action:'send',contextType:'project',contextId:pA,body:'Site setout is ready for review.',recipientUserIds:[R.user.id],mentionedUserIds:[R.user.id],requiresAck:false},S.cookie),200,'SE sends project update');
 await json(await call('/api/communications?contextType=project&contextId='+pB,'GET',undefined,R.cookie),404,'PE cannot read sibling-project discussion');
 await json(await call('/api/communications?contextType=project&contextId='+pA,'GET',undefined,B.cookie),404,'other tenant cannot read discussion');
 const peInbox=await json(await call('/api/communications/notifications','GET',undefined,R.cookie),200,'PE notification inbox');
 assert(peInbox.notifications.some(n=>n.title.includes('Scope Project Alpha')),'message creates an in-app notification');
 await json(await call('/api/communications/notifications','PATCH',{action:'preferences',email:false,sms:true,quietStart:'21:00',quietEnd:'06:00',timezone:'Australia/Sydney'},R.cookie),200,'save notification preferences');
 const prefs=await json(await call('/api/communications/notifications','GET',undefined,R.cookie),200);assert.equal(prefs.preferences.sms,true);assert.equal(prefs.preferences.quietStart,'21:00');
 const shiftMessage=await json(await call('/api/communications','POST',{action:'send',contextType:'shift',contextId:shiftA,body:'Please acknowledge the shift details.',recipientUserIds:[C.user.id],mentionedUserIds:[C.user.id],requiresAck:true},A.cookie),200,'admin sends assigned field shift message');
 const fieldThread=await json(await call('/api/communications?contextType=shift&contextId='+shiftA,'GET',undefined,C.cookie),200,'assigned field worker opens shift discussion');assert(fieldThread.messages.some(m=>m.id===shiftMessage.id));
 await json(await call('/api/communications','POST',{action:'acknowledge',messageId:shiftMessage.id},C.cookie),200,'field worker acknowledges shift');
 await json(await call('/api/communications','POST',{action:'send',contextType:'shift',contextId:shiftA,body:'On site and ready.',recipientUserIds:[],mentionedUserIds:[],requiresAck:false},C.cookie),200,'field worker replies in assigned shift');
 await json(await call('/api/communications?contextType=shift&contextId='+shiftB,'GET',undefined,C.cookie),404,'field worker cannot read unassigned shift discussion');
 await json(await call('/api/communications?contextType=project&contextId='+pA,'GET',undefined,C.cookie),403,'field worker shift communication does not grant project-wide discussion access');
 const packDoc=(await json(await upload(A.cookie,{contextType:'project',contextId:pA,projectId:pA,title:'Alpha external job pack',visibility:'field'}),201,'field-visible external job pack')).document;
 const officeOnlyDoc=(await json(await upload(A.cookie,{contextType:'project',contextId:pA,projectId:pA,title:'Alpha office secret',visibility:'office'}),201,'office-only project document')).document;
 const otherAlphaShift=await addShift('Alpha other shift',pA,today);
 const otherShiftEvidence=(await json(await upload(A.cookie,{contextType:'field',contextId:otherAlphaShift,projectId:pA,title:'Other shift field evidence',visibility:'field'}),201,'other shift field evidence')).document;
 const link=await json(await call('/api/communications/external','POST',{action:'create',shiftId:shiftA,recipientName:'External Crew',recipientEmail:'external@example.invalid',recipientPhone:'0400000000',expiresDays:2},A.cookie),200,'create secure external shift link');
 const rawToken=link.path.split('/').pop();assert(rawToken&&rawToken.length>20,'raw external token returned only at creation');
 const [[tokenRow]]=await db.execute('SELECT * FROM external_access_tokens WHERE organisation_id=? AND id=?',[memberA.organisation_id,link.id]);assert.equal(tokenRow.token_hash,sha('sha256').update(rawToken).digest('hex'),'only the SHA-256 hash is stored');assert(!JSON.stringify(tokenRow).includes(rawToken),'raw token never persisted');
 assert(!JSON.stringify(await json(await call('/api/communications/external?shiftId='+shiftA,'GET',undefined,A.cookie),200)).includes(rawToken),'raw token never re-exposed by the link manager');
 let externalJob=await json(await call('/api/external/job?token='+encodeURIComponent(rawToken),'GET'),200,'external recipient opens job');
 assert.equal(externalJob.shift.name,'Alpha kerb pour');assert(externalJob.documents.some(d=>d.id===packDoc.id),'field-visible job pack exposed');assert(!externalJob.documents.some(d=>d.id===officeOnlyDoc.id),'office-only document never exposed');assert(!externalJob.documents.some(d=>d.id===otherShiftEvidence.id),'field evidence from another shift in the same project is not exposed');
 const externalReply=new FormData();externalReply.set('token',rawToken);externalReply.set('action','accepted');externalReply.set('operator','External Operator');externalReply.set('plant','EX-01');externalReply.set('note','Available as booked');
 await json(await call('/api/external/job','POST',externalReply),201,'external recipient accepts and nominates resources');
 const evidenceForm=new FormData();evidenceForm.set('token',rawToken);evidenceForm.set('file',new File(['%PDF-1.4 external'],'external-docket.pdf',{type:'application/pdf'}));
 const evidence=await json(await call('/api/external/job','POST',evidenceForm),201,'external recipient uploads evidence');
 assert.equal((await call('/api/external/document?token='+encodeURIComponent(rawToken)+'&id='+encodeURIComponent(evidence.id),'GET')).status,200,'external recipient can reopen returned evidence');
 externalJob=await json(await call('/api/external/job?token='+encodeURIComponent(rawToken),'GET'),200);assert(externalJob.responses.some(r=>r.kind==='accepted'),'external response history retained');
 const creatorInbox=await json(await call('/api/communications/notifications','GET',undefined,A.cookie),200,'link creator gets response notification');assert(creatorInbox.notifications.some(n=>n.kind==='external_response'&&n.body.includes('accepted')));
 const links=await json(await call('/api/communications/external?shiftId='+shiftA,'GET',undefined,A.cookie),200);assert(links.links.some(x=>x.id===link.id&&x.lastResponse==='accepted'),'external link manager shows latest response');
 await json(await call('/api/communications/external','POST',{action:'revoke',id:link.id},A.cookie),200,'revoke external link');
 await json(await call('/api/external/job?token='+encodeURIComponent(rawToken),'GET'),404,'revoked external link fails closed');
 const entitlementLink=await json(await call('/api/communications/external','POST',{action:'create',shiftId:shiftA,recipientName:'Expiry Test',expiresDays:2},A.cookie),200,'create entitlement test link'),entitlementToken=entitlementLink.path.split('/').pop();
 await json(await call('/api/platform/entitlements','PUT',{module:'operations',status:'disabled'},A.cookie),200,'disable Operations');await json(await call('/api/external/job?token='+encodeURIComponent(entitlementToken),'GET'),404,'disabled Operations invalidates external shift links');await json(await call('/api/platform/entitlements','PUT',{module:'operations',status:'active'},A.cookie),200,'restore Operations');
 await json(await call('/api/communications/external','POST',{action:'revoke',id:entitlementLink.id},A.cookie),200,'revoke entitlement test link');
 const movedShift=await addShift('External moved-project check',pA,today);
 const movedLink=await json(await call('/api/communications/external','POST',{action:'create',shiftId:movedShift,recipientName:'Moved project test',expiresDays:2},A.cookie),200,'create project-bound external link'),movedToken=movedLink.path.split('/').pop();
 const [[movedRow]]=await db.execute('SELECT metadata FROM shifts WHERE organisation_id=? AND id=?',[memberA.organisation_id,movedShift]);const movedMeta=JSON.parse(movedRow.metadata);movedMeta.jobId=pB;await db.execute('UPDATE shifts SET metadata=? WHERE organisation_id=? AND id=?',[JSON.stringify(movedMeta),memberA.organisation_id,movedShift]);
 await json(await call('/api/external/job?token='+encodeURIComponent(movedToken),'GET'),404,'moving a shift to another project invalidates the old external link');
 assert.equal((await upload(R.cookie,{contextType:'organisation',category:'General',title:'Engineer company upload'})).status,403,'Project Engineer document capability does not grant company document authority');
 assert.equal((await upload(C.cookie,{contextType:'project',contextId:pA,projectId:pA,title:'Field direct project upload'})).status,404,'Field worker central uploads fail closed and stay attached to field records');
 const pCollab={projectId:pA,startDate:today,durationDays:1,predecessorId:null,workPackage:'Delivery',resourceRequirement:'',plannedQuantity:0,quantityUnit:'',productionPerDay:0};
 const peProgramme=await json(await call('/api/projects/program','POST',{...pCollab,name:'Alpha engineering prep',responsible:'user:'+R.user.id,status:'planned'},R.cookie),200,'PE owns programme activity');
 const seProgramme=await json(await call('/api/projects/program','POST',{...pCollab,name:'Alpha site setout',responsible:'user:'+S.user.id,status:'ready'},S.cookie),200,'SE updates own project programme');
 await json(await call('/api/projects/program','PATCH',{action:'comment',projectId:pA,id:seProgramme.id,text:'Setout points checked on site.'},S.cookie),200,'SE comments on programme activity');
 await json(await call('/api/projects/program','POST',{...pCollab,name:'Bad owner',responsible:'user:'+B.user.id,status:'planned'},R.cookie),400,'programme owner must belong to project team');
 for(const [label,cookie] of [['project_engineer',R.cookie],['site_engineer',S.cookie]]){
  const who=`${label}: `,ownedProgramme=label==='project_engineer'?peProgramme:seProgramme;
  const list=(await json(await call('/api/projects','GET',undefined,cookie),200)).projects.map(p=>p.id);
  assert(list.includes(pA),who+'assigned project listed');assert(!list.includes(pB)&&!list.includes(projectId),who+'unassigned projects not listed');
  await json(await call('/api/projects/workspace?id='+pA,'GET',undefined,cookie),200,who+'assigned project opens');
  await json(await call('/api/projects/workspace?id='+pB,'GET',undefined,cookie),404,who+'direct access to another project is refused');
  const prog=await json(await call('/api/projects/program?projectId='+pA,'GET',undefined,cookie),200,who+'programme opens');assert(!prog.projects.some(p=>p.id===pB),who+'programme project list is scoped');
  const ownedRow=prog.activities.find(a=>a.id===ownedProgramme.id);assert.equal(ownedRow.responsibleUserId,label==='project_engineer'?R.user.id:S.user.id,who+'typed programme owner resolved');assert(prog.members.some(m=>m.id===(label==='project_engineer'?R.user.id:S.user.id)),who+'project team returned for owner picker');
  if(label==='site_engineer')assert(prog.comments.some(x=>x.activityId===seProgramme.id&&x.text.includes('Setout points checked')),who+'programme comment returned');
  await json(await call('/api/projects/program?projectId='+pB,'GET',undefined,cookie),404,who+'other programme refused');
  await json(await call('/api/registers/risks?parentId='+pA,'GET',undefined,cookie),200,who+'own risk register');
  await json(await call('/api/registers/risks?parentId='+pB,'GET',undefined,cookie),404,who+'other risk register refused');
  await json(await call('/api/job-hub?jobId='+pB,'GET',undefined,cookie),404,who+'job hub scoped');
  await json(await call('/api/team?','GET',undefined,cookie),403,who+'no tenant admin');
  assert.equal((await json(await call('/api/hseq/swms?projectId='+pB,'GET',undefined,cookie),200)).swms.length,0,who+'no SWMS from other projects');
  assert.equal((await call('/api/documents?id='+docA.id,'GET',undefined,cookie)).status,200,who+'own project document');
  await json(await call('/api/documents?id='+docB.id,'GET',undefined,cookie),404,who+'guessed document of another project refused');
  assert.equal((await json(await call('/api/documents?projectId='+pB,'GET',undefined,cookie),200)).documents.length,0,who+'other project documents not listed');
  const bravoSearch=(await json(await call('/api/search?q=Bravo','GET',undefined,cookie),200)).results;
  assert(!bravoSearch.some(r=>r.projectId===pB||r.id===pB||r.id===docBContextOnly.id),who+'search excludes other projects including context-only documents');
  const scopedDocs=await json(await call('/api/documents?q=Alpha%20drawing','GET',undefined,cookie),200,who+'central document search');
  const scopedDoc=scopedDocs.documents.find(d=>d.id===docA.id);
  assert(scopedDoc&&scopedDoc.contextName==='Scope Project Alpha',who+'central Documents workspace resolves the owning project');
  assert(!scopedDocs.documents.some(d=>d.id===docB.id),who+'central Documents workspace respects project scope');
  const day=await json(await call('/api/field/today','GET',undefined,cookie),200);
  const ids=[...day.today,...day.upcoming].map(s=>s.id);
  assert(ids.includes(shiftA)&&ids.includes(upA),who+'Today includes own project shifts');assert(!ids.includes(shiftB)&&!ids.includes(upB),who+'Today excludes other project shifts');
  assert(!ids.includes(shift.id),who+'Today excludes unrelated organisation shifts');
  const home=await json(await call('/api/platform/home','GET',undefined,cookie),200);
  const mine=home.myProjects.map(p=>p.id);assert(mine.includes(pA)&&!mine.includes(pB),who+'My projects = memberships');
  assert(home.myActions.some(i=>i.key==='programme-'+ownedProgramme.id),who+'assigned programme activity appears in My Work');
  const homeShifts=home.today.map(i=>i.key);assert(homeShifts.includes('shift-'+shiftA)&&!homeShifts.includes('shift-'+shiftB),who+'Home Today uses the same scope');
  const board=await json(await call('/api/delivery','GET',undefined,cookie),200);assert(!board.shifts.some(s=>s.id===shiftB)&&!board.jobs.some(j=>j.id===pB),who+'schedule board scoped');
  await json(await call('/api/projects','POST',{name:'Engineer project'},cookie),403,who+'cannot create organisation projects');
  // Summaries are derived from the engineer's projects only.
  const ov=await json(await call('/api/platform/overview','GET',undefined,cookie),200,who+'overview');
  assert.equal(ov.projects.total,1,who+'overview counts only assigned projects');
  // Alpha has three in-window shifts (kerb pour, upcoming, other shift); Bravo's three must not be counted.
  assert.equal(ov.operations.upcomingShifts14d,3,who+'overview shifts only from assigned projects');
  assert(!ov.commercial&&!ov.pipeline,who+'no commercial or pipeline summaries');
  if(label==='project_engineer'){const rep=await json(await call('/api/reports/v1','GET',undefined,cookie),200,who+'reports');assert.equal(rep.projects.total,1,who+'reports scoped');assert.equal(rep.operations.upcomingShifts14d,3,who+'report shifts only from assigned projects');}
  else await json(await call('/api/reports/v1','GET',undefined,cookie),403,who+'no company reporting');
  // Legacy delivery attachments carry no project link: fail closed unless it is their own upload.
  const f=new FormData();f.set('file',new File(['office only'],'legacy.txt',{type:'text/plain'}));
  const legacy=await json(await call('/api/delivery/documents','POST',f,A.cookie),201,'admin stores a legacy attachment');
  await json(await call('/api/delivery/documents?id='+legacy.id,'GET',undefined,cookie),404,who+'unlinked legacy attachment refused');
  const own=new FormData();own.set('file',new File(['mine'],'mine.txt',{type:'text/plain'}));
  const mineUp=await json(await call('/api/delivery/documents','POST',own,cookie),201,who+'uploads an attachment');
  assert.equal((await call('/api/delivery/documents?id='+mineUp.id,'GET',undefined,cookie)).status,200,who+'opens own upload');
  assert.equal((await call('/api/delivery/documents?id='+legacy.id,'GET',undefined,A.cookie)).status,200,'admin keeps access');
 }
 await json(await call('/api/projects/program','POST',{projectId:pB,name:'x',startDate:today,durationDays:1,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'',plannedQuantity:0,quantityUnit:'',productionPerDay:0,status:'planned'},R.cookie),404,'PE cannot edit another project programme');
 await json(await call('/api/projects/program','POST',{projectId:pA,name:'Alpha setout',startDate:today,durationDays:2,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'',plannedQuantity:0,quantityUnit:'',productionPerDay:0,status:'planned'},R.cookie),200,'PE edits own project programme');
 await json(await call('/api/registers/risks','POST',{parentId:pA,values:{title:'Alpha trench collapse'}},S.cookie),201,'SE raises a risk on their project');
 await json(await call('/api/registers/risks','POST',{parentId:pB,values:{title:'x'}},S.cookie),404,'SE cannot raise risks on other projects');
 // Existing project_manager_user_id keeps working (compatibility with pre-membership data).
 await db.execute('UPDATE jobs SET project_manager_user_id=? WHERE organisation_id=? AND id=?',[S.user.id,memberA.organisation_id,pB]);
 await json(await call('/api/projects/workspace?id='+pB,'GET',undefined,S.cookie),200,'recorded project manager keeps access');
 await db.execute('UPDATE jobs SET project_manager_user_id=NULL WHERE organisation_id=? AND id=?',[memberA.organisation_id,pB]);
 // Removal deactivates the membership and access ends.
 const sMember=(await json(await call('/api/projects/team?projectId='+pA,'GET',undefined,A.cookie),200)).members.find(m=>m.userId===S.user.id);
 await json(await call(`/api/projects/team?projectId=${pA}&id=${sMember.id}`,'DELETE',undefined,A.cookie),200);
 await json(await call('/api/projects/workspace?id='+pA,'GET',undefined,S.cookie),404,'removed member loses access');
 const [[keptMember]]=await db.execute('SELECT active FROM project_members WHERE organisation_id=? AND id=?',[memberA.organisation_id,sMember.id]);assert.equal(Number(keptMember.active),0,'membership history retained');
 // Organisation-wide roles still see every project.
 const adminList=(await json(await call('/api/projects','GET',undefined,A.cookie),200)).projects.map(p=>p.id);assert(adminList.includes(pA)&&adminList.includes(pB));
 await as('office');const officeList=(await json(await call('/api/projects','GET',undefined,R.cookie),200)).projects.map(p=>p.id);assert(officeList.includes(pA)&&officeList.includes(pB),'office keeps organisation-wide access');
 // Tenant isolation: a membership row can never reach another organisation's project.
 const pOther=(await json(await call('/api/projects','POST',{name:'Other org project'},B.cookie),201)).projectId;
 await as('project_engineer');
 await db.execute('INSERT INTO project_members (id,organisation_id,project_id,user_id,project_role,active,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?)',[crypto.randomUUID(),memberA.organisation_id,pOther,R.user.id,'project_engineer',new Date().toISOString(),new Date().toISOString()]);
 await json(await call('/api/projects/workspace?id='+pOther,'GET',undefined,R.cookie),404,'membership never crosses organisations');
 await json(await call('/api/projects/team?projectId='+pA,'GET',undefined,B.cookie),404,'other organisation cannot read the team');
 await as('accounts');
 console.log('PASS P project scope: memberships (assign/idempotent/remove), PE/SE listing, detail, programme, registers, job hub, SWMS, documents, search, Today/upcoming, Home Today and My projects, schedule board, overview and reports scoped; legacy attachments fail closed; PM compatibility; office/admin organisation-wide; tenant isolation');

 // ---------------------------------------------------------------- Scenario K: CRM master — import, dedupe, reuse, legacy links, merge, scope
 step='K CRM';
 const ExcelJS=(await import('exceljs')).default;
 const cr=(body,cookie=A.cookie)=>call('/api/platform/clients','POST',body,cookie);
 // Existing master: 50 clients to update, 10 already identical, 5 near-duplicates.
 const upd=[],same=[];
 for(let n=1;n<=50;n++)upd.push((await json(await cr({action:'create',client:{name:`Update Target ${n}`,clientCode:`UPD-${n}`,phone:'02 1111 0000'}}),201)).client);
 for(let n=1;n<=10;n++)same.push((await json(await cr({action:'create',client:{name:`Same Client ${n}`,clientCode:`SAME-${n}`}}),201)).client);
 for(let n=1;n<=5;n++)await json(await cr({action:'create',client:{name:`Possible Co ${n} Pty Ltd`}}),201);
 const book=new ExcelJS.Workbook(),cs=book.addWorksheet('Clients'),ks=book.addWorksheet('Contacts'),ss=book.addWorksheet('Sites');
 cs.addRow(['Company','Client code','ABN','Phone','Mystery']);
 for(let n=1;n<=100;n++)cs.addRow([`New Client ${n}`,`NEW-${n}`,'','02 9999 0000','x']);
 for(let n=1;n<=50;n++)cs.addRow([`Update Target ${n}`,`UPD-${n}`,'','02 2222 0000','']);
 for(let n=1;n<=10;n++)cs.addRow([`Same Client ${n}`,`SAME-${n}`,'','','']);
 for(let n=1;n<=5;n++)cs.addRow([`Possible Co ${n}`,'','','','']);
 for(let n=1;n<=5;n++)cs.addRow([`Invalid ${n}`,'','123','','']);
 ks.addRow(['Client name','First name','Last name','Email','Primary contact']);
 for(let n=1;n<=20;n++)ks.addRow([`New Client ${n}`,'Contact',`${n}`,`contact${n}@new${n}.example.com`,'Yes']);
 ks.addRow(['Nobody Pty Ltd','Lost','Row','','']);
 ss.addRow(['Client code','Site name','Address']);
 for(let n=1;n<=10;n++)ss.addRow([`NEW-${n}`,`Yard ${n}`,`${n} Example St`]);
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 const importForm=(mode,extra={})=>{const f=new FormData();f.set('mode',mode);f.set('file',new File([bytes],'crm.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));for(const [k,v] of Object.entries(extra))f.set(k,JSON.stringify(v));return f;};
 const [[beforeCount]]=await db.execute('SELECT COUNT(*) AS n FROM clients WHERE organisation_id=?',[memberA.organisation_id]);
 const pv=await json(await call('/api/platform/clients/import','POST',importForm('preview'),A.cookie),200,'import preview');
 assert.deepEqual(pv.summary.byKind.clients,{create:100,update:50,skip:10,possible:5,error:5},'client rows classified');
 assert.deepEqual(pv.summary.byKind.contacts,{create:20,update:0,skip:0,possible:0,error:1},'contacts resolve to in-file clients; unknown client is an error');
 assert.deepEqual(pv.summary.byKind.sites,{create:10,update:0,skip:0,possible:0,error:0},'sites resolve by client code');
 assert(pv.sheets.find(x=>x.name==='Clients').unmapped.includes('Mystery'),'unknown headings reported');
 const [[afterPreview]]=await db.execute('SELECT COUNT(*) AS n FROM clients WHERE organisation_id=?',[memberA.organisation_id]);assert.equal(afterPreview.n,beforeCount.n,'preview writes nothing');
 const poss=pv.rows.filter(r=>r.action==='possible');assert.equal(poss.length,5);assert(poss[0].candidates.length>=1);
 await json(await call('/api/platform/clients/import','POST',importForm('preview'),B.cookie),200,'another organisation can preview');
 const pvB=await json(await call('/api/platform/clients/import','POST',importForm('preview'),B.cookie),200);assert.equal(pvB.summary.byKind.clients.update,0,'organisation B never matches organisation A clients');
 const decisions={[poss[0].key]:`use:${poss[0].candidates[0].id}`,[poss[1].key]:'skip',[poss[2].key]:'create'};
 const applied=await json(await call('/api/platform/clients/import','POST',importForm('apply',{decisions}),A.cookie),200,'import apply');
 assert.equal(applied.summary.created,100+1+20+10,'100 clients + 1 decided new + 20 contacts + 10 sites');assert.equal(applied.summary.updated,50,'50 real updates (using an existing client with nothing new changes nothing)');assert.equal(applied.summary.possibleUnresolved,2);assert.equal(applied.summary.errors,6);
 const [[newCount]]=await db.execute("SELECT COUNT(*) AS n FROM clients WHERE organisation_id=? AND name LIKE 'New Client %'",[memberA.organisation_id]);assert.equal(Number(newCount.n),100);
 const [[updated1]]=await db.execute('SELECT phone FROM clients WHERE organisation_id=? AND id=?',[memberA.organisation_id,upd[0].id]);assert.equal(updated1.phone,'02 2222 0000','update applied');
 const [[sameCount]]=await db.execute("SELECT COUNT(*) AS n FROM clients WHERE organisation_id=? AND name LIKE 'Same Client %'",[memberA.organisation_id]);assert.equal(Number(sameCount.n),10,'exact duplicates not duplicated');
 const [[rel]]=await db.execute("SELECT COUNT(*) AS n FROM client_contacts k JOIN clients c ON c.id=k.client_id WHERE k.organisation_id=? AND c.name LIKE 'New Client %' AND k.is_primary=1",[memberA.organisation_id]);assert.equal(Number(rel.n),20,'contacts linked to the new clients');
 const [[siteRel]]=await db.execute("SELECT COUNT(*) AS n FROM client_sites s JOIN clients c ON c.id=s.client_id WHERE s.organisation_id=? AND c.client_code LIKE 'NEW-%'",[memberA.organisation_id]);assert.equal(Number(siteRel.n),10);
 const [[importAudit]]=await db.execute("SELECT summary FROM audit_log WHERE organisation_id=? AND event_type='crm_import.completed' ORDER BY created_at DESC LIMIT 1",[memberA.organisation_id]);assert.match(importAudit.summary,/crm\.xlsx.*131 created, 50 updated/);
 const rerun=await json(await call('/api/platform/clients/import','POST',importForm('preview'),A.cookie),200);assert.equal(rerun.summary.byKind.clients.create,0,'re-running creates nothing new');assert.equal(rerun.summary.byKind.clients.possible,4,'near-duplicates without a decision still wait for a person');
 const [[keptName]]=await db.execute("SELECT name FROM clients WHERE organisation_id=? AND id=?",[memberA.organisation_id,poss[0].candidates[0].id]);assert.equal(keptName.name,'Possible Co 1 Pty Ltd','using an existing client never renames it');assert.equal(rerun.summary.byKind.contacts.create,0);assert.equal(rerun.summary.byKind.sites.create,0);
 // Quick create and exact-match reuse (ABN, name).
 const quick=(await json(await cr({action:'create',client:{name:'Quickie Civil',abn:'51 824 753 556'}}),201)).client;assert.equal(quick.abn,'51824753556');
 assert.equal((await json(await cr({action:'create',client:{name:'Totally different name',abn:'51824753556'}}),201)).client.id,quick.id,'same ABN returns the existing client');
 assert.equal((await json(await cr({action:'create',client:{name:' quickie  civil '}}),201)).existing,true);
 // Inactive clients stay searchable but rank after active ones.
 await json(await cr({action:'update',id:quick.id,revision:quick.revision,client:{status:'inactive'}}),200);
 assert((await json(await call('/api/platform/clients?q=quickie','GET',undefined,A.cookie),200)).clients.some(c=>c.id===quick.id&&c.status==='inactive'),'inactive client still searchable');
 const top=(await json(await call('/api/platform/clients?limit=500','GET',undefined,A.cookie),200)).clients;assert(top.findIndex(c=>c.status!=='active')>top.findLastIndex(c=>c.status==='active'),'active clients first');
 const [[inact]]=await db.execute("SELECT COUNT(*) AS n FROM audit_log WHERE organisation_id=? AND event_type='client.inactivated' AND entity_id=?",[memberA.organisation_id,quick.id]);assert.equal(Number(inact.n),1);
 // Legacy text: link only exact unique names; never guess; keep the text.
 const now=new Date().toISOString(),twin1=crypto.randomUUID(),twin2=crypto.randomUUID(),solo=crypto.randomUUID(),jobSolo=crypto.randomUUID(),jobTwin=crypto.randomUUID();
 for(const [id,name] of [[twin1,'Twin Civil'],[twin2,'Twin Civil'],[solo,'Solo Civil']])await db.execute("INSERT INTO clients (id,organisation_id,name,contact_name,email,phone,status,revision,created_at,updated_at) VALUES (?,?,?,'','','','active',1,?,?)",[id,memberA.organisation_id,name,now,now]);
 for(const [id,cn] of [[jobSolo,'solo civil'],[jobTwin,'Twin Civil']])await db.execute("INSERT INTO jobs (id,organisation_id,name,status,metadata,created_at,client_name,stage) VALUES (?,?,?,'Planning','{}',?,?,'setup')",[id,memberA.organisation_id,`Legacy ${cn}`,now,cn]);
 const legacy=await json(await call('/api/platform/clients?view=legacy','GET',undefined,A.cookie),200);
 assert.equal(legacy.rows.find(r=>r.id===jobSolo).status,'linked');assert.equal(legacy.rows.find(r=>r.id===jobTwin).status,'ambiguous');
 await json(await call('/api/platform/clients?view=legacy','GET',undefined,R.cookie),403,'legacy linking is for managers');
 await json(await cr({action:'linkLegacy',apply:true}),200);
 const [[ls]]=await db.execute('SELECT client_id,client_name FROM jobs WHERE id=?',[jobSolo]),[[lt]]=await db.execute('SELECT client_id,client_name FROM jobs WHERE id=?',[jobTwin]);
 assert.equal(ls.client_id,solo);assert.equal(ls.client_name,'solo civil','original text preserved');assert.equal(lt.client_id,null,'ambiguous record not guessed');
 await json(await cr({action:'linkRecord',type:'jobs',id:jobTwin,clientId:twin2}),200,'manual link');
 await json(await cr({action:'linkRecord',type:'jobs',id:jobTwin,clientId:twin1},B.cookie),400,'foreign organisation cannot link');
 // Merge: references move, the duplicate is kept as merged, history audited.
 const mp=await json(await cr({action:'merge',keepId:twin1,mergeId:twin2}),200);assert.equal(mp.preview.affected.Projects,1);assert.equal(mp.merged,false);
 await json(await cr({action:'merge',keepId:twin1,mergeId:twin2,confirm:true},B.cookie),404,'foreign merge refused');
 await json(await cr({action:'merge',keepId:twin1,mergeId:twin2,confirm:true}),200);
 const [[mt]]=await db.execute('SELECT client_id FROM jobs WHERE id=?',[jobTwin]),[[mc]]=await db.execute('SELECT status,merged_into_id FROM clients WHERE id=?',[twin2]);assert.equal(mt.client_id,twin1);assert.equal(mc.status,'merged');assert.equal(mc.merged_into_id,twin1);
 assert(!(await json(await call('/api/platform/clients?q=twin','GET',undefined,A.cookie),200)).clients.some(c=>c.id===twin2),'merged client hidden from pickers');
 // Merge keeps one primary contact: the kept client's primary wins; references to moved contacts stay valid.
 const jane=(await json(await cr({action:'create',client:{name:'Jane Keep Co',contact:{name:'Jane',email:'jane@keep.example.com'}}}),201)).client;
 const johnCo=(await json(await cr({action:'create',client:{name:'John Merge Co',contact:{name:'John',email:'jane@keep.example.com'}}}),201)).client;
 const john=johnCo.contacts.find(x=>x.name==='John');assert(john.isPrimary&&jane.contacts[0].isPrimary);
 const johnOpp=(await json(await opps.create(null,{name:'John opportunity',client_id:johnCo.id,contact_id:john.id}),201)).record;
 const mp2=await json(await cr({action:'merge',keepId:jane.id,mergeId:johnCo.id}),200);
 assert(mp2.preview.warnings.some(w=>/share the email/.test(w)),'duplicate contact email warned');assert(mp2.preview.warnings.some(w=>/John will no longer be primary/.test(w)),'primary rule shown in preview');
 await json(await cr({action:'merge',keepId:jane.id,mergeId:johnCo.id,confirm:true}),200);
 const [prim]=await db.execute("SELECT name FROM client_contacts WHERE organisation_id=? AND client_id=? AND status='active' AND is_primary=1",[memberA.organisation_id,jane.id]);assert.deepEqual(prim.map(x=>x.name),['Jane'],'exactly one primary: Jane');
 const [[johnRow]]=await db.execute('SELECT client_id,status,is_primary FROM client_contacts WHERE id=?',[john.id]);assert.deepEqual([johnRow.client_id,johnRow.status,Number(johnRow.is_primary)],[jane.id,'active',0],'John moved, active, no longer primary');
 const [[oppRow]]=await db.execute('SELECT client_id,contact_id FROM opportunities WHERE id=?',[johnOpp.id]);assert.deepEqual([oppRow.client_id,oppRow.contact_id],[jane.id,john.id],'opportunity still points at John');
 const [[mergedB]]=await db.execute('SELECT status FROM clients WHERE id=?',[johnCo.id]);assert.equal(mergedB.status,'merged','duplicate kept as merged, not deleted');
 const [[mergeAudit]]=await db.execute("SELECT COUNT(*) AS n FROM audit_log WHERE organisation_id=? AND event_type='client.merged' AND entity_id=?",[memberA.organisation_id,jane.id]);assert.equal(Number(mergeAudit.n),1);
 const noPrim=(await json(await cr({action:'create',client:{name:'No Primary Co'}}),201)).client;
 await json(await cr({action:'addContact',clientId:noPrim.id,contact:{name:'Plain Contact',isPrimary:false}}),201);
 const onePrim=(await json(await cr({action:'create',client:{name:'One Primary Co',contact:{name:'Pat Primary'}}}),201)).client;
 await json(await cr({action:'merge',keepId:noPrim.id,mergeId:onePrim.id,confirm:true}),200);
 const [prim2]=await db.execute("SELECT name FROM client_contacts WHERE organisation_id=? AND client_id=? AND status='active' AND is_primary=1",[memberA.organisation_id,noPrim.id]);assert.deepEqual(prim2.map(x=>x.name),['Pat Primary'],'the duplicate\'s only primary stays primary');
 // CRM permissions by role (server-enforced): workflow roles quick-create; master edit and administration are Admin/Office.
 const target=(await json(await cr({action:'create',client:{name:'Permission Target'}}),201)).client;
 const targetNow=async()=>(await json(await call('/api/platform/clients?ids='+target.id,'GET',undefined,A.cookie),200)).clients[0];
 const siteT=(await json(await cr({action:'createSite',site:{clientId:target.id,name:'Target Yard'}}),201)).site;
 const contactT=(await json(await cr({action:'addContact',clientId:target.id,contact:{name:'Target Contact'}}),201));const contactTRow=contactT.client.contacts.find(x=>x.id===contactT.contactId);
 const crmImportAs=()=>{const f=new FormData();f.set('mode','preview');f.set('file',new File([bytes],'crm.xlsx'));return call('/api/platform/clients/import','POST',f,R.cookie);};
 for(const role of ['scheduler','project_manager','estimator']){
  await as(role);const who=role+': ';
  assert((await json(await call('/api/platform/clients?q=permission','GET',undefined,R.cookie),200,who+'search')).clients.some(c=>c.id===target.id),who+'finds clients');
  const made=(await json(await cr({action:'create',client:{name:`Quick ${role}`}},R.cookie),201,who+'quick create client')).client;
  await json(await cr({action:'createSite',site:{clientId:target.id,address:`${role} site`}},R.cookie),201,who+'adds a site');
  await json(await cr({action:'addContact',clientId:target.id,contact:{name:`${role} contact`}},R.cookie),201,who+'adds a contact');
  const t=await targetNow();
  await json(await cr({action:'update',id:t.id,revision:t.revision,client:{name:'Renamed'}},R.cookie),403,who+'cannot edit master fields');
  await json(await cr({action:'update',id:t.id,revision:t.revision,client:{status:'inactive'}},R.cookie),403,who+'cannot inactivate');
  await json(await cr({action:'update',id:made.id,revision:made.revision,client:{phone:'1'}},R.cookie),403,who+'cannot edit even a client they created');
  await json(await cr({action:'updateSite',id:siteT.id,revision:siteT.revision,site:{status:'inactive'}},R.cookie),403,who+'cannot change sites');
  await json(await cr({action:'updateContact',id:contactTRow.id,revision:contactTRow.revision,contact:{archived:true}},R.cookie),403,who+'cannot change contacts');
  await json(await cr({action:'bulk',ids:[t.id],change:{status:'inactive'}},R.cookie),403,who+'cannot bulk update');
  await json(await crmImportAs(),403,who+'cannot import');
  await json(await cr({action:'merge',keepId:t.id,mergeId:made.id},R.cookie),403,who+'cannot merge');
  await json(await call('/api/platform/clients?view=legacy','GET',undefined,R.cookie),403,who+'no legacy administration');
  await json(await cr({action:'linkLegacy',apply:true},R.cookie),403,who+'cannot bulk-link');
 }
 await as('office');
 let tgt=await targetNow();await json(await cr({action:'update',id:tgt.id,revision:tgt.revision,client:{phone:'02 5555 0000'}},R.cookie),200,'office edits the master');
 tgt=await targetNow();await json(await cr({action:'bulk',ids:[tgt.id],change:{status:'inactive'}},R.cookie),200,'office bulk updates');
 await json(await crmImportAs(),200,'office imports');
 await json(await call('/api/platform/clients?view=legacy','GET',undefined,R.cookie),200,'office links legacy records');
 const officeDup=(await json(await cr({action:'create',client:{name:'Office Dup'}},R.cookie),201)).client;await json(await cr({action:'merge',keepId:target.id,mergeId:officeDup.id},R.cookie),200,'office previews merges');
 for(const role of ['project_engineer','site_engineer','accounts']){await as(role);await json(await cr({action:'create',client:{name:`${role} made`}},R.cookie),403,role+' cannot create clients');await json(await cr({action:'addContact',clientId:target.id,contact:{name:'x'}},R.cookie),403,role+' cannot add contacts');}
 await as('accounts');
 // Tenant isolation by forged ids.
 await json(await call('/api/platform/clients?id='+riverside.id,'GET',undefined,B.cookie),404,'foreign client detail');
 assert.equal((await json(await call('/api/platform/clients?ids='+riverside.id,'GET',undefined,B.cookie),200)).clients.length,0,'foreign client by id');
 assert(!(await json(await call('/api/search?q=Riverside','GET',undefined,B.cookie),200)).results.some(r=>r.id===riverside.id||r.clientId===riverside.id),'foreign search');
 assert(!(await json(await call('/api/platform/clients?view=contacts&q=max','GET',undefined,B.cookie),200)).items.some(x=>x.clientId===riverside.id),'foreign contacts');
 // Global search finds client, contact and site.
 const found=(await json(await call('/api/search?q=Riverside','GET',undefined,A.cookie),200)).results;assert.equal(found[0].type,'Client','exact client match ranks first');
 assert((await json(await call('/api/search?q=Max%20Site','GET',undefined,A.cookie),200)).results.some(r=>r.type==='Contact'&&r.clientId===riverside.id));
 // Project Engineer: basic client context for their own project only.
 const abc=(await json(await cr({action:'create',client:{name:'ABC Scope Civil'}}),201)).client,other=(await json(await cr({action:'create',client:{name:'Unrelated Client'}}),201)).client;
 for(const pid of [pA,pB]){const cur=(await json(await call('/api/projects/workspace?id='+pid,'GET',undefined,A.cookie),200)).project;await json(await call('/api/projects/workspace','PATCH',{id:pid,revision:cur.revision,clientId:abc.id},A.cookie),200);}
 await as('project_engineer');
 const peView=await json(await call('/api/platform/clients?id='+abc.id,'GET',undefined,R.cookie),200,'PE opens the client of their project');
 assert.deepEqual(peView.projects.active.map(p=>p.id),[pA],'PE sees only their project, not its siblings');assert(!JSON.stringify(peView).includes('Scope Project Bravo'),'no names of inaccessible projects');
 assert(!('tenders' in peView)&&!('opportunities' in peView),'no company-wide pipeline history');assert(!('paymentTermsDays' in peView.client),'no commercial fields');
 await json(await call('/api/platform/clients?id='+other.id,'GET',undefined,R.cookie),404,'PE cannot open unrelated clients');
 assert.deepEqual((await json(await call('/api/platform/clients?limit=500','GET',undefined,R.cookie),200)).clients.map(c=>c.id),[abc.id],'PE client list = clients of their projects');
 await json(await cr({action:'create',client:{name:'PE made'}},R.cookie),403,'engineers do not manage the master');
 // Scheduler: create an operational job from CRM records without typing them.
 await as('scheduler');
 const schedView=await json(await call('/api/platform/clients?id='+riverside.id,'GET',undefined,R.cookie),200);assert(!('tenders' in schedView),'scheduler has no pipeline history');
 const job=(await json(await call('/api/delivery','POST',{kind:'jobs',record:{id:'',name:'Riverside night works',status:'Planning',metadata:{clientId:riverside.id,siteId:riversideSite.id,contactId:maxSite.id}}},R.cookie),201,'scheduler creates a job from CRM entities')).record;
 const [[jr]]=await db.execute('SELECT client_id,site_id,contact_id,client_name FROM jobs WHERE id=?',[job.id]);assert.deepEqual([jr.client_id,jr.site_id,jr.contact_id,jr.client_name],[riverside.id,riversideSite.id,maxSite.id,'Riverside Council']);
 await json(await call('/api/delivery','POST',{kind:'jobs',record:{id:'',name:'Bad site',status:'Planning',metadata:{clientId:abc.id,siteId:riversideSite.id}}},R.cookie),400,'site must belong to the client');
 // Module-aware history: pipeline off → no tenders or opportunities.
 await as('accounts');
 await db.execute("UPDATE organisation_entitlements SET status='disabled' WHERE organisation_id=? AND module='pipeline'",[memberA.organisation_id]);
 const noPipe=await json(await call('/api/platform/clients?id='+riverside.id,'GET',undefined,A.cookie),200);assert(!('tenders' in noPipe)&&!('opportunities' in noPipe)&&noPipe.projects,'pipeline history hidden when Pipeline is off; projects remain');
 await db.execute("UPDATE organisation_entitlements SET status='active' WHERE organisation_id=? AND module='pipeline'",[memberA.organisation_id]);
 const full=await json(await call('/api/platform/clients?id='+riverside.id,'GET',undefined,A.cookie),200);assert(full.tenders.some(t=>t.id===tenderId),'client work shows its tender');assert(full.projects.active.some(p=>p.id===projectId)||full.projects.completed.some(p=>p.id===projectId));
 const tpl=await call('/api/platform/clients/import?template=1','GET',undefined,A.cookie);assert.equal(tpl.status,200);const tb=new ExcelJS.Workbook();await tb.xlsx.load(Buffer.from(await tpl.arrayBuffer()));assert.deepEqual(tb.worksheets.map(w=>w.name),['Instructions','Clients','Contacts','Sites']);
 console.log('PASS K CRM: bulk import 100 new/50 update/10 exact/5 possible/5 invalid with contacts+sites, preview writes nothing, decisions, audit, idempotent re-run; quick create by ABN/name; inactive; legacy linking never guesses; merge; tenant isolation; search; PE client scope; scheduler job from CRM; module-aware history; template; CRM create/edit/manage by role; merge keeps one primary contact with duplicate warnings');
 // ---------------------------------------------------------------- Scenario L: Core locations — address search, exact pin, inheritance, scope
 step='L locations';
 const lLoc=(q,cookie=A.cookie)=>call('/api/platform/locations?'+new URLSearchParams(q),'GET',undefined,cookie);
 const lCfg=await json(await lLoc({op:'config'}),200);assert.equal(lCfg.provider,'fake');assert.equal(lCfg.browserKey,null,'no browser key is configured in CI');
 assert.deepEqual((await json(await lLoc({op:'autocomplete',q:'24'}),200)).suggestions,[],'short queries do not hit the provider');
 const lSugg=(await json(await lLoc({op:'autocomplete',q:'24 York Road Ingleburn',session:'s1'}),200)).suggestions;assert.equal(lSugg[0].placeId,'fake-york-rd-ingleburn');
 const lYork=(await json(await lLoc({op:'place',id:lSugg[0].placeId,session:'s1'}),200)).place;assert.equal(lYork.addressLine1,'24 York Road');assert.equal(lYork.postcode,'2565');
 await json(await lLoc({op:'autocomplete',q:'offline'}),503,'provider offline is reported, not a crash');
 await json(await lLoc({op:'reverse',lat:'-1',lng:'-1'}),503,'reverse failure is reported so the picker keeps the pin');
 assert.equal((await json(await lLoc({op:'reverse',lat:'-12.3',lng:'130.8'}),200)).place,null,'no invented address for unknown points');
 const lYard=(await json(await lLoc({op:'reverse',lat:'-33.999',lng:'150.862'}),200)).place;assert.match(lYard.formattedAddress,/Yard entrance/);
 await json(await lLoc({op:'reverse',lat:'0',lng:'0'}),400,'null island is rejected');
 assert.equal((await lLoc({op:'config'},'')).status,401,'location endpoints need a session');
 const lPicked={...lYork,provider:'fake',source:'autocomplete',geocoded:lYork.point,pin:lYork.point};
 const lClient=(await json(await cr({action:'create',client:{name:`Location Client ${suffix}`}}),201)).client;
 const lSite=(await json(await cr({action:'createSite',site:{clientId:lClient.id,name:'Ingleburn depot upgrade',location:lPicked}}),201)).site;
 assert.equal(lSite.address,lYork.formattedAddress,'address text snapshot filled from the location');assert.equal(lSite.location.placeId,'fake-york-rd-ingleburn');assert.equal(lSite.location.pinAdjusted,false);
 // Moving the pin keeps the geocoded point and records the reverse-geocoded pin address.
 const lMoved=(await json(await cr({action:'updateSite',id:lSite.id,revision:lSite.revision,site:{location:{...lPicked,pin:{lat:-33.999,lng:150.862},pinAddress:lYard.formattedAddress}}}),200)).site;
 assert.equal(lMoved.location.pinAdjusted,true);assert.equal(lMoved.location.geocoded.lat,-33.9985);assert.equal(lMoved.location.pin.lat,-33.999);assert.equal(lMoved.location.pinAddress,lYard.formattedAddress);assert.equal(lMoved.location.id,lSite.location.id,'the same location is updated');
 assert.equal(lMoved.address,lYork.formattedAddress,'the site address stays the general address');
 const [[lrow]]=await db.execute('SELECT organisation_id,owner_type,owner_id FROM locations WHERE id=?',[lMoved.location.id]);assert.deepEqual({...lrow},{organisation_id:memberA.organisation_id,owner_type:'client_site',owner_id:lSite.id});
 // Tenant isolation: organisation B cannot read or update the site or reach the location.
 assert(!JSON.stringify(await json(await call('/api/platform/clients?view=sites&q=Ingleburn','GET',undefined,B.cookie),200)).includes(lSite.id),'no cross-tenant site search');
 assert.notEqual((await cr({action:'updateSite',id:lSite.id,revision:lMoved.revision,site:{location:lPicked}},B.cookie)).status,200,'foreign site update refused');
 assert.equal((await call('/api/platform/locations/'+lMoved.location.id,'GET',undefined,A.cookie)).status,404,'there is no global location endpoint');
 // Legacy site without a location still loads; manual entry with coordinates has no provider data.
 const lLegacySite=(await json(await cr({action:'createSite',site:{clientId:lClient.id,address:'Old quarry access road'}}),201)).site;assert.equal(lLegacySite.location,null);
 const lManualSite=(await json(await cr({action:'createSite',site:{clientId:lClient.id,name:'Lot 7',location:{addressLine1:'Lot 7 Quarry Road',addressLine2:null,locality:'Marulan',state:'NSW',postcode:'2579',country:'AU',source:'manual',placeId:'forged',provider:'fake',geocoded:{lat:-34.7,lng:150},pin:{lat:-34.71,lng:150.01}}}}),201)).site;
 assert.equal(lManualSite.location.placeId,null);assert.equal(lManualSite.location.geocoded,null);assert.equal(lManualSite.location.precision,'manual');assert.equal(lManualSite.location.pin.lat,-34.71);
 await json(await cr({action:'createSite',site:{clientId:lClient.id,name:'Bad pin',location:{addressLine1:null,addressLine2:null,locality:null,state:null,postcode:null,country:null,source:'manual',pin:{lat:0,lng:0}}}}),400,'invalid coordinates refused');
 // Project inherits the site location; a project override never rewrites the CRM site.
 const lJob=(await json(await call('/api/delivery','POST',{kind:'jobs',record:{id:'',name:`Location job ${suffix}`,status:'Planning',metadata:{clientId:lClient.id,siteId:lSite.id}}},A.cookie),201)).record;
 let lLp=(await json(await call('/api/projects/workspace?id='+lJob.id,'GET',undefined,A.cookie),200)).project;
 assert.equal(lLp.locationSource,'site');assert.equal(lLp.location.id,lMoved.location.id);
 const lDover=(await json(await lLoc({op:'place',id:(await json(await lLoc({op:'autocomplete',q:'Dover Road Rose Bay'}),200)).suggestions[0].placeId}),200)).place;
 lLp=(await json(await call('/api/projects/workspace','PATCH',{id:lLp.id,revision:lLp.revision,location:{...lDover,provider:'fake',source:'autocomplete',geocoded:lDover.point,pin:{lat:-33.8741,lng:151.2702},pinAddress:'120 Dover Road, Rose Bay NSW 2029, Australia'}},A.cookie),200)).project??lLp;
 lLp=(await json(await call('/api/projects/workspace?id='+lJob.id,'GET',undefined,A.cookie),200)).project;
 assert.equal(lLp.locationSource,'project');assert.equal(lLp.location.precision,'GEOMETRIC_CENTER');assert.equal(lLp.location.pinAdjusted,true);assert.equal(lLp.siteLocation.id,lMoved.location.id);
 const [[siteAfter]]=await db.execute('SELECT location_id,address FROM client_sites WHERE id=?',[lSite.id]);assert.equal(siteAfter.location_id,lMoved.location.id,'CRM site untouched');assert.equal(siteAfter.address,lYork.formattedAddress);
 const [[siteLocAfter]]=await db.execute('SELECT pin_lat FROM locations WHERE id=?',[lMoved.location.id]);assert.equal(Number(siteLocAfter.pin_lat),-33.999);
 // Delivery: shifts inherit the project location; a work point changes only that shift.
 const lShift=(await json(await call('/api/delivery','POST',{kind:'shifts',record:{id:'',name:'Location shift',status:'Planned',metadata:{jobId:lJob.id,date:today,start:'18:00',finish:'22:00',location:'Northbound lane, chainage 120',assignments:[]}}},A.cookie),201)).record;
 let lDl=await json(await call('/api/delivery','GET',undefined,A.cookie),200);let lDShift=lDl.shifts.find(x=>x.id===lShift.id);
 assert.equal(lDShift.metadata.locationSource,'project');assert.equal(lDShift.metadata.locationView.id,lLp.location.id);assert.equal(lDShift.metadata.location,'Northbound lane, chainage 120','free-text work area kept');
 await json(await call('/api/delivery','POST',{kind:'shifts',record:{...lDShift,metadata:{...lDShift.metadata,workPoint:{...lPicked,pin:{lat:-33.999,lng:150.862}}}}},A.cookie),200,'shift work point');
 lDl=await json(await call('/api/delivery','GET',undefined,A.cookie),200);lDShift=lDl.shifts.find(x=>x.id===lShift.id);
 assert.equal(lDShift.metadata.locationSource,'shift');assert.equal(lDShift.metadata.locationView.pin.lat,-33.999);assert.equal(lDShift.metadata.workPoint,undefined,'work point is not stored in metadata');
 assert.equal(lDl.jobs.find(x=>x.id===lJob.id).metadata.locationView.id,lLp.location.id,'the project keeps its own location');
 const [[shiftLoc]]=await db.execute('SELECT l.owner_type,l.owner_id FROM shifts s JOIN locations l ON l.id=s.location_id WHERE s.id=?',[lShift.id]);assert.deepEqual({...shiftLoc},{owner_type:'shift',owner_id:lShift.id});
 await json(await call('/api/delivery','POST',{kind:'shifts',record:{...lDShift,metadata:{...lDShift.metadata,workPoint:{addressLine1:null,addressLine2:null,locality:null,state:null,postcode:null,country:null,source:'manual',pin:{lat:200,lng:1}}}}},A.cookie),400,'invalid work point refused');
 // Field Today: exact work point with a Directions link to the pin.
 const lToday=await json(await call('/api/field/today','GET',undefined,A.cookie),200);const lTShift=[...lToday.today,...lToday.upcoming].find(x=>x.id===lShift.id);
 assert(lTShift,'shift visible on Today');assert.equal(lTShift.workLocation.directions,'https://www.google.com/maps/dir/?api=1&destination=-33.9990000,150.8620000');
 await json(await call('/api/delivery','POST',{kind:'shifts',record:{...lDShift,metadata:{...lDShift.metadata,workPoint:null}}},A.cookie),200,'clear work point');
 lDShift=(await json(await call('/api/delivery','GET',undefined,A.cookie),200)).shifts.find(x=>x.id===lShift.id);assert.equal(lDShift.metadata.locationSource,'project');
 // Reset the project to the site location.
 lLp=(await json(await call('/api/projects/workspace?id='+lJob.id,'GET',undefined,A.cookie),200)).project;
 await json(await call('/api/projects/workspace','PATCH',{id:lLp.id,revision:lLp.revision,useSiteLocation:true},A.cookie),200);
 lLp=(await json(await call('/api/projects/workspace?id='+lJob.id,'GET',undefined,A.cookie),200)).project;assert.equal(lLp.locationSource,'site');
 lDShift=(await json(await call('/api/delivery','GET',undefined,A.cookie),200)).shifts.find(x=>x.id===lShift.id);assert.equal(lDShift.metadata.locationSource,'site','shift provenance follows the CRM site when no project/shift override exists');
 assert.equal((await call('/api/projects/workspace?id='+lJob.id,'GET',undefined,B.cookie)).status,404,'foreign project location unreachable');
 // Depots: organisation-scoped with an exact location.
 const lDepot=await json(await call('/api/platform/depots','POST',{depot:{name:'Ingleburn yard',location:lPicked}},A.cookie),200,'create depot');
 const lDepots=(await json(await call('/api/platform/depots','GET',undefined,A.cookie),200)).depots;assert.equal(lDepots.find(d=>d.id===lDepot.id).location.placeId,'fake-york-rd-ingleburn');
 assert(!(await json(await call('/api/platform/depots','GET',undefined,B.cookie),200)).depots.some(d=>d.id===lDepot.id),'depots stay in their organisation');
 assert.equal((await call('/api/platform/depots','POST',{id:lDepot.id,depot:{name:'Hijack'}},B.cookie)).status,404,'foreign depot update');
 assert.equal((await call('/api/platform/depots','POST',{depot:{name:'Field depot'}},C.cookie)).status,403,'field users cannot change depots');
 // Company registered address: structured with a text snapshot.
 await json(await call('/api/platform/onboarding','PUT',{registered_location:lPicked},A.cookie),200);
 const lProf=(await json(await call('/api/platform/onboarding','GET',undefined,A.cookie),200)).profile;assert.equal(lProf.registered_address,lYork.formattedAddress);assert.equal(lProf.registered_location.postcode,'2565');
 // Incident: exact location plus free-text specific location; field users can record it.
 const lInc=await json(await reg('incidents',C.cookie).create(projectId,{incident_type:'near miss',occurred_at:`${today}T11:00`,description:'Plant reversed near pedestrians',location_description:'Gate 2, near the wash bay',location_id:{...lPicked,pin:{lat:-33.999,lng:150.862}}}),201,'incident with location');
 assert.equal(lInc.record.location.pinAdjusted,true);assert.equal(lInc.record.location_description,'Gate 2, near the wash bay');
 const lIncList=(await json(await reg('incidents',A.cookie).list('?parentId='+projectId),200)).records;assert.equal(lIncList.find(r=>r.id===lInc.record.id).location.pin.lat,-33.999);
 console.log('PASS L locations: fake provider autocomplete/place/reverse, offline + reverse failure, no invented addresses, site location with exact pin (geocoded kept), tenant isolation, no global endpoint, legacy + manual entry, project inheritance/override without rewriting CRM, shift work point, Field Today directions, depots, company address, incident location');

 // ---------------------------------------------------------------- Scenario H: ABN register, AI orchestration, billing
 // ---------------------------------------------------------------- Scenario F8: forms engine — versions, evidence, corrections, scope
 step='F8 forms engine';
 await as('project_engineer');
 const fPost=(body,cookie=A.cookie)=>call('/api/forms','POST',body,cookie);
 const fGet=(q,cookie=A.cookie)=>call('/api/forms?'+q,'GET',undefined,cookie);
 const fSchema={sections:[{id:'checks',title:'Checks',fields:[
  {id:'plant_safe',type:'boolean',label:'Plant safe to operate?',required:true},
  {id:'describe_defect',type:'textarea',label:'Describe the defect',required:true,showIf:{field:'plant_safe',op:'eq',value:'false'}},
  {id:'hazard',type:'select',label:'Main hazard',options:[{value:'traffic',label:'Traffic'},{value:'dust',label:'Dust'}]},
  {id:'operator',type:'person',label:'Operator'},
  {id:'rig',type:'asset',label:'Plant item'},
  {id:'work_point',type:'location',label:'Work point'},
  {id:'photos',type:'photo',label:'Photos'},
  {id:'signed',type:'signature',label:'Sign-off',required:true},
 ]}]};
 await json(await fPost({action:'create',name:'Field form',schema:fSchema},C.cookie),403,'field workers cannot create templates');
 await json(await fPost({action:'create',name:'Engineer form',schema:fSchema},R.cookie),403,'engineers cannot manage templates');
 await json(await fPost({action:'create',name:'Bad form',schema:{sections:[{id:'s',title:'S',fields:[{id:'a',type:'text',label:'A',showIf:{field:'zzz',op:'answered'}}]}]}}),400,'conditions must reference earlier fields');
 const fTpl=await json(await fPost({action:'create',name:'Plant prestart',category:'Prestart',schema:fSchema}),201,'create template draft v1');
 const fV1=fTpl.versionId;
 let fDetail=await json(await fGet('op=template&id='+fTpl.id),200);assert.equal(fDetail.draft.versionNumber,1);assert.equal(fDetail.current,null);
 assert(!(await json(await fGet('op=templates',C.cookie),200)).templates.some(t=>t.id===fTpl.id),'unpublished forms are hidden from field users');
 await json(await fGet('op=version&id='+fV1,C.cookie),404,'draft versions hidden from field users');
 await json(await fPost({action:'submit',templateId:fTpl.id,contextType:'project',contextId:pA,responses:{}},R.cookie),404,'no submissions against an unpublished form');
 await json(await fPost({action:'publish',id:fTpl.id,versionId:fV1},R.cookie),403,'engineers cannot publish');
 await json(await fPost({action:'publish',id:fTpl.id,versionId:fV1,changeReason:'First issue'}),200,'publish v1');
 await json(await fPost({action:'saveDraft',id:fTpl.id,versionId:fV1,schema:{sections:[]}}),409,'a published version cannot be edited');
 await json(await fPost({action:'publish',id:fTpl.id,versionId:fV1}),409,'a published version cannot be republished');
 // References for validation.
 const fPlantA=crypto.randomUUID(),fPlantB=crypto.randomUUID(),fNow=new Date().toISOString();
 await db.execute('INSERT INTO plant (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[fPlantA,memberA.organisation_id,'Form roller','active','{}',fNow]);
 await db.execute('INSERT INTO plant (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[fPlantB,memberB.organisation_id,'Other org roller','active','{}',fNow]);
 // Forms evidence belongs to IMS, not the Field module: everything below runs with Field disabled.
 const fUpload=(cookie,contextType,contextId,name='photo.png',content='\x89PNG fixture')=>{const f=new FormData();f.set('contextType',contextType);f.set('contextId',contextId);f.set('file',new File([content],name,{type:'image/png'}));return call('/api/forms/evidence','POST',f,cookie);};
 await json(await call('/api/platform/entitlements','PUT',{module:'field',status:'disabled'},A.cookie),200,'disable Field');
 await json(await upload(C.cookie,{contextType:'field',projectId:pA,title:'Ordinary field doc'}),403,'ordinary Field documents still need the Field module');
 const fPhotoR=(await json(await fUpload(R.cookie,'project',pA),201,'IMS active + Field disabled: engineer uploads form evidence')).document;
 const fSigR=(await json(await fUpload(R.cookie,'project',pA,'signature.png'),201,'IMS active + Field disabled: drawn signature stored')).document;
 const fPhotoOtherProject=(await json(await fUpload(A.cookie,'project',pB),201)).document;
 const fPhotoByAdmin=(await json(await fUpload(A.cookie,'project',pA),201)).document;
 const fAdminShiftDoc=(await json(await fUpload(A.cookie,'shift',shiftA),201)).document;
 const fPhotoOtherOrg=(await json(await fUpload(B.cookie,'organisation','current'),201)).document;
 const fShiftBDoc=(await json(await fUpload(A.cookie,'shift',shiftB),201)).document;
 await json(await fUpload(R.cookie,'project',pB),404,'engineer cannot upload evidence to an unassigned project');
 await json(await fUpload(C.cookie,'shift',shiftB),404,'field worker cannot upload evidence to an unassigned shift');
 await json(await fUpload(C.cookie,'project',pA),404,'field worker cannot upload project-level evidence');
 await json(await fUpload(R.cookie,'project',pA,'run.exe'),415,'evidence file types are controlled');
 // Controlled context: generic document routes never create, list, search or open Forms evidence.
 await json(await upload(A.cookie,{contextType:'form',contextId:'project:'+pA,projectId:pA,title:'Forged'}),400,'generic upload cannot write the Forms context');
 assert.equal((await call('/api/documents?id='+fPhotoR.id,'GET',undefined,A.cookie)).status,404,'generic open never serves Forms evidence');
 assert(!(await json(await call('/api/documents?projectId='+pA,'GET',undefined,A.cookie),200)).documents.some(d=>d.id===fPhotoR.id),'generic listing excludes Forms evidence');
 // Direct evidence access re-derives the form context.
 assert.equal((await call('/api/forms/evidence?id='+fPhotoR.id,'GET',undefined,R.cookie)).status,200,'engineer opens own project evidence');
 await json(await call('/api/forms/evidence?id='+fPhotoOtherProject.id,'GET',undefined,R.cookie),404,'engineer cannot open unassigned project evidence');
 await json(await call('/api/forms/evidence?id='+fPhotoR.id,'GET',undefined,C.cookie),404,'shift access never opens project-level evidence');
 await json(await call('/api/forms/evidence?id='+fShiftBDoc.id,'GET',undefined,C.cookie),404,'guessed evidence id for an unassigned shift refused');
 await json(await call('/api/forms/evidence?id='+fPhotoR.id,'GET',undefined,B.cookie),404,'other tenant cannot open evidence');
 const fWhere={addressLine1:'1 Alpha Road',addressLine2:null,locality:'Ingleburn',state:'NSW',postcode:'2565',country:'AU',source:'manual',pin:{lat:-33.99,lng:150.86}};
 const fGood={plant_safe:true,describe_defect:'left over from a hidden branch',hazard:'traffic',operator:R.user.id,rig:fPlantA,work_point:fWhere,photos:[fPhotoR.id],signed:{name:'Robin Engineer',confirmed:true,documentId:fSigR.id}};
 const fSubmit=(responses,cookie=R.cookie,contextType='project',contextId=pA,extra={})=>fPost({action:'submit',templateId:fTpl.id,contextType,contextId,responses,...extra},cookie);
 const fBad=async(patch,label)=>{const {signed:_s,...rest}=fGood;void _s;await json(await fSubmit({...fGood,...patch}),400,label);return rest;};
 await json(await fSubmit({...fGood,signed:undefined}),400,'required field enforced server-side');
 await fBad({plant_safe:false,describe_defect:undefined},'visible conditional required field enforced');
 await fBad({hazard:'fire'},'invalid choice rejected');
 await fBad({mystery:'x'},'unknown field rejected');
 await fBad({operator:B.user.id},'person from another organisation rejected');
 await fBad({rig:fPlantB},'asset from another organisation rejected');
 await fBad({photos:[fPhotoOtherProject.id]},'document from another project rejected');
 await fBad({photos:[fPhotoByAdmin.id]},'document uploaded by someone else rejected');
 await fBad({photos:[fPhotoOtherOrg.id]},'document from another organisation rejected');
 await json(await fSubmit({...fGood,photos:[fAdminShiftDoc.id]},A.cookie),400,'Forms evidence from another context cannot be inserted');
 await fBad({photos:[fShiftBDoc.id]},'unauthorised shift evidence rejected');
 const fOrdinary=(await json(await upload(A.cookie,{contextType:'project',contextId:pA,projectId:pA,title:'Ordinary project doc'}),201)).document;
 await json(await fSubmit({...fGood,photos:[fOrdinary.id]},A.cookie),400,'ordinary documents are not form evidence');
 await fBad({work_point:{...fWhere,pin:{lat:200,lng:1}}},'invalid location rejected');
 await fBad({signed:{name:'Robin',confirmed:false}},'unconfirmed signature rejected');
 const fSubA=(await json(await fSubmit(fGood),201,'engineer submits Alpha project form')).id;
 const [[fRowA]]=await db.execute('SELECT * FROM form_submissions WHERE organisation_id=? AND id=?',[memberA.organisation_id,fSubA]);
 const fOrigJson=fRowA.responses_json,fOrig=JSON.parse(fOrigJson);
 assert.equal(fRowA.template_version_id,fV1);assert.equal(fRowA.project_id,pA);assert.equal(fRowA.context_type,'project');
 assert.equal(fOrig.describe_defect,undefined,'hidden conditional answer is not stored');
 assert.equal(fOrig.signed.signerUserId,R.user.id,'signature stamped with the signer account');assert(fOrig.signed.signedAt,'signature stamped with capture time');
 assert(fOrig.work_point.locationId,'location stored in the Core locations model');
 assert.equal(fOrig.signed.documentId,fSigR.id,'drawn signature kept as a Documents reference');assert(!fOrigJson.includes('base64'),'no inline binary');
 const [[fLoc]]=await db.execute('SELECT owner_type,owner_id FROM locations WHERE organisation_id=? AND id=?',[memberA.organisation_id,fOrig.work_point.locationId]);assert.deepEqual({...fLoc},{owner_type:'form_submission',owner_id:fSubA});
 // Project scope: Bravo is not the engineer's project.
 await json(await fSubmit(fGood,R.cookie,'project',pB),404,'engineer cannot submit against an unassigned project');
 await json(await fGet(`op=submissions&contextType=project&contextId=${pB}`,R.cookie),404,'engineer cannot list another project\'s forms');
 const fBravoPhoto=(await json(await fUpload(A.cookie,'project',pB),201)).document;
 const fSubB=(await json(await fSubmit({...fGood,operator:A.user.id,photos:[fBravoPhoto.id],signed:{name:'Admin',confirmed:true}},A.cookie,'project',pB),201,'admin submits Bravo form')).id;
 await json(await fGet('op=submission&id='+fSubB,R.cookie),404,'engineer cannot open a Bravo submission by id');
 await json(await fPost({action:'amend',id:fSubB,responses:{...fGood,hazard:'dust'},reason:'Try to edit Bravo'},R.cookie),404,'engineer cannot correct a Bravo submission');
 const fRList=(await json(await fGet('op=submissions',R.cookie),200)).submissions.map(x=>x.id);assert(fRList.includes(fSubA)&&!fRList.includes(fSubB),'engineer list is project-scoped');
 // Field worker: assigned shift only; a shift never opens the project.
 const fFieldPhoto=(await json(await fUpload(C.cookie,'shift',shiftA),201,'Field disabled: assigned field worker uploads shift evidence')).document;
 assert.equal((await call('/api/forms/evidence?id='+fFieldPhoto.id,'GET',undefined,C.cookie)).status,200,'field worker reopens own shift evidence');
 assert.equal((await call('/api/forms/evidence?id='+fFieldPhoto.id,'GET',undefined,R.cookie)).status,200,'engineer opens shift evidence on their project');
 const fShiftSub=(await json(await fSubmit({plant_safe:false,describe_defect:'Hydraulic leak',photos:[fFieldPhoto.id],signed:{name:'Casey Field',confirmed:true}},C.cookie,'shift',shiftA),201,'field worker submits an assigned-shift form')).id;
 const [[fShiftRow]]=await db.execute('SELECT project_id,context_type FROM form_submissions WHERE organisation_id=? AND id=?',[memberA.organisation_id,fShiftSub]);assert.equal(fShiftRow.project_id,pA,'project derived from the shift, never supplied');
 await json(await fSubmit({plant_safe:true,signed:{name:'Casey Field',confirmed:true}},C.cookie,'shift',shiftB),404,'field worker cannot submit against an unassigned shift');
 await json(await fSubmit({plant_safe:true,signed:{name:'Casey Field',confirmed:true}},C.cookie,'project',pA),404,'field worker cannot submit against the whole project');
 await json(await fGet('op=submission&id='+fSubA,C.cookie),404,'field worker cannot open project-level evidence');
 await json(await fGet('op=submission&id='+fShiftSub,C.cookie),200,'field worker reopens own shift evidence');
 await json(await fPost({action:'amend',id:fShiftSub,responses:{plant_safe:true,signed:{name:'Casey Field',confirmed:true}},reason:'oops'},C.cookie),403,'field workers cannot correct evidence');
 const fShiftList=(await json(await fGet(`op=submissions&contextType=shift&contextId=${shiftA}`,R.cookie),200)).submissions.map(x=>x.id);assert(fShiftList.includes(fShiftSub),'engineer sees shift evidence on their project');
 // Tenant isolation.
 await json(await fGet('op=template&id='+fTpl.id,B.cookie),404,'other tenant cannot read the template');
 await json(await fGet('op=version&id='+fV1,B.cookie),404,'other tenant cannot read the version');
 await json(await fGet('op=submission&id='+fSubA,B.cookie),404,'other tenant cannot read the submission');
 await json(await fPost({action:'submit',templateId:fTpl.id,contextType:'organisation',contextId:'current',responses:fGood},B.cookie),404,'other tenant cannot submit against the template');
 await json(await fPost({action:'amend',id:fSubA,responses:fGood,reason:'hijack'},B.cookie),404,'other tenant cannot correct');
 await json(await fPost({action:'submit',templateId:fTpl.id,contextType:'project',contextId:pOther,responses:fGood}),404,'another organisation\'s project is not a context');
 // Versioning: V2 is edited and published without touching V1; V1 evidence keeps V1.
 const fRev=await json(await fPost({action:'revise',id:fTpl.id}),200,'start revision');assert.equal(fRev.versionNumber,2);
 assert.equal((await json(await fPost({action:'revise',id:fTpl.id}),200)).versionId,fRev.versionId,'one open draft at a time');
 const fSchema2={sections:[{...fSchema.sections[0],fields:[...fSchema.sections[0].fields,{id:'tyres_ok',type:'boolean',label:'Tyres OK?',required:true}].map(f=>f.id==='plant_safe'?{...f,label:'Is the plant safe to operate?'}:f)}]};
 const fDraft=(await json(await fGet('op=template&id='+fTpl.id),200)).draft;
 await json(await fPost({action:'saveDraft',id:fTpl.id,versionId:fRev.versionId,revision:fDraft.revision,schema:fSchema2,changeReason:'Add tyre check'}),200,'edit v2 draft');
 await json(await fPost({action:'saveDraft',id:fTpl.id,versionId:fRev.versionId,revision:fDraft.revision,schema:fSchema2}),409,'stale draft edit refused');
 const fV1After=(await json(await fGet('op=version&id='+fV1),200)).version;assert(!fV1After.schema.sections[0].fields.some(f=>f.id==='tyres_ok'),'v1 unchanged by v2 edits');assert.equal(fV1After.status,'published');
 await json(await fPost({action:'publish',id:fTpl.id,versionId:fRev.versionId}),200,'publish v2');
 assert.equal((await json(await fGet('op=version&id='+fV1),200)).version.status,'superseded','v1 becomes historical');
 const fSubAView=await json(await fGet('op=submission&id='+fSubA,R.cookie),200);assert.equal(fSubAView.submission.versionNumber,1);assert(!fSubAView.schema.sections[0].fields.some(f=>f.id==='tyres_ok'),'v1 evidence renders against v1');assert.equal(fSubAView.schema.sections[0].fields[0].label,'Plant safe to operate?');
 await json(await fSubmit(fGood,R.cookie,'project',pA,{versionId:fV1}),409,'new submissions cannot target a superseded version');
 await json(await fSubmit({...fGood,photos:[]}),400,'v2 required field enforced');
 await json(await fSubmit({...fGood,photos:[],tyres_ok:true}),201,'v2 submission');
 // Corrections: append-only, reasoned, original untouched.
 await json(await fPost({action:'amend',id:fSubA,responses:{...fSubAView.effective,hazard:'dust'}},R.cookie),400,'correction needs a reason');
 await json(await fPost({action:'amend',id:fSubA,responses:{...fSubAView.effective,tyres_ok:true},reason:'Add tyres'},R.cookie),400,'corrections validate against the original version');
 const fAm1=await json(await fPost({action:'amend',id:fSubA,responses:{...fSubAView.effective,hazard:'dust'},reason:'Wrong hazard selected'},R.cookie),201,'correction 1');
 assert.equal(fAm1.sequence,1);assert.deepEqual(fAm1.changedFields,['hazard']);
 await json(await fPost({action:'amend',id:fSubA,responses:{...fSubAView.effective,hazard:'dust'},reason:'Same again'},R.cookie),400,'a correction must change something');
 const fAm2=await json(await fPost({action:'amend',id:fSubA,responses:{...fSubAView.effective,hazard:'dust',signed:{name:'Robin E. Engineer',confirmed:true}},reason:'Signer name typo'},A.cookie),201,'correction 2');assert.equal(fAm2.sequence,2);
 const [[fRowAfter]]=await db.execute('SELECT responses_json FROM form_submissions WHERE organisation_id=? AND id=?',[memberA.organisation_id,fSubA]);assert.equal(fRowAfter.responses_json,fOrigJson,'original evidence never mutated');
 const fHist=await json(await fGet('op=submission&id='+fSubA,R.cookie),200);
 assert.equal(fHist.original.hazard,'traffic');assert.equal(fHist.effective.hazard,'dust');assert.equal(fHist.amendments.length,2);assert.equal(fHist.amendments[0].reason,'Wrong hazard selected');
 assert.equal(fHist.effective.signed.signerUserId,A.user.id,'a changed signature is re-stamped');assert.equal(fHist.original.signed.signerUserId,R.user.id,'the original signature is kept');
 assert.deepEqual(fHist.effective.work_point,fOrig.work_point,'carried location kept');assert.deepEqual(fHist.effective.photos,[fPhotoR.id],'carried files kept');
 assert.equal(fHist.labels.people[R.user.id]!==undefined,true);
 // Audit trail.
 const [fAudit]=await db.execute('SELECT event_type FROM audit_log WHERE organisation_id=? AND entity_id IN (?,?)',[memberA.organisation_id,fTpl.id,fSubA]);const fEvents=new Set(fAudit.map(r=>r.event_type));
 for(const e of ['form_template.created','form_template.published','form_template.revision_started','form_template.draft_updated','form_submission.submitted','form_submission.amended'])assert(fEvents.has(e),'audit: '+e);
 // Deterministic version numbers (database-enforced).
 await assert.rejects(db.execute("INSERT INTO form_template_versions (id,organisation_id,template_id,version_number,status,schema_json,created_at,updated_at) VALUES (?,?,?,1,'draft','{}',?,?)",[crypto.randomUUID(),memberA.organisation_id,fTpl.id,fNow,fNow]),'duplicate version number refused');
 // Archive stops new submissions; history stays readable.
 await json(await fPost({action:'archive',id:fTpl.id}),200);await json(await fSubmit({...fGood,photos:[],tyres_ok:true}),404,'archived forms cannot be completed');
 await json(await fGet('op=submission&id='+fSubA,R.cookie),200,'archived form evidence stays readable');await json(await fPost({action:'restore',id:fTpl.id}),200);
 // Submitted evidence stays readable with Field disabled; re-enabling Field leaves ordinary field documents unchanged.
 assert.equal((await call('/api/forms/evidence?id='+fPhotoR.id,'GET',undefined,R.cookie)).status,200,'submitted evidence readable while Field is disabled');
 assert.equal((await call('/api/forms/evidence?id='+fSigR.id,'GET',undefined,A.cookie)).status,200,'drawn signature readable while Field is disabled');
 await json(await call('/api/platform/entitlements','PUT',{module:'field',status:'active'},A.cookie),200,'restore Field');
 const fOrdinaryField=(await json(await upload(C.cookie,{contextType:'field',projectId:pA,title:'Ordinary field doc'}),201,'ordinary Field upload works again')).document;
 assert.equal((await call('/api/documents?id='+fOrdinaryField.id,'GET',undefined,C.cookie)).status,200,'ordinary Field document opens through the generic route');
 // IMS entitlement governs the forms surface.
 await json(await call('/api/platform/entitlements','PUT',{module:'ims',status:'disabled'},A.cookie),200,'disable IMS');
 await json(await fGet('op=templates'),404,'IMS disabled: forms unavailable');await json(await call('/api/forms/evidence?id='+fPhotoR.id,'GET',undefined,R.cookie),404,'IMS disabled: evidence unavailable');await json(await fUpload(R.cookie,'project',pA),404,'IMS disabled: no evidence uploads');await json(await fSubmit({...fGood,photos:[],tyres_ok:true}),404,'IMS disabled: no submissions');
 await json(await call('/api/platform/entitlements','PUT',{module:'ims',status:'active'},A.cookie),200,'restore IMS');
 console.log('PASS F8 forms: draft→publish→immutable v1, v2 revision without touching v1, v1 evidence renders v1, stale version refused, server-side required/conditional/choice/unknown/person/asset/document/location/signature validation, hidden answers dropped, immutable submissions with reasoned append-only corrections, Alpha/Bravo engineer scope, assigned-shift field submission, tenant isolation, audit trail, archive, IMS entitlement; evidence in a controlled IMS Forms document context works with Field disabled, re-derives shift/project scope on every open, never appears in generic document routes, and cannot be moved between contexts');

 // ---------------------------------------------------------------- Scenario 8B: HSEQ investigation & corrective-action chain
 step='8B HSEQ chain';
 await as('project_engineer');
 await json(await call('/api/projects/team','POST',{projectId:pA,userId:S.user.id,projectRole:'site_engineer'},A.cookie),200,'site engineer back on Alpha');
 const hPost=(body,cookie=R.cookie)=>call('/api/hseq/chain','POST',body,cookie);
 const hChain=(type,id,cookie=R.cookie)=>call(`/api/hseq/chain?sourceType=${type}&sourceId=${encodeURIComponent(id)}`,'GET',undefined,cookie);
 const complete=(id,cookie,note)=>call('/api/registers/actions','PATCH',{id,transition:'complete',note},cookie);
 // 1–2. Field worker reports; scope applies.
 const hInc=(await json(await reg('incidents',C.cookie).create(pA,{incident_type:'near miss',occurred_at:`${today}T08:15`,description:'Excavator slewed towards a spotter'}),201,'field worker reports Incident Alpha')).record;
 assert.equal(hInc.status,'reported');
 await json(await hChain('incident',hInc.id,B.cookie),404,'other tenant cannot open the chain');
 await json(await hChain('incident',hInc.id,C.cookie),403,'field worker cannot open the HSEQ chain');
 await json(await hPost({action:'startInvestigation',sourceType:'incident',sourceId:hInc.id},C.cookie),403,'field worker cannot investigate');
 // 3–5. Investigation.
 const hInv=(await json(await hPost({action:'startInvestigation',sourceType:'incident',sourceId:hInc.id,summary:'Slew near spotter at pit 4'}),201,'engineer starts investigation')).id;
 assert.equal((await json(await hChain('incident',hInc.id),200)).source.status,'investigating','incident moves to investigating');
 await json(await hPost({action:'startInvestigation',sourceType:'incident',sourceId:hInc.id}),409,'one investigation per source');
 await json(await hPost({action:'completeInvestigation',id:hInv}),422,'cannot complete without finding and root cause');
 let hInvRow=(await json(await hChain('incident',hInc.id),200)).investigation;
 await json(await hPost({action:'updateInvestigation',id:hInv,revision:hInvRow.revision,values:{facts:'Spotter inside slew radius; no exclusion zone marked',finding:'Exclusion zone not set out'}}),200);
 await json(await hPost({action:'completeInvestigation',id:hInv}),422,'finding alone is not enough — root cause or explicit conclusion required');
 hInvRow=(await json(await hChain('incident',hInc.id),200)).investigation;
 await json(await hPost({action:'updateInvestigation',id:hInv,revision:hInvRow.revision-1,values:{rootCause:'x'}}),409,'stale investigation edit refused');
 await json(await hPost({action:'updateInvestigation',id:hInv,revision:hInvRow.revision,values:{rootCause:'Pre-start did not cover exclusion zones',contributingFactors:'New spotter'}}),200);
 await json(await hPost({action:'completeInvestigation',id:hInv}),200,'investigation complete');
 await json(await hPost({action:'updateInvestigation',id:hInv,values:{finding:'rewrite'}}),409,'completed investigation is locked');
 await json(await hPost({action:'reopenInvestigation',id:hInv}),400,'reopen needs a reason');
 await json(await hPost({action:'reopenInvestigation',id:hInv,reason:'Add CCTV evidence'}),200,'controlled reopen');
 await json(await hPost({action:'completeInvestigation',id:hInv}),200,'re-complete');
 // 6–7. Two actions from the incident, real owners and due dates; project derived.
 const hA1=(await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hInc.id,actionText:'Mark exclusion zones in pre-start',ownerUserId:R.user.id,dueDate:'2020-01-01'}),201)).id;
 const hA2=(await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hInc.id,actionText:'Spotter refresher training',ownerUserId:S.user.id,dueDate:'2099-12-31'}),201)).id;
 await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hInc.id,actionText:'No owner'}),400,'actions need a real owner');
 await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hInc.id,actionText:'Foreign owner',ownerUserId:B.user.id}),400,'owner must be in the organisation');
 const [[hA1Row]]=await db.execute('SELECT project_id,owner_user_id,owner_name,source_type,source_id FROM hseq_actions WHERE organisation_id=? AND id=?',[memberA.organisation_id,hA1]);
 assert.equal(hA1Row.project_id,pA,'project derived from the incident');assert.equal(hA1Row.owner_user_id,R.user.id);assert(hA1Row.owner_name,'owner name snapshot');
 let hView=await json(await hChain('incident',hInc.id),200);assert.equal(hView.actions.length,2);assert.equal(hView.actions.find(x=>x.id===hA1).overdue,true,'past due and unverified is overdue');
 // 8–10. Completion and independent verification.
 await json(await complete(hA1,R.cookie),422,'completion notes required');
 await json(await complete(hA1,R.cookie,'Pre-start template updated with exclusion zones'),200,'owner completes action 1');
 const [[hA1Done]]=await db.execute('SELECT completed_by,completed_at FROM hseq_actions WHERE organisation_id=? AND id=?',[memberA.organisation_id,hA1]);assert.equal(hA1Done.completed_by,R.user.id);assert(hA1Done.completed_at,'completion stamped by the server');
 await json(await call('/api/registers/actions','PATCH',{id:hA1,transition:'verified'},A.cookie),409,'verification is not a status button');
 await json(await hPost({action:'reviewAction',id:hA1,outcome:'accepted',note:'Looks good'}),403,'the completer cannot verify their own completion');
 await json(await hPost({action:'reviewAction',id:hA1,outcome:'accepted',note:'Looks good'},S.cookie),403,'site engineers do not hold hseq.verify');
 await json(await hPost({action:'reviewAction',id:hA1,outcome:'accepted'},A.cookie),400,'verification needs a note');
 await json(await hPost({action:'reviewAction',id:hA1,outcome:'accepted',note:'Checked template and briefed crew'},A.cookie),200,'independent verifier accepts');
 assert.equal((await json(await hChain('incident',hInc.id),200)).actions.find(x=>x.id===hA1).overdue,false,'verified actions are not overdue');
 await json(await call('/api/registers/actions','PATCH',{id:hA1,revision:99,values:{action:'rewrite'}},A.cookie),409,'verified actions are locked');
 // 11–12. Second action still open → incident cannot close.
 await json(await hPost({action:'close',sourceType:'incident',sourceId:hInc.id,rationale:'Done'}),422,'incident cannot close with an open action');
 await json(await call('/api/registers/incidents','PATCH',{id:hInc.id,transition:'closed'},A.cookie),409,'closure is not a status button');
 // 13–16. Rejection keeps history, then acceptance.
 await json(await complete(hA2,S.cookie,'Training delivered'),200,'owner completes action 2');
 const hHome=await json(await call('/api/platform/home','GET',undefined,R.cookie),200);assert(hHome.myActions.some(x=>x.key==='actions-verify'),'verifier sees the verification queue in My Work');
 await json(await hPost({action:'reviewAction',id:hA2,outcome:'rejected',note:'No attendance record attached'},A.cookie),200,'verifier rejects with a reason');
 hView=await json(await hChain('incident',hInc.id),200);const hA2View=hView.actions.find(x=>x.id===hA2);
 assert.equal(hA2View.status,'in_progress','rejection reopens the action');assert.equal(hA2View.reviews.length,1);assert.equal(hA2View.reviews[0].completionNotes,'Training delivered','rejected completion kept in history');assert.equal(hA2View.reviews[0].completedBy,S.user.id);
 await json(await complete(hA2,S.cookie,'Training delivered; attendance sheet attached'),200,'completed again');
 await json(await hPost({action:'reviewAction',id:hA2,outcome:'accepted',note:'Attendance sheet checked'},R.cookie),200,'a different verifier accepts');
 // 17. Incident closes.
 await json(await hPost({action:'close',sourceType:'incident',sourceId:hInc.id},C.cookie),403,'field workers cannot close controlled HSEQ records');
 await json(await hPost({action:'close',sourceType:'incident',sourceId:hInc.id,rationale:'Actions verified'}),200,'incident closes once every action is verified');
 const [[hIncRow]]=await db.execute('SELECT status,closed_by,closed_at,closure_rationale FROM hseq_incidents WHERE organisation_id=? AND id=?',[memberA.organisation_id,hInc.id]);assert.equal(hIncRow.status,'closed');assert.equal(hIncRow.closed_by,R.user.id);assert(hIncRow.closed_at);
 // Closing without any chain needs an explicit rationale.
 const hInc2=(await json(await reg('incidents',C.cookie).create(pA,{incident_type:'other',occurred_at:`${today}T09:00`,description:'Minor spill of water from cart'}),201)).record;
 await json(await hPost({action:'close',sourceType:'incident',sourceId:hInc2.id}),422,'nothing entered is not "no investigation required"');
 await json(await hPost({action:'close',sourceType:'incident',sourceId:hInc2.id,rationale:'Water only; no hazard, no systemic cause.'}),200,'closure with explicit rationale');
 // NCR chain.
 const hNcr=(await json(await reg('ncrs',A.cookie).create(pA,{issue:'Kerb profile out of tolerance',requirement:'±5 mm per spec R15'}),201,'raise NCR')).record;
 const hNInv=(await json(await hPost({action:'startInvestigation',sourceType:'ncr',sourceId:hNcr.id,summary:'Survey of 40 m kerb'}),201)).id;
 const hNInvRow=(await json(await hChain('ncr',hNcr.id),200)).investigation;
 await json(await hPost({action:'updateInvestigation',id:hNInv,revision:hNInvRow.revision,values:{finding:'Stringline set 8 mm high',rootCause:'Unchecked survey control point'}}),200);
 await json(await hPost({action:'completeInvestigation',id:hNInv}),200,'NCR investigation complete');
 const hN1=(await json(await hPost({action:'addAction',sourceType:'ncr',sourceId:hNcr.id,actionText:'Break out and relay 40 m',ownerUserId:S.user.id,dueDate:'2099-01-01'}),201)).id;
 const hN2=(await json(await hPost({action:'addAction',sourceType:'ncr',sourceId:hNcr.id,actionText:'Add control check to ITP',ownerUserId:R.user.id,dueDate:'2099-01-01'}),201)).id;
 const [[hNcrRow]]=await db.execute('SELECT status,cause FROM hseq_ncrs WHERE organisation_id=? AND id=?',[memberA.organisation_id,hNcr.id]);assert.equal(hNcrRow.status,'action');assert.equal(hNcrRow.cause,'Unchecked survey control point','cause snapshot kept for compatibility');
 await json(await complete(hN1,S.cookie,'Relaid and resurveyed'),200);await json(await complete(hN2,R.cookie,'ITP updated'),200);
 await json(await reg('ncrs',A.cookie).move(hNcr.id,'verification'),200,'NCR ready for verification');
 await json(await hPost({action:'close',sourceType:'ncr',sourceId:hNcr.id,verification:'Resurvey within tolerance'},A.cookie),422,'NCR cannot close while actions are only complete');
 await json(await reg('ncrs',A.cookie).move(hNcr.id,'closed'),409,'NCR closure is not a status button');
 await json(await hPost({action:'reviewAction',id:hN1,outcome:'accepted',note:'Resurvey report checked'},R.cookie),200);
 await json(await hPost({action:'reviewAction',id:hN2,outcome:'accepted',note:'ITP revision reviewed'},A.cookie),200);
 await json(await hPost({action:'close',sourceType:'ncr',sourceId:hNcr.id,verification:'Resurvey within tolerance'},S.cookie),403,'only verifiers close NCRs');
 await json(await hPost({action:'close',sourceType:'ncr',sourceId:hNcr.id},A.cookie),422,'final verification required');
 await json(await hPost({action:'close',sourceType:'ncr',sourceId:hNcr.id,verification:'Resurvey within tolerance on 40 m'},A.cookie),200,'NCR verified and closed');
 const [[hNcrClosed]]=await db.execute('SELECT status,closed_by,closed_at,verification FROM hseq_ncrs WHERE organisation_id=? AND id=?',[memberA.organisation_id,hNcr.id]);assert.equal(hNcrClosed.status,'closed');assert.equal(hNcrClosed.closed_by,A.user.id);assert(hNcrClosed.closed_at);assert.equal(hNcrClosed.verification,'Resurvey within tolerance on 40 m');
 const [[hN1Row]]=await db.execute('SELECT verified_by,verified_at,verification_note FROM hseq_actions WHERE organisation_id=? AND id=?',[memberA.organisation_id,hN1]);assert.equal(hN1Row.verified_by,R.user.id);assert(hN1Row.verified_at);assert.equal(hN1Row.verification_note,'Resurvey report checked');
 // Relationship integrity.
 await json(await reg('actions',A.cookie).create(pB,{source_type:'incident',source_id:hInc2.id,action:'Mismatch',owner_user_id:A.user.id}),400,'Incident Alpha → Bravo action refused');
 await json(await reg('actions',A.cookie).create(pA,{source_type:'incident',source_id:'no-such-incident',action:'Ghost',owner_user_id:A.user.id}),404,'nonexistent source refused');
 await json(await reg('actions',A.cookie).create(pA,{source_type:'other',source_id:'free text',action:'Free id',owner_user_id:A.user.id}),400,'free-text source ids refused');
 const hBInc=(await json(await reg('incidents',B.cookie).create(null,{incident_type:'other',occurred_at:`${today}T09:00`,description:'Other org incident'}),201)).record;
 await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hBInc.id,actionText:'Cross tenant',ownerUserId:R.user.id},A.cookie),404,'source in another tenant refused');
 await json(await reg('actions',A.cookie).create(null,{source_type:'incident',source_id:hBInc.id,action:'Cross tenant register',owner_user_id:A.user.id}),404,'register refuses cross-tenant sources');
 const hBravoInc=(await json(await reg('incidents',A.cookie).create(pB,{incident_type:'other',occurred_at:`${today}T10:00`,description:'Bravo incident'}),201)).record;
 const hBravoAct=(await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hBravoInc.id,actionText:'Bravo action',ownerUserId:A.user.id},A.cookie),201)).id;
 await json(await hChain('incident',hBravoInc.id),404,'engineer cannot open a Bravo chain');
 await json(await hPost({action:'startInvestigation',sourceType:'incident',sourceId:hBravoInc.id}),404,'engineer cannot investigate Bravo');
 await json(await complete(hBravoAct,A.cookie,'done'),200);
 await json(await hPost({action:'reviewAction',id:hBravoAct,outcome:'accepted',note:'guess'}),404,'engineer cannot verify a Bravo action by id');
 await json(await hPost({action:'reviewAction',id:hA1,outcome:'accepted',note:'guess'},C.cookie),403,'field worker cannot verify by guessed id');
 await json(await hPost({action:'updateInvestigation',id:hInv,values:{finding:'x'}},C.cookie),403,'field worker cannot touch investigations by guessed id');
 await json(await hPost({action:'reopenInvestigation',id:hInv,reason:'Guess'},B.cookie),404,'other tenant cannot reach an investigation');
 // Forms seam: an authorised form submission can source a corrective action (project derived).
 const hFormAct=(await json(await hPost({action:'addAction',sourceType:'form_submission',sourceId:fSubA,actionText:'Fix hazard found in prestart',ownerUserId:R.user.id,dueDate:'2099-01-01'}),201,'action from a form submission')).id;
 const [[hFormRow]]=await db.execute('SELECT project_id,source_type FROM hseq_actions WHERE organisation_id=? AND id=?',[memberA.organisation_id,hFormAct]);assert.equal(hFormRow.project_id,pA);assert.equal(hFormRow.source_type,'form_submission');
 await json(await hPost({action:'addAction',sourceType:'form_submission',sourceId:fSubB,actionText:'Bravo form',ownerUserId:R.user.id}),404,'unrelated project submission refused');
 await json(await hPost({action:'addAction',sourceType:'form_submission',sourceId:fSubA,actionText:'Cross tenant',ownerUserId:B.user.id},B.cookie),404,'other tenant submission refused');
 const [[hFormUnchanged]]=await db.execute('SELECT responses_json FROM form_submissions WHERE organisation_id=? AND id=?',[memberA.organisation_id,fSubA]);assert.equal(hFormUnchanged.responses_json,fRowAfter.responses_json,'form evidence untouched');
 // Ownership: every new corrective action has a real organisation user owner, whichever path creates it.
 const hInc3=(await json(await reg('incidents',C.cookie).create(pA,{incident_type:'near miss',occurred_at:`${today}T12:00`,description:'Unsecured load on ute'}),201)).record;
 await json(await reg('actions',A.cookie).create(pA,{source_type:'incident',source_id:hInc3.id,action:'Ownerless'}),400,'generic create without an owner refused');
 await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hInc3.id,actionText:'Ownerless chain'}),400,'chain create without an owner still refused');
 await json(await reg('actions',A.cookie).create(pA,{source_type:'incident',source_id:hInc3.id,action:'Foreign owner',owner_user_id:B.user.id}),400,'owner from another organisation refused');
 const eGeneric=(await json(await reg('actions',A.cookie).create(pA,{source_type:'incident',source_id:hInc3.id,action:'Load restraint toolbox',owner_user_id:S.user.id,due_date:'2099-03-01'}),201,'generic create with a real owner')).record;
 assert.equal(eGeneric.owner_user_id,S.user.id);assert(eGeneric.owner_name,'owner name snapshot populated');assert.equal(eGeneric.project_id,pA);
 await json(await call('/api/registers/actions','PATCH',{id:eGeneric.id,revision:eGeneric.revision,values:{owner_user_id:null}},A.cookie),400,'an owned action cannot have its owner cleared');
 await json(await reg('actions',A.cookie).create(pA,{source_type:'incident',source_id:hInc3.id,action:'Evidence on create',owner_user_id:S.user.id,completion_document_id:fOrdinary.id}),400,'evidence is attached after the action exists');
 // Evidence integrity: completion and verification evidence must be current 'action' documents for that exact action.
 const eA=(await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hInc3.id,actionText:'Fit load restraint',ownerUserId:R.user.id,dueDate:'2099-03-01'}),201)).id;
 const eB=(await json(await hPost({action:'addAction',sourceType:'incident',sourceId:hInc3.id,actionText:'Audit utes',ownerUserId:R.user.id,dueDate:'2099-03-01'}),201)).id;
 const eRev=async id=>Number((await db.execute('SELECT revision FROM hseq_actions WHERE organisation_id=? AND id=?',[memberA.organisation_id,id]))[0][0].revision);
 const setEvidence=async(id,docId,cookie=R.cookie)=>call('/api/registers/actions','PATCH',{id,revision:await eRev(id),values:{completion_document_id:docId}},cookie);
 const eDocA=(await json(await upload(R.cookie,{contextType:'action',contextId:eA,title:'Restraint photo'}),201,'upload evidence against action A')).document;
 assert.equal(eDocA.projectId,pA,'evidence project comes from the action');
 const eDocB=(await json(await upload(R.cookie,{contextType:'action',contextId:eB,title:'Audit sheet'}),201)).document;
 await json(await upload(R.cookie,{contextType:'action',contextId:eA,projectId:pB,title:'Wrong project'}),400,'evidence cannot claim another project');
 await json(await upload(R.cookie,{contextType:'action',contextId:hBravoAct,title:'Bravo evidence'}),404,'PE cannot upload evidence to an unassigned project action');
 await json(await upload(R.cookie,{contextType:'action',contextId:'no-such-action',title:'Ghost'}),404,'evidence needs a real action');
 const eDocBravo=(await json(await upload(A.cookie,{contextType:'action',contextId:hBravoAct,title:'Bravo evidence'}),201)).document;
 const eOrgDoc=(await json(await upload(A.cookie,{contextType:'organisation',title:'Company policy'}),201)).document;
 const eOtherOrg=(await json(await upload(B.cookie,{contextType:'organisation',title:'Other org policy'}),201)).document;
 await json(await setEvidence(eA,eDocA.id),200,'action A uses its own evidence');
 await json(await setEvidence(eB,eDocA.id),400,'action B cannot use action A evidence');
 await json(await setEvidence(eA,eDocBravo.id,A.cookie),400,'Alpha action cannot use Bravo evidence');
 await json(await setEvidence(eB,eOrgDoc.id,A.cookie),400,'unrelated organisation document refused');
 await json(await setEvidence(eB,fOrdinary.id,A.cookie),400,'unrelated project document refused');
 await json(await setEvidence(eB,fPhotoR.id,A.cookie),400,'controlled Forms evidence refused');
 await json(await setEvidence(eB,eOtherOrg.id,A.cookie),400,'other-tenant document refused');
 await json(await complete(eA,R.cookie,'Restraint fitted'),200);
 assert.equal((await call('/api/documents?id='+eDocA.id,'GET',undefined,R.cookie)).status,200,'completion evidence available after completion');
 await json(await hPost({action:'reviewAction',id:eA,outcome:'rejected',note:'Photo does not show the tie-down points'},A.cookie),200,'reject reviewed completion');
 const [[eRej]]=await db.execute("SELECT completion_document_id,completion_notes FROM hseq_action_reviews WHERE organisation_id=? AND action_id=? AND outcome='rejected'",[memberA.organisation_id,eA]);
 assert.equal(eRej.completion_document_id,eDocA.id,'rejection keeps the completion evidence snapshot');assert.equal(eRej.completion_notes,'Restraint fitted');
 await json(await complete(eA,R.cookie,'Restraint fitted; tie-down points shown'),200);
 const eVerDoc=(await json(await upload(A.cookie,{contextType:'action',contextId:eA,title:'Verification inspection'}),201)).document;
 await json(await hPost({action:'reviewAction',id:eA,outcome:'accepted',note:'Inspected',documentId:eDocB.id},A.cookie),400,'verification cannot use another action evidence');
 await json(await hPost({action:'reviewAction',id:eA,outcome:'accepted',note:'Inspected',documentId:eDocBravo.id},A.cookie),400,'verification cannot use another project evidence');
 await json(await hPost({action:'reviewAction',id:eA,outcome:'accepted',note:'Inspected',documentId:eOrgDoc.id},A.cookie),400,'verification cannot use an unrelated organisation document');
 await json(await hPost({action:'reviewAction',id:eA,outcome:'accepted',note:'Inspected',documentId:fPhotoR.id},A.cookie),400,'verification cannot use controlled Forms evidence');
 await json(await hPost({action:'reviewAction',id:eA,outcome:'accepted',note:'Inspected on site',documentId:eVerDoc.id},A.cookie),200,'verification with its own evidence');
 const [[eAcc]]=await db.execute("SELECT r.document_id,a.verification_document_id,a.completion_document_id FROM hseq_action_reviews r JOIN hseq_actions a ON a.id=r.action_id WHERE r.organisation_id=? AND r.action_id=? AND r.outcome='accepted'",[memberA.organisation_id,eA]);
 assert.equal(eAcc.document_id,eVerDoc.id,'verification evidence kept in review history');assert.equal(eAcc.verification_document_id,eVerDoc.id);assert.equal(eAcc.completion_document_id,eDocA.id,'verification never rewrites completion evidence');
 // Legacy rows keep reading and closing safely.
 const hLegacyAct=crypto.randomUUID(),hLegacyNcr=crypto.randomUUID(),hNow=new Date().toISOString();
 await db.execute("INSERT INTO hseq_actions (id,organisation_id,project_id,source_type,source_id,action,owner_name,status,revision,created_at,updated_at) VALUES (?,?,?,'other','LEGACY-7','Legacy action','Pat Legacy','open',1,?,?)",[hLegacyAct,memberA.organisation_id,pA,hNow,hNow]);
 await db.execute("INSERT INTO hseq_ncrs (id,organisation_id,project_id,reference,issue,cause,corrective_action,verification,status,revision,created_at,updated_at) VALUES (?,?,?,'NCR-L1','Legacy NCR','Legacy cause','Legacy corrective action text','Legacy verification','verification',1,?,?)",[hLegacyNcr,memberA.organisation_id,pA,hNow,hNow]);
 assert((await json(await reg('actions',R.cookie).list('?parentId='+pA),200)).records.some(r=>r.id===hLegacyAct&&r.owner_name==='Pat Legacy'),'legacy action reads');
 await json(await call('/api/registers/actions','PATCH',{id:hLegacyAct,revision:1,values:{due_date:'2099-06-30'}},A.cookie),200,'legacy action edits without touching its source');
 await json(await call('/api/registers/actions','PATCH',{id:hLegacyAct,revision:2,values:{owner_user_id:S.user.id}},A.cookie),200,'legacy ownerless action can be given a real owner');
 const [[hLegacyOwned]]=await db.execute('SELECT owner_user_id,owner_name FROM hseq_actions WHERE organisation_id=? AND id=?',[memberA.organisation_id,hLegacyAct]);assert.equal(hLegacyOwned.owner_user_id,S.user.id);assert.notEqual(hLegacyOwned.owner_name,'Pat Legacy','owner snapshot follows the real owner');
 const hLegacyEvid=crypto.randomUUID();
 await db.execute("INSERT INTO hseq_actions (id,organisation_id,project_id,source_type,action,owner_name,status,completion_notes,completion_document_id,completed_at,revision,created_at,updated_at) VALUES (?,?,?,'other','Legacy evidence action','Pat Legacy','complete','Done long ago',?,?,1,?,?)",[hLegacyEvid,memberA.organisation_id,pA,fOrdinary.id,hNow,hNow,hNow]);
 assert((await json(await reg('actions',R.cookie).list('?parentId='+pA),200)).records.some(r=>r.id===hLegacyEvid&&r.completion_document_id===fOrdinary.id),'legacy evidence reference still reads');
 assert.equal((await json(await hChain('ncr',hLegacyNcr),200)).closure.blockers.length,0,'legacy NCR with cause, action text and verification is closable');
 await json(await hPost({action:'close',sourceType:'ncr',sourceId:hLegacyNcr},A.cookie),200,'legacy NCR closes');
 // Audit trail.
 const [hAud]=await db.execute('SELECT event_type,after_state FROM audit_log WHERE organisation_id=? AND entity_id IN (?,?,?,?)',[memberA.organisation_id,hInv,hA2,hInc.id,hNcr.id]);const hEv=new Set(hAud.map(r=>r.event_type));
 for(const e of ['hseq_investigation.started','hseq_investigation.updated','hseq_investigation.completed','hseq_investigation.reopened','corrective_action.created','corrective_action.rejected','corrective_action.verified','actions.complete','incident.closed','ncr.closed'])assert(hEv.has(e),'audit: '+e);
 const hRej=hAud.find(r=>r.event_type==='corrective_action.rejected');const hRejAfter=typeof hRej.after_state==='string'?JSON.parse(hRej.after_state):hRej.after_state;assert.equal(hRejAfter.completedBy,S.user.id);assert.equal(hRejAfter.reviewerUserId,A.user.id,'verification events name completer and verifier');
 console.log('PASS 8B HSEQ chain: field-reported incident → gated investigation (explicit root-cause conclusion, controlled reopen) → multiple owned actions with derived project → server-stamped completion → independent verification (self-verify and non-verifier refused) → rejection keeps history → closure gates for incidents (rationale when no chain) and NCRs (all actions verified, final verification), dedicated closure/verify actions, Alpha/Bravo scope, tenant and nonexistent sources refused, forms seam, legacy rows, My Work verification queue, audit; action evidence bound to the exact action (other action/project/org/Forms/tenant documents refused, snapshots kept) and a real owner on every new action');

 // ---------------------------------------------------------------- Scenario 8C: prestart → defect → safety hold → repair → verification → return to service
 step='8C form defects';
 await as('project_engineer');
 // Every deliberate defect carries its own request id; a retry re-sends the same one.
 const dPost=(b,cookie=C.cookie)=>call('/api/forms/defects','POST',{clientRequestId:crypto.randomUUID(),...b},cookie);
 const dList=(id,cookie=C.cookie)=>call('/api/forms/defects?submissionId='+encodeURIComponent(id),'GET',undefined,cookie);
 const dPlant=await json(await workshop({action:'asset',name:'Prestart roller',number:'PR-08',category:'Roller',registration:'PR08'}),200,'workshop asset');
 const dOther=await json(await workshop({action:'asset',name:'Unrelated truck',number:'TR-09',category:'Truck',registration:'TR09'}),200);
 // The operator completes a prestart on their assigned shift, recording the roller.
 const dSub=(await json(await fSubmit({plant_safe:false,describe_defect:'Reverse alarm not sounding',rig:dPlant.id,tyres_ok:true,signed:{name:'Casey Field',confirmed:true}},C.cookie,'shift',shiftA),201,'field prestart on the assigned shift')).id;
 const [[dSubBefore]]=await db.execute('SELECT responses_json FROM form_submissions WHERE organisation_id=? AND id=?',[memberA.organisation_id,dSub]);
 let dView=await json(await dList(dSub),200);assert.deepEqual(dView.defects,[]);assert(dView.assets.some(a=>a.id===dPlant.id),'plant recorded on the form is offered');
 // Validation: severity, answer and plant must be real and on this evidence.
 await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'plant_safe',title:'Reverse alarm',note:'No alarm'}),400,'severity required');
 await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'nope',title:'Reverse alarm',severity:'critical',note:'No alarm'}),400,'answer must be on the form');
 await json(await dPost({submissionId:dSub,assetId:dOther.id,fieldId:'plant_safe',title:'Wrong plant',severity:'critical',note:'x'}),400,'plant not on the form refused');
 await json(await dPost({submissionId:dSub,assetId:fPlantB,fieldId:'plant_safe',title:'Other org plant',severity:'critical',note:'x'}),400,'other-tenant plant refused');
 // Critical defect → Workshop work order + immediate safety hold.
 const dDef=await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'plant_safe',title:'Reverse alarm not sounding',severity:'critical',note:'Found at prestart; roller parked'}),201,'operator raises a critical defect from the prestart');
 assert.equal(dDef.safetyHold,true);
 const [[dPlantRow]]=await db.execute('SELECT status,safety_hold FROM plant WHERE organisation_id=? AND id=?',[memberA.organisation_id,dPlant.id]);assert.equal(Number(dPlantRow.safety_hold),1);assert.equal(dPlantRow.status,'Out of service','critical defect takes the plant out of service');
 const [[dOrder]]=await db.execute('SELECT status,severity,source_type,source_id,source_field,source_amendment_sequence,source_context_type,source_context_id,source_project_id,created_by FROM workshop_orders WHERE organisation_id=? AND id=?',[memberA.organisation_id,dDef.id]);
 assert.deepEqual({...dOrder},{status:'open',severity:'critical',source_type:'form_submission',source_id:dSub,source_field:'plant_safe',source_amendment_sequence:0,source_context_type:'shift',source_context_id:shiftA,source_project_id:pA,created_by:C.user.id},'work order linked to the form answer, exact evidence state and context');
 await json(await call('/api/forms/defects','POST',{submissionId:dSub,assetId:dPlant.id,fieldId:'plant_safe',title:'No request id',severity:'minor',note:'x'},C.cookie),400,'a request id is required');
 const dHeld=await json(await call('/api/delivery','POST',{kind:'shifts',check:true,record:{id:'',name:'Hold check',status:'Planned',metadata:{date:'2026-12-01',start:'07:00',finish:'17:00',assignments:[{category:'plant',resourceId:dPlant.id}]}},candidates:[]},A.cookie),200);
 assert(dHeld.conflicts.some(c=>c.code==='RESOURCE_UNAVAILABLE'),'held plant cannot be scheduled');
 // Scope: the submission's own access rules govern the seam.
 assert((await json(await dList(dSub,R.cookie),200)).defects.some(d=>d.id===dDef.id),'engineer on the project sees shift defects');
 await json(await dPost({submissionId:fSubA,assetId:fPlantA,fieldId:'plant_safe',title:'x',severity:'minor',note:'x'}),404,'field worker cannot raise from project-level evidence');
 await json(await dList(fSubA),404,'field worker cannot read project-level evidence defects');
 await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'tyres_ok',title:'x',severity:'minor',note:'x'},B.cookie),404,'other tenant refused');
 await json(await call('/api/platform/entitlements','PUT',{module:'workshop',status:'disabled'},A.cookie),200);
 await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'tyres_ok',title:'Tyre wear',severity:'minor',note:'x'}),409,'without Workshop the seam does not fire');
 assert.equal((await json(await fGet('op=submission&id='+dSub,C.cookie),200)).submission.id,dSub,'the prestart is still stored without Workshop');
 await json(await call('/api/platform/entitlements','PUT',{module:'workshop',status:'active'},A.cookie),200);
 await json(await workshop({action:'defect',assetId:dPlant.id,title:'x',severity:'minor',note:'x'},C.cookie),403,'field workers still cannot use Workshop directly');
 // Repair → independent verification → return to service.
 await json(await workshop({action:'repair',id:dDef.id,revision:1,note:'Replaced reverse alarm',labourHours:1,parts:'Reverse alarm'}),200,'workshop records the repair');
 await json(await workshop({action:'verify',id:dDef.id,revision:2,note:'Self check',accepted:true}),403,'repairer cannot verify');
 await json(await workshop({action:'verify',id:dDef.id,revision:2,note:'Alarm audible at 10 m',accepted:false},W.cookie),200,'verifier rejects');
 await json(await workshop({action:'repair',id:dDef.id,revision:3,note:'Rewired alarm',labourHours:1,parts:''}),200);
 assert.equal(Number((await db.execute('SELECT safety_hold FROM plant WHERE organisation_id=? AND id=?',[memberA.organisation_id,dPlant.id]))[0][0].safety_hold),1,'hold stays until verified');
 await json(await workshop({action:'verify',id:dDef.id,revision:4,note:'Alarm verified; returned to service',accepted:true},W.cookie),200,'independent verification');
 const [[dBack]]=await db.execute('SELECT status,safety_hold FROM plant WHERE organisation_id=? AND id=?',[memberA.organisation_id,dPlant.id]);assert.equal(Number(dBack.safety_hold),0);assert.equal(dBack.status,'Available','returned to service');
 dView=await json(await dList(dSub),200);assert.equal(dView.defects[0].status,'closed');assert.equal(dView.defects[0].safetyHold,false);
 // A minor defect raises no hold; the form evidence is never modified.
 const dMinor=await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'tyres_ok',title:'Tyre wear',severity:'minor',note:'Monitor'}),201);assert.equal(dMinor.safetyHold,false);
 assert.equal(Number((await db.execute('SELECT safety_hold FROM plant WHERE organisation_id=? AND id=?',[memberA.organisation_id,dPlant.id]))[0][0].safety_hold),0,'minor defect keeps plant available');
 const [[dSubAfter]]=await db.execute('SELECT responses_json FROM form_submissions WHERE organisation_id=? AND id=?',[memberA.organisation_id,dSub]);assert.equal(dSubAfter.responses_json,dSubBefore.responses_json,'prestart evidence untouched');
 const [dAud]=await db.execute('SELECT event_type FROM audit_log WHERE organisation_id=? AND entity_id IN (?,?)',[memberA.organisation_id,dSub,dDef.id]);const dEv=new Set(dAud.map(r=>r.event_type));
 for(const e of ['form_defect.raised','workshop.defect','workshop.repair','workshop.verify'])assert(dEv.has(e),'audit: '+e);
 const [[dEvent]]=await db.execute("SELECT COUNT(*) AS n FROM domain_events WHERE organisation_id=? AND entity_id=? AND event_type='workshop.defect.reported'",[memberA.organisation_id,dDef.id]);assert(Number(dEvent.n)>=1,'domain event published');
 // ---- 8C corrections: exact evidence provenance, narrow capability, idempotency vs source linkage, traceability
 const orderCount=async(sub)=>Number((await db.execute("SELECT COUNT(*) AS n FROM workshop_orders WHERE organisation_id=? AND source_id=?",[memberA.organisation_id,sub]))[0][0].n);
 // Legitimate multiple defects from one answer, and retry replay.
 const dRid=crypto.randomUUID(),dMulti={submissionId:dSub,assetId:dPlant.id,fieldId:'plant_safe',title:'Rear beacon failed',severity:'minor',note:'Beacon dead',clientRequestId:dRid};
 const before=await orderCount(dSub);
 const mA=await json(await call('/api/forms/defects','POST',dMulti,C.cookie),201,'defect A from plant_safe');
 const mAretry=await json(await call('/api/forms/defects','POST',dMulti,C.cookie),201,'retry of the same request replays');
 assert.equal(mAretry.id,mA.id,'retry returns the original work order');assert.equal(await orderCount(dSub),before+1,'retry created no second order');
 await json(await call('/api/forms/defects','POST',{...dMulti,title:'Different content, same request id'},C.cookie),409,'a request id cannot be reused for different content');
 const mB=await json(await dPost({...dMulti,clientRequestId:crypto.randomUUID(),title:'Left work light failed',note:'Light dead'}),201,'deliberate defect B from the same answer');
 assert.notEqual(mB.id,mA.id);assert.equal(await orderCount(dSub),before+2,'both defects exist for one answer');
 // Amendment provenance: the order keeps the evidence state it was raised on.
 const eff0=(await json(await fGet('op=submission&id='+dSub,A.cookie),200)).effective;
 await json(await fPost({action:'amend',id:dSub,responses:{...eff0,describe_defect:'Reverse alarm and beacon not working'},reason:'Add beacon'},A.cookie),201,'dSub correction 1');
 const p1=await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'describe_defect',title:'Beacon (after correction 1)',severity:'minor',note:'x'}),201);
 assert.equal(p1.amendmentSequence,1);
 const eff1=(await json(await fGet('op=submission&id='+dSub,A.cookie),200)).effective;
 await json(await fPost({action:'amend',id:dSub,responses:{...eff1,describe_defect:'Reverse alarm, beacon and horn'},reason:'Add horn'},A.cookie),201,'dSub correction 2');
 const seqOf=async id=>Number((await db.execute('SELECT source_amendment_sequence AS n FROM workshop_orders WHERE organisation_id=? AND id=?',[memberA.organisation_id,id]))[0][0].n);
 assert.equal(await seqOf(p1.id),1,'later correction does not alter the order provenance');assert.equal(await seqOf(dDef.id),0,'original-record defect stays at sequence 0');
 const p2=await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'describe_defect',title:'Horn (after correction 2)',severity:'minor',note:'x'}),201);assert.equal(p2.amendmentSequence,2);
 // Traceability: Workshop reads the source through the Forms helper, no answers copied.
 const src=(await json(await call('/api/forms/defects?workOrderId='+p1.id,'GET',undefined,A.cookie),200)).source;
 assert.equal(src.restricted,false);assert.equal(src.formName,'Plant prestart');assert.equal(src.submissionId,dSub);assert.equal(src.contextType,'shift');assert.equal(src.evidenceState,'Correction 1');assert.equal(src.currentAmendmentSequence,2);assert.equal(src.projectName,'Scope Project Alpha');
 assert(!JSON.stringify(src).includes('Reverse alarm and beacon'),'answers are not copied into the Workshop source view');
 assert.equal((await json(await call('/api/forms/defects?workOrderId='+dDef.id,'GET',undefined,A.cookie),200)).source.evidenceState,'Original submission');
 // Source access follows Forms scope: an engineer outside the project fails closed.
 const bravoRig=(await json(await fSubmit({...fGood,rig:dPlant.id,tyres_ok:true,operator:A.user.id,photos:[fBravoPhoto.id],signed:{name:'Admin',confirmed:true}},A.cookie,'project',pB),201,'Bravo submission recording the plant')).id;
 const bravoDef=await json(await dPost({submissionId:bravoRig,assetId:dPlant.id,fieldId:'plant_safe',title:'Bravo-sourced minor',severity:'minor',note:'x'},A.cookie),201);
 assert.equal((await json(await call('/api/forms/defects?workOrderId='+bravoDef.id,'GET',undefined,R.cookie),200)).source.restricted,true,'out-of-project engineer sees no form content');
 assert.equal(JSON.stringify(await (await call('/api/forms/defects?workOrderId='+bravoDef.id,'GET',undefined,R.cookie)).json()).includes('Bravo'),false);
 await json(await dPost({submissionId:bravoRig,assetId:dPlant.id,fieldId:'plant_safe',title:'x',severity:'minor',note:'x'},R.cookie),404,'engineer outside the project cannot raise from it');
 await json(await call('/api/forms/defects?workOrderId=nope','GET',undefined,A.cookie),404,'unknown order');
 // Capability: the field worker can report but has no repair / verify authority; a role without the capability cannot use the seam.
 await json(await workshop({action:'repair',id:dDef.id,revision:9,note:'x',labourHours:1,parts:''},C.cookie),403,'reporter cannot record a repair');
 await json(await workshop({action:'verify',id:dDef.id,revision:9,note:'x',accepted:true},C.cookie),403,'reporter cannot verify');
 await as('read_only');
 await json(await dList(dSub),200,'read-only role can still view the defects');
 await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'tyres_ok',title:'x',severity:'minor',note:'x'},R.cookie),403,'no workshop.defect.report → seam refused');
 await as('project_engineer');
 // Workshop read-only: readable, no new defects, and the UI capability flag is off.
 await json(await call('/api/platform/entitlements','PUT',{module:'workshop',status:'read_only'},A.cookie),200);
 assert.equal((await json(await dList(dSub),200)).canRaise,false,'Forms panel is told not to offer Raise defect');
 assert((await json(await dList(dSub),200)).defects.length>=5,'existing defects stay readable');
 await json(await dPost({submissionId:dSub,assetId:dPlant.id,fieldId:'tyres_ok',title:'x',severity:'minor',note:'x'}),409,'read-only Workshop refuses new defects');
 await json(await call('/api/workshop','GET',undefined,A.cookie),200,'Workshop orders remain readable');
 await json(await call('/api/platform/entitlements','PUT',{module:'workshop',status:'active'},A.cookie),200);
 assert.equal((await json(await dList(dSub),200)).canRaise,true);
 // Two critical defects on one asset: the hold clears only after BOTH are independently verified.
 const cPlant=await json(await workshop({action:'asset',name:'Double-hold grader',number:'GR-10',category:'Grader',registration:'GR10'}),200);
 const cSub=(await json(await fSubmit({plant_safe:false,describe_defect:'Two faults',rig:cPlant.id,tyres_ok:false,signed:{name:'Casey Field',confirmed:true}},C.cookie,'shift',shiftA),201)).id;
 const cA=await json(await dPost({submissionId:cSub,assetId:cPlant.id,fieldId:'plant_safe',title:'Brakes failed',severity:'critical',note:'A'}),201);
 const cB=await json(await dPost({submissionId:cSub,assetId:cPlant.id,fieldId:'tyres_ok',title:'Steering failed',severity:'critical',note:'B'}),201);
 const cState=async()=>{const [[r]]=await db.execute('SELECT status,safety_hold FROM plant WHERE organisation_id=? AND id=?',[memberA.organisation_id,cPlant.id]);return {status:r.status,hold:Number(r.safety_hold)};};
 assert.deepEqual(await cState(),{status:'Out of service',hold:1});
 await json(await workshop({action:'repair',id:cA.id,revision:1,note:'Brakes rebuilt',labourHours:2,parts:''}),200);
 await json(await workshop({action:'verify',id:cA.id,revision:2,note:'Brakes tested',accepted:true},W.cookie),200);
 assert.deepEqual(await cState(),{status:'Out of service',hold:1},'still held: critical defect B is open');
 const cHeld=await json(await call('/api/delivery','POST',{kind:'shifts',check:true,record:{id:'',name:'Hold check 2',status:'Planned',metadata:{date:'2026-12-02',start:'07:00',finish:'17:00',assignments:[{category:'plant',resourceId:cPlant.id}]}},candidates:[]},A.cookie),200);
 assert(cHeld.conflicts.some(c=>c.code==='RESOURCE_UNAVAILABLE'),'still cannot be scheduled after only A is verified');
 await json(await workshop({action:'repair',id:cB.id,revision:1,note:'Steering rebuilt',labourHours:2,parts:''}),200);
 await json(await workshop({action:'verify',id:cB.id,revision:2,note:'Steering tested',accepted:true},W.cookie),200);
 assert.deepEqual(await cState(),{status:'Available',hold:0},'returned to service only after both are verified');
 console.log('PASS 8C form defects: field prestart on assigned shift → critical defect linked to the answer → safety hold blocks scheduling → repair → self-verify refused → rejection → independent verification → returned to service; request-id idempotency with several defects per answer, exact amendment provenance, narrow workshop.defect.report capability, Forms-scoped source traceability, read-only Workshop, two critical defects (hold clears only after both), only plant on the form, submission scope, tenant isolation, Workshop entitlement seam, minor defects keep plant available, evidence untouched, audit and domain event');

 { // scoped: the 9A scenario reuses short names
 // ---------------------------------------------------------------- Scenario 9A: Document Engine foundation (managed documents)
 step='9A managed documents';
 await as('project_engineer');
 const mdForm=(fields,name='doc.pdf',content='%PDF-1.4 fixture')=>{const f=new FormData();for(const [k,v] of Object.entries(fields))if(v!==undefined)f.set(k,v);f.set('file',new File([content],name,{type:'application/pdf'}));return f;};
 const mdCreate=(fields,cookie=A.cookie,name,content)=>call('/api/managed-documents','POST',mdForm(fields,name,content),cookie);
 const mdRevise=(fields,cookie=A.cookie,name,content)=>call('/api/managed-documents/versions','POST',mdForm(fields,name,content),cookie);
 const mdGet=(id,cookie=A.cookie)=>call('/api/managed-documents?id='+encodeURIComponent(id),'GET',undefined,cookie);
 const mdList=(q,cookie=A.cookie)=>call('/api/managed-documents?'+q,'GET',undefined,cookie);
 const bytesOf=async r=>Buffer.from(await r.arrayBuffer());
 const hash=b=>sha('sha256').update(b).digest('hex');
 const org9=memberA.organisation_id;
 // Standalone company document: title + file, no project.
 const c1='%PDF-1.4 layout revision A',c2='%PDF-1.4 layout revision B — changed',c3='%PDF-1.4 layout IFC',c4='%PDF-1.4 layout unlabelled';
 const md=await json(await mdCreate({title:'CIV-102 Pavement Layout',revisionLabel:'A',documentNumber:'CIV-102',documentType:'Drawing',discipline:'Civil',tags:'pavement, Layout ,pavement'},A.cookie,'layout-a.pdf',c1),201,'create managed document');
 assert.equal(md.document.document.current.versionNumber,1);assert.equal(md.document.document.projectId,null,'no project required');assert.deepEqual(md.document.document.tags,['pavement','Layout'],'tags normalised and de-duplicated');
 const [[mRow]]=await db.execute('SELECT * FROM managed_documents WHERE organisation_id=? AND id=?',[org9,md.id]);
 const [v1Row]=(await db.execute('SELECT * FROM document_versions WHERE organisation_id=? AND managed_document_id=?',[org9,md.id]))[0];
 const [[f1Row]]=await db.execute('SELECT * FROM documents WHERE organisation_id=? AND id=?',[org9,v1Row.file_document_id]);
 assert.equal(mRow.current_version_id,v1Row.id);assert.equal(v1Row.version_number,1);assert.equal(v1Row.sha256,hash(Buffer.from(c1)));assert.equal(f1Row.sha256,v1Row.sha256,'physical file hash retained on the version');assert.equal(mRow.context_type,'organisation');assert.equal(Number(f1Row.version),1);assert.equal(f1Row.status,'current');
 // Revision B: new physical file + version; v1 and its file untouched and still downloadable exactly.
 await json(await mdRevise({id:md.id,revisionLabel:'A2',expectedVersion:'9'},A.cookie,'layout-b.pdf',c2),409,'stale expectedVersion is refused');
 await json(await mdRevise({id:md.id,revisionLabel:'<b>x</b>'},A.cookie,'layout-b.pdf',c2),400,'unsafe revision label refused');
 const md2=await json(await mdRevise({id:md.id,revisionLabel:'B',issueDate:'2026-09-01',changeNote:'Kerb line moved',expectedVersion:'1'},A.cookie,'layout-b.pdf',c2),201,'upload revision B');
 assert.equal(md2.versionNumber,2);assert.notEqual(md2.fileDocumentId,v1Row.file_document_id,'new physical file');
 const [[f1After]]=await db.execute('SELECT * FROM documents WHERE organisation_id=? AND id=?',[org9,v1Row.file_document_id]);
 assert.equal(f1After.sha256,f1Row.sha256);assert.equal(f1After.storage_key,f1Row.storage_key);assert.equal(f1After.status,'superseded','legacy mirror follows the managed layer');assert.equal(f1After.file_name,'layout-a.pdf');
 const [[mAfter]]=await db.execute('SELECT current_version_id FROM managed_documents WHERE organisation_id=? AND id=?',[org9,md.id]);assert.equal(mAfter.current_version_id,md2.versionId);
 const [[v1After]]=await db.execute('SELECT * FROM document_versions WHERE organisation_id=? AND id=?',[org9,v1Row.id]);assert.deepEqual({...v1After},{...v1Row},'historical version row is never rewritten');
 await mdRevise({id:md.id,revisionLabel:'IFC'},A.cookie,'layout-c.pdf',c3).then(r=>json(r,201,'revision IFC'));
 const md4=await json(await mdRevise({id:md.id},A.cookie,'layout-d.pdf',c4),201,'revision without a label');
 assert.equal(md4.versionNumber,4,'system controlled sequence');
 const detail=(await json(await mdGet(md.id),200)).versions;
 assert.deepEqual(detail.map(v=>[v.versionNumber,v.revisionLabel,v.current]),[[4,null,true],[3,'IFC',false],[2,'B',false],[1,'A',false]]);
 // Exact-version download and hashes.
 const dl=async(v,cookie=A.cookie)=>call(v.url,'GET',undefined,cookie);
 for(const [v,content] of [[detail[3],c1],[detail[2],c2],[detail[1],c3],[detail[0],c4]]){const b=await bytesOf(await dl(v));assert.equal(b.toString(),content);assert.equal(hash(b),v.sha256,'downloaded bytes match the recorded hash');}
 assert.equal((await bytesOf(await call(`/api/managed-documents?id=${md.id}&download=1`,'GET',undefined,A.cookie))).toString(),c4,'no version id → current');
 assert.equal((await bytesOf(await call(`/api/documents?id=${v1Row.file_document_id}`,'GET',undefined,A.cookie))).toString(),c1,'raw physical id still downloads');
 await json(await call('/api/documents','POST',(()=>{const f=new FormData();f.set('file',new File(['x'],'x.pdf',{type:'application/pdf'}));f.set('contextType','organisation');f.set('supersedesId',md4.fileDocumentId);return f;})(),A.cookie),409,'raw supersede cannot bypass the managed revision authority');
 // Metadata: identity only; versions untouched.
 const meta0=(await json(await mdGet(md.id),200)).document;
 const [vBefore]=await db.execute('SELECT * FROM document_versions WHERE organisation_id=? AND managed_document_id=? ORDER BY version_number',[org9,md.id]);
 const patched=await json(await call('/api/managed-documents','PATCH',{id:md.id,revision:meta0.revision,title:'CIV-102 Pavement Layout (issued)',documentType:'Drawing',discipline:'Pavements',tags:['Layout','IFC']},A.cookie),200);
 assert.equal(patched.document.title,'CIV-102 Pavement Layout (issued)');assert.equal(patched.document.discipline,'Pavements');
 await json(await call('/api/managed-documents','PATCH',{id:md.id,revision:meta0.revision,title:'stale'},A.cookie),409,'stale metadata edit refused');
 const [vAfter]=await db.execute('SELECT * FROM document_versions WHERE organisation_id=? AND managed_document_id=? ORDER BY version_number',[org9,md.id]);assert.deepEqual(vAfter,vBefore,'metadata edit does not touch version records');
 // Search: one logical result, never one per revision.
 for(const q of ['CIV-102','pavements','Drawing','ifc','layout-d.pdf'])assert((await json(await mdList('q='+encodeURIComponent(q)),200)).documents.some(d=>d.id===md.id),'register search: '+q);
 assert(!(await json(await mdList('q=layout-a.pdf'),200)).documents.length,'historical file names are not indexed as separate documents');
 const gs=async(q,cookie=A.cookie)=>(await json(await call('/api/search?q='+encodeURIComponent(q),'GET',undefined,cookie),200)).results;
 for(const q of ['CIV-102','Pavements','Drawing','layout-d.pdf'])assert.equal((await gs(q)).filter(r=>r.id===md.id&&r.type==='Managed document').length,1,'global search one result: '+q);
 assert(!(await gs('layout')).some(r=>r.type==='Document'&&[v1Row.file_document_id,md2.fileDocumentId,md4.fileDocumentId].includes(r.id)),'managed physical files are not duplicate legacy results');
 assert(!(await gs('layout-a.pdf')).some(r=>r.id===md.id),'a superseded file name does not surface the document twice');
 // Legacy unmanaged attachment stays searchable and listable.
 const rawLegacy=(await json(await upload(A.cookie,{contextType:'organisation',category:'Quality',title:'Legacy raw handbook zed'},'legacy-zed.pdf'),201)).document;
 assert((await gs('handbook zed')).some(r=>r.id===rawLegacy.id&&r.type==='Document'),'legacy raw document remains globally searchable');
 assert((await json(await call('/api/documents?unmanaged=1&q=handbook%20zed','GET',undefined,A.cookie),200)).documents.some(d=>d.id===rawLegacy.id));
 assert(!(await json(await call('/api/documents?unmanaged=1&q=layout','GET',undefined,A.cookie),200)).documents.some(d=>d.id===md4.fileDocumentId),'managed files are not legacy attachments');
 // Project scope: PE assigned to Alpha only.
 const bTender=null;void bTender;
 const dA=await json(await mdCreate({title:'Alpha drawing set',contextType:'project',contextId:pA,documentType:'Drawing'},A.cookie,'alpha.pdf','%PDF-1.4 alpha'),201,'project managed document');
 const dB=await json(await mdCreate({title:'Bravo drawing set',contextType:'project',contextId:pB,documentType:'Drawing'},A.cookie,'bravo.pdf','%PDF-1.4 bravo'),201);
 assert.equal(dA.document.document.projectId,pA);
 const dBv=(await json(await mdGet(dB.id),200)).versions[0];
 for(const role of ['project_engineer','site_engineer']){
  await as(role);const who=role+': ';
  await json(await mdGet(dA.id,R.cookie),200,who+'own project managed document');
  await json(await mdGet(dB.id,R.cookie),404,who+'guessed managed id of another project');
  assert.equal((await call(dBv.url,'GET',undefined,R.cookie)).status,404,who+'guessed version id of another project');
  assert.equal((await call(`/api/managed-documents?id=${dA.id}&versionId=${dBv.id}&download=1`,'GET',undefined,R.cookie)).status,404,who+'a version id of another document cannot be swapped in');
  assert.equal((await call('/api/documents?id='+dB.fileDocumentId,'GET',undefined,R.cookie)).status,404,who+'guessed physical file id of another project');
  const listed=(await json(await mdList('limit=500',R.cookie),200)).documents.map(d=>d.id);assert(listed.includes(dA.id)&&!listed.includes(dB.id),who+'register is project-scoped');
  assert(!(await gs('Bravo drawing',R.cookie)).some(r=>r.id===dB.id),who+'search excludes other projects');
 }
 await as('site_engineer');
 await json(await mdRevise({id:dA.id},R.cookie,'x.pdf','x'),403,'site engineer has no manage_versions');
 await json(await call('/api/managed-documents','PATCH',{id:dA.id,revision:1,title:'x'},R.cookie),403,'site engineer has no document.edit');
 await as('project_engineer');
 await json(await mdRevise({id:dA.id,revisionLabel:'B'},R.cookie,'alpha-b.pdf','%PDF-1.4 alpha b'),201,'project engineer revises an Alpha document');
 await json(await mdRevise({id:dB.id,revisionLabel:'B'},R.cookie,'bravo-b.pdf','x'),404,'project engineer cannot revise a Bravo document');
 await json(await call('/api/managed-documents','PATCH',{id:dB.id,revision:1,title:'hijack'},R.cookie),404,'project engineer cannot edit a Bravo document');
 await as('project_manager');
 await json(await mdGet(dB.id,R.cookie),200,'org-wide project manager opens Bravo');
 // Links: validated, tenant-safe, never widening access.
 const link=async(id,body,cookie=A.cookie)=>call('/api/managed-documents/links','POST',{id,...body},cookie);
 const lProject=await json(await link(dA.id,{targetType:'project',targetId:pA}),201,'link to a project');
 await json(await link(dA.id,{targetType:'project',targetId:pA}),409,'duplicate link refused');
 await json(await link(dA.id,{targetType:'tender',targetId:tenderId,relationship:'supporting'}),201,'link to a tender');
 await json(await link(dA.id,{targetType:'project',targetId:'no-such-project'}),404,'nonexistent target refused');
 await json(await link(dA.id,{targetType:'docket',targetId:'x'}),400,'unsupported target type refused');
 const bProject=(await json(await call('/api/projects','POST',{name:'Other tenant project'},B.cookie),201)).projectId;
 await json(await link(dA.id,{targetType:'project',targetId:bProject}),404,'cross-tenant target refused');
 await json(await link(dB.id,{targetType:'project',targetId:pA}),201,'a Bravo document may be linked to Alpha');
 await as('project_engineer');
 await json(await mdGet(dB.id,R.cookie),404,'link to an assigned project does NOT open the Bravo document');
 assert(!(await json(await mdList('limit=500',R.cookie),200)).documents.some(d=>d.id===dB.id),'…nor list it');
 await json(await link(dA.id,{targetType:'project',targetId:pB},R.cookie),404,'engineer cannot link to a project outside their scope');
 await json(await link(dB.id,{targetType:'project',targetId:pA},R.cookie),404,'engineer cannot link a Bravo document');
 await json(await call('/api/managed-documents/links?id='+encodeURIComponent((await json(await mdGet(dB.id),200)).links[0].id),'DELETE',undefined,R.cookie),404,'engineer cannot remove a link by guessed id');
 const linkedDetail=await json(await mdGet(dA.id,R.cookie),200);assert.equal(linkedDetail.links.length,1,'engineer sees the project link');assert.equal(linkedDetail.hiddenLinks,1,'the tender link is hidden from a role without tender access');
 await json(await call('/api/managed-documents/links?id='+lProject.id,'DELETE',undefined,A.cookie),200,'unlink');
 // Tenant isolation by known ids.
 await json(await mdGet(md.id,B.cookie),404,'other tenant managed id');
 assert.equal((await call(detail[3].url,'GET',undefined,B.cookie)).status,404,'other tenant version id');
 assert.equal((await call('/api/documents?id='+v1Row.file_document_id,'GET',undefined,B.cookie)).status,404,'other tenant physical file id');
 await json(await link(md.id,{targetType:'project',targetId:pA},B.cookie),404,'other tenant link attempt');
 await json(await mdRevise({id:md.id},B.cookie,'x.pdf','x'),404,'other tenant revision attempt');
 // Field visibility and roles.
 const fieldDoc=await json(await mdCreate({title:'Site induction pack',visibility:'field'},A.cookie,'induction.pdf','%PDF-1.4 induction'),201);
 await json(await mdGet(fieldDoc.id,C.cookie),200,'field worker opens a field-visible managed document');
 await json(await mdGet(md.id,C.cookie),404,'field worker cannot open an office-only managed document');
 assert(!(await json(await mdList('limit=500',C.cookie),200)).documents.some(d=>d.id===md.id),'field register excludes office-only documents');
 assert.equal((await mdCreate({title:'Field attempt'},C.cookie,'f.pdf','x')).status,404,'field worker cannot create managed documents');
 await json(await mdRevise({id:fieldDoc.id},C.cookie,'x.pdf','x'),403,'field worker cannot upload revisions');
 // Tender + commercial contexts and capability-aware access.
 const tDoc=await json(await mdCreate({title:'Tender addendum',contextType:'tender',contextId:tenderId},A.cookie,'addendum.pdf','%PDF-1.4 tender'),201,'tender managed document');
 assert.equal((await json(await mdGet(tDoc.id),200)).document.contextName!==undefined,true);
 await as('scheduler');await json(await mdGet(tDoc.id,R.cookie),404,'scheduler cannot open a tender managed document');
 await as('estimator');await json(await mdGet(tDoc.id,R.cookie),200,'estimator opens a tender managed document');
 await json(await mdCreate({title:'Estimator note',contextType:'tender',contextId:tenderId},R.cookie,'note.pdf','%PDF-1.4 note'),201,'estimator adds a tender document');
 await json(await mdCreate({title:'Not backed',contextType:'tender',contextId:'nope'},A.cookie,'x.pdf','x'),404,'context must be a real record');
 await json(await mdCreate({title:'Forms are controlled',contextType:'form',contextId:'project:'+pA},A.cookie,'x.pdf','x'),400,'controlled Forms context is never a managed document');
 await json(await mdCreate({title:'Field context',contextType:'field'},A.cookie,'x.pdf','x'),400,'evidence contexts are not managed');
 const cDoc=await json(await mdCreate({title:'Claim support pack',contextType:'claim',contextId:claim.claimId},A.cookie,'claim-support.pdf','%PDF-1.4 claim'),201,'commercial-context managed document');
 assert.equal(cDoc.document.document.projectId,projectId,'project derived from the claim');
 await as('project_engineer');await json(await mdGet(cDoc.id,R.cookie),404,'project access alone never exposes a claim artifact');
 await as('accounts');await json(await mdGet(cDoc.id,R.cookie),200,'accounts (commercial.view) opens the claim artifact');
 await json(await call('/api/managed-documents','PATCH',{id:cDoc.id,revision:1,title:'x'},R.cookie),403,'…without document administration rights');
 assert.equal((await mdCreate({title:'Accounts upload'},R.cookie,'x.pdf','x')).status,403,'accounts has no document.upload');
 await as('project_engineer');
 // Archive/restore: never a delete.
 const ar=(await json(await mdGet(tDoc.id),200)).document;
 await json(await call('/api/managed-documents','PATCH',{id:tDoc.id,revision:ar.revision,archived:true},A.cookie),200,'archive');
 assert(!(await json(await mdList('q=addendum'),200)).documents.some(d=>d.id===tDoc.id),'archived documents leave the register');
 assert((await json(await mdList('archived=1'),200)).documents.some(d=>d.id===tDoc.id));assert(!(await gs('Tender addendum')).some(r=>r.id===tDoc.id),'archived documents leave global search');
 await json(await mdRevise({id:tDoc.id},A.cookie,'x.pdf','x'),409,'archived document takes no revision');
 await json(await call('/api/managed-documents','PATCH',{id:tDoc.id,revision:ar.revision+1,archived:false},A.cookie),200,'restore');
 assert.equal(Number((await db.execute('SELECT COUNT(*) n FROM document_versions WHERE organisation_id=? AND managed_document_id=?',[org9,tDoc.id]))[0][0].n),1,'archive keeps every version');
 // Existing raw upload paths and controlled evidence are unchanged.
 const rawProject=(await json(await upload(A.cookie,{contextType:'project',projectId:pA,category:'Drawings',title:'Raw project upload'},'raw-project.pdf'),201,'raw project upload still works')).document;
 assert.equal((await call('/api/documents?id='+rawProject.id,'GET',undefined,A.cookie)).status,200);
 assert(!(await json(await mdList('limit=500'),200)).documents.some(d=>d.current.fileDocumentId===rawProject.id),'raw uploads are not silently managed');
 assert.equal((await call('/api/documents?id='+fPhotoR.id,'GET',undefined,A.cookie)).status,404,'controlled Forms evidence is still not served by the generic route');
 assert(!(await gs('Form evidence')).some(r=>r.id===fPhotoR.id),'controlled Forms evidence is never searchable');
 // Audit trail.
 const [aud]=await db.execute("SELECT event_type,after_state FROM audit_log WHERE organisation_id=? AND entity_type='managed_document' AND entity_id=?",[org9,md.id]);
 const evs=aud.map(r=>r.event_type);
 for(const e of ['managed_document.created','managed_document.version_created','managed_document.updated'])assert(evs.includes(e),'audit: '+e);
 assert.equal(evs.filter(e=>e==='managed_document.version_created').length,4);
 const vEv=aud.filter(r=>r.event_type==='managed_document.version_created').map(r=>JSON.parse(r.after_state)).find(x=>x.versionNumber===2);
 assert.equal(vEv.fileDocumentId,md2.fileDocumentId);assert.equal(vEv.revisionLabel,'B');assert.equal(vEv.sha256,hash(Buffer.from(c2)));assert.equal(vEv.previousVersionId,v1Row.id);
 const evsA=(await db.execute("SELECT event_type FROM audit_log WHERE organisation_id=? AND entity_id IN (?,?)",[org9,dA.id,tDoc.id]))[0].map(r=>r.event_type);
 for(const e of ['managed_document.link_added','managed_document.link_removed','managed_document.archived','managed_document.restored'])assert(evsA.includes(e),'audit: '+e);
 // Service-level: a server-side caller stores GENERATED bytes (no browser upload) — the seam Commercial will use.
 const tsm=(await import('typescript')).default,{createRequire}=await import('node:module'),fsm=await import('node:fs'),pathm=await import('node:path');
 const nodeRequire=createRequire(import.meta.url),modCache={};
 const loadTs=file=>{file=pathm.resolve(file);if(modCache[file])return modCache[file].exports;const m={exports:{}};modCache[file]=m;const code=tsm.transpileModule(fsm.readFileSync(file,'utf8'),{compilerOptions:{module:tsm.ModuleKind.CommonJS,target:tsm.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('@/')?loadTs(n.slice(2)+'.ts'):n.startsWith('.')?loadTs(pathm.resolve(pathm.dirname(file),n)+'.ts'):nodeRequire(n),m,m.exports);return m.exports;};
 const svc=loadTs('lib/platform/managed-documents.ts'),ctx=loadTs('lib/platform/context.ts');
 servicePool=loadTs('lib/platform/database.ts').getPool(); // closed in finally so the process can exit
 const actorOf=(userId,organisationId,role)=>({userId,email:`svc-${role}@example.invalid`,organisationId,role});
 const asAdmin=fn=>ctx.actorContext.run(actorOf(A.user.id,org9,'admin'),fn);
 const genA=Buffer.from('%PDF-1.4 GENERATED proforma issue 1'),genB=Buffer.from('%PDF-1.4 GENERATED proforma issue 2 (amended)');
 const gen=await asAdmin(()=>svc.createManagedDocument({title:'SYNTH-PINV-001 — September Claim',contextType:'claim',contextId:claim.claimId,documentType:'Proforma',source:'generated',generated:true,revisionLabel:'1',content:{fileName:'proforma.pdf',contentType:'application/pdf',bytes:new Uint8Array(genA)}}));
 assert.equal(gen.versionNumber,1);assert.equal(gen.sha256,hash(genA));
 const gen2=await asAdmin(()=>svc.addDocumentVersion(gen.id,{generated:true,revisionLabel:'2',expectedVersion:1,changeNote:'Amended after review',content:{fileName:'proforma-2.pdf',contentType:'application/pdf',bytes:genB}}));
 assert.equal(gen2.versionNumber,2);
 const pinned=await asAdmin(()=>svc.getManagedVersion(gen.id,gen.versionId));
 assert.deepEqual([pinned.versionNumber,pinned.fileDocumentId,pinned.sha256,pinned.current],[1,gen.fileDocumentId,hash(genA),false],'an approved artifact can be pinned to its exact version, file and hash');
 const dlPinned=await asAdmin(async()=>Buffer.from(await (await svc.openManagedVersion(gen.id,gen.versionId)).arrayBuffer()));assert.equal(dlPinned.toString(),genA.toString(),'the pinned version never resolves to the current file');
 await assert.rejects(ctx.actorContext.run(actorOf(A.user.id,org9,'accounts'),()=>svc.createManagedDocument({title:'x',contextType:'organisation',generated:true,content:{fileName:'x.pdf',bytes:new Uint8Array([1])}})),/company documents/,'generated:true skips only the upload capability, not the context gate');
 await assert.rejects(ctx.actorContext.run(actorOf(B.user.id,memberB.organisation_id,'admin'),()=>svc.getManagedVersion(gen.id,gen.versionId)),/not found/i,'cross-tenant service call fails closed');
 assert.equal((await json(await mdGet(gen.id),200)).versions.length,2,'generated artifact is visible through the normal API');
 console.log('PASS 9A managed documents: standalone create, immutable revisions with exact-version download and hashes, revision labels, metadata, one search result per document, legacy attachments, project scope (PE/SE), links that never widen access, tenant isolation, field visibility, commercial/tender contexts, archive, audit, and server-side generated artifact seam');
 }

 step='H ABN';
 let reg1=await json(await call('/api/platform/abn?abn=51824753556&lookup=1','GET',undefined,A.cookie),200);assert.equal(reg1.registry.status,'found');assert.equal(reg1.registry.record.entityName,'ALPHA CIVIL PTY LTD');
 const nf=await json(await call('/api/platform/abn','POST',{abn:'53004085616'},A.cookie),404);assert.equal(nf.code,'ABN_NOT_FOUND');
 await json(await call('/api/platform/abn','POST',{abn:'51824753556'},C.cookie),403,'only admins confirm ABNs');
 const conf=await json(await call('/api/platform/abn','POST',{abn:'51824753556'},A.cookie),200);assert.equal(conf.record.source,'ABR');
 let prof=(await json(await call('/api/platform/onboarding','GET',undefined,A.cookie),200)).profile;
 assert.deepEqual([prof.abn_verification,prof.abn_lookup_source,prof.abn_entity_name,prof.gst_registered_from,prof.legal_name],['abr-verified','ABR','ALPHA CIVIL PTY LTD','2001-07-01','ALPHA CIVIL PTY LTD']);assert(prof.abn_lookup_at);
 await json(await call('/api/platform/onboarding','PUT',{abn:'53 004 085 616'},A.cookie),200);
 prof=(await json(await call('/api/platform/onboarding','GET',undefined,A.cookie),200)).profile;assert.equal(prof.abn_verification,'format-checked','changing the ABN clears the register confirmation');assert.equal(prof.abn_lookup_at,null);
 step='H AI';
 let st=await json(await call('/api/ai','GET',undefined,A.cookie),200);
 assert(st.installation.every(g=>g.ok),'installation ready');assert.equal(st.organisationEnabled,false,'AI is off for an organisation until an admin switches it on');
 await json(await call('/api/hseq/swms','POST',{action:'revise',id:sw.swmsId,reason:'Add controls'},A.cookie),200);
 const gated=await json(await call('/api/ai','POST',{action:'swms-assist',swmsId:sw.swmsId},A.cookie),403);assert.equal(gated.code,'AI_UNAVAILABLE');assert(gated.gates.some(g=>g.key==='organisation'&&!g.ok));
 assert.equal(aiCalls,0,'no provider call while gated');
 await json(await call('/api/ai','PUT',{enabled:true},A.cookie),422,'switching on requires acknowledgement');
 await json(await call('/api/ai','PUT',{enabled:true,acknowledged:true},C.cookie),403);
 await json(await call('/api/ai','PUT',{enabled:true,acknowledged:true},A.cookie),200);
 assert.equal((await call('/api/ai','POST',{action:'swms-assist',swmsId:sw.swmsId},C.cookie)).status,403,'field role cannot run AI');
 const aiRun=await json(await call('/api/ai','POST',{action:'swms-assist',swmsId:sw.swmsId},A.cookie),200);
 assert.equal(aiRun.replay,false);assert.equal(aiRun.suggestions.length,1,'out-of-range step suggestions are discarded');assert.equal(aiCalls,1);
 const aiAgain=await json(await call('/api/ai','POST',{action:'swms-assist',swmsId:sw.swmsId},A.cookie),200);assert.equal(aiAgain.replay,true);assert.equal(aiCalls,1,'idempotent: the provider is not called (or billed) twice');
 const [[ledger]]=await db.execute("SELECT status,input_tokens,output_tokens,provider,model FROM ai_usage_ledger WHERE organisation_id=? AND feature='swms.assist'",[memberA.organisation_id]);assert.deepEqual([ledger.status,ledger.input_tokens,ledger.output_tokens,ledger.provider,ledger.model],['completed',120,40,'anthropic','fixture-model']);
 const sugg=aiRun.suggestions[0];assert.equal(sugg.status,'suggested');assert(sugg.sourceLocation&&sugg.confidence===0.8&&sugg.extractedAt,'source-linked with confidence and time');
 await json(await call('/api/ai','POST',{action:'decide',id:sugg.id,decision:'accepted'},A.cookie),200);
 swms=await json(await call('/api/hseq/swms?id='+sw.swmsId,'GET',undefined,A.cookie),200);
 const draftRev=swms.revisions.find(r=>r.id===swms.swms.currentRevisionId);assert.equal(draftRev.status,'draft','AI never approves or issues');assert.match(draftRev.content.workSteps[0].controls,/shore trenches/);
 await json(await call('/api/ai','POST',{action:'decide',id:sugg.id,decision:'accepted'},A.cookie),409,'a suggestion is decided once');
 const imsAi=await json(await call('/api/ai','POST',{action:'ims-draft',title:'Traffic management procedure',category:'Procedure',brief:'Night works on arterial roads'},A.cookie),200);
 const libDraft=await json(await call('/api/ai','POST',{action:'decide',id:imsAi.suggestions[0].id,decision:'accepted'},A.cookie),200);
 const [[libRow]]=await db.execute('SELECT status,title FROM library_items WHERE id=?',[libDraft.appliedEntityId]);assert.deepEqual([libRow.status,libRow.title],['draft','Traffic management procedure'],'IMS draft lands as Draft');
 const failed=await json(await call('/api/ai','POST',{action:'ims-draft',title:'FAIL-PLEASE',category:'Procedure',brief:'x'},A.cookie),502);assert.equal(failed.code,'AI_FAILED');
 const [[failRow]]=await db.execute("SELECT status,error FROM ai_usage_ledger WHERE organisation_id=? AND feature='ims.draft' AND status='failed'",[memberA.organisation_id]);assert(failRow,'provider failure recorded in the ledger');
 assert.equal((await call('/api/ai','POST',{action:'tender-requirements',tenderId},A.cookie)).status,409,'no suggestions for a tender that has been awarded');
 const usageList=await json(await call('/api/ai?usage=1','GET',undefined,A.cookie),200);assert(usageList.usage.length>=3);
 await json(await call('/api/ai','PUT',{enabled:false},A.cookie),200);
 assert.equal((await json(await call('/api/ai','POST',{action:'swms-assist',swmsId:sw.swmsId},A.cookie),403)).code,'AI_UNAVAILABLE','switching off takes effect immediately');
 step='H billing';
 const {createHmac}=await import('node:crypto');
 const signed=(event,secret=BILLING_SECRET,t=Math.floor(Date.now()/1000))=>{const raw=JSON.stringify(event);return fetch(base+'/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-billing-signature':`t=${t},v1=${createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')}`},body:raw});};
 const orgA=memberA.organisation_id,subEvent=(id,type,data={})=>({id,type,data:{organisationId:orgA,customerId:`cus_${suffix}`,subscriptionId:`sub_${suffix}`,...data}});
 assert.equal((await fetch(base+'/api/billing/webhook',{method:'POST',body:JSON.stringify(subEvent(`evt_x_${suffix}`,'subscription.created',{status:'active',modules:[]}))})).status,401,'unsigned webhook refused');
 assert.equal((await signed(subEvent(`evt_forged_${suffix}`,'subscription.created',{status:'active',modules:[]}),'wrong-secret')).status,401,'forged signature refused');
 const [[noForged]]=await db.execute("SELECT COUNT(*) AS n FROM billing_events WHERE event_id IN (?,?)",[`evt_x_${suffix}`,`evt_forged_${suffix}`]);assert.equal(Number(noForged.n),0,'refused deliveries are never stored');
 const modulesOn=['pipeline','estimating','projects','ims','operations','field','dockets','commercial','ai'];
 await json(await signed(subEvent(`evt_1_${suffix}`,'subscription.created',{planCode:'provider-plan-a',status:'active',modules:modulesOn})),200);
 const dupBilling=await json(await signed(subEvent(`evt_1_${suffix}`,'subscription.created',{planCode:'provider-plan-a',status:'active',modules:modulesOn})),200);assert.equal(dupBilling.duplicate,true,'duplicate delivery acknowledged, not re-applied');
 ws=await json(await call('/api/workspace','GET',undefined,A.cookie),200);assert.equal(ws.entitlements.reports,'read_only','modules outside the plan become read-only');assert.equal(ws.entitlements.commercial,'active');
 await json(await signed(subEvent(`evt_2_${suffix}`,'payment.failed')),200);
 let billing=await json(await call('/api/billing','GET',undefined,A.cookie),200);assert.equal(billing.subscriptions[0].status,'past_due');assert(billing.subscriptions[0].last_payment_failed_at);
 ws=await json(await call('/api/workspace','GET',undefined,A.cookie),200);assert.equal(ws.entitlements.commercial,'active','payment failure keeps access during the grace period');
 assert.equal((await signed({id:`evt_bad_${suffix}`,type:'subscription.updated',data:{organisationId:memberB.organisation_id,customerId:`cus_${suffix}`,subscriptionId:`subB_${suffix}`}})).status,422,'a customer cannot be moved to another organisation');
 await json(await signed(subEvent(`evt_3_${suffix}`,'subscription.cancelled')),200);
 ws=await json(await call('/api/workspace','GET',undefined,A.cookie),200);assert(Object.entries(ws.entitlements).filter(([m])=>m!=='core').every(([,v])=>v==='read_only'),'cancellation → read-only, never deleted');
 const [[claimsKept]]=await db.execute('SELECT COUNT(*) AS n FROM progress_claims WHERE organisation_id=?',[orgA]);assert(Number(claimsKept.n)>0);
 await json(await call('/api/billing','POST',{organisationId:orgA,action:'activate',reference:`INV-${suffix}`,planCode:'manual-agreement',modules:[...modulesOn,'reports']},A.cookie),403,'an organisation admin cannot grant paid modules');
 const Op=await signup('operator');assert.equal(Op.email,OPERATOR);
 await json(await call('/api/billing','POST',{organisationId:orgA,action:'activate',reference:`INV-${suffix}`,planCode:'manual-agreement',modules:[...modulesOn,'reports']},Op.cookie),200,'platform operator records a manual agreement');
 ws=await json(await call('/api/workspace','GET',undefined,A.cookie),200);assert.equal(ws.entitlements.reports,'active');assert.equal(ws.entitlements.commercial,'active');
 billing=await json(await call('/api/billing','GET',undefined,A.cookie),200);assert(billing.events.length>=3);assert.equal(billing.configured,true);
 console.log('PASS H: ABN register lookup → confirm → source/time recorded, change clears confirmation; AI five gates, acknowledgement, idempotent ledger (no second provider call), source-linked suggestions, drafts only, failure recorded, switch-off immediate; billing signature/forgery refusal, idempotent events, plan → entitlements, payment grace, cancellation read-only, cross-org customer refusal, manual path operator-only');
 console.log('PASS V1 journey complete');
}catch(error){console.error('FAILED at',step);console.error(appLog.slice(-4000));throw error;}finally{app.kill();s3.close();ext.close();await servicePool?.end();await db.end();}
