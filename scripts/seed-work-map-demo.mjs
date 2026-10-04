// Repeatable DEMO fixture for the project Work map (test databases only).
//   MYSQL_DATABASE=<name>_test BETTER_AUTH_URL=http://localhost:3188 node scripts/seed-work-map-demo.mjs [--reset]
// Needs the app already running against that database. Creates (or reuses) one demo user, one sample project and
// labelled DEMO work areas/stages: asphalt, stabilisation and traffic management (subcontracted). Fictional data only.
// Safe to repeat: fixed ids, INSERT IGNORE. Existing demo rows (including your edits or archiving) are left alone;
// pass --reset to put the demo areas back to their original shapes and states.
import {connect} from './mysql-config.mjs';

export const DEMO_EMAIL='demo-workmap@example.invalid',DEMO_PASSWORD='Very-strong-demo-password-42',DEMO_PROJECT='DEMO – Work map sample project';
const PIN={lat:-33.7960,lng:150.9050};// invented location; the editor is a plain grid, so no real place is implied
// Same local equirectangular projection as lib/v1/work-areas.ts (kept inline so this script runs without a TS loader).
const MPD=6371008.8*Math.PI/180,fromLocal=(q,o)=>({lat:o.lat+q.y/MPD,lng:o.lng+q.x/(MPD*Math.cos(o.lat*Math.PI/180))});
const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
export const DEMO_AREAS=[
 {slug:'stage1-stabilise',name:'DEMO – Stage 1: Stabilise west section',kind:'stage',discipline:'stabilisation',delivery:'own',sequence:1,notes:'DEMO data. In-situ stabilisation of the west section, one carriageway at a time.',pts:rect(-260,-20,-20,10)},
 {slug:'stage2-asphalt',name:'DEMO – Stage 2: Asphalt east section',kind:'stage',discipline:'asphalt',delivery:'own',sequence:2,notes:'DEMO data. Profile and two-course asphalt after the stabilised section is sealed.',pts:rect(-20,-20,180,10)},
 {slug:'intersection-patch',name:'DEMO – Intersection asphalt patch',kind:'work_area',discipline:'asphalt',delivery:'own',sequence:3,notes:'DEMO data. Concave outline around the intersection; night works.',pts:[[-30,-95],[30,-95],[30,-65],[8,-65],[8,-45],[-30,-45]]},
 {slug:'tm-west',name:'DEMO – Traffic control west approach',kind:'work_area',discipline:'traffic_management',delivery:'subcontracted',contractor:'Example Traffic Control Pty Ltd (DEMO)',sequence:1,notes:'DEMO data. Subcontracted traffic control for Stage 1. Overview only; not a traffic management plan.',pts:rect(-260,22,-20,48)},
 {slug:'tm-east',name:'DEMO – Traffic control east approach',kind:'work_area',discipline:'traffic_management',delivery:'subcontracted',contractor:'Example Traffic Control Pty Ltd (DEMO)',sequence:2,notes:'DEMO data. Subcontracted traffic control for Stage 2 and the intersection.',pts:rect(-20,22,200,48)},
 {slug:'compound',name:'DEMO – Compound and stockpile',kind:'work_area',discipline:'other',delivery:'own',sequence:null,notes:'DEMO data. Site compound, plant parking and millings stockpile.',pts:rect(80,-100,160,-55)},
 {slug:'superseded',name:'DEMO – Superseded stabilisation option (archived)',kind:'work_area',discipline:'stabilisation',delivery:'own',sequence:null,notes:'DEMO data. Archived to show the archive state.',archived:true,pts:rect(-260,-100,-120,-60)},
];
const ringOf=a=>a.pts.map(([x,y])=>{const p=fromLocal({x,y},PIN);return {lat:Math.round(p.lat*1e7)/1e7,lng:Math.round(p.lng*1e7)/1e7};});

