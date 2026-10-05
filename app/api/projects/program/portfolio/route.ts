import {api} from '@/lib/platform/http';
import {programmePortfolio} from '@/lib/seams/programme-portfolio';
export const dynamic='force-dynamic';
const read=api({permission:'read',module:'projects',capability:'project.view'},({actor,params})=>programmePortfolio(actor,params));
// Include errors/auth failures in the private, uncached contract too.
export async function GET(request:Request){
 const response=await read(request);
 response.headers.set('Cache-Control','private, no-store');
 return response;
}
