import { requireEstimateDb, safeJson } from "@/lib/estimates-db";
import { requireActor, authError } from "@/lib/authz";
export async function GET(request:Request){
 try{
  const db=requireEstimateDb(),actor=await requireActor(request,db,"read");
  const q=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,200);
  if(q.length<2)return Response.json({results:[]});
  const out:Record<string,unknown>[]=[];
  for(const [table,type] of [['clients','Client'],['jobs','Job'],['opportunities','Opportunity'],['dockets','Docket']]){
   const name=table==='dockets'?'docket_no':'name';
   const status=table==='clients'?"'active'":'status';
   const detail=table==='dockets'?"client || ' ' || project":table==='clients'?'contact_name':'metadata';
   const metadata=table==='clients'||table==='dockets'?"'{}'":'metadata';
   const filter=table==='clients'?'':"AND lower(status) != 'archived'";
   const r=await db.prepare(`SELECT id,${name} AS name,${status} AS status,${metadata} AS metadata FROM ${table} WHERE organisation_id=? ${filter} AND (${name} LIKE ? OR ${detail} LIKE ?) LIMIT 20`).bind(actor.organisationId,`%${q}%`,`%${q}%`).all<Record<string,unknown>>();
   out.push(...r.results.map(x=>({...x,type,metadata:safeJson(x.metadata,{})})));
  }
  return Response.json({results:out});
 }catch(e){return authError(e);}
}
