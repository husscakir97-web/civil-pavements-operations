// Core clients and sites: created once, selected everywhere (opportunities,
// tenders, projects, shifts via their project). Every query is scoped to the
// session organisation. Transactions keep a text snapshot (client_name,
// location/site_address) next to client_id/site_id so history survives edits.
import {z} from 'zod';
import {actorContext} from './context';
import {can} from './permissions';
import {audit} from './audit';
import {fail} from './http';
import {query,one,exec,tx,nowIso,uuid,type Conn,type Row} from './sql';
import {getPool} from './database';

const actor=()=>actorContext.getStore()!;
export const canViewClients=(role:string)=>can(role,'pipeline.view')||can(role,'project.view');
export const canEditClients=(role:string)=>can(role,'pipeline.edit')||can(role,'project.edit');
function needView(){if(!canViewClients(actor().role))fail(403,'You are not authorised to view clients.');}
function needEdit(){if(!canEditClients(actor().role))fail(403,'You are not authorised to change clients.');}

export type ClientSummary={id:string;name:string;legalName:string|null;abn:string|null;contactName:string;email:string;phone:string;status:string;revision:number;sites:SiteSummary[]};
export type SiteSummary={id:string;clientId:string|null;name:string;address:string|null;label:string};

export const siteLabel=(s:{name:string;address?:string|null;suburb?:string|null})=>[s.name,s.address&&s.address!==s.name?s.address:null,s.suburb].filter(Boolean).join(', ');
const site=(r:Row):SiteSummary=>({id:r.id,clientId:r.client_id??null,name:r.name,address:r.address??null,label:siteLabel(r as {name:string})});
const client=(r:Row,sites:SiteSummary[]):ClientSummary=>({id:r.id,name:r.name,legalName:r.legal_name??null,abn:r.abn??null,contactName:r.contact_name||'',email:r.email||'',phone:r.phone||'',status:r.status||'active',revision:Number(r.revision||1),sites});
const like=(q:string)=>`%${q.replace(/[\\%_]/g,m=>'\\'+m)}%`;

/** Searchable client list with each client's sites. Small registers are returned whole for instant client-side filtering. */
export async function listClients(q=''){
 needView();
 const org=actor().organisationId,term=q.trim().slice(0,120);
 const where=term?' AND (name LIKE ? OR legal_name LIKE ? OR abn LIKE ? OR contact_name LIKE ? OR account_reference LIKE ?)':'';
 const rows=await query(`SELECT * FROM clients WHERE organisation_id=?${where} ORDER BY status='active' DESC,name LIMIT 500`,[org,...(term?Array(5).fill(like(term)):[])]);
 const ids=rows.map(r=>r.id);
 const sites=ids.length?await query("SELECT * FROM client_sites WHERE organisation_id=? AND client_id IN (?) AND status='active' ORDER BY name",[org,ids]):[];
 return {clients:rows.map(r=>client(r,sites.filter(s=>s.client_id===r.id).map(site)))};
}

export async function getClient(id:string,conn:Conn=getPool()){
 const org=actor().organisationId;
 const r=await one('SELECT * FROM clients WHERE organisation_id=? AND id=?',[org,id],conn);
 if(!r)return null;
 const sites=await query("SELECT * FROM client_sites WHERE organisation_id=? AND client_id=? AND status='active' ORDER BY name",[org,id],conn);
 return client(r,sites.map(site));
}

export const clientInput=z.object({
 name:z.string().trim().min(1,'Client name is required.').max(255),
 legalName:z.string().trim().max(255).nullish(),
 abn:z.string().trim().max(20).nullish(),
 contactName:z.string().trim().max(160).nullish(),
 email:z.string().trim().max(254).nullish(),
 phone:z.string().trim().max(60).nullish(),
 notes:z.string().trim().max(5000).nullish(),
 site:z.object({name:z.string().trim().max(255).nullish(),address:z.string().trim().min(1).max(500)}).nullish(),
});
export const siteInput=z.object({clientId:z.string().max(191).nullish(),name:z.string().trim().max(255).nullish(),address:z.string().trim().max(500).nullish(),suburb:z.string().trim().max(120).nullish(),state:z.string().trim().max(20).nullish(),postcode:z.string().trim().max(10).nullish(),accessNotes:z.string().trim().max(5000).nullish()}).refine(s=>Boolean(s.name||s.address),'Enter a site name or address.');

/**
 * Quick create (only the name is required). An exact, case-insensitive name match
 * returns the existing client instead of creating a duplicate; near matches are
 * never merged automatically.
 */
