// Provider-neutral billing foundation. No prices live in this codebase: plans are
// codes with a module set, priced (if at all) by the billing provider or by a manual
// agreement. A charge is only ever recorded when a provider event says it happened.
//
// Webhooks use one normalised event shape (a provider adapter translates into it):
//   {id, type, created, data:{organisationId, customerId?, subscriptionId?, planCode?, status?,
//    modules?: ModuleKey[], currentPeriodEnd?, trialEndsAt?, cancelAt?}}
// type ∈ customer.created | subscription.created | subscription.updated |
//        subscription.cancelled | payment.failed | payment.succeeded
// Signature: header `x-billing-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`,
// 5-minute tolerance, constant-time compare. Unsigned or badly signed deliveries are refused
// before anything is stored, so they can never block a genuine event id.
// Idempotency: billing_events is unique on (provider, event_id); a repeat is acknowledged, not re-applied.
import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PoolConnection} from 'mysql2/promise';
import {z} from 'zod';
import {one,query,exec,tx,nowIso,uuid} from './sql';
import {audit} from './audit';
import {MODULES,type ModuleKey,type EntitlementStatus} from './modules';

export const BILLING_TOLERANCE_SECONDS=300;
export const billingConfigured=(env:Record<string,string|undefined>=process.env)=>Boolean(env.BILLING_PROVIDER&&env.BILLING_WEBHOOK_SECRET);

export function sign(secret:string,raw:string,t=Math.floor(Date.now()/1000)){return `t=${t},v1=${createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')}`;}
export function verifySignature(secret:string|undefined,raw:string,header:string|null,now=Math.floor(Date.now()/1000)){
 if(!secret||!header)return false;
 const parts=Object.fromEntries(header.split(',').map(p=>p.trim().split('=') as [string,string]));
 const t=Number(parts.t);if(!Number.isFinite(t)||Math.abs(now-t)>BILLING_TOLERANCE_SECONDS||!/^[a-f0-9]{64}$/.test(parts.v1||''))return false;
 const expected=createHmac('sha256',secret).update(`${t}.${raw}`).digest();
 return timingSafeEqual(expected,Buffer.from(parts.v1,'hex'));
}

const moduleList=z.array(z.enum(MODULES)).max(MODULES.length);
export const billingEvent=z.object({
 id:z.string().min(1).max(191),
 type:z.enum(['customer.created','subscription.created','subscription.updated','subscription.cancelled','payment.failed','payment.succeeded']),
 created:z.string().max(40).optional(),
 data:z.object({
  organisationId:z.string().min(1).max(191),customerId:z.string().max(191).optional(),subscriptionId:z.string().max(191).optional(),
  planCode:z.string().max(60).optional(),status:z.enum(['trialing','active','past_due','cancelled']).optional(),modules:moduleList.optional(),
  currentPeriodEnd:z.string().max(40).optional(),trialEndsAt:z.string().max(40).optional(),cancelAt:z.string().max(40).optional(),email:z.string().max(254).optional(),
 }).strict(),
}).strict();
export type BillingEvent=z.infer<typeof billingEvent>;

async function setModules(conn:PoolConnection,org:string,statuses:Partial<Record<ModuleKey,EntitlementStatus>>,source:string,planCode:string|null,validUntil:string|null){
 const now=nowIso();
 for(const [module,status] of Object.entries(statuses) as Array<[ModuleKey,EntitlementStatus]>){
  if(module==='core')continue;
  const before=await one<{status:string}>('SELECT status FROM organisation_entitlements WHERE organisation_id=? AND module=?',[org,module],conn);
  if(before?.status===status)continue;
  await exec('INSERT INTO organisation_entitlements (id,organisation_id,module,status,source,plan_code,valid_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),source=VALUES(source),plan_code=VALUES(plan_code),valid_until=VALUES(valid_until),updated_at=VALUES(updated_at)',[uuid(),org,module,status,source,planCode,validUntil,now,now],conn);
  await audit({event:'entitlement.changed',entityType:'entitlement',entityId:module,organisationId:org,summary:`${module}: ${before?.status||'none'} → ${status} (${source}${planCode?`, plan ${planCode}`:''})`,before,after:{status,source,planCode}},conn);
 }
}
/** Subscription state → module statuses. Excluded or cancelled modules become read-only; data is never deleted. */
export function entitlementsFor(status:string,modules:ModuleKey[]){
 const out:Partial<Record<ModuleKey,EntitlementStatus>>={};
 for(const m of MODULES)if(m!=='core')out[m]=(status==='active'||status==='trialing'||status==='past_due')&&modules.includes(m)?'active':'read_only';
 return out;
}

