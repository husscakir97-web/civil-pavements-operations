import {requireActor,authError,type Permission} from '@/lib/authz';
import {database} from './database';
import {actorContext} from './context';
// Every business route is wrapped explicitly, including routes without internal guards.
export function withActor(handler:(request:Request)=>Promise<Response>,permission:Permission){return async(request:Request)=>{
 try{
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   const origin=request.headers.get('origin');
   if(origin&&origin!==new URL(process.env.BETTER_AUTH_URL!).origin)return Response.json({error:'Invalid origin'},{status:403});
  }
  const actor=await requireActor(request,database,permission);
  return await actorContext.run(actor,()=>handler(request));
 }catch(error){return authError(error);}
};}
