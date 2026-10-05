// Work map stage of the demo company: synthetic site pins, confirmed work points, shared work areas (asphalt, stabilisation and traffic
// management; own crews and subcontractors) and the scheduled shifts that reference them. Everything goes through the application's own
// HTTP API (work-point confirmation, work areas, shift links) so every rule and audit applies; SQL is read-only.
// SYNTHETIC: the coordinates are invented and the shapes are stylised, not survey data and not a traffic management plan.
// Idempotent: every record is found by a natural key (project + area name, shift + area) and created only when missing.
const MPD=6371008.8*Math.PI/180;                                                    // same local projection as lib/v1/work-areas.ts
const at=(o,x,y)=>({lat:Math.round((o.lat+y/MPD)*1e7)/1e7,lng:Math.round((o.lng+x/(MPD*Math.cos(o.lat*Math.PI/180)))*1e7)/1e7});
const rect=(o,x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>at(o,x,y));
export const SUB_TC='Example Traffic Control Pty Ltd (DEMO subcontractor)';
export const SUB_LINE='DEMO Stripe Right Linemarking (subcontractor)';
const NOTE=' DEMO area: stylised overview on synthetic coordinates. Operational markup only; not an approved traffic management plan.';

// Site pins (synthetic) per demo site, and where each project's work areas are drawn.
export const SITE_PINS={'DEMO-C1:Quarry Road corridor':{lat:-33.2010,lng:149.0610},'DEMO-C2:Anzac Parade':{lat:-33.2305,lng:149.0702},'DEMO-C4:Coastal Motorway night works':{lat:-33.1750,lng:149.1204}};
export const B2_OVERRIDE_OFFSET_M=600;   // Anzac Parade: the project's own pin sits 600 m east of the council's site pin (a project-specific work point)
export const B3_MOVE_M=450;              // Motorway: after confirming at the site pin, the project location is moved 450 m: the map must flag it, not move the shapes

