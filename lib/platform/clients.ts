// Core client master: clients, their contacts and reusable sites. Created once,
// selected everywhere (opportunities, tenders, estimates, projects, jobs). This is
// Core — every module that needs a client uses the same records. Every query is
// scoped to the session organisation. Transactions keep a text snapshot
// (client_name, location/site_address) next to client_id/site_id/contact_id so
// history survives later edits and renames.
import {z} from 'zod';
import {actorContext} from './context';
import {can} from './permissions';
import {audit} from './audit';
import {fail} from './http';
import {query,one,exec,tx,nowIso,uuid,type Conn,type Row} from './sql';
import {getPool} from './database';
import {orgWideProjects,memberProjectIds} from './project-access';
import {matchClient,matchContact,matchSite,strongAbn,abnDigits,collapse,legacyClientFor,nameKey} from '@/lib/v1/crm-match';

const actor=()=>actorContext.getStore()!;
/** Anyone who works with pipeline, projects or the schedule can see and pick clients (engineers: their projects' clients only). */
export const canViewClients=(role:string)=>can(role,'pipeline.view')||can(role,'project.view')||can(role,'schedule.view');
/** Quick create inside a workflow: a new client, or a site/contact on a client (crm.create). */
export const canCreateClients=(role:string)=>can(role,'crm.create');
/** Changing existing master records: identity/contact fields, status, contacts and sites (crm.edit). */
export const canEditClients=(role:string)=>can(role,'crm.edit');
/** CRM administration: bulk import, merge, legacy linking, bulk status/owner changes (crm.manage). */
export const canManageClients=(role:string)=>can(role,'crm.manage');
const commercial=(role:string)=>can(role,'commercial.view');
function needView(){if(!canViewClients(actor().role))fail(403,'You are not authorised to view clients.');}
function needCreate(){if(!canCreateClients(actor().role))fail(403,'You are not authorised to add clients.');}
function needEdit(){if(!canEditClients(actor().role))fail(403,'You are not authorised to change client records.');}
function needManage(){if(!canManageClients(actor().role))fail(403,'You are not authorised to administer the client master.');}

export type ContactSummary={id:string;clientId:string;name:string;firstName:string|null;lastName:string|null;role:string|null;department:string|null;email:string|null;phone:string|null;mobile:string|null;isPrimary:boolean;status:string;notes:string|null;revision:number};
export type SiteSummary={id:string;clientId:string|null;name:string;address:string|null;suburb:string|null;state:string|null;postcode:string|null;siteContact:string|null;accessNotes:string|null;status:string;label:string;revision:number};
export type ClientSummary={id:string;name:string;legalName:string|null;abn:string|null;clientCode:string|null;contactName:string;email:string;phone:string;website:string|null;tags:string[];ownerUserId:string|null;notes:string|null;status:string;mergedIntoId:string|null;revision:number;sites:SiteSummary[];contacts:ContactSummary[];
 /** Commercial fields: present only for roles with commercial access. */
 paymentTermsDays?:number|null;creditStatus?:string|null;billingEmail?:string|null;accountReference?:string|null};

export const siteLabel=(s:{name:string;address?:string|null;suburb?:string|null})=>[s.name,s.address&&s.address!==s.name?s.address:null,s.suburb].filter(Boolean).join(', ');
const site=(r:Row):SiteSummary=>({id:r.id,clientId:r.client_id??null,name:r.name,address:r.address??null,suburb:r.suburb??null,state:r.state??null,postcode:r.postcode??null,siteContact:r.site_contact??null,accessNotes:r.access_notes??null,status:r.status||'active',label:siteLabel(r as {name:string}),revision:Number(r.revision||1)});
const contact=(r:Row):ContactSummary=>({id:r.id,clientId:r.client_id,name:r.name,firstName:r.first_name??null,lastName:r.last_name??null,role:r.role??null,department:r.department??null,email:r.email??null,phone:r.phone??null,mobile:r.mobile??null,isPrimary:Boolean(Number(r.is_primary)),status:r.status||'active',notes:r.notes??null,revision:Number(r.revision||1)});
function client(r:Row,sites:SiteSummary[],contacts:ContactSummary[]=[]):ClientSummary{
 const out:ClientSummary={id:r.id,name:r.name,legalName:r.legal_name??null,abn:r.abn??null,clientCode:r.client_code??null,contactName:r.contact_name||'',email:r.email||'',phone:r.phone||'',website:r.website??null,tags:String(r.tags||'').split(',').map(t=>t.trim()).filter(Boolean),ownerUserId:r.owner_user_id??null,notes:r.notes??null,status:r.status||'active',mergedIntoId:r.merged_into_id??null,revision:Number(r.revision||1),sites,contacts};
 if(commercial(actor().role))Object.assign(out,{paymentTermsDays:r.payment_terms_days??null,creditStatus:r.credit_status??null,billingEmail:r.billing_email??null,accountReference:r.account_reference??null});
 return out;
}
const like=(q:string)=>`%${q.replace(/[\\%_]/g,m=>'\\'+m)}%`;

