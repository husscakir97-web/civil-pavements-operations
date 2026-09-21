import { requireEstimateDb, safeJson } from "@/lib/estimates-db";
import { requireActor, authError } from "@/lib/authz";

type SearchSpec={table:string;type:string;name:string;status:string;detail:string;metadata:string;filter?:string};

const specs:SearchSpec[]=[
 {table:"clients",type:"Client",name:"name",status:"'active'",detail:"contact_name || ' ' || email || ' ' || phone",metadata:"'{}'"},
 {table:"opportunities",type:"Opportunity",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"estimates",type:"Estimate",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"jobs",type:"Project",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"shifts",type:"Shift",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"variations",type:"Variation",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"commercial_records",type:"Commercial",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"attachments",type:"Document",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"workers",type:"Worker",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"plant",type:"Plant",name:"name",status:"status",detail:"metadata",metadata:"metadata",filter:"AND lower(status) != 'archived'"},
 {table:"dockets",type:"Docket",name:"docket_no",status:"status",detail:"client || ' ' || project || ' ' || po_number || ' ' || notes",metadata:"'{}'",filter:"AND lower(status) != 'archived'"},
];

export async function GET(request:Request){
 try{
  const db=requireEstimateDb(),actor=await requireActor(request,db,"read");
  const q=(new URL(request.url).searchParams.get("q")||"").trim().slice(0,200);
  if(q.length<2)return Response.json({results:[]});
  const out:Record<string,unknown>[]=[];
  for(const spec of specs){
   const r=await db.prepare(
    `SELECT id,${spec.name} AS name,${spec.status} AS status,${spec.metadata} AS metadata FROM ${spec.table} WHERE organisation_id=? ${spec.filter||""} AND (${spec.name} LIKE ? OR ${spec.detail} LIKE ?) LIMIT 12`
   ).bind(actor.organisationId,`%${q}%`,`%${q}%`).all<Record<string,unknown>>();
   out.push(...r.results.map(x=>({...x,type:spec.type,metadata:safeJson(x.metadata,{})})));
  }
  return Response.json({results:out.slice(0,60)});
 }catch(e){return authError(e);}
}