// [name, kind, discipline, delivery, contractor, sequence, rectangle (x0,y0,x1,y1) in metres from the project pin, archived]
const band=i=>150*i,bandRange=i=>`ch ${800*i}–${800*(i+1)}`;
const B1=[];
for(let i=0;i<4;i++){
 B1.push([`Asphalt ${bandRange(i)}`,'stage','asphalt','own',null,i+1,[0,band(i),800,band(i)+26]]);
 if(i<2)B1.push([`Stabilisation ${bandRange(i)}`,'stage','stabilisation','own',null,i+1,[0,band(i)+32,800,band(i)+58]]);
 B1.push([`Traffic management ${bandRange(i)}${i<2?' (own crew)':' (subcontracted)'}`,'work_area','traffic_management',i<2?'own':'subcontracted',i<2?null:SUB_TC,i+1,[0,band(i)+64,800,band(i)+90]]);
}
B1.push(['Linemarking and final seal ch 2400–3200','work_area','other','subcontracted',SUB_LINE,5,[0,band(3)+96,800,band(3)+122]]);
B1.push(['Option B stabilisation route (superseded)','work_area','stabilisation','own',null,null,[860,0,1000,120],true]);
export const WORK_MAP={
 B1:{site:'DEMO-C1:Quarry Road corridor',origin:'site',confirm:'before-areas',areas:B1},
 B2:{site:'DEMO-C2:Anzac Parade',origin:'override',confirm:'before-areas',areas:[
  ['Profiling night 1 — Anzac Parade','work_area','asphalt','own',null,1,[0,0,320,26]],
  ['Profiling night 2 — Anzac Parade','work_area','asphalt','own',null,2,[0,40,320,66]],
  ['Profiling night 3 — Anzac Parade','work_area','asphalt','own',null,3,[0,80,320,106]],
  ['Night traffic management — Anzac Parade (own crew)','work_area','traffic_management','own',null,1,[0,120,320,150]],
 ]},
 B3:{site:'DEMO-C4:Coastal Motorway night works',origin:'site',confirm:'before-areas',moveAfter:true,areas:[
  ['Night lane closure 1 — motorway','work_area','traffic_management','own',null,1,[0,0,500,24]],
  ['Night lane closure 2 — motorway','work_area','traffic_management','own',null,2,[0,36,500,60]],
  ['Advance warning — motorway (subcontracted)','work_area','traffic_management','subcontracted',SUB_TC,3,[-220,0,-20,24]],
  ['Vehicle compound — motorway','work_area','other','own',null,null,[520,0,600,50]],
 ]},
};
// shift name -> [project, area names]
const A=(i)=>`Asphalt ${bandRange(i)}`,S=(i)=>`Stabilisation ${bandRange(i)}`,T=(i)=>`Traffic management ${bandRange(i)}${i<2?' (own crew)':' (subcontracted)'}`;
export const NEW_SHIFTS=[   // added to the demo's shifts (scripts/demo/shifts.mjs): stabilisation, which the original dataset did not schedule
 ['Stabilisation Quarry Road — chainage 0–800','B1',-35,'06:00','16:00','Completed',['sam','nina','leah'],['roller8','water','tipB'],'Construction Induction (White Card)','Stabilisation','Completed.'],
 ['Stabilisation Quarry Road — chainage 800–1600','B1',-28,'06:00','16:00','Completed',['sam','nina','leah'],['roller8','water','tipB'],'Construction Induction (White Card)','Stabilisation','Completed.'],
];
export const SHIFT_LINKS={
 'Stabilisation Quarry Road — chainage 0–800':['B1',[S(0),T(0)]],
 'Stabilisation Quarry Road — chainage 800–1600':['B1',[S(1),T(1)]],
 'Profiling Quarry Road — stage 1':['B1',[A(0),T(0)]],
 'Paving Quarry Road — chainage 0–800':['B1',[A(0),T(0)]],
 'Paving Quarry Road — chainage 800–1600':['B1',[A(1),T(1)]],
 'Paving Quarry Road — chainage 1600–2400':['B1',[A(2),T(2)]],
 'Paving Quarry Road — chainage 2400–3200':['B1',[A(3),T(3)]],
 'Final wearing course and linemarking — Quarry Road':['B1',[A(3),T(3),'Linemarking and final seal ch 2400–3200']],
 'Profiling Anzac Parade — night 1':['B2',['Profiling night 1 — Anzac Parade','Night traffic management — Anzac Parade (own crew)']],
 'Profiling Anzac Parade — night 2':['B2',['Profiling night 2 — Anzac Parade','Night traffic management — Anzac Parade (own crew)']],
 'Profiling Anzac Parade — night 3':['B2',['Profiling night 3 — Anzac Parade','Night traffic management — Anzac Parade (own crew)']],
 'Night traffic control — motorway lane closure 1':['B3',['Night lane closure 1 — motorway','Advance warning — motorway (subcontracted)']],
 'Night traffic control — motorway lane closure 2':['B3',['Night lane closure 2 — motorway','Advance warning — motorway (subcontracted)']],
};