/**
 * Clients this user may see. Organisation-wide roles: every client (null). Project/Site
 * Engineers: only clients of projects they are assigned to — never the whole master.
 */
export async function visibleClientIds(conn?:Conn):Promise<string[]|null>{
 const a=actor();
 if(orgWideProjects(a))return null;
 const ids=await memberProjectIds(a,conn);
 if(!ids.length)return [];
 return (await query<{id:string}>('SELECT DISTINCT client_id AS id FROM jobs WHERE organisation_id=? AND id IN (?) AND client_id IS NOT NULL',[a.organisationId,ids],conn)).map(r=>r.id);
}
async function scopeSql(column:string,params:unknown[],conn?:Conn){const ids=await visibleClientIds(conn);if(!ids)return '';params.push(ids.length?ids:['-']);return ` AND ${column} IN (?)`;}
async function assertVisible(id:string,conn?:Conn){const ids=await visibleClientIds(conn);if(ids&&!ids.includes(id))fail(404,'Client not found.');}

async function attach(rows:Row[],conn:Conn=getPool(),includeInactive=false){
 const org=actor().organisationId,ids=rows.map(r=>r.id);
 const status=includeInactive?"status<>'archived'":"status='active'";
 const sites=ids.length?await query(`SELECT * FROM client_sites WHERE organisation_id=? AND client_id IN (?) AND ${includeInactive?"status<>'merged'":"status='active'"} ORDER BY name`,[org,ids],conn):[];
 const contacts=ids.length?await query(`SELECT * FROM client_contacts WHERE organisation_id=? AND client_id IN (?) AND ${status} ORDER BY is_primary DESC,name`,[org,ids],conn):[];
 return rows.map(r=>client(r,sites.filter(s=>s.client_id===r.id).map(site),contacts.filter(c=>c.client_id===r.id).map(contact)));
}

/**
 * Server-side client search (name, legal name, ABN, code, contact names/emails, site names/addresses).
 * Exact and prefix matches rank first, then active clients. Merged clients never appear.
 */
export async function listClients(q='',opts:{limit?:number;includeInactive?:boolean;ids?:string[]}={}){
 needView();
 const org=actor().organisationId,term=q.trim().slice(0,120).toLowerCase(),limit=Math.min(Math.max(opts.limit||500,1),500);
 const params:unknown[]=[org];let where=" AND status<>'merged'";
 if(term){
  const digits=abnDigits(term),t=like(term);
  where+=` AND (LOWER(name) LIKE ? OR LOWER(legal_name) LIKE ? OR LOWER(contact_name) LIKE ? OR LOWER(account_reference) LIKE ? OR LOWER(client_code) LIKE ? OR LOWER(email) LIKE ?${digits.length>=3?' OR REPLACE(abn,\' \',\'\') LIKE ?':''}
   OR EXISTS (SELECT 1 FROM client_contacts k WHERE k.organisation_id=clients.organisation_id AND k.client_id=clients.id AND k.status='active' AND (LOWER(k.name) LIKE ? OR LOWER(k.email) LIKE ?))
   OR EXISTS (SELECT 1 FROM client_sites s WHERE s.organisation_id=clients.organisation_id AND s.client_id=clients.id AND s.status='active' AND (LOWER(s.name) LIKE ? OR LOWER(s.address) LIKE ?)))`;
  params.push(t,t,t,t,t,t,...(digits.length>=3?[like(digits)]:[]),t,t,t,t);
 }
 if(opts.ids?.length){where+=' AND id IN (?)';params.push(opts.ids);}
 where+=await scopeSql('id',params);
 const order=term?'(LOWER(name)=?) DESC,(LOWER(name) LIKE ?) DESC,':'';
 const rows=await query(`SELECT * FROM clients WHERE organisation_id=?${where} ORDER BY ${order}status='active' DESC,name LIMIT ${limit}`,[...params,...(term?[term,like(term).slice(1)]:[])]);
 return {clients:await attach(rows)};
}

export async function getClient(id:string,conn:Conn=getPool(),includeInactive=false){
 const org=actor().organisationId;
 const r=await one('SELECT * FROM clients WHERE organisation_id=? AND id=?',[org,id],conn);
 if(!r)return null;
 return (await attach([r],conn,includeInactive))[0];
}
/** One client for its detail page (inactive contacts and sites included); 404 outside scope. */
export async function clientDetail(id:string){
 needView();await assertVisible(id);
 const c=await getClient(id,getPool(),true);if(!c)fail(404,'Client not found.');
 return c!;
}