export async function seedWorkMapDemo({base=process.env.BETTER_AUTH_URL,reset=false,log=console.log}={}){
 const dbName=process.env.MYSQL_DATABASE||'';
 if(!dbName.endsWith('_test'))throw new Error('Refusing to run: MYSQL_DATABASE must name a disposable database ending in _test');
 if(!['127.0.0.1','localhost'].includes(process.env.MYSQL_HOST))throw new Error('Refusing to run: the database host must be local');
 if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base||''))throw new Error('Refusing to run: BETTER_AUTH_URL must be a local http address');
 const db=await connect();
 try{
  const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{origin:base,'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  const cookieOf=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
  let [[user]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[DEMO_EMAIL]);
  // A session is only needed to create the project, so a repeat run makes no sign-in request (the auth endpoint rate-limits).
  let cookie=null;
  if(!user){const r=await post('/api/auth/sign-up/email',{name:'Demo Planner',email:DEMO_EMAIL,password:DEMO_PASSWORD,callbackURL:'/'});if(!r.ok)throw new Error('demo sign-up failed: '+r.status+' '+(await r.text()).slice(0,200));cookie=cookieOf(r);[[user]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[DEMO_EMAIL]);}
  const session=async()=>{if(cookie)return cookie;const r=await post('/api/auth/sign-in/email',{email:DEMO_EMAIL,password:DEMO_PASSWORD},null);if(!r.ok)throw new Error('demo sign-in failed: '+r.status);return cookie=cookieOf(r);};
  const org=user.organisation_id;
  // Demo users should land in the workspace, not the first-run wizard.
  await db.query("INSERT INTO organisation_profiles (organisation_id,created_at,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE organisation_id=organisation_id",[org,new Date().toISOString(),new Date().toISOString()]);
  await db.query("UPDATE organisation_profiles SET legal_name=COALESCE(legal_name,?),onboarding_completed_at=COALESCE(onboarding_completed_at,?),updated_at=? WHERE organisation_id=?",['Example Civil Pty Ltd (DEMO)',new Date().toISOString(),new Date().toISOString(),org]);
  let [[project]]=await db.query('SELECT id,revision FROM jobs WHERE organisation_id=? AND name=?',[org,DEMO_PROJECT]);
  if(!project){
   const r=await post('/api/projects',{name:DEMO_PROJECT,clientName:'Example Council (DEMO)',siteAddress:'Example Road, Demo Hills NSW (fictional)'},await session());
   if(!r.ok)throw new Error('demo project failed: '+r.status+' '+(await r.text()).slice(0,200));
   [[project]]=await db.query('SELECT id,revision FROM jobs WHERE organisation_id=? AND name=?',[org,DEMO_PROJECT]);
   const p=await fetch(base+'/api/projects/workspace',{method:'PATCH',headers:{origin:base,'Content-Type':'application/json',cookie:await session()},body:JSON.stringify({id:project.id,revision:Number(project.revision||1),location:{formattedAddress:'Example Road, Demo Hills NSW (fictional)',pin:PIN,source:'manual'}})});
   if(!p.ok)throw new Error('demo location failed: '+p.status+' '+(await p.text()).slice(0,200));
  }
  const now=new Date().toISOString();let created=0,reset_=0;
  for(const a of DEMO_AREAS){
   const id=`demo-workmap-${a.slug}`,ring=ringOf(a),lat=ring.map(p=>p.lat),lng=ring.map(p=>p.lng);
   const vals=[id,org,project.id,a.name,a.kind,a.discipline,a.delivery,a.contractor||null,a.sequence??null,a.notes,JSON.stringify(ring),ring.length,polyArea(a.pts),Math.min(...lat),Math.max(...lat),Math.min(...lng),Math.max(...lng),a.archived?'archived':'active',1,user.id,user.id,now,now,a.archived?now:null,a.archived?user.id:null];
   const cols='id,organisation_id,project_id,name,kind,discipline,delivery,contractor_label,sequence,notes,geometry,vertex_count,area_m2,min_lat,max_lat,min_lng,max_lng,status,revision,created_by,updated_by,created_at,updated_at,archived_at,archived_by';
   const [r]=await db.query(`INSERT IGNORE INTO project_work_areas (${cols}) VALUES (${vals.map(()=>'?').join(',')})`,vals);
   if(r.affectedRows){created++;await db.query('INSERT IGNORE INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,project_id,summary,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[`demo-workmap-audit-${a.slug}`,org,user.id,DEMO_EMAIL,'workmap.area_created','project_work_area',id,project.id,`DEMO fixture: “${a.name}” loaded`.slice(0,500),JSON.stringify({name:a.name,demo:true}),now]);}
   else if(reset){await db.query('UPDATE project_work_areas SET name=?,kind=?,discipline=?,delivery=?,contractor_label=?,sequence=?,notes=?,geometry=?,vertex_count=?,area_m2=?,min_lat=?,max_lat=?,min_lng=?,max_lng=?,status=?,archived_at=?,archived_by=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[a.name,a.kind,a.discipline,a.delivery,a.contractor||null,a.sequence??null,a.notes,JSON.stringify(ring),ring.length,polyArea(a.pts),Math.min(...lat),Math.max(...lat),Math.min(...lng),Math.max(...lng),a.archived?'archived':'active',a.archived?now:null,a.archived?user.id:null,now,org,id]);reset_++;}
  }
  log(`DEMO work map ready: project “${DEMO_PROJECT}” (${project.id}); ${created} area(s) created, ${reset_} reset, ${DEMO_AREAS.length-created-reset_} left as they were.`);
  log(`Sign in at ${base}/login as ${DEMO_EMAIL} / ${DEMO_PASSWORD}, then Projects → ${DEMO_PROJECT} → Work map.`);
  return {org,projectId:project.id,userId:user.id,email:DEMO_EMAIL,password:DEMO_PASSWORD};
 }finally{await db.end();}
}
function polyArea(pts){let s=0;for(let i=0;i<pts.length;i++){const [x1,y1]=pts[i],[x2,y2]=pts[(i+1)%pts.length];s+=x1*y2-x2*y1;}return Math.round(Math.abs(s)/2*10)/10;}
if(import.meta.url===`file://${process.argv[1]}`)await seedWorkMapDemo({reset:process.argv.includes('--reset')});
