// ABN format + official checksum (ATO algorithm). The checksum proves the number
// is well-formed, not that it is registered. Registry confirmation uses the official
// ABR (Australian Business Register) JSON web service, and only when ABR_GUID is
// configured. Without it the lookup reports "not configured": no result is invented.
const WEIGHTS=[10,1,3,5,7,9,11,13,15,17,19];
export function normaliseAbn(input:string){return String(input||'').replace(/\s+/g,'');}
export function isValidAbn(input:string){
 const abn=normaliseAbn(input);
 if(!/^\d{11}$/.test(abn))return false;
 const digits=abn.split('').map(Number);digits[0]-=1;
 return digits.reduce((sum,d,i)=>sum+d*WEIGHTS[i],0)%89===0;
}
export function formatAbn(input:string){const a=normaliseAbn(input);return a.length===11?`${a.slice(0,2)} ${a.slice(2,5)} ${a.slice(5,8)} ${a.slice(8)}`:input;}

export type AbnRecord={abn:string;entityName:string;entityType:string;abnStatus:string;gstRegisteredFrom:string|null;businessNames:string[];state:string|null;postcode:string|null;source:'ABR';lookedUpAt:string};
export type AbnLookupResult=
 |{status:'not-configured';message:string}
 |{status:'invalid';message:string}
 |{status:'found';record:AbnRecord}
 |{status:'not-found';message:string}
 |{status:'error';message:string};
export interface AbnLookupAdapter{lookup(abn:string):Promise<AbnLookupResult>}

export const ABR_DEFAULT_URL='https://abr.business.gov.au/json/';
/** Parses the ABR JSONP body `callback({...})`. Exported for tests. */
export function parseAbrResponse(body:string,abn:string,now=new Date()):AbnLookupResult{
 const start=body.indexOf('('),end=body.lastIndexOf(')');
 let data:Record<string,unknown>;
 try{data=JSON.parse(start>=0&&end>start?body.slice(start+1,end):body);}catch{return {status:'error',message:'The ABN Lookup service returned an unreadable response.'};}
 const message=String(data.Message||'').trim();
 const found=normaliseAbn(String(data.Abn||''));
 if(message){
  if(/guid/i.test(message))return {status:'error',message:'The ABN Lookup service rejected the configured ABR_GUID.'};
  return {status:'not-found',message};
 }
 if(!found||found!==abn)return {status:'not-found',message:'No ABN record was returned for this number.'};
 const gst=String(data.Gst||'').trim();
 return {status:'found',record:{abn:found,entityName:String(data.EntityName||'').trim(),entityType:String(data.EntityTypeName||'').trim(),abnStatus:String(data.AbnStatus||'').trim(),gstRegisteredFrom:/^\d{4}-\d{2}-\d{2}/.test(gst)?gst.slice(0,10):null,businessNames:Array.isArray(data.BusinessName)?data.BusinessName.map(String).filter(Boolean).slice(0,20):[],state:String(data.AddressState||'')||null,postcode:String(data.AddressPostcode||'')||null,source:'ABR',lookedUpAt:now.toISOString()}};
}

export function abrAdapter(env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch):AbnLookupAdapter{
 return {async lookup(input){
  const abn=normaliseAbn(input);
  if(!isValidAbn(abn))return {status:'invalid',message:'This is not a valid ABN (11 digits with a valid checksum).'};
  const guid=env.ABR_GUID?.trim();
  if(!guid)return {status:'not-configured',message:'Registry lookup is not configured. Set ABR_GUID (issued free by the Australian Business Register) to confirm ABNs against the register.'};
  const base=(env.ABR_BASE_URL||ABR_DEFAULT_URL).replace(/\/?$/,'/');
  const url=`${base}AbnDetails.aspx?abn=${abn}&callback=callback&guid=${encodeURIComponent(guid)}`;
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
  try{
   const r=await fetcher(url,{signal:abort.signal,cache:'no-store'});
   if(!r.ok)return {status:'error',message:`The ABN Lookup service is unavailable (HTTP ${r.status}). Try again later.`};
   return parseAbrResponse(await r.text(),abn);
  }catch{return {status:'error',message:abort.signal.aborted?'The ABN Lookup service did not respond in time. Try again later.':'The ABN Lookup service could not be reached. Try again later.'};}
  finally{clearTimeout(timer);}
 }};
}
export const abnLookup:AbnLookupAdapter={lookup:abn=>abrAdapter().lookup(abn)};
