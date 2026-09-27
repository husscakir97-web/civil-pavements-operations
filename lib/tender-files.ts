import {z} from 'zod';
import {actorContext} from './platform/context';
import {requireEstimateDb,jsonError} from './estimates-db';
import {tenderPack} from './tender-db';

const selection=z.object({opportunityId:z.string().min(1).max(191),documentIds:z.array(z.string().min(1).max(191)).min(1).max(100)}).strict();
export async function changeTenderFiles(request:Request,restore=false){
 const parsed=selection.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return jsonError('Select between 1 and 100 tender files.',400);
 const {opportunityId}=parsed.data,ids=[...new Set(parsed.data.documentIds)],actor=actorContext.getStore()!;
 const {docs,removed}=await tenderPack(opportunityId,true),all=[...docs,...removed];
 if(ids.some(id=>!all.some(d=>d.id===id)))return jsonError('One or more files are not in this tender pack. Refresh and try again.',404);
 const status=restore?'active':'tender-removed',db=requireEstimateDb();
 // Preserve original bytes and extracted evidence for undo and historical use.
 // Only status changes, so an in-flight extraction cannot restore a removed file.
 await db.batch([
  ...ids.map(id=>db.prepare("UPDATE attachments SET status=? WHERE id=? AND organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.opportunityId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='tender'").bind(status,id,actor.organisationId,opportunityId)),
  db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,restore?'tender.files.restored':'tender.files.removed','recorded',JSON.stringify({opportunityId,documentIds:ids,actorId:actor.userId}),new Date().toISOString())
 ]);
 return Response.json({documentIds:ids,restored:restore});
}
