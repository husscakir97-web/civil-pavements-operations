import {withActor} from '@/lib/platform/route';
import {calculateEstimate,normaliseEstimateData,validateEstimate,DEFAULT_RATE_LIBRARY} from '@/lib/estimate-calculations';
import { requireEstimateDb, cleanText, safeJson } from '@/lib/estimates-db';
import { dataSchema, preparationKinds, blankData, blankRow, extractQuestions, type PreparationRecord } from '@/lib/preparation';
import { appendStatements, checkLinks, enabled, entitlement, exact, fail, issuesFor, latestRecords, preparationActor, preparationError, preparationRecords } from '@/lib/preparation-db';
export const dynamic='force-dynamic';
async function handleGET(request:Request){try{
 const db=requireEstimateDb(),actor=await preparationActor(request,db),records=await preparationRecords(db,actor.organisationId);
 if(['field'].includes(actor.role))fail('Open approved activity documents from your assigned shift.',403);
 const [jobs,opportunities,users]=await Promise.all(['jobs','opportunities','users'].map(table=>db.prepare(`SELECT id,name FROM ${table} WHERE organisation_id=?`).bind(actor.organisationId).all<{id:string;name:string}>()));
 const visible=records.filter(r=>enabled(records,entitlement(r.kind)));
 return Response.json({records:visible,jobs:jobs.results,opportunities:opportunities.results,users:users.results.some(u=>u.id===actor.userId)?users.results:[...users.results,{id:actor.userId,name:actor.email}],actor,issues:Object.fromEntries(latestRecords(visible).map(r=>[r.id,issuesFor(r,records)])),ai:{available:false,method:'Local text extraction/OCR and manual drafting'},entitlements:{tender:enabled(records,'tender'),ims:enabled(records,'ims'),field:enabled(records,'field')}},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return preparationError(e);}}
async function handlePOST(request:Request){try{
 const db=requireEstimateDb();const body=await request.json() as Record<string,unknown>;const action=cleanText(body.action,30)||'save';
 const actor=await preparationActor(request,db,action);const records=await preparationRecords(db,actor.organisationId);
 if(action==='create-project'){
 const title=cleanText(body.title,180);if(!title)fail('Project name is required.');const id=crypto.randomUUID();await db.batch([db.prepare('INSERT INTO jobs (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(id,actor.organisationId,title,'Planning',JSON.stringify({scope:cleanText(body.scope,5000),site:cleanText(body.site,500),client:cleanText(body.client,200)}),new Date().toISOString()),db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,'preparation.project.created','recorded',JSON.stringify({jobId:id,actorId:actor.userId}),new Date().toISOString())]);return Response.json({jobId:id},{status:201});
 }
 const current=latestRecords(records).find(r=>r.id===body.id);
 if(current?.status==='Submitted'&&!['copy','handover','allowance'].includes(action))fail('Issued content is protected. Copy it to prepare an amendment.',409);
 if(body.id&&!current)fail('Preparation record not found.',404);
 if(current&&Number(body.revision)!==current.revision)fail('Record changed.',409);
 const kind=current?.kind||preparationKinds.find(k=>k===body.kind);if(!kind)fail('Choose a preparation type.');
 if(!enabled(records,entitlement(kind)))fail('This add-on is not enabled for your organisation.',403);
 if(kind==='settings')await preparationActor(request,db,'admin');
 const now=new Date().toISOString();let record:PreparationRecord={id:current?.id||crypto.randomUUID(),organisation_id:actor.organisationId,revision:(current?.revision||0)+1,kind,title:cleanText(body.title??current?.title,180),status:current?.status||'Draft',job_id:current?.job_id||cleanText(body.jobId,100)||null,opportunity_id:current?.opportunity_id||cleanText(body.opportunityId,100)||null,data:structuredClone(current?.data||blankData()),actor_id:actor.userId,reason:action,created_at:now};
 if(!record.title)fail('A title is required.');
 if(action==='populate-project'){
 if(!record.job_id)fail('Select a project first.');const job=await db.prepare('SELECT name,metadata FROM jobs WHERE id=? AND organisation_id=?').bind(record.job_id,actor.organisationId).first<{name:string;metadata:string}>();if(!job)fail('Project not found.',404);const meta=safeJson<Record<string,unknown>>(job.metadata,{});const values:Record<string,string>={project:job.name,client:String(meta.client||''),scope:String(meta.scope||''),location:String(meta.site||''),programme:String(meta.programme||meta.startDate||''),personnel:String(meta.projectManager||''),resources:String(meta.resources||'')};record.data.sections=record.data.sections.map(s=>({...s,text:s.text.replace(/\{\{(\w+)\}\}/g,(token,key)=>values[key]||token),source:`Project ${job.name}; saved project information`}));record.status='Draft';
 }else if(action==='save'||action==='admin'){
  const proposed=dataSchema.parse(body.data);
  // Content edits are always new draft revisions; approval fields are server-owned.
  for(const r of proposed.rows){const old=current?.data.rows.find(o=>o.id===r.id);r.status='Draft';r.acceptance=undefined;r.notApplicable=undefined;if(old&&JSON.stringify({...r,status:old.status,acceptance:old.acceptance,notApplicable:old.notApplicable})===JSON.stringify(old)){r.status=old.status;r.acceptance=old.acceptance;r.notApplicable=old.notApplicable;}}
  proposed.submission=undefined;proposed.manifest=current?.data.manifest||[];
  if(current?.status==='Submitted')fail('Copy this issued submission to prepare an amendment.',409);
  if(kind==='settings'&&Object.values(proposed.entitlements).some(v=>!v))fail('Disabling existing add-ons is not authorised in this stage.');
  if(kind==='risk'){
 const config=latestRecords(records).find(r=>r.kind==='settings'&&r.status==='Approved');const matrix=config?.data.matrix||{};
 proposed.rows.forEach(r=>{for(const stage of ['Initial','Residual'])r.fields[`${stage} rating`]=matrix[`${r.fields[`${stage} likelihood`]}|${r.fields[`${stage} consequence`]}`]||'';});if(config)proposed.evidence=[{id:config.id,revision:config.revision}];
 }
 record={...record,status:'Draft',data:proposed};
 }else if(action==='extract'){
  const pages=dataSchema.shape.sourcePages.parse(body.pages);const candidates=extractQuestions(pages);const ids=new Set(record.data.rows.map(r=>r.id));record.data.rows.push(...candidates.filter(r=>!ids.has(r.id)));record.data.sourcePages.push(...pages.filter(p=>!record.data.sourcePages.some(old=>old.fileId===p.fileId&&old.ref===p.ref)));record.status='Draft';
 }else if(action==='copy'){
  record={...record,id:crypto.randomUUID(),revision:1,status:'Draft',kind:body.asTemplate===true?'template':current?.kind==='template'?'plan':kind,title:cleanText(body.title,180)||record.title+' — copy',job_id:cleanText(body.jobId,100)||null,opportunity_id:cleanText(body.opportunityId,100)||null};
  record.data.origin={id:current!.id,revision:current!.revision};record.data.submission=undefined;record.data.manifest=[];record.data.rows.forEach(r=>{r.status='Draft';r.acceptance=undefined;r.notApplicable=undefined;});
 }else if(action==='review'){if(record.status!=='Draft'&&record.status!=='Changes requested')fail('Only drafts can enter internal review.');record.status='Internal Review';
 }else if(action==='approve'){
  if(body.rowId){const row=record.data.rows.find(r=>r.id===body.rowId);if(!row)fail('Question not found.',404);if(row.uncertain)fail('Confirm the requirement against its source before approval.');row.status='Approved';const problems=issuesFor({...record,data:{...record.data,rows:[{...row,requiresAcceptance:false}]}},records);if(problems.length)fail(problems.join('\n'));record.status='Draft';}
  else {if(record.status!=='Internal Review')fail('Internal review is required before approval.');const problems=issuesFor(record,records);if(problems.length)fail(problems.join('\n'));record.status='Approved';}
 }else if(action==='changes'){
  const comment=cleanText(body.comment,3000);if(!comment)fail('Describe the requested changes.');record.status='Changes requested';record.data.notes+='\nReview: '+comment;
 }else if(action==='accept'||action==='exception'){
  const row=record.data.rows.find(r=>r.id===body.rowId);if(!row)fail('Requirement not found.',404);const reference=cleanText(body.reference,1000);if(!reference)fail('Provide the approval reference or justified reason.');
  if(action==='accept'){if(row.status!=='Approved')fail('Approve the response internally before recording client acceptance.');row.acceptance={date:now,reference,by:actor.userId};}else row.notApplicable={reason:reference,by:actor.userId};record.status='Draft';
 }else if(action==='submit'){
  if(record.status!=='Approved')fail('Approve the submission before recording issue.');const date=cleanText(body.date,10),method=cleanText(body.method,100),reference=cleanText(body.reference,500);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!method||!reference)fail('Submission date, method and reference are required.');
  const problems=issuesFor(record,records);if(problems.length)fail(problems.join('\n'));
  record.data.manifest=[{id:current!.id,revision:current!.revision},...record.data.evidence,...record.data.rows.flatMap(r=>r.evidence)];record.data.submission={date,method,reference,by:actor.userId};record.status='Submitted';
 }else if(action==='handover'){
  if(kind!=='submission'||!['Approved','Submitted','Accepted'].includes(record.status))fail('An approved tender response is required for handover.');
  const jobId=cleanText(body.jobId,100);if(!jobId)fail('Select the awarded or directly created project.');
  const existing=latestRecords(records).find(r=>r.kind==='project-pack'&&r.job_id===jobId&&r.data.origin?.id===current!.id);if(existing)return Response.json({record:existing,alreadyTransferred:true});
  record={...record,id:`handover:${current!.id}:${jobId}`,revision:1,kind:'project-pack',title:`${record.title} — commencement pack`,status:'Draft',job_id:jobId};record.data.origin={id:current!.id,revision:current!.revision};record.data.rows=record.data.rows.filter(r=>r.stage==='Pre-commencement').map(r=>({...r,id:crypto.randomUUID(),status:'Draft',acceptance:undefined,notApplicable:undefined}));record.data.submission=undefined;record.data.sections.push({title:'Tender commitments',text:current!.data.rows.map(r=>`${r.question}\n${r.answer}`).join('\n\n'),source:`Tender revision ${current!.revision}`});
 }else if(action==='apply-allowance'){
 if(!['admin','office','estimator/commercial manager','commercial manager','estimator'].includes(actor.role))fail('Estimator authorisation is required.',403);
 if(kind!=='allowance')fail('Select a draft allowance.');const line=record.data.rows[0];const estimateId=cleanText(line?.fields['Estimate ID'],100);const quantity=Number(line?.fields.Quantity),rate=Number(line?.fields.Rate);if(body.confirm!==true||!estimateId||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(rate)||rate<=0)fail('Confirm a positive quantity and rate, and select a draft estimate.');
 const estimate=await db.prepare('SELECT * FROM estimates WHERE id=? AND organisation_id=?').bind(estimateId,actor.organisationId).first<{id:string;metadata:string;status:string;name:string}>();if(!estimate)fail('Estimate not found.',404);const meta=safeJson<Record<string,unknown>>(estimate.metadata,{});if(meta.approvedBudget||meta.approvedRevisionId||meta.jobId||!['Draft','Internal Review'].includes(String(meta.status||estimate.status)))fail('Approved, submitted or awarded estimates cannot be changed by an allowance.',409);
 const data=normaliseEstimateData(meta.data||{},DEFAULT_RATE_LIBRARY);if(data.subcontractors.some(l=>l.id===record.id))return Response.json({alreadyApplied:true,record:current});data.subcontractors.push({id:record.id,name:record.title,quantity,unit:line.fields.Unit||'item',unitRate:rate});const totals=calculateEstimate(data),validation=validateEstimate(data,totals),revisionId=crypto.randomUUID(),revisionNumber=Number(meta.revisionNumber||1)+1;record.status='Approved';record.data.notes+='\nConfirmed estimate allowance: '+estimateId;
 const nextMeta={...meta,data,totals,validation,revisionNumber,currentRevisionId:revisionId,updatedAt:now};
 // The conditional INSERT reserves this allowance revision only if the estimate is unchanged.
 // Every write is conditional on that reservation within the same D1 transaction.
 const marker=crypto.randomUUID();record.reason='allowance.confirmed:'+marker;
 const values=[record.id,record.organisation_id,record.revision,record.kind,record.title,record.status,record.job_id,record.opportunity_id,JSON.stringify(record.data),actor.userId,record.reason,now];
 const guard='EXISTS (SELECT 1 FROM preparation_revisions WHERE id=? AND organisation_id=? AND revision=? AND reason=?)';const guardArgs=[record.id,actor.organisationId,record.revision,record.reason];
 const results=await db.batch([
 db.prepare('INSERT INTO preparation_revisions (id,organisation_id,revision,kind,title,status,job_id,opportunity_id,data,actor_id,reason,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM estimates WHERE id=? AND organisation_id=? AND metadata=?)').bind(...values,estimateId,actor.organisationId,estimate.metadata),
 db.prepare(`UPDATE estimates SET metadata=? WHERE id=? AND organisation_id=? AND ${guard}`).bind(JSON.stringify(nextMeta),estimateId,actor.organisationId,...guardArgs),
 db.prepare(`INSERT INTO quote_revisions (id,organisation_id,name,status,metadata,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(revisionId,actor.organisationId,estimate.name+' · Rev '+revisionNumber,String(meta.status||estimate.status),JSON.stringify({estimateId,revisionNumber,data,totals,validation,reason:'Confirmed preparation allowance',createdAt:now}),now,...guardArgs),
 db.prepare(`INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),actor.organisationId,'preparation.allowance.confirmed','recorded',JSON.stringify({estimateId,revisionId,allowanceId:record.id,actorId:actor.userId}),now,...guardArgs)
 ]);if(!results[0].meta.changes)fail('Estimate changed. Reload and confirm again.',409);return Response.json({record},{status:201});
 }else if(action==='allowance'){
  const row=record.data.rows.find(r=>r.id===body.rowId);if(!row||row.status!=='Approved')fail('Select a reviewed and approved requirement.');const existing=latestRecords(records).find(r=>r.kind==='allowance'&&r.data.notes.split('\n')[0]===`${record.id}:${row.id}`);if(existing)return Response.json({record:existing,alreadyCreated:true});const data=blankData(),allowance=blankRow(row.question);allowance.fields={'Requirement':row.question,'Quantity':'','Unit':'','Rate':'','Estimate ID':''};data.rows=[allowance];data.notes=`${record.id}:${row.id}`;data.origin={id:current!.id,revision:current!.revision};record={...record,id:'allowance:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${current!.id}:${row.id}`)))).map(v=>v.toString(16).padStart(2,'0')).join(''),revision:1,kind:'allowance',title:row.question.slice(0,180),status:'Draft',data};
 }else fail('Unknown preparation action.',400);
 await checkLinks(db,actor,record,records);
 await db.batch(appendStatements(db,record));return Response.json({record,issues:issuesFor(record,[...records,record])},{status:201});
}catch(e){return preparationError(e);}}

export const GET=withActor(handleGET,'read');

export const POST=withActor(handlePOST,'write');
