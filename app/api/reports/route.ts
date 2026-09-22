import {withActor} from '@/lib/platform/route';
import { DEFAULT_ORGANISATION_ID, requireEstimateDb, safeJson, jsonError } from '@/lib/estimates-db';
import { requireActor } from '@/lib/authz';
import { reportTables, summarise, type ReportData, type ReportRow } from '@/lib/reporting';
export const dynamic = 'force-dynamic';
async function handleGET(request: Request) {
 try {
  const db=requireEstimateDb(); await requireActor(request, db, 'read');
  const entries=await Promise.all(reportTables.map(async table=>{
   const columns=table==='dockets'?'id,docket_no AS name,status,amount,quantity,work_date,client,project':table==='field_records'?'shift_id AS id,shift_id AS name,status,data AS metadata':'id,name,status,metadata';
   const result=await db.prepare(`SELECT ${columns} FROM ${table} WHERE organisation_id=?`).bind(DEFAULT_ORGANISATION_ID()).all<Record<string,unknown>>();
   const rows:ReportRow[]=result.results.map(r=>({id:String(r.id),name:String(r.name),status:String(r.status),metadata:table==='dockets'?r:safeJson<Record<string,unknown>>(r.metadata,{})}));
   return [table,rows] as const;
  }));
  const records:ReportData=Object.fromEntries(entries);
  const summaryOnly=new URL(request.url).searchParams.get('summary')==='1';
  return Response.json({...(!summaryOnly?{records}:{}),summary:summarise(records),updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 } catch(error){console.error('Reports:',error);return jsonError('Saved records could not be loaded. Retry to refresh the report.',503);}
}

export const GET=withActor(handleGET,'read');
