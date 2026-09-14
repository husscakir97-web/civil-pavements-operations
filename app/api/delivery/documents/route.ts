import { env } from 'cloudflare:workers';
import { requireEstimateDb, jsonError } from '@/lib/estimates-db';
import { requireActor, authError } from '@/lib/authz';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try { const db = requireEstimateDb(); const actor = await requireActor(request, db, 'write');
    const form=await request.formData();const file=form.get('file');
    if(!(file instanceof File)||!file.size||file.size>20*1024*1024)return jsonError('Choose a file up to 20 MB.');
    if(!env.BUCKET)return jsonError('Document storage is unavailable.',503);
    const id=crypto.randomUUID();const key=`delivery/${actor.organisationId}/${id}`;
    await env.BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:'application/octet-stream'}});
    await db.prepare('INSERT INTO attachments (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(id,actor.organisationId,file.name,'active',JSON.stringify({key,size:file.size,contentType:file.type||'application/octet-stream'}),new Date().toISOString()).run();
    return Response.json({id,name:file.name,url:`/api/delivery/documents?id=${id}`},{status:201});
  }catch(e){console.error(e);return authError(e);}
}
export async function GET(request:Request) {
  try {
    const db = requireEstimateDb(); const actor = await requireActor(request, db, 'read');
    const id=new URL(request.url).searchParams.get('id');
    const row=await db.prepare('SELECT name,metadata FROM attachments WHERE id=? AND organisation_id=?').bind(id,actor.organisationId).first<{name:string;metadata:string}>();
    if(!row)return jsonError('Document not found.',404);
    const object=await env.BUCKET?.get(JSON.parse(row.metadata).key);if(!object)return jsonError('Document not found.',404);
    const meta = JSON.parse(row.metadata) as {contentType?:string};
    return new Response(object.body,{headers:{'Content-Type':meta.contentType||'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
  }catch(e){console.error(e);return authError(e);}
}