export async function workMapStage(c){
 const {call,must,one,all,org,log}=c;
 const projectRev=async id=>Number((await one('SELECT revision FROM jobs WHERE organisation_id=? AND id=?',[org,id])).revision||1);
 // 1. synthetic pins on the three demo sites (a site keeps its own location; projects inherit it unless they hold an override)
 for(const [key,pin] of Object.entries(SITE_PINS)){
  const siteId=c.ids['site:'+key];if(!siteId)throw new Error('demo site missing: '+key);
  const site=await one('SELECT id,name,address,revision,location_id FROM client_sites WHERE organisation_id=? AND id=?',[org,siteId]);
  if(site.location_id)continue;
  await must(call('/api/platform/clients','POST',{action:'updateSite',id:siteId,revision:Number(site.revision||1),site:{location:{formattedAddress:`${site.address||site.name} (DEMO synthetic pin)`,pin,source:'manual',label:site.name}}}),[200,201],'site pin '+key);
  c.note('site-pins');
 }
 for(const [proj,def] of Object.entries(WORK_MAP)){
  const projectId=c.ids['project:'+proj];if(!projectId)throw new Error('demo project missing: '+proj);
  const sitePin=SITE_PINS[def.site];
  // B2 holds a project-specific pin (override); the council's site pin is not touched.
  if(def.origin==='override'&&!(await one('SELECT location_id FROM jobs WHERE organisation_id=? AND id=?',[org,projectId])).location_id){
   const pin=at(sitePin,B2_OVERRIDE_OFFSET_M,0);
   await must(call('/api/projects/workspace','PATCH',{id:projectId,revision:await projectRev(projectId),location:{formattedAddress:'Anzac Parade work zone (DEMO project pin)',pin,source:'manual',label:'Anzac Parade work zone'}}),[200],'project override '+proj);c.note('project-pins');
  }
  const origin=def.origin==='override'?at(sitePin,B2_OVERRIDE_OFFSET_M,0):sitePin;
  if(!await one('SELECT id FROM project_work_points WHERE organisation_id=? AND project_id=?',[org,projectId])){await must(call('/api/projects/work-point','POST',{projectId}),[200],'confirm work point '+proj);c.note('work-points');}
  // 2. shared work areas (own crews and subcontractors) drawn around the project's work point
  for(const [name,kind,discipline,delivery,contractor,sequence,[x0,y0,x1,y1],archived] of def.areas){
   let area=await one('SELECT id,revision,status FROM project_work_areas WHERE organisation_id=? AND project_id=? AND name=?',[org,projectId,'DEMO – '+name]);
   if(!area){
    const made=await must(call('/api/projects/work-areas','POST',{projectId,name:'DEMO – '+name,kind,discipline,delivery,contractorLabel:contractor,sequence,notes:`${name}.${NOTE}`,ring:rect(origin,x0,y0,x1,y1)}),[201],'work area '+name);
    area={id:made.area.id,revision:made.area.revision,status:'active'};c.note('work-areas');
   }
   if(archived&&area.status!=='archived')await must(call('/api/projects/work-areas','PATCH',{id:area.id,revision:Number(area.revision),archive:true}),[200],'archive '+name);
  }
  // 3. B3: the project's location is later moved away from the confirmed work point. The areas stay put and the map flags it for review.
  if(def.moveAfter&&!(await one('SELECT location_id FROM jobs WHERE organisation_id=? AND id=?',[org,projectId])).location_id){
   await must(call('/api/projects/workspace','PATCH',{id:projectId,revision:await projectRev(projectId),location:{formattedAddress:'Motorway compound (DEMO project pin, moved)',pin:at(sitePin,0,B3_MOVE_M),source:'manual',label:'Motorway compound'}}),[200],'move B3 location');c.note('project-pins');
  }
 }
 // 4. scheduled shifts reference the shared areas by id
 for(const [shiftName,[proj,names]] of Object.entries(SHIFT_LINKS)){
  const shift=await one('SELECT id FROM shifts WHERE organisation_id=? AND name=?',[org,shiftName]);if(!shift)throw new Error('demo shift missing: '+shiftName);
  const projectId=c.ids['project:'+proj];
  const want=[];for(const n of names){const a=await one('SELECT id FROM project_work_areas WHERE organisation_id=? AND project_id=? AND name=?',[org,projectId,'DEMO – '+n]);if(!a)throw new Error('demo area missing: '+n);want.push(a.id);}
  const have=(await all('SELECT work_area_id id FROM shift_work_areas WHERE organisation_id=? AND shift_id=?',[org,shift.id])).map(r=>r.id);
  if(want.every(id=>have.includes(id))&&have.length===want.length)continue;
  await must(call('/api/delivery/work-areas','POST',{shiftId:shift.id,workAreaIds:want}),[200],'link shift '+shiftName);c.note('shift-area-links',want.length);
 }
 const n=async(sql)=>Number((await one(sql,[org])).n);
 log('work areas',await n("SELECT COUNT(*) n FROM project_work_areas WHERE organisation_id=?"),'work points',await n('SELECT COUNT(*) n FROM project_work_points WHERE organisation_id=?'),'shift links',await n('SELECT COUNT(*) n FROM shift_work_areas WHERE organisation_id=?'));
}
