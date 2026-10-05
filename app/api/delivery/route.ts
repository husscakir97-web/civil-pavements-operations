import {workerEmployment} from '@/lib/v1/employment';
import {coverage,requirementsInput} from '@/lib/v1/shift-requirements';
import {assignments} from '@/lib/planning';
import {fieldDelivery,withoutMoney} from '@/lib/field-access';
import {can} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {withActor} from '@/lib/platform/route';
import type { Database } from '@/lib/platform/database';
import { imsBlockers } from '@/lib/ims-readiness';
import { requireActor } from '@/lib/authz';
import { currentOrganisationId, currentOrganisationId as ORG, requireEstimateDb, safeJson, jsonError } from '@/lib/estimates-db';
import { CHECKS, SHIFT_STATUSES, mergeJob, shiftWarnings, type DeliveryRecord, type Meta } from '@/lib/planning';
import { evaluateShift, availability, blocking, loadResources, loadNearbyShifts, shiftInput, organisationToday, type Conflict } from '@/lib/modules/operations/conflicts';
import { RESOURCE_CATEGORIES } from '@/lib/v1/resource-mapping';
import { shiftStatements } from '@/lib/v1/resource-sync';
import { projectScope } from '@/lib/platform/project-access';
import { presentLocation, saveLocation, locationInput } from '@/lib/platform/locations';
import { tx, exec as sqlExec } from '@/lib/platform/sql';
import { notifyShiftChange } from '@/lib/platform/communications';
export const dynamic = 'force-dynamic';
const tables = ['jobs','shifts','workers','crews','plant','suppliers','subcontractors'] as const;
async function load(db: Database, table: string): Promise<DeliveryRecord[]> {
  const r = await db.prepare(`SELECT * FROM ${table} WHERE organisation_id = ? ORDER BY created_at DESC`).bind(ORG()).all<Record<string,unknown>>();
  // Typed identifiers (0004) fill gaps in legacy metadata so the planner can search by plant number, rego or employee number.
  const typed=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries({plantNumber:row.plant_number,rego:row.registration,category:row.category,make:row.make,model:row.model,employeeNumber:row.employee_number,roleTitle:row.role_title}).filter(([,v])=>v!=null&&v!==''));
  // Core client/site/contact links on jobs are the typed columns: they win over any older metadata copy.
  const links=(row:Record<string,unknown>)=>table==='jobs'||table==='shifts'?Object.fromEntries(Object.entries(table==='jobs'?{clientId:row.client_id,siteId:row.site_id,contactId:row.contact_id,locationId:row.location_id}:{locationId:row.location_id}).filter(([,v])=>v!=null&&v!=='')):{};
  return r.results.map(r => ({id:String(r.id), name:String(r.name), status:String(r.status), metadata:{...typed(r),...safeJson<Meta>(r.metadata,{}),...links(r),...(table==='workers'?{employmentType:workerEmployment(r,safeJson<Meta>(r.metadata,{}))}:{})}, createdAt:String(r.created_at)}));
}
// Effective location for the schedule: a shift's own work point, else its project's location
// (project override, else the client site's). Read through the organisation-scoped wrapper.
async function attachLocations(db: Database, jobs: DeliveryRecord[], shifts: DeliveryRecord[]) {
  const siteIds=[...new Set(jobs.map(j=>String(j.metadata.siteId||'')).filter(Boolean))];
  const sites=siteIds.length?(await db.prepare(`SELECT id,location_id FROM client_sites WHERE organisation_id=? AND id IN (${siteIds.map(()=>'?').join(',')})`).bind(ORG(),...siteIds).all<{id:string;location_id:string|null}>()).results:[];
  const siteLoc=new Map(sites.map(x=>[x.id,x.location_id]));
  const ids=[...new Set([...jobs.map(j=>j.metadata.locationId),...shifts.map(x=>x.metadata.locationId),...sites.map(x=>x.location_id)].map(x=>String(x||'')).filter(Boolean))];
  const rows=ids.length?(await db.prepare(`SELECT * FROM locations WHERE organisation_id=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(ORG(),...ids).all<Record<string,unknown>>()).results:[];
  const byId=new Map(rows.map(r=>[String(r.id),presentLocation(r)]));
  const jobLoc=new Map<string,ReturnType<typeof presentLocation>|null>(),jobLocSource=new Map<string,'project'|'site'|null>();
  for(const j of jobs){const own=byId.get(String(j.metadata.locationId||''))??null,site=byId.get(String(siteLoc.get(String(j.metadata.siteId||''))||''))??null;const loc=own||site,source=own?'project':site?'site':null;jobLoc.set(j.id,loc);jobLocSource.set(j.id,source);j.metadata.locationView=loc;j.metadata.locationSource=source;}
  for(const x of shifts){const own=byId.get(String(x.metadata.locationId||''))??null,jobId=String(x.metadata.jobId||''),inherited=jobLoc.get(jobId)||null;x.metadata.locationView=own||inherited;x.metadata.locationSource=own?'shift':inherited?jobLocSource.get(jobId)||null:null;}
}
async function handleGET(request: Request) {
  try { const db=requireEstimateDb(); const actor=await requireActor(request, db, 'field-read'); if(actor.role==='field'){const [jobs,shifts]=await Promise.all([load(db,'jobs'),load(db,'shifts')]);return Response.json({jobs:jobs.map(r=>fieldDelivery(r,'jobs')),shifts:shifts.map(r=>fieldDelivery(r,'shifts')),workers:[],crews:[],plant:[],suppliers:[],subcontractors:[]},{headers:{'Cache-Control':'private, no-store'}});} const rows=await Promise.all(tables.map(t=>load(db,t)));
    // Project-scoped roles see the schedule of their own projects only (jobs and shifts); resource registers are unchanged.
    const scope=await projectScope(actor); if(scope){rows[0]=rows[0].filter(j=>scope.includes(j.id));rows[1]=rows[1].filter(s=>scope.includes(String(s.metadata.jobId||'')));}
    await attachLocations(db,rows[0],rows[1]);
    const money=can(actor.role,'commercial.view')&&usable(await getEntitlements(actor.organisationId),'commercial'); return Response.json(Object.fromEntries(tables.map((t,i)=>[t,money?rows[i]:rows[i].map(withoutMoney)])),{headers:{'Cache-Control':'private, no-store'}}); }
  catch(e) { console.error(e); return jsonError('Unable to load dispatch records. Please retry.',503); }
}
async function handlePOST(request:Request) {
  try {
    const body=await request.json() as {kind:string;record:DeliveryRecord;check?:boolean;candidates?:Array<{category:string;resourceId:string}>};
    if (!['jobs','shifts'].includes(body.kind)) return jsonError('Invalid record type.');
    const db=requireEstimateDb(); const actor=await requireActor(request, db, 'write'); const record=body.record;
    const mayUseMoney=can(actor.role,'commercial.view')&&usable(await getEntitlements(actor.organisationId),'commercial');
    // Read-only availability check for the planner: evaluates the draft shift and candidate
    // resources with the same conflict engine used on save. Nothing is written.
    if(body.check && body.kind==='shifts'){
      const input=shiftInput({id:String(record?.id||'__draft__'),name:String(record?.name||''),status:String(record?.status||'Draft'),metadata:JSON.stringify(record?.metadata||{})});
      const candidates=(Array.isArray(body.candidates)?body.candidates:[]).slice(0,300).map(c=>({resourceType:(RESOURCE_CATEGORIES as Record<string,string>)[String(c.category)]||String(c.category),resourceId:String(c.resourceId||'')})).filter(c=>c.resourceId);
      const resources=await loadResources(db,ORG(),[...input.assignments,...candidates]);
      const others=await loadNearbyShifts(db,ORG(),input.date);
      const today=await organisationToday(db,ORG());
      return Response.json({conflicts:evaluateShift(input,resources,others,{today}),availability:availability(input,candidates,resources,others,{today})},{headers:{'Cache-Control':'private, no-store'}});
    }
    if (!record?.name?.trim()) return jsonError('Name is required.');
    const existing=record.id ? (await load(db,body.kind)).find(r=>r.id===record.id) : undefined;
    if(record.id && !existing) return jsonError('Record no longer exists.',404);
    const id=existing?.id || crypto.randomUUID();
    const metadata=body.kind==='jobs' ? mergeJob(existing?.metadata || {},record.metadata || {}) : {...existing?.metadata,...record.metadata};
    // A shift may carry its own exact work point (a Core location owned by the shift); it is stored
    // in the locations table, not in legacy metadata. null clears it (back to the project/site location).
    const hasWorkPoint=body.kind==='shifts'&&record.metadata&&'workPoint' in record.metadata;
    const workPoint=hasWorkPoint?(record.metadata as Record<string,unknown>).workPoint:undefined;
    for(const k of ['workPoint','locationView','locationSource','locationId'])delete (metadata as Record<string,unknown>)[k];
    if(workPoint&&!locationInput.safeParse(workPoint).success)return jsonError('Check the work point: enter an address or valid coordinates.');
    const saved={...record,id,metadata};
    let warnings:string[]=[];
    let conflicts:Conflict[]=[];
    const sync:{sql:string;params:unknown[]}[]=[];
    if(body.kind==='jobs' && existing){
      const current=await db.prepare('SELECT stage FROM jobs WHERE organisation_id=? AND id=?').bind(ORG(),id).first<{stage:string|null}>();
      if(current?.stage==='closed') return jsonError('This project is closed. Reopen it from the project workspace before changing it.',409);
    }
    if(body.kind==='jobs'){
      // Client, site and contact are chosen from the Core client master; ids are checked against this organisation.
      const clientId=String(metadata.clientId||'')||null,siteId=String(metadata.siteId||'')||null,contactId=String(metadata.contactId||'')||null;
      const c=clientId?await db.prepare("SELECT id,name FROM clients WHERE organisation_id=? AND id=? AND status<>'merged'").bind(ORG(),clientId).first<{id:string;name:string}>():null;
      if(clientId&&!c)return jsonError('Client not found. Choose a client from the list.');
      const site=siteId?await db.prepare('SELECT id,client_id FROM client_sites WHERE organisation_id=? AND id=?').bind(ORG(),siteId).first<{id:string;client_id:string|null}>():null;
      if(siteId&&(!site||(site.client_id&&site.client_id!==clientId)))return jsonError('Choose a site that belongs to the client.');
      const contact=contactId?await db.prepare('SELECT id,client_id FROM client_contacts WHERE organisation_id=? AND id=?').bind(ORG(),contactId).first<{id:string;client_id:string}>():null;
      if(contactId&&(!contact||contact.client_id!==clientId))return jsonError('Choose a contact that belongs to the client.');
      if(c)metadata.client=c.name;
      const touched=clientId||siteId||contactId||existing?.metadata.clientId||existing?.metadata.siteId||existing?.metadata.contactId;
      if(touched)sync.push({sql:`UPDATE jobs SET client_id=?,site_id=?,contact_id=?${c?',client_name=?':''} WHERE organisation_id=? AND id=?`,params:[clientId,siteId,contactId,...(c?[c.name]:[]),ORG(),id]});
    }
    if(body.kind==='jobs' && record.status==='Ready to Commence'){
      const blockers=await imsBlockers(db,ORG(),id);
      if(blockers.length)return jsonError('Complete mandatory IMS requirements before commencement.',422,{warnings:blockers});
    }
    if(body.kind==='shifts') {
      if(!SHIFT_STATUSES.includes(record.status)) return jsonError('Invalid shift status.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(metadata.date)) || !/^\d{2}:\d{2}$/.test(String(metadata.start)) || !/^\d{2}:\d{2}$/.test(String(metadata.finish))) return jsonError('Date, start and finish are required.');
      const jobs=await load(db,'jobs'); if(!jobs.some(j=>j.id===metadata.jobId)) return jsonError('Select an existing job.');
      const stage=await db.prepare('SELECT stage FROM jobs WHERE organisation_id=? AND id=?').bind(currentOrganisationId(),String(metadata.jobId)).first<{stage:string|null}>();
      if(stage?.stage==='closed') return jsonError('This project is closed. Reopen it before scheduling work.',409);
      const byTable=await Promise.all(tables.slice(2).map(t=>load(db,t)));
      const resources=byTable.flat();
      // Non-commercial planners never receive rates. Preserve the server-side rate for an
      // existing assignment, and source the resource's stored rate for a newly assigned item.
      // This prevents an operational save from erasing or forging hidden commercial data.
      if(!mayUseMoney){
        const previous=existing?assignments(existing):[];
        const incoming=assignments(saved);
        metadata.assignments=incoming.map(a=>{
          const old=previous.find(p=>p.resourceId===a.resourceId&&p.category===a.category);
          const resource=resources.find(r=>r.id===a.resourceId);
          const stored=old?.rate??Number(resource?.metadata.hourlyRate??resource?.metadata.rate??0);
          return {...a,rate:Number(stored)||0};
        });
      }
      warnings=shiftWarnings(saved,jobs,await load(db,'shifts'),resources);
      // Deterministic conflict engine over typed resources (double-booking, inactive,
      // competencies, plant compliance). Blocks apply to Planned / Ready / In Progress.
      const input=shiftInput({...saved,metadata});
      conflicts=evaluateShift(input,await loadResources(db,ORG(),input.assignments),await loadNearbyShifts(db,ORG(),input.date),{today:await organisationToday(db,ORG())});
      if(metadata.requirements!==undefined){
        const parsed=requirementsInput.safeParse(metadata.requirements);
        if(!parsed.success)return jsonError('Check resource requirements: choose a category and positive whole quantity.');
        metadata.requirements=parsed.data;
        for(const r of coverage(parsed.data,assignments(saved)))if(r.missing)conflicts.push({code:'REQUIREMENT_SHORTAGE',severity:'block',message:r.category+' '+(r.role||'resources')+': '+r.filled+'/'+r.quantity+' filled.'});
        sync.push({sql:'DELETE FROM shift_requirements WHERE organisation_id=? AND shift_id=?',params:[ORG(),id]});
        for(const r of parsed.data)sync.push({sql:'INSERT INTO shift_requirements (id,organisation_id,shift_id,category,role,quantity,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)',params:[crypto.randomUUID(),ORG(),id,r.category,r.role,r.quantity,'active',actor.userId,new Date().toISOString(),new Date().toISOString()]});
      }
      const blocks=blocking(record.status,conflicts);
      if(blocks.length) return jsonError(`Resolve ${blocks.length===1?'this scheduling conflict':`these ${blocks.length} scheduling conflicts`} or save the shift as Draft.`,409,{conflicts,warnings});
      const known={jobIds:new Set(jobs.map(j=>j.id)),resources:new Map(byTable.flatMap((rows,i)=>rows.map(r=>[r.id,tables[i+2]] as [string,string])))};
      sync.push(...shiftStatements(ORG(),{id,name:record.name.trim(),status:record.status,metadata},known,new Date().toISOString(),()=>crypto.randomUUID(),actor.userId).statements);
      if (['Ready','In Progress'].includes(record.status)) warnings.push(...await imsBlockers(db,ORG(),String(metadata.jobId)));
      const checks=metadata.checks as Record<string,boolean> || {};
      if (['Ready','In Progress'].includes(record.status) && (warnings.length || CHECKS.some(c=>!checks[c]))) return jsonError('Resolve warnings and complete the checklist before marking Ready or In Progress.',422,{warnings});
    }
    const now=new Date().toISOString();
    const write=existing ? db.prepare(`UPDATE ${body.kind} SET name=?,status=?,metadata=? WHERE id=? AND organisation_id=?`).bind(record.name.trim(),record.status,JSON.stringify(metadata),id,ORG()) : db.prepare(`INSERT INTO ${body.kind} (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)`).bind(id,ORG(),record.name.trim(),record.status,JSON.stringify(metadata),now);
    await db.batch([write,...sync.map(s=>db.prepare(s.sql).bind(...s.params)),db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),ORG(),`${body.kind}.${existing?'updated':'created'}`,'recorded',JSON.stringify({recordId:id}),now)]);
    if(hasWorkPoint){
      await tx(async conn=>{
        const cur=await db.prepare('SELECT location_id FROM shifts WHERE organisation_id=? AND id=?').bind(ORG(),id).first<{location_id:string|null}>();
        const lid=workPoint?await saveLocation(conn,{type:'shift',id,locationType:'work_point'},locationInput.parse(workPoint) as never,cur?.location_id):null;
        await sqlExec('UPDATE shifts SET location_id=? WHERE organisation_id=? AND id=?',[lid,ORG(),id],conn);
      });
    }
    if(body.kind==='shifts')await notifyShiftChange({id,name:record.name.trim(),status:record.status,metadata},existing).catch(()=>{});
    return Response.json({record:mayUseMoney?saved:withoutMoney(saved),warnings,conflicts},{status:existing?200:201});
  } catch(e) { console.error(e);return jsonError('Unable to save. Your changes are still in the form.',503); }
}

export const GET=withActor(handleGET,'field-read','operations');

export const POST=withActor(handlePOST,'write','operations');
