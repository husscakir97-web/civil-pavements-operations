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

export type ClientSummary={id:string;name:string;legalName:string|null;abn:string|null;contactName:string;email:string;phone:string;status:string;revision:number;sites:SiteSummary[];contacts:ContactSummary[]};
export type ContactSummary={id:string;clientId:string;name:string;role:string|null;email:string|null;phone:string|null;mobile:string|null;isPrimary:boolean;revision:number};
export type SiteSummary={id:string;clientId:string|null;name:string;address:string|null;label:string};

export const siteLabel=(s:{name:string;address?:string|null;suburb?:string|null})=>[s.name,s.address&&s.address!==s.name?s.address:null,s.suburb].filter(Boolean).join(', ');
const site=(r:Row):SiteSummary=>({id:r.id,clientId:r.client_id??null,name:r.name,address:r.address??null,label:siteLabel(r as {name:string})});
const contact=(r:Row):ContactSummary=>({id:r.id,clientId:r.client_id,name:r.name,role:r.role??null,email:r.email??null,phone:r.phone??null,mobile:r.mobile??null,isPrimary:Boolean(Number(r.is_primary)),revision:Number(r.revision||1)});
const client=(r:Row,sites:SiteSummary[],contacts:ContactSummary[]=[]):ClientSummary=>({id:r.id,name:r.name,legalName:r.legal_name??null,abn:r.abn??null,contactName:r.contact_name||'',email:r.email||'',phone:r.phone||'',status:r.status||'active',revision:Number(r.revision||1),sites,contacts});
const like=(q:string)=>`%${q.replace(/[\\%_]/g,m=>'\\'+m)}%`;

/** Searchable client list with each client's sites. Small registers are returned whole for instant client-side filtering. */
export async function listClients(q=''){
 needView();
 const org=actor().organisationId,term=q.trim().slice(0,120);
 // Legacy clients columns are utf8mb4_bin (case-sensitive), so compare lower-cased.
 const where=term?' AND (LOWER(name) LIKE ? OR LOWER(legal_name) LIKE ? OR LOWER(abn) LIKE ? OR LOWER(contact_name) LIKE ? OR LOWER(account_reference) LIKE ?)':'';
 const rows=await query(`SELECT * FROM clients WHERE organisation_id=?${where} ORDER BY status='active' DESC,name LIMIT 500`,[org,...(term?Array(5).fill(like(term.toLowerCase())):[])]);
 const ids=rows.map(r=>r.id);
 const sites=ids.length?await query("SELECT * FROM client_sites WHERE organisation_id=? AND client_id IN (?) AND status='active' ORDER BY name",[org,ids]):[];
 const contacts=ids.length?await query("SELECT * FROM client_contacts WHERE organisation_id=? AND client_id IN (?) AND status='active' ORDER BY is_primary DESC,name",[org,ids]):[];
 return {clients:rows.map(r=>client(r,sites.filter(s=>s.client_id===r.id).map(site),contacts.filter(c=>c.client_id===r.id).map(contact)))};
}

export async function getClient(id:string,conn:Conn=getPool()){
 const org=actor().organisationId;
 const r=await one('SELECT * FROM clients WHERE organisation_id=? AND id=?',[org,id],conn);
 if(!r)return null;
 const sites=await query("SELECT * FROM client_sites WHERE organisation_id=? AND client_id=? AND status='active' ORDER BY name",[org,id],conn);
 const contacts=await query("SELECT * FROM client_contacts WHERE organisation_id=? AND client_id=? AND status='active' ORDER BY is_primary DESC,name",[org,id],conn);
 return client(r,sites.map(site),contacts.map(contact));
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

// ---------------------------------------------------------------- contacts
export const contactInput=z.object({name:z.string().trim().min(1,'Contact name is required.').max(160),role:z.string().trim().max(120).nullish(),email:z.string().trim().max(254).nullish(),phone:z.string().trim().max(60).nullish(),mobile:z.string().trim().max(60).nullish(),isPrimary:z.boolean().optional(),notes:z.string().trim().max(5000).nullish()});

/** Adds a contact to a client. Only one active contact is primary. */
export async function addContact(clientId:string,input:z.infer<typeof contactInput>){
 needEdit();
 const a=actor(),v=contactInput.parse(input);
 return tx(async conn=>{
  if(!await one('SELECT id FROM clients WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,clientId],conn))fail(400,'Client not found.');
  if(v.isPrimary)await exec("UPDATE client_contacts SET is_primary=0 WHERE organisation_id=? AND client_id=?",[a.organisationId,clientId],conn);
  const id=uuid(),now=nowIso();
  await exec('INSERT INTO client_contacts (id,organisation_id,client_id,name,role,email,phone,mobile,is_primary,notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,a.organisationId,clientId,v.name,v.role||null,v.email||null,v.phone||null,v.mobile||null,v.isPrimary?1:0,v.notes||null,'active',1,a.userId,now,now],conn);
  await audit({event:'client_contact.created',entityType:'client_contact',entityId:id,summary:`Contact added: ${v.name}`,after:{clientId,...v}},conn);
  return {client:(await getClient(clientId,conn))!};
 });
}

/** Edits or removes (archives) a contact; history stays in the audit log. */
export async function updateContact(id:string,revision:number,input:Partial<z.infer<typeof contactInput>>&{archived?:boolean}){
 needEdit();
 const a=actor(),v=contactInput.partial().extend({archived:z.boolean().optional()}).parse(input);
 return tx(async conn=>{
  const row=await one('SELECT * FROM client_contacts WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);
  if(!row)fail(404,'Contact not found.');
  if(Number(row!.revision)!==Number(revision))fail(409,'This contact was changed by someone else. Refresh to see the latest version.');
  const map:Record<string,string>={name:'name',role:'role',email:'email',phone:'phone',mobile:'mobile',notes:'notes'};
  const set:Row={};
  for(const [k,col] of Object.entries(map))if((v as Row)[k]!==undefined)set[col]=(v as Row)[k]||null;
  if(set.name===null)fail(400,'Contact name is required.');
  if(v.isPrimary!==undefined){set.is_primary=v.isPrimary?1:0;if(v.isPrimary)await exec('UPDATE client_contacts SET is_primary=0 WHERE organisation_id=? AND client_id=? AND id<>?',[a.organisationId,row!.client_id,id],conn);}
  if(v.archived)set.status='archived';
  const cols=Object.keys(set);
  if(cols.length){
   await exec(`UPDATE client_contacts SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,id],conn);
   await audit({event:v.archived?'client_contact.archived':'client_contact.updated',entityType:'client_contact',entityId:id,summary:`Contact ${v.archived?'removed':'updated'}: ${row!.name}`,before:Object.fromEntries(cols.map(c=>[c,row![c]])),after:set},conn);
  }
  return {client:(await getClient(row!.client_id,conn))!};
 });
}
