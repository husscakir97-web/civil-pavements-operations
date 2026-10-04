// Stages of the demo-company seed. Each stage is idempotent: it looks for its records by a deterministic natural key and only
// creates what is missing. All business writes go through the application's HTTP API.
import {resourceStage} from './resources.mjs';
import {crmStage} from './crm.mjs';
import {pipelineStage} from './pipeline.mjs';
import {projectsStage,closeProject} from './projects.mjs';
import {shiftsStage} from './shifts.mjs';
import {workMapStage} from './workmap.mjs';
import {workshopStage} from './workshop.mjs';
import {commercialStage} from './commercial.mjs';
import {hseqStage} from './hseq.mjs';
import {planningStage} from './planning.mjs';
import {verify} from './verify.mjs';

async function companyStage(c){
 const {call,must,db,org,log}=c;
 const p=await must(call('/api/platform/onboarding'),[200],'profile');
 const profile=p.profile||p;
 if(profile.trading_name!=='Kestrel Civil & Pavements'){
  await must(call('/api/platform/onboarding','PUT',{
   legal_name:'Kestrel Civil & Pavements Pty Ltd (fictional demonstration company)',trading_name:'Kestrel Civil & Pavements',
   registered_address:'1 Demo Street, Exampleton NSW 2999',operating_address:'1 Demo Street, Exampleton NSW 2999',
   business_activities:['Traffic control','Asphalt and pavement maintenance','Road profiling'],disciplines:['Civil','Pavements','Traffic management'],operating_regions:['NSW'],
   workforce_size:'21–50',typical_project_size:'$100k–$1M',plant_summary:'Profilers, paver, rollers, tippers and traffic control equipment (fictional).',
   key_clients:['Marrow Shire Council','Ridgeway City Council','Ironbark Construction','Coastal Tollways'],certifications:['Demonstration only: no real certification'],
   tendering_activity:'Regular',hseq_maturity:'Developing',estimating_approach:'Spreadsheet',onboarding_step:4,complete:true,
  }),[200],'profile update');
  c.note('profile');
 }
 await db.query("UPDATE organisations SET name='Kestrel Civil & Pavements (DEMO)' WHERE id=? AND name<>'Kestrel Civil & Pavements (DEMO)'",[org]);
 for(const [code,name,description] of [['TC','Traffic Control','Traffic management plans, traffic controllers, VMS and arrow boards.'],['APM','Asphalt & Pavement Maintenance','Resurfacing, patching and pavement repairs.'],['PRF','Profiling','Cold planing and profiling for resurfacing programmes.']]){
  const have=await c.one('SELECT id FROM business_units WHERE organisation_id=? AND code=?',[org,code]);
  if(have){c.ids['division:'+code]=have.id;continue;}
  const made=await must(call('/api/business-units','POST',{name,code,description}),[201],'division '+code);
  c.ids['division:'+code]=made.id||made.division?.id;c.note('divisions');
 }
 log('divisions:',['TC','APM','PRF'].map(k=>c.ids['division:'+k]?'ok':'?').join(' '));
}

/** Rebuilds the id registry from deterministic natural keys so any stage can run on its own (and after a previous run). */
export async function hydrate(c){
 const {all,org,ids}=c;
 for(const r of await all('SELECT id,code FROM business_units WHERE organisation_id=?',[org]))ids['division:'+r.code]=r.id;
 for(const r of await all("SELECT id,employee_number n FROM workers WHERE organisation_id=? AND employee_number LIKE 'DEMO-%'",[org]))ids['worker:'+r.n]=r.id;
 for(const r of await all("SELECT id,plant_number n FROM plant WHERE organisation_id=? AND plant_number LIKE 'DEMO-%'",[org]))ids['plant:'+r.n]=r.id;
 for(const r of await all("SELECT id,client_code n FROM clients WHERE organisation_id=? AND client_code LIKE 'DEMO-%'",[org]))ids['client:'+r.n]=r.id;
 for(const r of await all("SELECT s.id,s.name,c.client_code n FROM client_sites s JOIN clients c ON c.id=s.client_id WHERE s.organisation_id=? AND c.client_code LIKE 'DEMO-%'",[org]))ids[`site:${r.n}:${r.name}`]=r.id;
 for(const r of await all("SELECT id,reference,project_id,estimate_id FROM tenders WHERE organisation_id=? AND reference LIKE 'DEMO-T-%'",[org])){const k='B'+Number(r.reference.slice(-3));ids['tender:'+k]=r.id;if(r.project_id)ids['project:'+k]=r.project_id;if(r.estimate_id)ids['estimate:'+k]=r.estimate_id;}
 for(const r of await all("SELECT id,email FROM users WHERE organisation_id=? AND email LIKE '%@kestrel-demo.example.invalid'",[org])){const m={'elena.voss':'pm','marcus.doyle':'est','hana.kobayashi':'sched','joel.mercer':'site','rina.patel':'acct'}[r.email.split('@')[0]];if(m)ids['user:'+m]=r.id;}
}

async function closeStage(c){await closeProject(c,'B2');c.log('B2 stage:',(await c.one('SELECT stage FROM jobs WHERE organisation_id=? AND id=?',[c.org,c.ids['project:B2']])).stage);}

export const STAGES=[['company',companyStage],['resources',resourceStage],['crm',crmStage],['pipeline',pipelineStage],['projects',projectsStage],['shifts',shiftsStage],['workmap',workMapStage],['workshop',workshopStage],['commercial',commercialStage],['close',closeStage],['hseq',hseqStage],['planning',planningStage],['verify',async c=>{c.manifest=await verify(c);}]];
