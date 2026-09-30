// Divisions (business units). A division is a dimension INSIDE one organisation used to organise and filter
// projects, tenders, estimates and shifts. Clients, contacts, people and plant remain organisation-level and
// shared. A division never grants or widens access: it only narrows what the caller can already see.
// NULL business_unit_id on a record means "the organisation's default division".
import {actorContext} from './context';
import {audit} from './audit';
import {fail} from './http';
import {can} from './permissions';
import {query,one,exec,tx,nowIso,type Row,type Conn} from './sql';

export const defaultDivisionId=(organisationId:string)=>`bu_default_${organisationId}`;
const actor=()=>{const a=actorContext.getStore();if(!a)throw new Error('No actor context');return a;};
export const normaliseCode=(v:unknown)=>String(v??'').trim().toUpperCase();
export const CODE=/^[A-Z0-9][A-Z0-9-]{0,19}$/;

export type Division={id:string;name:string;code:string;description:string|null;status:'active'|'archived';isDefault:boolean;sortOrder:number;revision:number;archivedAt:string|null};
const present=(r:Row):Division=>({id:r.id,name:r.name,code:r.code,description:r.description??null,status:r.status==='archived'?'archived':'active',isDefault:Number(r.is_default)===1,sortOrder:Number(r.sort_order||0),revision:Number(r.revision||1),archivedAt:r.archived_at??null});

/** Idempotent: creates the organisation's default division if it is missing (e.g. an organisation created after the migration). */
export async function ensureDefaultDivision(organisationId=actor().organisationId,conn?:Conn):Promise<string>{
 const id=defaultDivisionId(organisationId);
 const existing=await one<{id:string}>('SELECT id FROM business_units WHERE organisation_id=? AND is_default=1',[organisationId],conn);
 if(existing)return existing.id;
 const now=nowIso();
 await exec("INSERT INTO business_units (id,organisation_id,name,code,description,status,is_default,sort_order,revision,created_at,updated_at) VALUES (?,?,'General','GEN','Default division. Rename it or add more divisions in Admin.','active',1,0,1,?,?) ON DUPLICATE KEY UPDATE id=id",[id,organisationId,now,now],conn);
 return id;
}

export async function listDivisions(){
 const org=actor().organisationId;await ensureDefaultDivision(org);
 const rows=await query('SELECT * FROM business_units WHERE organisation_id=? ORDER BY (status=\'archived\'),sort_order,name',[org]);
 const divisions=rows.map(present);
 return {divisions,activeCount:divisions.filter(d=>d.status==='active').length,defaultId:divisions.find(d=>d.isDefault)?.id??null,canManage:can(actor().role,'org.admin')};
}

const needManage=()=>{if(!can(actor().role,'org.admin'))fail(403,'You are not authorised to manage divisions.');};
const cleanName=(v:unknown)=>{const n=String(v??'').trim().replace(/\s+/g,' ');if(!n)fail(400,'A division name is required.');if(n.length>120)fail(400,'Division names are limited to 120 characters.');return n;};
const cleanCode=(v:unknown)=>{const c=normaliseCode(v);if(!CODE.test(c))fail(400,'Use a short code of letters, numbers or hyphens (for example CIV or ASP).');return c;};
const cleanDesc=(v:unknown)=>{const d=String(v??'').trim();return d?d.slice(0,1000):null;};

async function assertUnique(org:string,name:string,code:string,exceptId:string|null,conn:Conn){
 const rows=await query('SELECT id,name,code FROM business_units WHERE organisation_id=?',[org],conn);
 for(const r of rows){if(r.id===exceptId)continue;if(String(r.code).toUpperCase()===code)fail(409,`The code ${code} is already used by another division.`);if(String(r.name).toLowerCase()===name.toLowerCase())fail(409,'A division with this name already exists.');}
}

export async function createDivision(input:{name?:unknown;code?:unknown;description?:unknown}){
 needManage();const a=actor();
 const name=cleanName(input.name),code=cleanCode(input.code),description=cleanDesc(input.description);
 return tx(async conn=>{
  await ensureDefaultDivision(a.organisationId,conn);
  await assertUnique(a.organisationId,name,code,null,conn);
  const id=crypto.randomUUID(),now=nowIso();
  const next=await one<{n:number}>('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM business_units WHERE organisation_id=?',[a.organisationId],conn);
  await exec("INSERT INTO business_units (id,organisation_id,name,code,description,status,is_default,sort_order,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'active',0,?,1,?,?,?)",[id,a.organisationId,name,code,description,Number(next?.n||1),a.userId,now,now],conn);
  await audit({event:'business_unit.created',entityType:'business_unit',entityId:id,summary:`Division ${code} ${name} created`,after:{name,code}},conn);
  return {id};
 });
}

