// CRM bulk import (Core): clients, contacts and sites from our template or the customer's own
// spreadsheet. Same pattern as the employee/plant importer — read headings, suggest mappings,
// preview every row, then apply only after confirmation. Matching is deterministic
// (lib/v1/crm-match.ts); uncertain matches are "possible duplicates" a person resolves.
// Nothing is written by preview. Apply re-runs the preview and writes in one transaction.
import ExcelJS from 'exceljs';
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from './context';
import {can} from './permissions';
import {audit} from './audit';
import {fail} from './http';
import {query,exec,tx,nowIso,uuid,type Row} from './sql';
import {readWorkbook,parseSheet,type FieldDef,type ParsedSheet} from './spreadsheet';
import {canManageClients} from './clients';
import {matchClient,matchContact,matchSite,strongAbn,validEmail,collapse,nameKey,codeKey,type ClientLike,type ContactLike,type SiteLike} from '@/lib/v1/crm-match';

export type CrmKind='clients'|'contacts'|'sites';
export type CrmAction='create'|'update'|'skip'|'possible'|'error';
export type CrmPreviewRow={key:string;sheet:string;kind:CrmKind;rowNumber:number;label:string;client:string|null;action:CrmAction;matchId:string|null;matchLabel:string|null;candidates:Array<{id:string;label:string}>;reasons:string[];errors:string[];warnings:string[]};
export type CrmPreview={fileName:string;sheets:Array<{name:string;kind:CrmKind;mapped:Array<{source:string;target:string|null}>;unmapped:string[];fields:Array<{key:string;label:string}>}>;rows:CrmPreviewRow[];summary:Record<CrmAction|'total',number>&{byKind:Record<CrmKind,Record<CrmAction,number>>}};
export type CrmOptions={updateExisting?:boolean;mapping?:Record<string,Record<string,string>>;sheetKinds?:Record<string,CrmKind>;decisions?:Record<string,string>};

const f=(key:string,label:string,aliases:string[]):FieldDef=>({key,label,aliases});
const CLIENT_REF=[f('clientRef','Client',['client name','client','company','company name','customer','customer name','business name','account name','organisation','organization']),f('clientCode','Client code',['client code','account code','customer code','client number','customer number','client id','customer id']),f('clientAbn','Client ABN',['client abn','company abn','abn'])];
const COMMERCIAL=new Set(['paymentTermsDays','billingEmail','creditStatus','accountReference']);
const DEFS:Record<CrmKind,FieldDef[]>={
 clients:[f('name','Trading name',['client name','client','company','company name','customer','customer name','business name','account name','trading name','display name','organisation','organization']),f('legalName','Legal name',['legal name','registered name','entity name','legal entity','registered business name']),f('abn','ABN',['abn','abn number','australian business number']),f('clientCode','Client code',['client code','account code','customer code','client number','customer number','client id','customer id']),f('phone','Phone',['phone','main phone','phone number','telephone','office phone']),f('email','Email',['email','main email','email address','general email','office email']),f('website','Website',['website','web','url','web site']),f('status','Status',['status','client status','active']),f('tags','Tags',['tags','category','categories','type','client type','industry']),f('notes','Notes',['notes','comments','description']),
  f('paymentTermsDays','Payment terms (days)',['payment terms','terms','payment terms days','terms days']),f('billingEmail','Billing email',['billing email','accounts email','invoice email','ap email']),f('creditStatus','Credit status',['credit status','credit','credit rating']),f('accountReference','Account reference',['account reference','accounts reference','debtor code','debtor number','customer account']),
  f('contactName','Contact name',['contact','contact name','primary contact','main contact','contact person']),f('contactRole','Contact role',['contact role','contact title','contact position']),f('contactEmail','Contact email',['contact email','contact email address']),f('contactPhone','Contact phone',['contact phone','contact mobile','contact number','mobile']),
  f('siteName','Site name',['site','site name','location name']),f('siteAddress','Address',['address','site address','street address','street','postal address','physical address','location']),f('siteSuburb','Suburb',['suburb','city','town']),f('siteState','State',['state']),f('sitePostcode','Postcode',['postcode','post code','zip'])],
 contacts:[...CLIENT_REF,f('firstName','First name',['first name','firstname','given name']),f('lastName','Last name',['last name','lastname','surname','family name']),f('name','Full name',['name','full name','contact','contact name','display name']),f('role','Role / title',['role','title','job title','position']),f('department','Department',['department','team','division']),f('email','Email',['email','email address','contact email']),f('phone','Phone',['phone','phone number','work phone','office phone']),f('mobile','Mobile',['mobile','mobile number','cell','mobile phone']),f('primary','Primary contact',['primary','primary contact','main contact','is primary']),f('notes','Notes',['notes','comments'])],
 sites:[...CLIENT_REF,f('name','Site name',['site','site name','location name','name']),f('address','Address',['address','site address','street address','street','location']),f('suburb','Suburb',['suburb','city','town']),f('state','State',['state']),f('postcode','Postcode',['postcode','post code','zip']),f('siteContact','Site contact',['site contact','contact on site']),f('notes','Access notes',['access notes','notes','access','instructions'])],
};
const actor=()=>actorContext.getStore()!;
/** Sheet type from its name: “Contacts” → contacts, “Sites”/“Locations” → sites, anything else → clients. */
const guessKind=(name:string):CrmKind=>/contact/i.test(name)?'contacts':/site|location|address/i.test(name)?'sites':'clients';
const yes=(s:string)=>/^(y|yes|true|1|primary|x)$/i.test(s.trim());
const statusOf=(s:string)=>{const k=s.trim().toLowerCase();return ['active','current','yes','y','true','1'].includes(k)?'active':['inactive','archived','closed','former','no','n','false','0','dormant'].includes(k)?'inactive':null;};

