// Shared handler for V1 routes: authentication, entitlement, capability,
// validation and consistent user-facing errors (no stack traces leak).
import {ZodError,type ZodTypeAny,type z} from 'zod';
import {withActor} from './route';
import {actorContext} from './context';
import {can,type Capability} from './permissions';
import {TransitionError} from './workflow';
import type {ModuleKey} from './modules';
import type {Actor,Permission} from '@/lib/authz';

export class HttpError extends Error{constructor(readonly status:number,message:string,readonly details?:Record<string,unknown>){super(message);}}
export const fail=(status:number,message:string,details?:Record<string,unknown>):never=>{throw new HttpError(status,message,details);};
export const notFound=(what='Record')=>fail(404,`${what} not found.`);

export type Ctx={request:Request;actor:Actor;url:URL;params:URLSearchParams};
type Options={permission:Permission;module:ModuleKey;capability?:Capability};

export function need(capability:Capability){const actor=actorContext.getStore()!;if(!can(actor.role,capability))fail(403,'You are not authorised for this action.');return actor;}

export async function body<S extends ZodTypeAny>(request:Request,schema:S):Promise<z.infer<S>>{
 const raw=await request.json().catch(()=>fail(400,'Request body must be JSON.'));
 const parsed=schema.safeParse(raw);
 if(!parsed.success)fail(400,'Check the highlighted fields.',{issues:parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
 return parsed.data;
}

export function errorResponse(e:unknown){
 if(e instanceof HttpError)return Response.json({error:e.message,...e.details},{status:e.status});
 if(e instanceof TransitionError)return Response.json({error:e.message},{status:e.status});
 if(e instanceof ZodError)return Response.json({error:'Check the highlighted fields.',issues:e.issues},{status:400});
 const status=Number((e as {status?:number})?.status);
 if(status===401||status===403||status===404||status===400||status===409)return Response.json({error:(e as Error).message||'Request failed.'},{status});
 if((e as {code?:string})?.code==='ER_DUP_ENTRY')return Response.json({error:'This record already exists or was changed by another request. Refresh and try again.'},{status:409});
 console.error('API error',e);
 return Response.json({error:'The request could not be completed. Please retry.'},{status:503});
}

export function api(options:Options,fn:(ctx:Ctx)=>Promise<unknown>){
 return withActor(async request=>{
  try{
   const actor=actorContext.getStore()!;
   if(options.capability&&!can(actor.role,options.capability))return Response.json({error:'You are not authorised for this action.'},{status:403});
   const url=new URL(request.url);
   const out=await fn({request,actor,url,params:url.searchParams});
   if(out instanceof Response)return out;
   return Response.json(out??{ok:true},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){return errorResponse(e);}
 },options.permission,options.module);
}