export async function createClient(input:z.infer<typeof clientInput>){
 needEdit();
 const a=actor(),v=clientInput.parse(input);
 return tx(async conn=>{
  const existing=await one('SELECT id FROM clients WHERE organisation_id=? AND LOWER(TRIM(name))=LOWER(?) LIMIT 1 FOR UPDATE',[a.organisationId,v.name],conn);
  let id=existing?.id as string|undefined;
  if(!id){
   id=uuid();const now=nowIso();
   await exec('INSERT INTO clients (id,organisation_id,name,contact_name,email,phone,legal_name,abn,notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,a.organisationId,v.name,v.contactName||'',v.email||'',v.phone||'',v.legalName||null,v.abn?.replace(/\s+/g,'')||null,v.notes||null,'active',1,a.userId,now,now],conn);
   await audit({event:'client.created',entityType:'client',entityId:id,summary:`Client created: ${v.name}`,after:{...v,site:undefined}},conn);
  }
  if(v.site)await insertSite({clientId:id,name:v.site.name||null,address:v.site.address},conn);
  return {client:(await getClient(id,conn))!,existing:Boolean(existing)};
 });
}

export async function updateClient(id:string,revision:number,input:Partial<z.infer<typeof clientInput>>&{status?:'active'|'inactive'}){
 needEdit();
 const a=actor(),v=clientInput.partial().extend({status:z.enum(['active','inactive']).optional()}).parse(input);
 const map:Record<string,string>={name:'name',legalName:'legal_name',abn:'abn',contactName:'contact_name',email:'email',phone:'phone',notes:'notes',status:'status'};
 return tx(async conn=>{
  const row=await one('SELECT * FROM clients WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);
  if(!row)fail(404,'Client not found.');
  if(Number(row!.revision||1)!==Number(revision))fail(409,'This client was changed by someone else. Refresh to see the latest version.');
  const set:Row={};
  for(const [k,col] of Object.entries(map))if(k in v&&(v as Row)[k]!==undefined)set[col]=['contact_name','email','phone'].includes(col)?((v as Row)[k]??''):(v as Row)[k]??null;
  if(set.name!==undefined&&!String(set.name).trim())fail(400,'Client name is required.');
  const cols=Object.keys(set);
  if(cols.length){
   await exec(`UPDATE clients SET ${cols.map(c=>`${c}=?`).join(',')},revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,id],conn);
   await audit({event:'client.updated',entityType:'client',entityId:id,summary:`Client updated: ${String(set.name??row!.name).slice(0,120)}`,before:Object.fromEntries(cols.map(c=>[c,row![c]])),after:set},conn);
  }
  return {client:(await getClient(id,conn))!};
 });
}

async function insertSite(v:z.infer<typeof siteInput>,conn:Conn){
 const a=actor(),org=a.organisationId;
 if(v.clientId&&!await one('SELECT id FROM clients WHERE organisation_id=? AND id=?',[org,v.clientId],conn))fail(400,'Client not found.');
 const name=(v.name||v.address||'').trim().slice(0,255);
 const dup=await one("SELECT * FROM client_sites WHERE organisation_id=? AND client_id<=>? AND LOWER(name)=LOWER(?) AND status='active' LIMIT 1",[org,v.clientId||null,name],conn);
 if(dup)return site(dup);
 const id=uuid(),now=nowIso();
 await exec('INSERT INTO client_sites (id,organisation_id,client_id,name,address,suburb,state,postcode,access_notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,org,v.clientId||null,name,v.address||null,v.suburb||null,v.state||null,v.postcode||null,v.accessNotes||null,'active',1,a.userId,now,now],conn);
 await audit({event:'client_site.created',entityType:'client_site',entityId:id,summary:`Site added: ${name}`,after:v},conn);
 return site((await one('SELECT * FROM client_sites WHERE id=?',[id],conn))!);
}
export async function createSite(input:z.infer<typeof siteInput>){needEdit();const v=siteInput.parse(input);return tx(async conn=>({site:await insertSite(v,conn)}));}

/**
 * Validates client/site references for a write and returns the snapshot text to
 * store alongside them. A site must belong to the chosen client (or to no client).
 */
export async function resolveClientContext(clientId:string|null|undefined,siteId:string|null|undefined,conn:Conn=getPool()){
 const org=actor().organisationId;
 const c=clientId?await one('SELECT id,name FROM clients WHERE organisation_id=? AND id=?',[org,clientId],conn):null;
 if(clientId&&!c)fail(400,'Client not found. Choose a client from the list.');
 const s=siteId?await one('SELECT * FROM client_sites WHERE organisation_id=? AND id=?',[org,siteId],conn):null;
 if(siteId&&!s)fail(400,'Site not found. Choose a site from the list.');
 if(s&&s.client_id&&clientId&&s.client_id!==clientId)fail(400,'That site belongs to a different client.');
 return {clientId:c?.id as string|null??null,clientName:c?.name as string|null??null,siteId:s?.id as string|null??null,siteLabel:s?siteLabel(s as {name:string}):null};
}
