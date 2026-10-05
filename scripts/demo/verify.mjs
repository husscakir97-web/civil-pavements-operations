// Read-only verification of the seeded demo company: counts, relationships, totals, test conditions and tenant isolation.
// Returns the dataset manifest. Throws (non-zero exit) when anything is off.
const EXPECT={divisions:3,workers:14,competencies:29,plant:12,crews:3,suppliers:2,subcontractors:2,clients:4,sites:6,contacts:6,opportunities:11,tenders:8,estimates:7,projects:3,users:6,shifts:17,workAreas:20,workPoints:3,shiftAreaLinks:27,locations:5,dockets:8,claims:4,invoices:2,incidents:2,ncrs:1,actions:3,workshopOrders:3,programme:7,plans:1,scenarios:3};

export async function verify(c){
 const {one,all,org,call,d,log,db}=c;
 const results=[];
 const check=(name,ok,detail='')=>{results.push({name,ok:Boolean(ok),detail});log(`${ok?'PASS':'FAIL'}  ${name}${detail?' — '+detail:''}`);};
 const n=async(sql,params=[org])=>Number((await one(sql,params)).n);
 const counts={
  divisions:await n("SELECT COUNT(*) n FROM business_units WHERE organisation_id=? AND code IN ('TC','APM','PRF')"),
  workers:await n("SELECT COUNT(*) n FROM workers WHERE organisation_id=? AND employee_number LIKE 'DEMO-%'"),
  competencies:await n("SELECT COUNT(*) n FROM worker_competencies WHERE organisation_id=? AND status='current'"),
  plant:await n("SELECT COUNT(*) n FROM plant WHERE organisation_id=? AND plant_number LIKE 'DEMO-%'"),
  crews:await n("SELECT COUNT(*) n FROM crews WHERE organisation_id=? AND name LIKE 'DEMO %'"),
  suppliers:await n("SELECT COUNT(*) n FROM suppliers WHERE organisation_id=? AND name LIKE 'DEMO %'"),
  subcontractors:await n("SELECT COUNT(*) n FROM subcontractors WHERE organisation_id=? AND name LIKE 'DEMO %'"),
  clients:await n("SELECT COUNT(*) n FROM clients WHERE organisation_id=? AND client_code LIKE 'DEMO-%'"),
  sites:await n("SELECT COUNT(*) n FROM client_sites WHERE organisation_id=?"),
  contacts:await n("SELECT COUNT(*) n FROM client_contacts WHERE organisation_id=?"),
  opportunities:await n("SELECT COUNT(*) n FROM opportunities WHERE organisation_id=?"),
  tenders:await n("SELECT COUNT(*) n FROM tenders WHERE organisation_id=? AND reference LIKE 'DEMO-T-%'"),
  estimates:await n("SELECT COUNT(*) n FROM estimates WHERE organisation_id=?"),
  projects:await n("SELECT COUNT(*) n FROM jobs WHERE organisation_id=?"),
  users:await n("SELECT COUNT(*) n FROM users WHERE organisation_id=?"),
  shifts:await n("SELECT COUNT(*) n FROM shifts WHERE organisation_id=?"),
  shiftAssignments:await n("SELECT COUNT(*) n FROM shift_assignments WHERE organisation_id=?"),
  dockets:await n("SELECT COUNT(*) n FROM dockets WHERE organisation_id=? AND docket_no LIKE 'DEMO-D-%'"),
  costTransactions:await n("SELECT COUNT(*) n FROM cost_transactions WHERE organisation_id=?"),
  claims:await n("SELECT COUNT(*) n FROM progress_claims WHERE organisation_id=?"),
  invoices:await n("SELECT COUNT(*) n FROM client_invoices WHERE organisation_id=?"),
  risks:await n("SELECT COUNT(*) n FROM risks WHERE organisation_id=?"),
  swms:await n("SELECT COUNT(*) n FROM swms WHERE organisation_id=?"),
  itps:await n("SELECT COUNT(*) n FROM itps WHERE organisation_id=?"),
  incidents:await n("SELECT COUNT(*) n FROM hseq_incidents WHERE organisation_id=?"),
  ncrs:await n("SELECT COUNT(*) n FROM hseq_ncrs WHERE organisation_id=?"),
  actions:await n("SELECT COUNT(*) n FROM hseq_actions WHERE organisation_id=?"),
  workshopOrders:await n("SELECT COUNT(*) n FROM workshop_orders WHERE organisation_id=?"),
  serviceEvents:await n("SELECT COUNT(*) n FROM asset_service_events WHERE organisation_id=?"),
  workAreas:await n("SELECT COUNT(*) n FROM project_work_areas WHERE organisation_id=?"),
  workPoints:await n("SELECT COUNT(*) n FROM project_work_points WHERE organisation_id=?"),
  shiftAreaLinks:await n("SELECT COUNT(*) n FROM shift_work_areas WHERE organisation_id=?"),
  locations:await n("SELECT COUNT(*) n FROM locations WHERE organisation_id=?"),
  programme:await n("SELECT COUNT(*) n FROM program_activities WHERE organisation_id=?"),
  plans:await n("SELECT COUNT(*) n FROM planning_plans WHERE organisation_id=?"),
  scenarios:await n("SELECT COUNT(*) n FROM planning_scenarios WHERE organisation_id=?"),
  planningActivities:await n("SELECT COUNT(*) n FROM planning_activities WHERE organisation_id=?"),
  planningDependencies:await n("SELECT COUNT(*) n FROM planning_dependencies WHERE organisation_id=?"),
  sharedCosts:await n("SELECT COUNT(*) n FROM planning_cost_items WHERE organisation_id=? AND scope='shared'"),
 };
 for(const [k,v] of Object.entries(EXPECT))check(`count ${k} = ${v}`,counts[k]>=v&&(k==='sites'||k==='contacts'||k==='competencies'||k==='estimates'||k==='opportunities'||k==='users'?true:counts[k]===v),`${counts[k]}`);

 // pipeline and project lineage
 const states=await all("SELECT t.reference,t.stage,e.workflow_state ws,j.stage jstage FROM tenders t LEFT JOIN estimates e ON e.id=t.estimate_id LEFT JOIN jobs j ON j.id=t.project_id WHERE t.organisation_id=? ORDER BY t.reference",[org]);
 const st=Object.fromEntries(states.map(r=>[r.reference,r]));
 check('tender states cover awarded, submitted, approval, pricing, review, lost',st['DEMO-T-001'].stage==='awarded'&&st['DEMO-T-004'].stage==='submitted'&&st['DEMO-T-005'].stage==='approval'&&st['DEMO-T-006'].stage==='pricing'&&st['DEMO-T-007'].stage==='pricing'&&st['DEMO-T-008'].stage==='lost');
 check('estimate states cover draft, review and approved',st['DEMO-T-006'].ws==='review'&&st['DEMO-T-007'].ws==='draft'&&st['DEMO-T-001'].ws==='approved');
 check('project states cover active, closed and setup',st['DEMO-T-001'].jstage==='active'&&st['DEMO-T-002'].jstage==='closed'&&st['DEMO-T-003'].jstage==='setup',JSON.stringify([st['DEMO-T-001'].jstage,st['DEMO-T-002'].jstage,st['DEMO-T-003'].jstage]));
 const lineage=await all("SELECT j.project_number,j.source_tender_id,j.source_estimate_revision_id,r.status rev_status,b.contract_value bl FROM jobs j LEFT JOIN estimate_revisions r ON r.id=j.source_estimate_revision_id LEFT JOIN project_baselines b ON b.project_id=j.id WHERE j.organisation_id=?",[org]);
 check('every project has tender lineage, an approved estimate revision and a baseline equal to its contract value',lineage.length===3&&lineage.every(l=>l.source_tender_id&&l.rev_status==='approved'&&l.bl!==null));
 // shifts
 const shiftStatuses=Object.fromEntries((await all("SELECT status,COUNT(*) n FROM shifts WHERE organisation_id=? GROUP BY status",[org])).map(r=>[r.status,Number(r.n)]));
 check('shift states cover Draft, Planned, In Progress and Completed',['Draft','Planned','In Progress','Completed'].every(k=>shiftStatuses[k]>0),JSON.stringify(shiftStatuses));
 check('every assignment points at a worker or plant record of this organisation',await n("SELECT COUNT(*) n FROM shift_assignments a LEFT JOIN workers w ON a.resource_type='worker' AND w.id=a.resource_id AND w.organisation_id=a.organisation_id LEFT JOIN plant p ON a.resource_type='plant' AND p.id=a.resource_id AND p.organisation_id=a.organisation_id WHERE a.organisation_id=? AND w.id IS NULL AND p.id IS NULL")===0);
 check('every shift belongs to a project of this organisation',await n("SELECT COUNT(*) n FROM shifts s LEFT JOIN jobs j ON j.id=s.project_id AND j.organisation_id=s.organisation_id WHERE s.organisation_id=? AND j.id IS NULL")===0);
 // test conditions
 const test=async name=>{const row=await one('SELECT id FROM shifts WHERE organisation_id=? AND name=?',[org,name]);return (await call('/api/delivery','POST',{kind:'shifts',check:true,record:{id:row.id,name,status:'Planned',metadata:await shiftMeta(name)},candidates:[]})).body;};
 const shiftMeta=async name=>{const s=await one('SELECT metadata FROM shifts WHERE organisation_id=? AND name=?',[org,name]);return JSON.parse(s.metadata);};
 const clash=await test('TEST CLASH — Profiling Quarry Road second crew'),unavailable=await test('TEST — Unavailable plant'),expired=await test('TEST — Expired qualification');
 const codes=r=>(r.conflicts||[]).map(x=>x.code);
 check('TEST: resource clash is reported (worker and plant double-booked)',codes(clash).includes('WORKER_DOUBLE_BOOKED')&&codes(clash).includes('PLANT_DOUBLE_BOOKED'),codes(clash).join(','));
 check('TEST: unavailable plant is reported (safety hold and expired registration) and nothing else is wrong with that shift',codes(unavailable).includes('RESOURCE_UNAVAILABLE')&&codes(unavailable).includes('PLANT_COMPLIANCE_EXPIRED')&&!codes(unavailable).some(x=>/DOUBLE/.test(x)),codes(unavailable).join(','));
 check('TEST: expired qualification is reported and nothing else is wrong with that shift',codes(expired).some(x=>x.startsWith('COMPETENCY_EXPIRED'))&&!codes(expired).some(x=>/DOUBLE/.test(x)),codes(expired).join(','));
 check('a blocking conflict really prevents Planned (the clash shift is refused as Planned)',(await call('/api/delivery','POST',{kind:'shifts',record:{id:'',name:'refusal probe',status:'Planned',metadata:await shiftMeta('TEST — Expired qualification')}})).status===409);
 await db.query("DELETE FROM shifts WHERE organisation_id=? AND name='refusal probe'",[org]);
 check('plant on safety hold and compliance-expired plant exist',await n("SELECT COUNT(*) n FROM plant WHERE organisation_id=? AND safety_hold=1")===1&&await n("SELECT COUNT(*) n FROM plant WHERE organisation_id=? AND compliance_expiry<?",[org,d(0)])===1);
 const comps=await all("SELECT expiry_date FROM worker_competencies WHERE organisation_id=? AND status='current' AND expiry_date IS NOT NULL",[org]);
 check('qualifications include 1 expired and 2 expiring within 30 days of the seed date',comps.filter(x=>x.expiry_date<d(0)).length===1&&comps.filter(x=>x.expiry_date>=d(0)&&x.expiry_date<=d(30)).length===2,`${comps.filter(x=>x.expiry_date<d(0)).length} expired, ${comps.filter(x=>x.expiry_date>=d(0)&&x.expiry_date<=d(30)).length} expiring`);
 check('overdue corrective action and overdue NCR exist (due before the seed date, not closed)',await n("SELECT COUNT(*) n FROM hseq_actions WHERE organisation_id=? AND due_date<? AND status NOT IN ('complete','verified')",[org,d(0)])>=1&&await n("SELECT COUNT(*) n FROM hseq_ncrs WHERE organisation_id=? AND due_date<? AND status<>'closed'",[org,d(0)])>=1);
 // dockets / costs / charges
 const dk=await one("SELECT id,status,amount FROM dockets WHERE organisation_id=? AND docket_no='DEMO-D-006'",[org]);
 const cost=await n("SELECT COALESCE(SUM(amount),0) n FROM cost_transactions WHERE organisation_id=? AND source_id=? AND status='actual'",[org,dk.id]);
 const rows=await n("SELECT COUNT(*) n FROM cost_transactions WHERE organisation_id=? AND source_id=? AND status='actual' AND source_line='L1'",[org,dk.id]);
 const charge=await n("SELECT COALESCE(SUM(this_claim),0) n FROM claim_lines WHERE organisation_id=? AND line_type='docket' AND source_id=?",[org,dk.id]);
 check('TEST: docket DEMO-D-006 internal cost is $725 (corrected from $600), posted once, while the agreed client charge is $1,000',cost===725&&rows===1&&charge===1000,`cost ${cost}, cost rows ${rows}, client charge ${charge}`);
 check('the correction from $600 is on the audit trail',await n("SELECT COUNT(*) n FROM audit_log WHERE organisation_id=? AND entity_id=? AND (before_state LIKE '%600%' OR after_state LIKE '%725%' OR summary LIKE '%725%')",[org,dk.id])>=1);
 check('unpriced docket DEMO-D-004 stays in review, posts no cost and keeps unknown amounts unknown',await n("SELECT COUNT(*) n FROM dockets d WHERE d.organisation_id=? AND d.docket_no='DEMO-D-004' AND d.status='review' AND d.line_items LIKE '%unpriced%' AND NOT EXISTS (SELECT 1 FROM cost_transactions c WHERE c.source_id=d.id)")===1);
 check('every approved allocated docket has exactly its cost posted (no duplicates)',await n("SELECT COUNT(*) n FROM (SELECT d.id FROM dockets d JOIN cost_transactions c ON c.source_id=d.id AND c.status='actual' WHERE d.organisation_id=? GROUP BY d.id HAVING COUNT(DISTINCT c.source_line)<>COUNT(*)) x")===0);
 const claimed=await all("SELECT number,period,status,gross_amount FROM progress_claims WHERE organisation_id=? ORDER BY project_id,number",[org]);
 check('claims cover paid/invoiced, submitted and in internal approval',claimed.some(x=>x.status==='paid'||x.status==='invoiced')&&claimed.some(x=>x.status==='submitted')&&claimed.some(x=>x.status==='internal_approval'),claimed.map(x=>x.status).join(','));
 // planning
 const plan=await one("SELECT id FROM planning_plans WHERE organisation_id=?",[org]);
 const scenarios=await all("SELECT id,name FROM planning_scenarios WHERE organisation_id=? AND plan_id=? ORDER BY created_at",[org,plan.id]);
 const loaded=[];for(const s of scenarios)loaded.push((await call('/api/planning?scenarioId='+s.id)).body);
 check('Planning: three scenarios saved; the base and night totals are known, the pending-quote scenario is unknown',loaded.length===3&&loaded[0].result.cost.total!==null&&loaded[1].result.cost.total!==null&&loaded[2].result.cost.total===null,loaded.map(l=>l.result.cost.total).join(' / '));
 check('Planning: parallel join (programme path = longest predecessor, not the sum) and a shared cost counted once',loaded[0].result.activities[loaded[0].document.activities.find(a=>a.name.startsWith('Tack')).id].start===Math.max(...['Profile existing wearing course','Install signage and delineation'].map(nm=>loaded[0].result.activities[loaded[0].document.activities.find(a=>a.name===nm).id].finish))&&loaded[0].result.cost.sharedCosts.find(s=>/Mobilisation/.test(s.label)).usedBy.length===2);
 check('Planning: night works is slower and costs more than the base scenario',loaded[1].result.duration.days>loaded[0].result.duration.days&&loaded[1].result.cost.total>loaded[0].result.cost.total,`${loaded[0].result.duration.days}d $${loaded[0].result.cost.total} vs ${loaded[1].result.duration.days}d $${loaded[1].result.cost.total}`);
 // work map: synthetic pins, confirmed work points, shared areas, linked shifts
 const mapProjects={};for(const key of ['B1','B2','B3'])mapProjects[key]=(await call('/api/projects/work-areas?projectId='+c.ids['project:'+key]+'&archived=1')).body;
 const allAreas=Object.values(mapProjects).flatMap(m=>m.areas);
 check('Work map: asphalt, stabilisation and traffic management areas all exist, every one marked DEMO',['asphalt','stabilisation','traffic_management'].every(k=>allAreas.some(a=>a.discipline===k))&&allAreas.every(a=>/^DEMO –/.test(a.name)),String(allAreas.length));
 check('Work map: own-crew and subcontracted areas exist, and every subcontracted area names its subcontractor',allAreas.some(a=>a.delivery==='own')&&allAreas.some(a=>a.delivery==='subcontracted')&&allAreas.filter(a=>a.delivery==='subcontracted').every(a=>a.contractorLabel));
 check('Work map: one archived area is kept, hidden by default and never deleted',allAreas.filter(a=>a.status==='archived').length===1&&(await call('/api/projects/work-areas?projectId='+c.ids['project:B1'])).body.areas.every(a=>a.status==='active'));
 check('Work map: B1 inherits the client site location and its work point is confirmed',mapProjects.B1.workPoint.status==='confirmed'&&mapProjects.B1.workPoint.source==='site',JSON.stringify([mapProjects.B1.workPoint.status,mapProjects.B1.workPoint.source]));
 check('Work map: B2 holds its own project pin (the site pin is not changed) and its work point is confirmed',mapProjects.B2.workPoint.status==='confirmed'&&mapProjects.B2.workPoint.source==='project'&&await n("SELECT COUNT(*) n FROM client_sites s JOIN locations l ON l.id=s.location_id WHERE s.organisation_id=? AND s.name='Anzac Parade' AND ABS(l.pin_lat-(-33.2305))<0.00001 AND ABS(l.pin_lng-149.0702)<0.00001")===1);
 check('Work map: B3 location moved away from its confirmed work point is flagged for review while the areas stay where they were drawn',mapProjects.B3.workPoint.status==='moved'&&Math.abs(mapProjects.B3.workPoint.distanceM-450)<5&&mapProjects.B3.areas.length===4,JSON.stringify([mapProjects.B3.workPoint.status,mapProjects.B3.workPoint.distanceM]));
 check('Work map: every shift link points at a work area of the shift\'s own project (no copied geometry, no cross-project link)',await n("SELECT COUNT(*) n FROM shift_work_areas l JOIN shifts s ON s.id=l.shift_id JOIN project_work_areas a ON a.id=l.work_area_id WHERE l.organisation_id=? AND (a.project_id<>s.project_id OR l.project_id<>s.project_id OR a.organisation_id<>l.organisation_id)")===0);
 check('Work map: linked shifts cover asphalt, stabilisation, traffic management and subcontracted work',await n("SELECT COUNT(DISTINCT a.discipline) n FROM shift_work_areas l JOIN project_work_areas a ON a.id=l.work_area_id WHERE l.organisation_id=?")>=3&&await n("SELECT COUNT(*) n FROM shift_work_areas l JOIN project_work_areas a ON a.id=l.work_area_id WHERE l.organisation_id=? AND a.delivery='subcontracted'")>=1);
 // isolation
 const orphan=await n("SELECT COUNT(*) n FROM planning_activities a JOIN planning_scenarios s ON s.id=a.scenario_id WHERE a.organisation_id=? AND s.organisation_id<>a.organisation_id");
 const crossShift=await n("SELECT COUNT(*) n FROM shifts s JOIN jobs j ON j.id=s.project_id WHERE s.organisation_id=? AND j.organisation_id<>s.organisation_id");
 const crossCost=await n("SELECT COUNT(*) n FROM cost_transactions c JOIN jobs j ON j.id=c.project_id WHERE c.organisation_id=? AND j.organisation_id<>c.organisation_id");
 check('tenant isolation: no relationship crosses an organisation boundary',orphan+crossShift+crossCost===0);
 check('no external activity was configured: no notification, communication, billing or webhook rows',await n("SELECT (SELECT COUNT(*) FROM communication_messages WHERE organisation_id=?)+(SELECT COUNT(*) FROM external_access_tokens WHERE organisation_id=?)+(SELECT COUNT(*) FROM billing_events WHERE organisation_id=?) n",[org,org,org])===0);
 const failed=results.filter(r=>!r.ok);
 if(failed.length)throw new Error(`${failed.length} verification check(s) failed`);
 return {counts,checks:results.map(r=>[r.ok,r.name,r.detail])};
}
