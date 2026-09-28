// TEST SITE ONLY. Seeds synthetic clients, sites, plant, workers and Company
// Library items into every organisation of the darkgray test database so the
// UX tranche can be tried without typing data. Lives only on the
// claude/test-integration branch, which is never merged.
// Guard: runs only when MYSQL_DATABASE is the confirmed test database.
// Idempotent: fixed ids per organisation + INSERT IGNORE.
import {connect} from './mysql-config.mjs';

const TEST_DATABASE='u840559204_infra_test';
if(process.env.MYSQL_DATABASE!==TEST_DATABASE)console.log('Test data seed skipped (not the test database).');

async function seed(){

const now=new Date().toISOString(),today=now.slice(0,10);
const inDays=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const CLIENTS=[
 {key:'aber',name:'Abergeldie Complex Infrastructure',legal:'Abergeldie Complex Infrastructure Pty Ltd',contact:'Sam Taylor',email:'sam.taylor@example.invalid',phone:'02 9000 0001',sites:[['carlisle','Carlisle St upgrade','12 Carlisle St, Leichhardt NSW 2040'],['parra','Parramatta depot','5 Depot Rd, Parramatta NSW 2150']]},
 {key:'council',name:'Inner West Council',legal:'Inner West Council',contact:'Priya Nair',email:'priya.nair@example.invalid',phone:'02 9000 0002',sites:[['marrick','Marrickville Rd resurfacing','Marrickville Rd, Marrickville NSW 2204']]},
 {key:'tfnsw',name:'Transport for NSW',legal:'Transport for NSW',contact:'Alex Chen',email:'alex.chen@example.invalid',phone:'02 9000 0003',sites:[]},
];
const PLANT=[
 ['tma001','TMA truck','TMA001','A3D002','TMA','Isuzu','FVR 165-300','owned','Available',inDays(200)],
 ['tma002','TMA truck','TMA002','B7K114','TMA','Hino','500 Series','owned','Maintenance',inDays(90)],
 ['pav01','Asphalt paver','PAV01','','Paver','Vogele','Super 1800-3','owned','Available',inDays(300)],
 ['rol01','Tandem roller','ROL01','','Roller','Hamm','HD+ 90','hired','Available',inDays(-5)],
 ['prof01','Profiler 1m','PRO01','XY9021','Profiler','Wirtgen','W 100 Fi','owned','Available',inDays(120)],
 ['trk01','Tipper truck','TRK01','CF12AB','Truck','Volvo','FMX','leased','Allocated',inDays(45)],
];
const WORKERS=[
 ['freddy','Freddy','Nguyen','E1001','Supervisor',[['Supervisor ticket',inDays(400)],['White card',null]]],
 ['john','John','Smith','E1002','Traffic controller',[['Traffic Controller card',inDays(-9)],['White card',null]]],
 ['maria','Maria','Lopez','E1003','Traffic controller',[['Traffic Controller card',inDays(250)]]],
 ['ahmed','Ahmed','Khan','E1004','Paver operator',[['Paver ticket',inDays(180)],['White card',null]]],
 ['lee','Lee','Wong','E1005','Roller operator',[['Roller ticket',inDays(20)]]],
 ['tom','Tom','Brown','E1006','Labourer',[['White card',null]]],
];
const LIBRARY=[
 ['pl','Insurance','Public Liability Insurance $20m','Current certificate of currency for public and products liability.',inDays(210),'Office'],
 ['wc','Insurance','Workers Compensation Insurance','NSW icare policy certificate.',inDays(15),'Office'],
 ['whs','Policy','WHS Policy','Work health and safety policy signed by the managing director.',null,'HSEQ Manager'],
 ['cap','Capability statement','Capability statement 2026','Company overview, key projects and plant fleet for tenders.',null,'Estimating'],
 ['iso','Certification','ISO 9001 Quality certificate','Third-party quality certification.',inDays(-20),'HSEQ Manager'],
 ['cv','Personnel CV','CV — Freddy Nguyen (Supervisor)','15 years asphalt and civil supervision.',null,'Operations'],
];

const db=await connect();
try{
 const [orgs]=await db.query('SELECT id FROM organisations');
 for(const {id:org} of orgs){
  const sid=key=>`seed-${key}-${org}`.slice(0,191);
  for(const c of CLIENTS){
   await db.query('INSERT IGNORE INTO clients (id,organisation_id,name,contact_name,email,phone,legal_name,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)',[sid('client-'+c.key),org,c.name,c.contact,c.email,c.phone,c.legal,'active',now,now]);
   for(const [k,name,address] of c.sites)await db.query('INSERT IGNORE INTO client_sites (id,organisation_id,client_id,name,address,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)',[sid('site-'+k),org,sid('client-'+c.key),name,address,'active',now,now]);
  }
  for(const [k,name,no,rego,cat,make,model,own,status,expiry] of PLANT)
   await db.query('INSERT IGNORE INTO plant (id,organisation_id,name,status,metadata,created_at,plant_number,registration,category,make,model,ownership,compliance_expiry,location,active,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?)',[sid('plant-'+k),org,name,status,JSON.stringify({seed:true,plantNumber:no,rego,type:cat}),now,no,rego||null,cat,make,model,own,expiry,'Parramatta depot',now]);
  for(const [k,first,last,emp,role,comps] of WORKERS){
   await db.query('INSERT IGNORE INTO workers (id,organisation_id,name,status,metadata,created_at,employee_number,first_name,last_name,role_title,employment_type,location,active,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,1,?)',[sid('worker-'+k),org,`${first} ${last}`,'Active',JSON.stringify({seed:true,role}),now,emp,first,last,role,'employee','Parramatta depot',now]);
   for(const [i,[type,expiry]] of comps.entries())await db.query('INSERT IGNORE INTO worker_competencies (id,organisation_id,worker_id,competency_type,expiry_date,status,source,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',[sid(`comp-${k}-${i}`),org,sid('worker-'+k),type,expiry,'current','manual',now,now]);
  }
  for(const [k,cat,title,desc,expiry,owner] of LIBRARY)
   await db.query('INSERT IGNORE INTO library_items (id,organisation_id,category,title,description,expiry_date,owner_name,status,version,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)',[sid('lib-'+k),org,cat,title,desc,expiry,owner,'current',now,now]);
  // One project and one opportunity already linked to a client and site.
  await db.query('INSERT IGNORE INTO jobs (id,organisation_id,name,status,metadata,created_at,project_number,client_name,stage,start_date,site_address,client_id,site_id,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)',[sid('job-carlisle'),org,'Carlisle St pavement upgrade','Planning',JSON.stringify({seed:true,client:'Abergeldie Complex Infrastructure',site:'Carlisle St upgrade, 12 Carlisle St, Leichhardt NSW 2040'}),now,'SEED-001','Abergeldie Complex Infrastructure','setup',today,'Carlisle St upgrade, 12 Carlisle St, Leichhardt NSW 2040',sid('client-aber'),sid('site-carlisle'),now]);
  await db.query("INSERT IGNORE INTO opportunities (id,organisation_id,name,status,metadata,created_at,client_name,estimated_value,closing_date,stage,location,client_id,site_id,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)",[sid('opp-marrick'),org,'Marrickville Rd resurfacing','qualified',JSON.stringify({seed:true,client:'Inner West Council'}),now,'Inner West Council',800000,inDays(14),'qualified','Marrickville Rd resurfacing, Marrickville Rd, Marrickville NSW 2204',sid('client-council'),sid('site-marrick'),now]);
 }
 console.log(`Test data seeded for ${orgs.length} organisation(s).`);
}finally{await db.end();}
}

if(process.env.MYSQL_DATABASE===TEST_DATABASE)await seed();