/** CRM workspace lists: contacts or sites across clients, searched and paged on the server. */
export async function searchCrm(view:'contacts'|'sites',q='',page=1){
 needView();
 const org=actor().organisationId,term=q.trim().slice(0,120).toLowerCase(),size=50,offset=(Math.max(1,page)-1)*size,params:unknown[]=[org];
 let where=" AND c.status<>'merged' AND x.status<>'merged'";
 if(term){const t=like(term);where+=view==='contacts'?' AND (LOWER(x.name) LIKE ? OR LOWER(x.email) LIKE ? OR LOWER(x.role) LIKE ? OR x.phone LIKE ? OR x.mobile LIKE ? OR LOWER(c.name) LIKE ?)':' AND (LOWER(x.name) LIKE ? OR LOWER(x.address) LIKE ? OR LOWER(x.suburb) LIKE ? OR LOWER(c.name) LIKE ?)';params.push(...(view==='contacts'?[t,t,t,t,t,t]:[t,t,t,t]));}
 where+=await scopeSql('c.id',params);
 const table=view==='contacts'?'client_contacts':'client_sites';
 const rows=await query(`SELECT x.*,c.name AS client_name FROM ${table} x JOIN clients c ON c.organisation_id=x.organisation_id AND c.id=x.client_id WHERE x.organisation_id=?${where} ORDER BY x.status='active' DESC,x.name LIMIT ${size+1} OFFSET ${offset}`,params);
 const more=rows.length>size;
 return {view,page,more,items:rows.slice(0,size).map(r=>({...(view==='contacts'?contact(r):site(r)),clientName:r.client_name}))};
}

const opt=(n:number)=>z.string().trim().max(n).nullish();
export const clientInput=z.object({
 name:z.string().trim().min(1,'Client name is required.').max(255),
 legalName:opt(255),abn:opt(20),clientCode:opt(80),contactName:opt(160),email:opt(254),phone:opt(60),website:opt(255),notes:z.string().trim().max(5000).nullish(),
 tags:z.array(z.string().trim().max(40)).max(20).nullish(),ownerUserId:opt(191),
 paymentTermsDays:z.number().int().min(0).max(365).nullish(),creditStatus:opt(30),billingEmail:opt(254),accountReference:opt(80),
 site:z.object({name:opt(255),address:z.string().trim().min(1).max(500)}).nullish(),
 contact:z.object({name:z.string().trim().min(1).max(160),email:opt(254),phone:opt(60),role:opt(120)}).nullish(),
});
export const siteInput=z.object({clientId:opt(191),name:opt(255),address:opt(500),suburb:opt(120),state:opt(20),postcode:opt(10),siteContact:opt(160),accessNotes:z.string().trim().max(5000).nullish()}).refine(s=>Boolean(s.name||s.address),'Enter a site name or address.');
const COMMERCIAL_KEYS=['paymentTermsDays','creditStatus','billingEmail','accountReference'] as const;
const CLIENT_COLUMNS:Record<string,string>={name:'name',legalName:'legal_name',abn:'abn',clientCode:'client_code',contactName:'contact_name',email:'email',phone:'phone',website:'website',notes:'notes',tags:'tags',ownerUserId:'owner_user_id',paymentTermsDays:'payment_terms_days',creditStatus:'credit_status',billingEmail:'billing_email',accountReference:'account_reference',status:'status'};
const NOT_NULL_TEXT=['contact_name','email','phone'];
/** ABN is stored as its digits when it is a valid ABN; anything else is kept as typed so nothing is lost. */
const storeAbn=(v:string|null|undefined)=>v?(strongAbn(v)||collapse(v)):null;
function clientColumns(v:Row,role:string){
 const set:Row={};
 for(const [k,col] of Object.entries(CLIENT_COLUMNS)){
  if(!(k in v)||v[k]===undefined)continue;
  if((COMMERCIAL_KEYS as readonly string[]).includes(k)&&!commercial(role))continue;
  let val=v[k];
  if(k==='abn')val=storeAbn(val as string|null);
  if(k==='tags')val=Array.isArray(val)?val.filter(Boolean).join(', ')||null:null;
  set[col]=NOT_NULL_TEXT.includes(col)?(val??''):(val===''?null:val??null);
 }
 return set;
}
async function checkOwner(ownerUserId:unknown,conn:Conn){if(ownerUserId&&!await one('SELECT id FROM users WHERE organisation_id=? AND id=?',[actor().organisationId,ownerUserId],conn))fail(400,'Choose an account owner from your organisation.');}

/**
 * Quick create (only the name is required). A deterministic match — same valid ABN, same
 * client code or the same normalised name — returns the existing client instead of a
 * duplicate. Weaker similarities are never merged automatically.
 */
