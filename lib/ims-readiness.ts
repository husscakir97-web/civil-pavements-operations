import type { Database } from '@/lib/platform/database';
import {preparationReadiness} from './preparation-db';
/** Readiness is derived from current approved evidence, never from a UI checkbox. */
export async function imsBlockers(db:Database,organisationId:string,jobId:string){
 const preparation=await preparationReadiness(db,organisationId,jobId);
 const items=await db.prepare(`SELECT i.title,i.status,i.mandatory,d.status AS document_status,d.expiry_date,d.effective_date,d.storage_attachment_id,a.id AS attachment_id FROM job_ims_items i LEFT JOIN ims_documents d ON d.id=i.linked_document_id AND d.organisation_id=i.organisation_id LEFT JOIN attachments a ON a.id=d.storage_attachment_id AND a.organisation_id=i.organisation_id WHERE i.organisation_id=? AND i.job_id=?`).bind(organisationId,jobId).all<Record<string,unknown>>();
 if(!items.results.length)return preparation ?? ['Project IMS pack has not been created and reviewed.'];
 const today=new Date().toISOString().slice(0,10);
 return [...(preparation||[]),...items.results.filter(i=>Number(i.mandatory)===1&&(!['Approved','Accepted'].includes(String(i.status))||!['Approved','Accepted'].includes(String(i.document_status))||!i.attachment_id||(i.expiry_date&&String(i.expiry_date)<today)||(i.effective_date&&String(i.effective_date)>today))).map(i=>`IMS: ${i.title} requires current approved evidence.`)];
}