type Existing={clients:Array<ClientLike&{row:Row}>;contacts:Array<ContactLike&{row:Row}>;sites:Array<SiteLike&{row:Row}>};
type Planned={key:string;id:string;values:Row;existingId:string|null;action:CrmAction};

async function loadExisting(conn?:PoolConnection):Promise<Existing>{
 const org=actor().organisationId;
 const [c,k,s]=await Promise.all([
  query("SELECT * FROM clients WHERE organisation_id=? AND status<>'merged'",[org],conn),
  query("SELECT * FROM client_contacts WHERE organisation_id=?",[org],conn),
  query("SELECT * FROM client_sites WHERE organisation_id=? AND client_id IS NOT NULL",[org],conn),
 ]);
 return {clients:c.map(r=>({id:r.id,name:r.name,legalName:r.legal_name,abn:r.abn,clientCode:r.client_code,email:r.email,phone:r.phone,status:r.status,row:r})),
  contacts:k.map(r=>({id:r.id,clientId:r.client_id,name:r.name,email:r.email,phone:r.phone,mobile:r.mobile,status:r.status,row:r})),
  sites:s.map(r=>({id:r.id,clientId:r.client_id,name:r.name,address:r.address,status:r.status,row:r}))};
}

function clientValues(c:Record<string,string>,allowCommercial:boolean,errors:string[],warnings:string[]):Row{
 const v:Row={};
 const name=collapse(c.name||c.legalName);if(!name)errors.push('A client name (trading or legal name) is required.');
 v.name=name;if(c.legalName)v.legalName=collapse(c.legalName);
 if(c.abn){const a=strongAbn(c.abn);if(!a)errors.push(`ABN “${c.abn}” is not a valid ABN.`);else v.abn=a;}
 if(c.clientCode)v.clientCode=collapse(c.clientCode).slice(0,80);
 if(c.email){if(!validEmail(c.email))errors.push(`Email “${c.email}” is not valid.`);else v.email=collapse(c.email);}
 if(c.phone)v.phone=collapse(c.phone).slice(0,60);
 if(c.website)v.website=collapse(c.website).slice(0,255);
 if(c.notes)v.notes=c.notes.slice(0,5000);
 if(c.tags)v.tags=c.tags.split(/[,;|]/).map(t=>t.trim()).filter(Boolean).slice(0,20).join(', ');
 if(c.status){const st=statusOf(c.status);if(!st)errors.push('Status must be Active or Inactive.');else v.status=st;}
 const commercialCells=['paymentTermsDays','billingEmail','creditStatus','accountReference'].filter(k=>c[k]);
 if(commercialCells.length&&!allowCommercial)warnings.push('Commercial columns ignored for your role.');
 if(allowCommercial){
  if(c.paymentTermsDays){const m=String(c.paymentTermsDays).trim().match(/^(?:net\s*)?(\d{1,3})(?:\s*days?)?$/i),n=m?Number(m[1]):NaN;if(!Number.isInteger(n)||n<0||n>365)errors.push('Payment terms must be a whole number of days (0–365).');else v.paymentTermsDays=n;}
  if(c.billingEmail){if(!validEmail(c.billingEmail))errors.push('Billing email is not valid.');else v.billingEmail=collapse(c.billingEmail);}
  if(c.creditStatus)v.creditStatus=collapse(c.creditStatus).slice(0,30);
  if(c.accountReference)v.accountReference=collapse(c.accountReference).slice(0,80);
 }
 return v;
}
const CLIENT_COLS:Record<string,string>={name:'name',legalName:'legal_name',abn:'abn',clientCode:'client_code',email:'email',phone:'phone',website:'website',notes:'notes',tags:'tags',status:'status',paymentTermsDays:'payment_terms_days',billingEmail:'billing_email',creditStatus:'credit_status',accountReference:'account_reference'};
/** Columns a row would change on an existing record (blank cells never overwrite). */
// Identity is never rewritten by an import: an existing client's trading/legal name only fills a gap.
const PROTECTED=new Set(['name','legal_name']);
const changes=(values:Row,existing:Row,cols:Record<string,string>)=>Object.entries(cols).filter(([k,col])=>values[k]!==undefined&&values[k]!==''&&!(PROTECTED.has(col)&&existing[col])&&String(existing[col]??'')!==String(values[k])).map(([k])=>k);