async function loadForWrite(id:string,conn:Conn){
 const r=await one('SELECT * FROM business_units WHERE organisation_id=? AND id=? FOR UPDATE',[actor().organisationId,String(id||'')],conn);
 if(!r)fail(404,'Division not found.');return r!;
}

export async function updateDivision(id:string,input:{revision?:unknown;name?:unknown;code?:unknown;description?:unknown}){
 needManage();const a=actor();
 return tx(async conn=>{
  const r=await loadForWrite(id,conn);
  if(Number(r.revision)!==Number(input.revision))fail(409,'This division was changed by someone else. Refresh and try again.');
  const name='name' in input?cleanName(input.name):r.name,code='code' in input?cleanCode(input.code):r.code,description='description' in input?cleanDesc(input.description):r.description;
  await assertUnique(a.organisationId,name,code,r.id,conn);
  if(name===r.name&&code===r.code&&(description??null)===(r.description??null))return {id:r.id,revision:Number(r.revision),changed:false};
  await exec('UPDATE business_units SET name=?,code=?,description=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[name,code,description,nowIso(),a.organisationId,r.id],conn);
  await audit({event:'business_unit.updated',entityType:'business_unit',entityId:r.id,summary:`Division ${code} ${name} updated`,before:{name:r.name,code:r.code},after:{name,code}},conn);
  return {id:r.id,revision:Number(r.revision)+1,changed:true};
 });
}

/** Archive keeps the row: every historical record still points at it. The default division cannot be archived. */
export async function setDivisionArchived(id:string,archived:boolean,revision:unknown){
 needManage();const a=actor();
 return tx(async conn=>{
  const r=await loadForWrite(id,conn);
  if(Number(r.revision)!==Number(revision))fail(409,'This division was changed by someone else. Refresh and try again.');
  if(archived&&Number(r.is_default)===1)fail(409,'The default division cannot be archived. Make another division the default first.');
  const status=archived?'archived':'active';if(r.status===status)return {id:r.id,status,revision:Number(r.revision)};
  const now=nowIso();
  await exec('UPDATE business_units SET status=?,archived_at=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[status,archived?now:null,now,a.organisationId,r.id],conn);
  await audit({event:archived?'business_unit.archived':'business_unit.restored',entityType:'business_unit',entityId:r.id,summary:`Division ${r.code} ${r.name} ${archived?'archived':'restored'}`,before:{status:r.status},after:{status}},conn);
  return {id:r.id,status,revision:Number(r.revision)+1};
 });
}

export async function setDefaultDivision(id:string,revision:unknown){
 needManage();const a=actor();
 return tx(async conn=>{
  const r=await loadForWrite(id,conn);
  if(Number(r.revision)!==Number(revision))fail(409,'This division was changed by someone else. Refresh and try again.');
  if(r.status!=='active')fail(409,'Restore this division before making it the default.');
  if(Number(r.is_default)===1)return {id:r.id,revision:Number(r.revision)};
  const now=nowIso();
  await exec('UPDATE business_units SET is_default=0,revision=revision+1,updated_at=? WHERE organisation_id=? AND is_default=1',[now,a.organisationId],conn);
  await exec('UPDATE business_units SET is_default=1,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[now,a.organisationId,r.id],conn);
  await audit({event:'business_unit.default_changed',entityType:'business_unit',entityId:r.id,summary:`Division ${r.code} ${r.name} is now the default`,after:{isDefault:true}},conn);
  return {id:r.id,revision:Number(r.revision)+1};
 });
}

/**
 * Validates a division chosen for a record. undefined = not supplied (caller inherits or uses the default);
 * null/'' = default division; otherwise it must be an ACTIVE division of this organisation (other tenants' ids are "not found").
 */
export async function resolveDivisionInput(input:unknown,conn?:Conn):Promise<string|null|undefined>{
 if(input===undefined)return undefined;
 const org=actor().organisationId;
 if(input===null||input==='')return ensureDefaultDivision(org,conn);
 const r=await one('SELECT id,status FROM business_units WHERE organisation_id=? AND id=?',[org,String(input)],conn);
 if(!r)fail(404,'Division not found.');
 if(r!.status!=='active')fail(422,'This division is archived. Choose an active division.');
 return r!.id;
}
/** Same check for a record that already carries the value: keeping an archived division is allowed (history), changing to one is not. */
export async function resolveDivisionChange(input:unknown,current:string|null|undefined,conn?:Conn){
 if(input!=null&&input!==''&&String(input)===String(current??''))return String(current);
 return resolveDivisionInput(input,conn);
}