export async function createClient(input:z.infer<typeof clientInput>){
 needCreate();
 const a=actor(),v=clientInput.parse(input);
 return tx(async conn=>{
  const existing=await query("SELECT id,name,legal_name,abn,client_code,status FROM clients WHERE organisation_id=? AND status<>'merged' FOR UPDATE",[a.organisationId],conn);
  const m=matchClient({name:v.name,legalName:v.legalName,abn:v.abn,clientCode:v.clientCode},existing.map(r=>({id:r.id,name:r.name,legalName:r.legal_name,abn:r.abn,clientCode:r.client_code,status:r.status})));
  let id=m.kind==='exact'?m.match!.id:undefined;
  if(!id){
   await checkOwner(v.ownerUserId,conn);
   id=uuid();const now=nowIso(),cols=clientColumns({...v,site:undefined,contact:undefined},a.role);
   const row:Row={contact_name:'',email:'',phone:'',...cols,id,organisation_id:a.organisationId,status:'active',revision:1,created_by:a.userId,created_at:now,updated_at:now};
   const keys=Object.keys(row);
   await exec(`INSERT INTO clients (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]),conn);
   await audit({event:'client.created',entityType:'client',entityId:id,summary:`Client created: ${v.name}`,after:{...cols}},conn);
  }
  if(v.site)await insertSite({clientId:id,name:v.site.name||null,address:v.site.address},conn);
  if(v.contact)await insertContact(id,{name:v.contact.name,email:v.contact.email,phone:v.contact.phone,role:v.contact.role,isPrimary:true},conn);
  return {client:(await getClient(id,conn))!,existing:m.kind==='exact',possibleDuplicates:m.kind==='possible'?m.candidates.map(c=>({id:c.id,name:c.name})):[]};
 });
}

export const clientPatch=clientInput.omit({site:true,contact:true}).partial().extend({status:z.enum(['active','inactive']).optional()});
export async function updateClient(id:string,revision:number,input:z.infer<typeof clientPatch>){
 needEdit();
 const a=actor(),v=clientPatch.parse(input);
 return tx(async conn=>{
  const row=await one('SELECT * FROM clients WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);
  if(!row||row.status==='merged')fail(404,'Client not found.');
  if(Number(row!.revision||1)!==Number(revision))fail(409,'This client was changed by someone else. Refresh to see the latest version.');
  if('ownerUserId' in v)await checkOwner(v.ownerUserId,conn);
  const set=clientColumns(v as Row,a.role);
  if(set.name!==undefined&&!String(set.name).trim())fail(400,'Client name is required.');
  const cols=Object.keys(set).filter(c=>String(row![c]??'')!==String(set[c]??''));
  if(cols.length){
   await exec(`UPDATE clients SET ${cols.map(c=>`${c}=?`).join(',')},revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,id],conn);
   const event=cols.length===1&&cols[0]==='status'?(set.status==='inactive'?'client.inactivated':'client.reactivated'):'client.updated';
   await audit({event,entityType:'client',entityId:id,summary:`Client ${event.split('.')[1]}: ${String(set.name??row!.name).slice(0,120)}`,before:Object.fromEntries(cols.map(c=>[c,row![c]])),after:Object.fromEntries(cols.map(c=>[c,set[c]]))},conn);
  }
  return {client:(await getClient(id,conn,true))!};
 });
}
/** Bulk activate/inactivate or assign an owner. Each client is updated and audited individually. */
export async function bulkUpdateClients(ids:string[],change:{status?:'active'|'inactive';ownerUserId?:string|null}){
 needManage();
 const a=actor();if(!ids.length)return {updated:0};
 return tx(async conn=>{
  if('ownerUserId' in change)await checkOwner(change.ownerUserId,conn);
  const rows=await query("SELECT id,name,status,owner_user_id FROM clients WHERE organisation_id=? AND id IN (?) AND status<>'merged' FOR UPDATE",[a.organisationId,ids.slice(0,500)],conn);
  const set:Row={};if(change.status)set.status=change.status;if('ownerUserId' in change)set.owner_user_id=change.ownerUserId||null;
  const cols=Object.keys(set);if(!cols.length)return {updated:0};
  for(const r of rows){
   await exec(`UPDATE clients SET ${cols.map(c=>`${c}=?`).join(',')},revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,r.id],conn);
   await audit({event:change.status?(change.status==='inactive'?'client.inactivated':'client.reactivated'):'client.updated',entityType:'client',entityId:r.id,summary:`Client bulk update: ${String(r.name).slice(0,120)}`,before:Object.fromEntries(cols.map(c=>[c,r[c]])),after:set},conn);
  }
  return {updated:rows.length};
 });
}

async function insertSite(v:z.infer<typeof siteInput>,conn:Conn){
 const a=actor(),org=a.organisationId;
 if(v.clientId&&!await one("SELECT id FROM clients WHERE organisation_id=? AND id=? AND status<>'merged'",[org,v.clientId],conn))fail(400,'Client not found.');
 const name=(v.name||v.address||'').trim().slice(0,255);
 if(v.clientId){
  const existing=await query("SELECT id,client_id,name,address,status FROM client_sites WHERE organisation_id=? AND client_id=?",[org,v.clientId],conn);
  const m=matchSite(v.clientId,{name,address:v.address},existing.map(s=>({id:s.id,clientId:s.client_id,name:s.name,address:s.address,status:s.status})));
  if(m.kind==='exact')return site((await one('SELECT * FROM client_sites WHERE organisation_id=? AND id=?',[org,m.match!.id],conn))!);
 }else{
  const dup=await one("SELECT * FROM client_sites WHERE organisation_id=? AND client_id IS NULL AND LOWER(name)=LOWER(?) AND status='active' LIMIT 1",[org,name],conn);
  if(dup)return site(dup);
 }
 const id=uuid(),now=nowIso();
 await exec('INSERT INTO client_sites (id,organisation_id,client_id,name,address,suburb,state,postcode,site_contact,access_notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,org,v.clientId||null,name,v.address||null,v.suburb||null,v.state||null,v.postcode||null,v.siteContact||null,v.accessNotes||null,'active',1,a.userId,now,now],conn);
 await audit({event:'client_site.created',entityType:'client_site',entityId:id,summary:`Site added: ${name}`,after:v},conn);
 return site((await one('SELECT * FROM client_sites WHERE id=?',[id],conn))!);
}
export async function createSite(input:z.infer<typeof siteInput>){needCreate();const v=siteInput.parse(input);return tx(async conn=>({site:await insertSite(v,conn)}));}
export const sitePatch=z.object({name:opt(255),address:opt(500),suburb:opt(120),state:opt(20),postcode:opt(10),siteContact:opt(160),accessNotes:z.string().trim().max(5000).nullish(),status:z.enum(['active','inactive']).optional()});
export async function updateSite(id:string,revision:number,input:z.infer<typeof sitePatch>){
 needEdit();
 const a=actor(),v=sitePatch.parse(input);
 return tx(async conn=>{
  const row=await one('SELECT * FROM client_sites WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);
  if(!row)fail(404,'Site not found.');
  if(Number(row!.revision)!==Number(revision))fail(409,'This site was changed by someone else. Refresh to see the latest version.');
  const map:Record<string,string>={name:'name',address:'address',suburb:'suburb',state:'state',postcode:'postcode',siteContact:'site_contact',accessNotes:'access_notes',status:'status'};
  const set:Row={};for(const [k,col] of Object.entries(map))if((v as Row)[k]!==undefined)set[col]=(v as Row)[k]||null;
  if(set.name===null)fail(400,'A site name is required.');
  const cols=Object.keys(set);
  if(cols.length){
   await exec(`UPDATE client_sites SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,id],conn);
   await audit({event:v.status==='inactive'?'client_site.inactivated':v.status==='active'&&row!.status!=='active'?'client_site.reactivated':'client_site.updated',entityType:'client_site',entityId:id,summary:`Site updated: ${row!.name}`,before:Object.fromEntries(cols.map(c=>[c,row![c]])),after:set},conn);
  }
  return {site:site((await one('SELECT * FROM client_sites WHERE id=?',[id],conn))!)};
 });
}