/** Builds the full preview: parse every sheet, resolve clients first, then contacts and sites against existing and in-file clients. */
export async function previewCrmImport(file:File,opts:CrmOptions={},conn?:PoolConnection){
 const a=actor();if(!canManageClients(a.role))fail(403,'You are not authorised to import clients.');
 const allowCommercial=can(a.role,'commercial.view'),update=opts.updateExisting!==false,decisions=opts.decisions||{};
 const wb=await readWorkbook(file),ex=await loadExisting(conn);
 const sheets:Array<{parsed:ParsedSheet;kind:CrmKind}>=wb.sheets.map((s,i)=>{const kind=opts.sheetKinds?.[s.name]||(wb.sheets.length===1&&i===0?'clients':guessKind(s.name));return {kind,parsed:parseSheet(s,DEFS[kind].filter(d=>allowCommercial||!COMMERCIAL.has(d.key)),opts.mapping?.[s.name]||{})};});
 const rows:CrmPreviewRow[]=[];
 const planned:{clients:Planned[];contacts:Planned[];sites:Planned[]}={clients:[],contacts:[],sites:[]};
 // In-file clients (created or matched) are resolvable by later contact/site rows.
 const fileClients:Array<ClientLike&{plannedKey:string}>=[];
 const clientLabel=(id:string)=>String(ex.clients.find(c=>c.id===id)?.name??fileClients.find(c=>c.id===id)?.name??'');

 const decide=(key:string,m:{kind:string},fallback:CrmAction):{action:CrmAction;useId:string|null}=>{
  const d=decisions[key];
  if(m.kind!=='possible')return {action:fallback,useId:null};
  if(d==='create')return {action:'create',useId:null};
  if(d==='skip')return {action:'skip',useId:null};
  if(d?.startsWith('use:'))return {action:'update',useId:d.slice(4)};
  return {action:'possible',useId:null};
 };

 // ---- clients (dedicated sheets, plus client columns of a flat sheet)
 const inline:Array<{parentKey:string;sheet:string;rowNumber:number;contact?:Record<string,string>;site?:Record<string,string>}>=[];
 for(const {parsed,kind} of sheets.filter(s=>s.kind==='clients'))for(const r of parsed.rows){
  const key=`${parsed.name}:${r.rowNumber}`,errors:string[]=[],warnings:string[]=[];
  const v=clientValues(r.cells,allowCommercial,errors,warnings);
  const inFile=fileClients.find(c=>(v.abn&&strongAbn(c.abn)===v.abn)||(v.clientCode&&codeKey(c.clientCode)===codeKey(v.clientCode))||(nameKey(c.name)&&nameKey(c.name)===nameKey(v.name)));
  let action:CrmAction='create',matchId:string|null=null,candidates:Array<{id:string;label:string}>=[],reasons:string[]=[];
  if(errors.length)action='error';
  else if(inFile){action='skip';matchId=inFile.id;warnings.push(`Same client as an earlier row (${inFile.plannedKey.split(':').pop()}).`);}
  else{
   const m=matchClient({name:v.name,legalName:v.legalName,abn:v.abn,clientCode:v.clientCode,email:v.email,phone:v.phone},ex.clients);
   reasons=m.reasons;candidates=m.candidates.map(c=>({id:c.id,label:String(c.name)}));
   if(m.kind==='exact'){matchId=m.match!.id;const diff=changes(v,m.match!.row,CLIENT_COLS);action=diff.length&&update?'update':'skip';if(!diff.length)warnings.push('Already up to date.');else if(!update)warnings.push('Matches an existing client; updates are switched off.');}
   else{const d=decide(key,m,'create');action=d.action;if(d.useId){if(!ex.clients.some(c=>c.id===d.useId))errors.push('Chosen client not found.');matchId=d.useId;}}
   if(errors.length)action='error';
  }
  const id=action==='create'?uuid():matchId||'';
  if(action!=='error'&&id){fileClients.push({id,name:v.name,legalName:v.legalName,abn:v.abn,clientCode:v.clientCode,plannedKey:key});}
  if(action==='create'||action==='update')planned.clients.push({key,id,values:v,existingId:action==='update'?matchId:null,action});
  if(action==='possible'&&(r.cells.contactName||r.cells.contactEmail||r.cells.siteName||r.cells.siteAddress))warnings.push('Its contact and site import once you choose what to do with this client.');
  rows.push({key,sheet:parsed.name,kind,rowNumber:r.rowNumber,label:String(v.name||'Unnamed'),client:null,action,matchId,matchLabel:matchId?clientLabel(matchId):null,candidates,reasons,errors,warnings});
  if(action!=='error'&&id){
   const c=r.cells;
   if(c.contactName||c.contactEmail)inline.push({parentKey:key,sheet:parsed.name,rowNumber:r.rowNumber,contact:{name:c.contactName||'',email:c.contactEmail||'',phone:c.contactPhone||'',role:c.contactRole||'',primary:'yes',_client:id}});
   if(c.siteName||c.siteAddress)inline.push({parentKey:key,sheet:parsed.name,rowNumber:r.rowNumber,site:{name:c.siteName||'',address:c.siteAddress||'',suburb:c.siteSuburb||'',state:c.siteState||'',postcode:c.sitePostcode||'',_client:id}});
  }
 }

 const resolveClient=(c:Record<string,string>,errors:string[]):string|null=>{
  if(c._client)return c._client;
  const abn=c.clientAbn?strongAbn(c.clientAbn):null,code=c.clientCode?codeKey(c.clientCode):'',name=nameKey(c.clientRef);
  if(!abn&&!code&&!name){errors.push('Say which client this belongs to (client name, code or ABN).');return null;}
  const pool=[...ex.clients.map(x=>({id:x.id,name:x.name,legalName:x.legalName,abn:x.abn,clientCode:x.clientCode})),...fileClients.filter(x=>!ex.clients.some(e=>e.id===x.id))];
  const by=(pred:(x:ClientLike)=>boolean)=>[...new Map(pool.filter(pred).map(x=>[x.id,x])).values()];
  const hits=abn?by(x=>strongAbn(x.abn)===abn):code?by(x=>codeKey(x.clientCode)===code):by(x=>[nameKey(x.name),nameKey(x.legalName)].includes(name));
  if(hits.length===1)return hits[0].id;
  errors.push(hits.length?'More than one client matches this reference. Use the client code or ABN.':`No client “${c.clientRef||c.clientCode||c.clientAbn}” exists or is being imported.`);
  return null;
 };

 // ---- contacts (dedicated sheets + inline from client rows)
 const contactInputs=[...sheets.filter(s=>s.kind==='contacts').flatMap(({parsed})=>parsed.rows.map(r=>({key:`${parsed.name}:${r.rowNumber}`,sheet:parsed.name,rowNumber:r.rowNumber,c:r.cells}))),...inline.filter(x=>x.contact).map(x=>({key:`${x.parentKey}:contact`,sheet:x.sheet,rowNumber:x.rowNumber,c:x.contact!}))];
 const fileContacts:Array<ContactLike>=[];
 for(const {key,sheet,rowNumber,c} of contactInputs){
  const errors:string[]=[],warnings:string[]=[];
  const clientId=resolveClient(c,errors);
  const name=collapse(c.name||[c.firstName,c.lastName].filter(Boolean).join(' '));
  if(!name)errors.push('A contact name is required.');
  if(c.email&&!validEmail(c.email))errors.push(`Email “${c.email}” is not valid.`);
  const v:Row={name,firstName:c.firstName||null,lastName:c.lastName||null,role:c.role||null,department:c.department||null,email:c.email&&validEmail(c.email)?collapse(c.email):null,phone:c.phone||null,mobile:c.mobile||null,isPrimary:c.primary?yes(c.primary):false,notes:c.notes||null,clientId};
  let action:CrmAction=errors.length?'error':'create',matchId:string|null=null,candidates:Array<{id:string;label:string}>=[],reasons:string[]=[];
  if(!errors.length&&clientId){
   const dupe=matchContact(clientId,{name,email:v.email,phone:v.phone,mobile:v.mobile},fileContacts);
   if(dupe.kind==='exact'){action='skip';warnings.push('Same contact as an earlier row.');}
   else{
    const m=matchContact(clientId,{name,email:v.email,phone:v.phone,mobile:v.mobile},ex.contacts);
    reasons=m.reasons;candidates=m.candidates.map(x=>({id:x.id,label:String(x.name)}));
    if(m.kind==='exact'){matchId=m.match!.id;const row=(m.match as ContactLike&{row:Row}).row;const diff=changes(v,row,{name:'name',role:'role',department:'department',email:'email',phone:'phone',mobile:'mobile',notes:'notes'});action=diff.length&&update?'update':'skip';if(!diff.length)warnings.push('Already up to date.');}
    else{const d=decide(key,m,'create');action=d.action;if(d.useId){if(!ex.contacts.some(x=>x.id===d.useId&&x.clientId===clientId))errors.push('Chosen contact not found for this client.');matchId=d.useId;}}
    if(errors.length)action='error';
   }
   if(action!=='error')fileContacts.push({id:matchId||key,clientId,name,email:v.email,phone:v.phone,mobile:v.mobile});
  }
  if(action==='create'||action==='update')planned.contacts.push({key,id:action==='create'?uuid():matchId!,values:v,existingId:action==='update'?matchId:null,action});
  rows.push({key,sheet,kind:'contacts',rowNumber,label:name||'Unnamed contact',client:clientId?clientLabel(clientId):null,action,matchId,matchLabel:matchId?String(ex.contacts.find(x=>x.id===matchId)?.name||''):null,candidates,reasons,errors,warnings});
 }

 // ---- sites
 const siteInputs=[...sheets.filter(s=>s.kind==='sites').flatMap(({parsed})=>parsed.rows.map(r=>({key:`${parsed.name}:${r.rowNumber}`,sheet:parsed.name,rowNumber:r.rowNumber,c:r.cells}))),...inline.filter(x=>x.site).map(x=>({key:`${x.parentKey}:site`,sheet:x.sheet,rowNumber:x.rowNumber,c:x.site!}))];
 const fileSites:Array<SiteLike>=[];
 for(const {key,sheet,rowNumber,c} of siteInputs){
  const errors:string[]=[],warnings:string[]=[];
  const clientId=resolveClient(c,errors);
  const name=collapse(c.name||c.address).slice(0,255);
  if(!name)errors.push('A site name or address is required.');
  const v:Row={name,address:c.address?collapse(c.address).slice(0,500):null,suburb:c.suburb||null,state:c.state||null,postcode:c.postcode||null,siteContact:c.siteContact||null,accessNotes:c.notes||null,clientId};
  let action:CrmAction=errors.length?'error':'create',matchId:string|null=null,candidates:Array<{id:string;label:string}>=[],reasons:string[]=[];
  if(!errors.length&&clientId){
   if(matchSite(clientId,{name,address:v.address},fileSites).kind==='exact'){action='skip';warnings.push('Same site as an earlier row.');}
   else{
    const m=matchSite(clientId,{name,address:v.address},ex.sites);
    reasons=m.reasons;candidates=m.candidates.map(x=>({id:x.id,label:String(x.name)}));
    if(m.kind==='exact'){matchId=m.match!.id;const row=(m.match as SiteLike&{row:Row}).row;const diff=changes(v,row,{address:'address',suburb:'suburb',state:'state',postcode:'postcode',siteContact:'site_contact',accessNotes:'access_notes'});action=diff.length&&update?'update':'skip';if(!diff.length)warnings.push('Already up to date.');}
    else{const d=decide(key,m,'create');action=d.action;if(d.useId){if(!ex.sites.some(x=>x.id===d.useId&&x.clientId===clientId))errors.push('Chosen site not found for this client.');matchId=d.useId;}}
    if(errors.length)action='error';
   }
   if(action!=='error')fileSites.push({id:matchId||key,clientId,name,address:v.address});
  }
  if(action==='create'||action==='update')planned.sites.push({key,id:action==='create'?uuid():matchId!,values:v,existingId:action==='update'?matchId:null,action});
  rows.push({key,sheet,kind:'sites',rowNumber,label:name||'Unnamed site',client:clientId?clientLabel(clientId):null,action,matchId,matchLabel:matchId?String(ex.sites.find(x=>x.id===matchId)?.name||''):null,candidates,reasons,errors,warnings});
 }

 const empty=()=>({create:0,update:0,skip:0,possible:0,error:0});
 const byKind={clients:empty(),contacts:empty(),sites:empty()} as Record<CrmKind,Record<CrmAction,number>>;
 for(const r of rows)byKind[r.kind][r.action]++;
 const count=(x:CrmAction)=>rows.filter(r=>r.action===x).length;
 const preview:CrmPreview={fileName:file.name,
  sheets:sheets.map(({parsed,kind})=>({name:parsed.name,kind,mapped:parsed.heads.filter(Boolean).map(h=>({source:h.source,target:h.key})),unmapped:parsed.heads.filter(h=>h&&!h.key).map(h=>h.source),fields:DEFS[kind].filter(d=>allowCommercial||!COMMERCIAL.has(d.key)).map(d=>({key:d.key,label:d.label}))})),
  rows,summary:{total:rows.length,create:count('create'),update:count('update'),skip:count('skip'),possible:count('possible'),error:count('error'),byKind}};
 return {preview,planned};
}

