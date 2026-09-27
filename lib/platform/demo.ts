import type {PoolConnection} from 'mysql2/promise';
import {makeDefaultEstimate,calculateEstimate,validateEstimate,DEFAULT_RATE_LIBRARY} from '@/lib/estimate-calculations';

// Bootstrap is a platform seam: all fixtures are synthetic and tenant-scoped.
// Called inside the organisation transaction, once for the first membership.
export async function seedDemo(db:PoolConnection,org:string,now:string){
 const date=now.slice(0,10),jobId=crypto.randomUUID(),estimateId=crypto.randomUUID(),revisionId=crypto.randomUUID(),workerId=crypto.randomUUID();
 const data={...makeDefaultEstimate(),name:'DEMO — resurfacing estimate',clientName:'Demo Council',projectName:'DEMO — Riverside resurfacing',site:'Demo training site',specification:'Synthetic demonstration only — resurface the training road.'};
 const totals=calculateEstimate(data),validation=validateEstimate(data,totals);
 const entity=async(table:string,id:string,name:string,status:string,metadata:object)=>{
  // Table names are constants defined in this file, never user input.
  await db.execute(`INSERT INTO ${table} (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)`,[id,org,name,status,JSON.stringify({...metadata,demo:true}),now]);
 };
 await entity('rate_libraries',crypto.randomUUID(),'Demo historical rates','active',DEFAULT_RATE_LIBRARY);
 await entity('estimates',estimateId,data.name,'Awarded',{status:'Awarded',revisionNumber:1,currentRevisionId:revisionId,data,totals,validation,jobId,approvedRevisionId:revisionId,approvedBudget:totals,approvedSnapshot:data,awardedAt:now});
 await entity('quote_revisions',revisionId,data.name,'Awarded',{estimateId,revisionNumber:1,data,totals,validation,reason:'Synthetic demo baseline',approvedBudget:totals,createdAt:now});
 await entity('jobs',jobId,data.projectName,'Planning',{client:data.clientName,site:data.site,workType:data.workType,scope:data.specification,contractValue:totals.sellRate,sourceEstimateId:estimateId,sourceRevisionId:revisionId,estimateSnapshot:data,approvedBudget:totals,awardedAt:now,startDate:date,po:'DEMO-PO-001',projectManager:'Demo manager',supervisor:'Demo supervisor',siteContact:'Training only',occupancyStart:'06:00',occupancyFinish:'18:00'});
 await entity('workers',workerId,'Demo supervisor','active',{role:'Supervisor',hourlyRate:85,competencyExpiry:'2099-12-31'});
 await entity('shifts',crypto.randomUUID(),'DEMO — planned resurfacing shift','Planned',{jobId,date,start:'07:00',finish:'15:00',tonnes:40,assignments:[{resourceId:workerId,category:'workers',name:'Demo supervisor',role:'Supervisor',hours:8,rate:85,payload:0,trips:0}],checks:{},notes:'Synthetic plan. Complete readiness checks before commencing.'});
 await db.execute('INSERT INTO clients (id,organisation_id,name,contact_name,email,phone) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),org,'Demo Council','Demo client','demo@example.invalid','']);
 for(let i=1;i<=6;i++){
  await db.execute('INSERT INTO dockets (id,organisation_id,docket_no,work_date,client,project,crew,labour_hours,quantity,quantity_unit,amount,status,notes,links,line_items,extraction_method,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[crypto.randomUUID(),org,`DEMO-${String(i).padStart(3,'0')}`,date,data.clientName,data.projectName,'Demo crew',8,10,'t',1500,i<=3?'approved':'review','Synthetic demo docket. No source file is attached.',JSON.stringify({jobId}),JSON.stringify([{description:'Demo asphalt supply',quantity:10,unit:'t',rate:150,amount:1500}]),'manual',now,now]);
 }
 await entity('audit_events',crypto.randomUUID(),'organisation.demo-seeded','recorded',{jobId,docketCount:6});
}