/**
 * Validates client/site/contact references for a write and returns the snapshot text to
 * store alongside them. A site and a contact must belong to the chosen client.
 */
export async function resolveClientContext(clientId:string|null|undefined,siteId:string|null|undefined,conn:Conn=getPool(),contactId?:string|null){
 const org=actor().organisationId;
 const c=clientId?await one("SELECT id,name FROM clients WHERE organisation_id=? AND id=? AND status<>'merged'",[org,clientId],conn):null;
 if(clientId&&!c)fail(400,'Client not found. Choose a client from the list.');
 const s=siteId?await one('SELECT * FROM client_sites WHERE organisation_id=? AND id=?',[org,siteId],conn):null;
 if(siteId&&!s)fail(400,'Site not found. Choose a site from the list.');
 if(s&&s.client_id&&clientId&&s.client_id!==clientId)fail(400,'That site belongs to a different client.');
 const k=contactId?await one('SELECT id,client_id,name FROM client_contacts WHERE organisation_id=? AND id=?',[org,contactId],conn):null;
 if(contactId&&!k)fail(400,'Contact not found. Choose a contact from the list.');
 if(k&&clientId&&k.client_id!==clientId)fail(400,'That contact belongs to a different client.');
 return {clientId:c?.id as string|null??null,clientName:c?.name as string|null??null,siteId:s?.id as string|null??null,siteLabel:s?siteLabel(s as {name:string}):null,contactId:k?.id as string|null??null,contactName:k?.name as string|null??null};
}

