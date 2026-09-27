import {requireActor,authError,type Permission} from '@/lib/authz';
import {database} from './database';
import {actorContext} from './context';
import {requireModule,ModuleUnavailable} from './entitlements';
import type {ModuleKey} from './modules';
// Every business route is wrapped explicitly, including routes without internal guards.
// `module` enforces the organisation's entitlement: disabled → 404, read-only → writes refused.
export function withActor(handler:(request:Request)=>Promise<Response>,permission:Permission,module:ModuleKey='core'){return async(request:Request)=>{
 try{
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   const origin=request.headers.get('origin');
   if(origin&&origin!==new URL(process.env.BETTER_AUTH_URL!).origin)return Response.json({error:'Invalid origin'},{status:403});
  }
  const actor=await requireActor(request,database,permission,module);
  return await actorContext.run(actor,async()=>{
   if(module!=='core')await requireModule(module,!['GET','HEAD','OPTIONS'].includes(request.method));
   return handler(request);
  });
 }catch(error){if(error instanceof ModuleUnavailable)return Response.json({error:error.message},{status:error.status});return authError(error);}
};}
