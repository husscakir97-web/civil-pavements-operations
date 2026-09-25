import {api} from '@/lib/platform/http';
import {isValidAbn,formatAbn,abnLookup} from '@/lib/platform/abn';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'core'},async({params})=>{
 const abn=String(params.get('abn')||'');
 const valid=isValidAbn(abn);
 return {abn:formatAbn(abn),valid,message:valid?'ABN format and checksum are valid.':'This is not a valid ABN (11 digits with a valid checksum).',registry:valid?await abnLookup.lookup(abn):null};
});
