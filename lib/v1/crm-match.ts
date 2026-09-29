// Deterministic client / contact / site matching used by CRM import, quick create and
// legacy linking. Normalised forms are only for comparison: stored values are never
// rewritten. Only strong identifiers produce an automatic match; weaker signals are
// reported as "possible" so a person decides.
import {isValidAbn} from '@/lib/platform/abn';

const SUFFIXES=['pty ltd','pty limited','pty. ltd','proprietary limited','limited','ltd','pty','inc','incorporated','co','company','corporation','corp','group','holdings','australia','aust','the'];
const FREE_MAIL=new Set(['gmail.com','outlook.com','hotmail.com','live.com','yahoo.com','yahoo.com.au','bigpond.com','bigpond.net.au','icloud.com','me.com','optusnet.com.au','protonmail.com']);

export const collapse=(s:unknown)=>String(s??'').trim().replace(/\s+/g,' ');
/** Case-, spacing- and punctuation-insensitive name key ("ABC  Civil Pty. Ltd." → "abc civil pty ltd"). */
export const nameKey=(s:unknown)=>collapse(s).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
/** Name key without company suffixes, for suggestions only ("ABC Civil Pty Ltd" ≈ "ABC Civil"). */
export const coreNameKey=(s:unknown)=>{let k=` ${nameKey(s)} `;for(const x of SUFFIXES)k=k.replace(new RegExp(` ${x.replace('.','\\.')} `,'g'),' ');return k.replace(/\s+/g,' ').trim();};
export const abnDigits=(s:unknown)=>String(s??'').replace(/\D+/g,'');
/** Digits of a valid ABN, otherwise null (so a mistyped ABN never matches anything). */
export const strongAbn=(s:unknown)=>{const d=abnDigits(s);return d.length===11&&isValidAbn(d)?d:null;};
export const codeKey=(s:unknown)=>collapse(s).toLowerCase();
export const emailKey=(s:unknown)=>collapse(s).toLowerCase();
export const validEmail=(s:unknown)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailKey(s));
/** Business email domain (free mail providers excluded: they say nothing about the company). */
export const emailDomain=(s:unknown)=>{const e=emailKey(s);const d=e.includes('@')?e.split('@').pop()!:'';return d&&!FREE_MAIL.has(d)?d:null;};
/** Australian phone digits: +61 / 61 prefix folded to 0, at least 8 digits. */
export const phoneKey=(s:unknown)=>{let d=String(s??'').replace(/\D+/g,'');if(d.startsWith('61')&&d.length>=11)d='0'+d.slice(2);return d.length>=8?d:null;};

export type ClientLike={id:string;name?:string|null;legalName?:string|null;abn?:string|null;clientCode?:string|null;email?:string|null;phone?:string|null;status?:string|null};
export type MatchResult<T>={kind:'exact'|'possible'|'none';match:T|null;candidates:T[];reasons:string[]};

/**
 * Client match, strongest signal first:
 *  1. valid ABN equal → exact (conflicting ABNs on a name match → possible)
 *  2. client code equal → exact
 *  3. exact normalised legal/trading name, one candidate, no conflicting ABN → exact
 *  4. suffix-insensitive name, business email domain or phone → possible
 * Several candidates for a strong signal are always "possible" — never guessed.
 */
export function matchClient<T extends ClientLike>(input:Omit<ClientLike,'id'>,existing:T[]):MatchResult<T>{
 const live=existing.filter(c=>c.status!=='merged');
 const abn=strongAbn(input.abn);
 if(abn){const hits=live.filter(c=>strongAbn(c.abn)===abn);if(hits.length===1)return {kind:'exact',match:hits[0],candidates:hits,reasons:['Same ABN']};if(hits.length>1)return {kind:'possible',match:null,candidates:hits,reasons:['Several clients share this ABN']};}
 const code=codeKey(input.clientCode);
 if(code){const hits=live.filter(c=>codeKey(c.clientCode)===code);if(hits.length===1)return {kind:'exact',match:hits[0],candidates:hits,reasons:['Same client code']};if(hits.length>1)return {kind:'possible',match:null,candidates:hits,reasons:['Several clients share this code']};}
 const names=[nameKey(input.name),nameKey(input.legalName)].filter(Boolean);
 if(names.length){
  const hits=live.filter(c=>[nameKey(c.name),nameKey(c.legalName)].some(k=>k&&names.includes(k)));
  if(hits.length===1){
   const other=strongAbn(hits[0].abn);
   if(abn&&other&&other!==abn)return {kind:'possible',match:null,candidates:hits,reasons:['Same name but a different ABN']};
   return {kind:'exact',match:hits[0],candidates:hits,reasons:['Same name']};
  }
  if(hits.length>1)return {kind:'possible',match:null,candidates:hits,reasons:['Several clients have this name']};
 }
 const cores=[coreNameKey(input.name),coreNameKey(input.legalName)].filter(k=>k.length>=3);
 const domain=emailDomain(input.email),phone=phoneKey(input.phone);
 const reasons=new Set<string>(),possible=new Map<string,T>();
 for(const c of live){
  if(cores.length&&[coreNameKey(c.name),coreNameKey(c.legalName)].some(k=>k&&cores.includes(k))){possible.set(c.id,c);reasons.add('Similar name');}
  if(domain&&emailDomain(c.email)===domain){possible.set(c.id,c);reasons.add('Same email domain');}
  if(phone&&phoneKey(c.phone)===phone){possible.set(c.id,c);reasons.add('Same phone');}
 }
 if(possible.size)return {kind:'possible',match:null,candidates:[...possible.values()],reasons:[...reasons]};
 return {kind:'none',match:null,candidates:[],reasons:[]};
}