/** Applies a confirmed import. Possible duplicates without a decision, errors and skips are never written. */
export async function applyCrmImport(file:File,opts:CrmOptions={}){
 const a=actor(),org=a.organisationId,allowCommercial=can(a.role,'commercial.view');
 return tx(async conn=>{
  const {preview,planned}=await previewCrmImport(file,opts,conn);
  const now=nowIso();let created=0,updated=0;
  for(const p of planned.clients){
   const v=p.values,cols=Object.entries(CLIENT_COLS).filter(([k])=>v[k]!==undefined&&v[k]!==''&&(allowCommercial||!COMMERCIAL.has(k)));
   if(p.action==='create'){
    const row:Row={id:p.id,organisation_id:org,contact_name:'',email:'',phone:'',status:'active',revision:1,created_by:a.userId,created_at:now,updated_at:now};
    for(const [k,col] of cols)row[col]=v[k];
    const keys=Object.keys(row);
    await exec(`INSERT INTO clients (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]),conn);created++;
   }else{
    const existing=(await query('SELECT * FROM clients WHERE organisation_id=? AND id=? FOR UPDATE',[org,p.existingId],conn))[0];if(!existing)continue;
    const diff=cols.filter(([k,col])=>!(PROTECTED.has(col)&&existing[col])&&String(existing[col]??'')!==String(v[k]));
    if(!diff.length)continue;
    await exec(`UPDATE clients SET ${diff.map(([,col])=>`${col}=?`).join(',')},revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?`,[...diff.map(([k])=>v[k]),now,org,p.existingId],conn);updated++;
   }
  }
  const primaryDone=new Set<string>();
  for(const p of planned.contacts){
   const v=p.values;
   if(v.isPrimary&&!primaryDone.has(String(v.clientId))){await exec('UPDATE client_contacts SET is_primary=0 WHERE organisation_id=? AND client_id=?',[org,v.clientId],conn);primaryDone.add(String(v.clientId));}
   else if(v.isPrimary)v.isPrimary=false;
   if(p.action==='create'){
    await exec('INSERT INTO client_contacts (id,organisation_id,client_id,name,first_name,last_name,role,department,email,phone,mobile,is_primary,notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[p.id,org,v.clientId,v.name,v.firstName,v.lastName,v.role,v.department,v.email,v.phone,v.mobile,v.isPrimary?1:0,v.notes,'active',1,a.userId,now,now],conn);created++;
   }else{
    const map:Record<string,string>={name:'name',firstName:'first_name',lastName:'last_name',role:'role',department:'department',email:'email',phone:'phone',mobile:'mobile',notes:'notes'};
    const set=Object.entries(map).filter(([k])=>v[k]);if(v.isPrimary)set.push(['isPrimary','is_primary']);
    await exec(`UPDATE client_contacts SET ${set.map(([,c])=>`${c}=?`).join(',')},status='active',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...set.map(([k])=>k==='isPrimary'?1:v[k]),now,org,p.existingId],conn);updated++;
   }
  }
  for(const p of planned.sites){
   const v=p.values;
   if(p.action==='create'){await exec('INSERT INTO client_sites (id,organisation_id,client_id,name,address,suburb,state,postcode,site_contact,access_notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[p.id,org,v.clientId,v.name,v.address,v.suburb,v.state,v.postcode,v.siteContact,v.accessNotes,'active',1,a.userId,now,now],conn);created++;}
   else{const map:Record<string,string>={address:'address',suburb:'suburb',state:'state',postcode:'postcode',siteContact:'site_contact',accessNotes:'access_notes'};const set=Object.entries(map).filter(([k])=>v[k]);if(!set.length)continue;await exec(`UPDATE client_sites SET ${set.map(([,c])=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...set.map(([k])=>v[k]),now,org,p.existingId],conn);updated++;}
  }
  const s=preview.summary,result={created,updated,skipped:s.skip,possibleUnresolved:s.possible,errors:s.error,total:s.total,byKind:s.byKind};
  // The spreadsheet itself is not stored; the audit keeps who, when, which file and the counts.
  await audit({event:'crm_import.completed',entityType:'client',entityId:org,summary:`CRM import “${file.name}”: ${created} created, ${updated} updated, ${s.skip} skipped, ${s.possible} unresolved duplicates, ${s.error} errors`,after:{fileName:file.name,...result,createdClientIds:planned.clients.filter(p=>p.action==='create').map(p=>p.id).slice(0,200)}},conn);
  return {summary:result,rows:preview.rows.filter(r=>r.action==='error'||r.action==='possible').slice(0,500)};
 });
}

/** Downloadable template: Instructions + Clients, Contacts and Sites sheets that reference clients by name, code or ABN. */
export async function crmTemplate(){
 const allowCommercial=can(actor().role,'commercial.view'),w=new ExcelJS.Workbook();
 const info=w.addWorksheet('Instructions');info.columns=[{width:26},{width:90}];
 info.addRows([['CRM bulk import',''],['How it works','Fill any of the Clients, Contacts and Sites sheets, upload the file, check the preview, then confirm. Nothing changes before you confirm.'],['Matching','Clients match on a valid ABN, then Client code, then the exact name. Similar names, a shared email domain or phone are shown as possible duplicates for you to decide.'],['Contacts and sites','Say which client each row belongs to with the Client name, Client code or ABN — including clients created in the same file.'],['Blank cells','Blank cells never overwrite existing values.'],['Your own spreadsheet','You can upload your existing customer list instead. Common headings (Company, Customer, ABN, Contact, Email, Address…) are recognised and you can map the rest.']]);
 info.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD85618'}};});
 const sheet=(name:string,heads:string[],sample:string[])=>{const s=w.addWorksheet(name);s.addRow(heads);s.addRow(sample);s.views=[{state:'frozen',ySplit:1}];s.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17212B'}};});s.columns.forEach((c,i)=>c.width=Math.min(34,Math.max(14,(heads[i]?.length||10)+6)));return s;};
 const ch=['Trading name','Legal name','ABN','Client code','Phone','Email','Website','Status','Tags',...(allowCommercial?['Payment terms (days)','Billing email','Account reference']:[])];
 const cs=['Example Civil','Example Civil Pty Ltd','51 824 753 556','EXC001','02 9000 0000','office@example.com.au','example.com.au','Active','Council, Roads',...(allowCommercial?['30','accounts@example.com.au','DEB-001']:[])];
 const clients=sheet('Clients',ch,cs);
 const si=ch.indexOf('Status')+1;for(let r=2;r<1002;r++)clients.getCell(r,si).dataValidation={type:'list',allowBlank:true,formulae:['"Active,Inactive"']};
 sheet('Contacts',['Client name','Client code','First name','Last name','Role / title','Email','Phone','Mobile','Primary contact'],['Example Civil','EXC001','Sam','Lee','Project manager','sam@example.com.au','02 9000 0001','0400 000 000','Yes']);
 sheet('Sites',['Client name','Client code','Site name','Address','Suburb','State','Postcode','Access notes'],['Example Civil','EXC001','Depot','1 Example Rd','Parramatta','NSW','2150','Gate code at office']);
 return Buffer.from(await w.xlsx.writeBuffer());
}
export const _test={clientValues,guessKind,DEFS};
