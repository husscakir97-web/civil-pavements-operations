// ABN format + official checksum (ATO algorithm). This proves the number is
// well-formed, not that it is registered. Registry lookup is an adapter that is
// deliberately unconfigured until an ABR GUID is supplied (no fake lookups).
const WEIGHTS=[10,1,3,5,7,9,11,13,15,17,19];
export function normaliseAbn(input:string){return String(input||'').replace(/\s+/g,'');}
export function isValidAbn(input:string){
 const abn=normaliseAbn(input);
 if(!/^\d{11}$/.test(abn))return false;
 const digits=abn.split('').map(Number);digits[0]-=1;
 return digits.reduce((sum,d,i)=>sum+d*WEIGHTS[i],0)%89===0;
}
export function formatAbn(input:string){const a=normaliseAbn(input);return a.length===11?`${a.slice(0,2)} ${a.slice(2,5)} ${a.slice(5,8)} ${a.slice(8)}`:input;}
export type AbnLookupResult={status:'not-configured'}|{status:'found';entityName:string;entityType:string;gstRegistered:boolean;source:string};
export interface AbnLookupAdapter{lookup(abn:string):Promise<AbnLookupResult>}
/** Replace with an ABR web-services adapter once ABR_GUID is provisioned. */
export const abnLookup:AbnLookupAdapter={async lookup(){return {status:'not-configured'};}};
