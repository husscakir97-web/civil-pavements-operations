import {errorResponse,fail} from '@/lib/platform/http';
import {externalDocument} from '@/lib/platform/communications';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const p=new URL(request.url).searchParams,token=p.get('token')||'',id=p.get('id')||'';if(token.length<20||!id)fail(404,'Document not found.');return externalDocument(token,id);}catch(e){return errorResponse(e);}}