// ---------------------------------------------------------------- contacts
export const contactInput=z.object({name:z.string().trim().max(160).optional(),firstName:opt(80),lastName:opt(80),role:opt(120),department:opt(120),email:opt(254),phone:opt(60),mobile:opt(60),isPrimary:z.boolean().optional(),notes:z.string().trim().max(5000).nullish()})
 .refine(c=>Boolean(c.name?.trim()||c.firstName?.trim()||c.lastName?.trim()),'Contact name is required.');
const displayName=(v:{name?:string|null;firstName?:string|null;lastName?:string|null})=>collapse(v.name||[v.firstName,v.lastName].filter(Boolean).join(' ')).slice(0,160);

async function insertContact(clientId:string,v:z.infer<typeof contactInput>,conn:Conn){
 const a=actor(),name=displayName(v);
 const existing=await query("SELECT id,client_id,name,email,phone,mobile,status FROM client_contacts WHERE organisation_id=? AND client_id=?",[a.organisationId,clientId],conn);
 const m=matchContact(clientId,{name,email:v.email,phone:v.phone,mobile:v.mobile},existing.map(r=>({id:r.id,clientId:r.client_id,name:r.name,email:r.email,phone:r.phone,mobile:r.mobile,status:r.status})));
 if(m.kind==='exact')return {id:m.match!.id,existing:true};
 if(v.isPrimary)await exec("UPDATE client_contacts SET is_primary=0 WHERE organisation_id=? AND client_id=?",[a.organisationId,clientId],conn);
 const id=uuid(),now=nowIso();
 await exec('INSERT INTO client_contacts (id,organisation_id,client_id,name,first_name,last_name,role,department,email,phone,mobile,is_primary,notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,a.organisationId,clientId,name,v.firstName||null,v.lastName||null,v.role||null,v.department||null,v.email||null,v.phone||null,v.mobile||null,v.isPrimary?1:0,v.notes||null,'active',1,a.userId,now,now],conn);
 await audit({event:'client_contact.created',entityType:'client_contact',entityId:id,summary:`Contact added: ${name}`,after:{clientId,...v}},conn);
 return {id,existing:false};
}
/** Adds a contact to a client (same email or same name within the client returns the existing contact). */
export async function addContact(clientId:string,input:z.infer<typeof contactInput>){
 needCreate();
 const a=actor(),v=contactInput.parse(input);
 return tx(async conn=>{
  if(!await one("SELECT id FROM clients WHERE organisation_id=? AND id=? AND status<>'merged' FOR UPDATE",[a.organisationId,clientId],conn))fail(400,'Client not found.');
  const r=await insertContact(clientId,v,conn);
  return {client:(await getClient(clientId,conn))!,contactId:r.id,existing:r.existing};
 });
}

/** Edits, inactivates (archives) or reactivates a contact; history stays in the audit log. */
export async function updateContact(id:string,revision:number,input:Partial<z.input<typeof contactInput>>&{archived?:boolean}){
 needEdit();
 const a=actor(),v=z.object({name:opt(160),firstName:opt(80),lastName:opt(80),role:opt(120),department:opt(120),email:opt(254),phone:opt(60),mobile:opt(60),isPrimary:z.boolean().optional(),notes:z.string().trim().max(5000).nullish(),archived:z.boolean().optional()}).parse(input);
 return tx(async conn=>{
  const row=await one('SELECT * FROM client_contacts WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);
  if(!row)fail(404,'Contact not found.');
  if(Number(row!.revision)!==Number(revision))fail(409,'This contact was changed by someone else. Refresh to see the latest version.');
  const map:Record<string,string>={name:'name',firstName:'first_name',lastName:'last_name',role:'role',department:'department',email:'email',phone:'phone',mobile:'mobile',notes:'notes'};
  const set:Row={};
  for(const [k,col] of Object.entries(map))if((v as Row)[k]!==undefined)set[col]=(v as Row)[k]||null;
  if(('first_name' in set||'last_name' in set)&&!('name' in set))set.name=displayName({firstName:set.first_name??row!.first_name,lastName:set.last_name??row!.last_name})||row!.name;
  if(set.name===null)fail(400,'Contact name is required.');
  if(v.isPrimary!==undefined){set.is_primary=v.isPrimary?1:0;if(v.isPrimary)await exec('UPDATE client_contacts SET is_primary=0 WHERE organisation_id=? AND client_id=? AND id<>?',[a.organisationId,row!.client_id,id],conn);}
  if(v.archived!==undefined)set.status=v.archived?'archived':'active';
  const cols=Object.keys(set);
  if(cols.length){
   await exec(`UPDATE client_contacts SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,id],conn);
   await audit({event:v.archived?'client_contact.archived':v.archived===false?'client_contact.reactivated':'client_contact.updated',entityType:'client_contact',entityId:id,summary:`Contact ${v.archived?'removed':'updated'}: ${row!.name}`,before:Object.fromEntries(cols.map(c=>[c,row![c]])),after:set},conn);
  }
  return {client:(await getClient(row!.client_id,conn))!};
 });
}

// ---------------------------------------------------------------- merge
/** Records that point at a client. Estimates keep their client inside the revision snapshot and are not rewritten. */
const CLIENT_REFS=[['opportunities','Opportunities'],['tenders','Tenders'],['jobs','Projects'],['client_contacts','Contacts'],['client_sites','Sites']] as const;
/**
 * Merge `mergeId` into `keepId`: every client reference moves to the kept client, the merged
 * client becomes status "merged" with merged_into_id (never deleted), and the move is audited.
 * Record snapshots (client_name) are left as they were for historical integrity.
 */
export async function mergeClients(keepId:string,mergeId:string,confirm=false){
 needManage();
 const a=actor(),org=a.organisationId;
 if(keepId===mergeId)fail(400,'Choose two different clients.');
 const work=async(conn:Conn)=>{
  const [keep,drop]=await Promise.all([one("SELECT * FROM clients WHERE organisation_id=? AND id=? AND status<>'merged'"+(confirm?' FOR UPDATE':''),[org,keepId],conn),one("SELECT * FROM clients WHERE organisation_id=? AND id=? AND status<>'merged'"+(confirm?' FOR UPDATE':''),[org,mergeId],conn)]);
  if(!keep||!drop)fail(404,'Client not found.');
  const affected:Record<string,number>={};
  for(const [table,label] of CLIENT_REFS)affected[label]=Number((await one<{n:number}>(`SELECT COUNT(*) AS n FROM ${table} WHERE organisation_id=? AND client_id=?`,[org,mergeId],conn))?.n||0);
  // Warn about records that will sit side by side after the merge (they are kept, never auto-merged).
  const [contacts,sites]=await Promise.all([
   query("SELECT id,client_id,name,email,is_primary FROM client_contacts WHERE organisation_id=? AND client_id IN (?) AND status='active'",[org,[keepId,mergeId]],conn),
   query("SELECT id,client_id,name,address FROM client_sites WHERE organisation_id=? AND client_id IN (?) AND status='active'",[org,[keepId,mergeId]],conn),
  ]);
  const warnings:string[]=[];
  const email=(e:unknown)=>String(e||'').trim().toLowerCase();
  for(const k of contacts.filter(x=>x.client_id===mergeId&&email(x.email)))for(const o of contacts.filter(x=>x.client_id===keepId&&email(x.email)===email(k.email)))warnings.push(`Contacts “${k.name}” and “${o.name}” share the email ${email(k.email)}; both are kept.`);
  const skey=(x:Row)=>[nameKey(x.name),nameKey(x.address)].filter(Boolean);
  for(const k of sites.filter(x=>x.client_id===mergeId))for(const o of sites.filter(x=>x.client_id===keepId))if(skey(k).some(v=>skey(o).includes(v)))warnings.push(`Sites “${k.name}” and “${o.name}” look like the same place; both are kept.`);
  // One primary contact per client: the kept client's primary wins; otherwise a single primary moves across.
  const keepPrimary=contacts.filter(x=>x.client_id===keepId&&Number(x.is_primary)),dropPrimary=contacts.filter(x=>x.client_id===mergeId&&Number(x.is_primary));
  const primaryRule=keepPrimary.length?(dropPrimary.length?`${dropPrimary.map(x=>x.name).join(', ')} will no longer be primary; ${keepPrimary[0].name} stays the primary contact.`:null)
   :dropPrimary.length===1?`${dropPrimary[0].name} becomes the primary contact.`
   :dropPrimary.length>1?`The duplicate has ${dropPrimary.length} primary contacts; none is made primary — choose one after the merge.`:null;
  if(primaryRule)warnings.push(primaryRule);
  if(keepPrimary.length>1)warnings.push(`${keep!.name} already has ${keepPrimary.length} primary contacts; review them after the merge.`);
  const preview={keep:{id:keep!.id,name:keep!.name},merge:{id:drop!.id,name:drop!.name},affected,warnings};
  if(!confirm)return {preview,merged:false};
  const now=nowIso();
  // Clear moved primaries before they arrive when the kept client already has one (or the duplicate has several).
  if(keepPrimary.length||dropPrimary.length>1)await exec("UPDATE client_contacts SET is_primary=0,revision=revision+1,updated_at=? WHERE organisation_id=? AND client_id=? AND is_primary=1",[now,org,mergeId],conn);
  for(const [table] of CLIENT_REFS)await exec(`UPDATE ${table} SET client_id=?,updated_at=? WHERE organisation_id=? AND client_id=?`,[keepId,now,org,mergeId],conn);
  // Fill gaps on the kept client from the merged one; never overwrite what the kept client already has.
  const fill:Row={};for(const col of ['legal_name','abn','client_code','website','notes'])if(!keep![col]&&drop![col])fill[col]=drop![col];
  for(const col of ['contact_name','email','phone'])if(!keep![col]&&drop![col])fill[col]=drop![col];
  const cols=Object.keys(fill);
  if(cols.length)await exec(`UPDATE clients SET ${cols.map(c=>`${c}=?`).join(',')},revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>fill[c]),now,org,keepId],conn);
  await exec("UPDATE clients SET status='merged',merged_into_id=?,revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?",[keepId,now,org,mergeId],conn);
  await audit({event:'client.merged',entityType:'client',entityId:keepId,summary:`Merged ${drop!.name} into ${keep!.name}`,before:{mergedClient:drop},after:{affected,filled:fill,warnings}},conn);
  return {preview,merged:true};
 };
 return confirm?tx(work):work(getPool());
}

// ---------------------------------------------------------------- legacy links
const LEGACY_TABLES=[['opportunities','name','Opportunity'],['tenders','title','Tender'],['jobs','name','Project']] as const;
/**
 * Records that carry a client name but no client_id. A record links only when exactly one
 * client has that exact normalised name; ambiguous and unmatched records stay unlinked for a
 * person to choose. The original client_name text is never changed.
 */
export async function legacyClientLinks(apply=false){
 needManage();
 const a=actor(),org=a.organisationId;
 const clients=(await query("SELECT id,name,legal_name,abn,status FROM clients WHERE organisation_id=? AND status<>'merged'",[org])).map(r=>({id:r.id,name:r.name,legalName:r.legal_name,abn:r.abn,status:r.status}));
 const rows:Array<{table:string;type:string;id:string;title:string;clientName:string;status:'linked'|'ambiguous'|'none';clientId:string|null;candidates:Array<{id:string;name:string}>}>=[];
 for(const [table,title,type] of LEGACY_TABLES){
  const recs=await query(`SELECT id,${title} AS title,client_name FROM ${table} WHERE organisation_id=? AND client_id IS NULL AND client_name IS NOT NULL AND TRIM(client_name)<>'' LIMIT 2000`,[org]);
  for(const r of recs){const m=legacyClientFor(r.client_name,clients);rows.push({table,type,id:r.id,title:String(r.title||''),clientName:String(r.client_name),status:m.status,clientId:m.client?.id??null,candidates:m.candidates.map(c=>({id:c.id,name:String(c.name)}))});}
 }
 const summary={linkable:rows.filter(r=>r.status==='linked').length,ambiguous:rows.filter(r=>r.status==='ambiguous').length,unmatched:rows.filter(r=>r.status==='none').length};
 if(!apply)return {summary,rows:rows.slice(0,500),applied:0};
 let applied=0;
 await tx(async conn=>{
  for(const r of rows.filter(x=>x.status==='linked')){
   const n=await exec(`UPDATE ${r.table} SET client_id=? WHERE organisation_id=? AND id=? AND client_id IS NULL`,[r.clientId,org,r.id],conn);
   if(n){applied++;await audit({event:'client.legacy_linked',entityType:r.table,entityId:r.id,summary:`${r.type} linked to client (exact name “${r.clientName}”)`,after:{clientId:r.clientId,clientName:r.clientName,rule:'exact unique normalised name'}},conn);}
  }
 });
 return {summary,rows:rows.slice(0,500),applied};
}
/** Manual link chosen by a person for an ambiguous or unmatched legacy record. */
export async function linkLegacyRecord(type:'opportunities'|'tenders'|'jobs',id:string,clientId:string){
 needManage();
 const a=actor(),org=a.organisationId;
 return tx(async conn=>{
  const c=await one("SELECT id,name FROM clients WHERE organisation_id=? AND id=? AND status<>'merged'",[org,clientId],conn);if(!c)fail(400,'Client not found.');
  const r=await one(`SELECT id,client_id,client_name FROM ${type} WHERE organisation_id=? AND id=? FOR UPDATE`,[org,id],conn);if(!r)fail(404,'Record not found.');
  if(r!.client_id)fail(409,'This record is already linked to a client.');
  await exec(`UPDATE ${type} SET client_id=? WHERE organisation_id=? AND id=?`,[clientId,org,id],conn);
  await audit({event:'client.legacy_linked',entityType:type,entityId:id,summary:`Linked to ${c!.name} by a person (was “${r!.client_name||''}”)`,after:{clientId,clientName:r!.client_name,rule:'manual'}},conn);
  return {linked:true};
 });
}