export type ContactLike={id:string;clientId:string;name?:string|null;email?:string|null;phone?:string|null;mobile?:string|null;status?:string|null};
/** Within one client: exact email or same name → exact; same phone only → possible. */
export function matchContact<T extends ContactLike>(clientId:string,input:{name?:string|null;email?:string|null;phone?:string|null;mobile?:string|null},existing:T[]):MatchResult<T>{
 const mine=existing.filter(c=>c.clientId===clientId&&c.status!=='archived');
 const email=validEmail(input.email)?emailKey(input.email):null;
 if(email){const hits=mine.filter(c=>emailKey(c.email)===email);if(hits.length===1)return {kind:'exact',match:hits[0],candidates:hits,reasons:['Same email']};if(hits.length>1)return {kind:'possible',match:null,candidates:hits,reasons:['Several contacts share this email']};}
 const name=nameKey(input.name);
 if(name){const hits=mine.filter(c=>nameKey(c.name)===name);if(hits.length===1){const other=validEmail(hits[0].email)?emailKey(hits[0].email):null;if(email&&other&&other!==email)return {kind:'possible',match:null,candidates:hits,reasons:['Same name, different email']};return {kind:'exact',match:hits[0],candidates:hits,reasons:['Same name']};}if(hits.length>1)return {kind:'possible',match:null,candidates:hits,reasons:['Several contacts have this name']};}
 const phones=[phoneKey(input.phone),phoneKey(input.mobile)].filter(Boolean);
 const hits=phones.length?mine.filter(c=>[phoneKey(c.phone),phoneKey(c.mobile)].some(p=>p&&phones.includes(p))):[];
 if(hits.length)return {kind:'possible',match:null,candidates:hits,reasons:['Same phone']};
 return {kind:'none',match:null,candidates:[],reasons:[]};
}

export type SiteLike={id:string;clientId:string|null;name?:string|null;address?:string|null;status?:string|null};
/** Within one client: same normalised site name or same exact address → exact. */
export function matchSite<T extends SiteLike>(clientId:string,input:{name?:string|null;address?:string|null},existing:T[]):MatchResult<T>{
 const mine=existing.filter(s=>s.clientId===clientId&&s.status!=='archived'&&s.status!=='inactive');
 const name=nameKey(input.name),addr=nameKey(input.address);
 const byName=name?mine.filter(s=>nameKey(s.name)===name):[];
 const byAddr=addr?mine.filter(s=>nameKey(s.address)===addr||nameKey(s.name)===addr):[];
 const hits=[...new Map([...byName,...byAddr].map(s=>[s.id,s])).values()];
 if(hits.length===1)return {kind:'exact',match:hits[0],candidates:hits,reasons:[byName.length?'Same site name':'Same address']};
 if(hits.length>1)return {kind:'possible',match:null,candidates:hits,reasons:['Several sites match']};
 return {kind:'none',match:null,candidates:[],reasons:[]};
}

/** Legacy linking: only one exact, unambiguous name match (ABN when the record has one) links. */
export function legacyClientFor<T extends ClientLike>(text:string|null|undefined,existing:T[]):{status:'linked'|'ambiguous'|'none';client:T|null;candidates:T[]}{
 const key=nameKey(text);if(!key)return {status:'none',client:null,candidates:[]};
 const hits=existing.filter(c=>c.status!=='merged'&&[nameKey(c.name),nameKey(c.legalName)].includes(key));
 if(hits.length===1)return {status:'linked',client:hits[0],candidates:hits};
 return {status:hits.length?'ambiguous':'none',client:null,candidates:hits};
}