/** Applies one verified event inside a transaction. Returns duplicate=true for a repeat delivery. */
export async function applyBillingEvent(provider:string,event:BillingEvent,raw:string,source='webhook'){
 return tx(async conn=>{
  const d=event.data,now=nowIso();
  if(!await one('SELECT id FROM organisations WHERE id=?',[d.organisationId],conn))throw Object.assign(new Error('Unknown organisation'),{status:422});
  if(d.customerId){
   const owner=await one<{organisation_id:string}>('SELECT organisation_id FROM billing_customers WHERE provider=? AND provider_customer_id=?',[provider,d.customerId],conn);
   if(owner&&owner.organisation_id!==d.organisationId)throw Object.assign(new Error('Customer belongs to another organisation'),{status:422});
  }
  const dup=await one('SELECT id FROM billing_events WHERE provider=? AND event_id=? FOR UPDATE',[provider,event.id],conn);
  if(dup)return {duplicate:true};
  await exec("INSERT INTO billing_events (id,organisation_id,provider,event_id,event_type,signature_valid,status,payload,received_at) VALUES (?,?,?,?,?,1,'received',?,?)",[uuid(),d.organisationId,provider,event.id,event.type,raw.slice(0,60000),now],conn);
  if(d.customerId)await exec('INSERT INTO billing_customers (id,organisation_id,provider,provider_customer_id,billing_email,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?) ON DUPLICATE KEY UPDATE provider_customer_id=VALUES(provider_customer_id),billing_email=COALESCE(VALUES(billing_email),billing_email),revision=revision+1,updated_at=VALUES(updated_at)',[uuid(),d.organisationId,provider,d.customerId,d.email||null,now,now],conn);
  if(event.type!=='customer.created'){
   if(!d.subscriptionId)throw Object.assign(new Error('subscriptionId is required'),{status:422});
   let sub=await one('SELECT * FROM billing_subscriptions WHERE provider=? AND provider_subscription_id=? FOR UPDATE',[provider,d.subscriptionId],conn);
   if(sub&&sub.organisation_id!==d.organisationId)throw Object.assign(new Error('Subscription belongs to another organisation'),{status:422});
   if(!sub){
    if(!event.type.startsWith('subscription.'))throw Object.assign(new Error('Unknown subscription'),{status:422});
    const id=uuid();
    await exec('INSERT INTO billing_subscriptions (id,organisation_id,provider,provider_subscription_id,plan_code,status,modules,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',[id,d.organisationId,provider,d.subscriptionId,d.planCode||'unspecified',d.status||'active',JSON.stringify(d.modules||[]),now,now],conn);
    sub=await one('SELECT * FROM billing_subscriptions WHERE id=?',[id],conn);
   }
   const modules=(d.modules??JSON.parse(sub!.modules||'[]')) as ModuleKey[];
   let status=d.status||sub!.status;
   const set:Record<string,unknown>={};
   if(event.type==='subscription.cancelled'){status='cancelled';set.cancelled_at=now;}
   if(event.type==='payment.failed'){status='past_due';set.last_payment_failed_at=now;}
   if(event.type==='payment.succeeded'){if(status==='past_due')status='active';set.last_payment_failed_at=null;}
   Object.assign(set,{status,plan_code:d.planCode||sub!.plan_code,modules:JSON.stringify(modules),trial_ends_at:d.trialEndsAt??sub!.trial_ends_at,current_period_end:d.currentPeriodEnd??sub!.current_period_end,cancel_at:d.cancelAt??sub!.cancel_at});
   await exec(`UPDATE billing_subscriptions SET ${Object.keys(set).map(k=>`${k}=?`).join(',')},revision=revision+1,updated_at=? WHERE id=?`,[...Object.values(set),now,sub!.id],conn);
   // Payment failure keeps access (grace) until the provider cancels; cancellation makes modules read-only.
   if(event.type!=='payment.failed')await setModules(conn,d.organisationId,entitlementsFor(String(status),modules),`billing:${provider}`,String(set.plan_code),status==='trialing'?String(set.trial_ends_at||'')||null:null);
  }
  await exec("UPDATE billing_events SET status='applied',processed_at=? WHERE provider=? AND event_id=?",[nowIso(),provider,event.id],conn);
  await audit({event:`billing.${event.type}`,entityType:'billing',entityId:d.subscriptionId||d.customerId||event.id,organisationId:d.organisationId,summary:`Billing ${source}: ${event.type}${d.planCode?` (${d.planCode})`:''}${d.status?` → ${d.status}`:''}`,after:d},conn);
  return {duplicate:false};
 });
}

export async function billingSummary(org:string){
 const [subs,events,ents]=await Promise.all([
  query('SELECT provider,provider_subscription_id,plan_code,status,modules,trial_ends_at,current_period_end,cancel_at,cancelled_at,last_payment_failed_at,updated_at FROM billing_subscriptions WHERE organisation_id=? ORDER BY updated_at DESC',[org]),
  query('SELECT provider,event_id,event_type,status,received_at,processed_at FROM billing_events WHERE organisation_id=? ORDER BY received_at DESC LIMIT 20',[org]),
  query('SELECT module,status,source,plan_code,valid_until FROM organisation_entitlements WHERE organisation_id=? ORDER BY module',[org]),
 ]);
 const trial=ents.find(e=>e.plan_code==='beta-trial');
 return {configured:billingConfigured(),provider:process.env.BILLING_PROVIDER||null,
  subscriptions:subs.map(s=>({...s,modules:JSON.parse(s.modules||'[]')})),events,entitlements:ents,
  trial:trial?{planCode:'beta-trial',validUntil:trial.valid_until}:null,
  message:billingConfigured()?'Billing events from the configured provider update entitlements automatically.':'No billing provider is connected. Your organisation is on the beta trial; nothing has been charged.'};
}

export const isPlatformOperator=(email:string,env:Record<string,string|undefined>=process.env)=>(env.PLATFORM_OPERATOR_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
