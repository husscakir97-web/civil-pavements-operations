import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {billingSummary,applyBillingEvent,isPlatformOperator} from '@/lib/platform/billing';
import {MODULES} from '@/lib/platform/modules';
export const dynamic='force-dynamic';
export const GET=api({permission:'admin',module:'core',capability:'entitlements.manage'},async({actor})=>billingSummary(actor.organisationId));
// Manual path for agreements handled outside a billing provider (e.g. invoiced annually).
// Restricted to platform operators named in PLATFORM_OPERATOR_EMAILS; an organisation
// admin cannot grant their own organisation paid modules.
export const POST=api({permission:'admin',module:'core'},async({request,actor})=>{
 if(!isPlatformOperator(actor.email))fail(403,'Only a platform operator can record a manual subscription.');
 const b=await body(request,z.object({organisationId:z.string().max(191),action:z.enum(['activate','cancel','payment_failed','payment_succeeded']),reference:z.string().min(3).max(120),planCode:z.string().max(60).optional(),modules:z.array(z.enum(MODULES)).optional(),currentPeriodEnd:z.string().max(40).optional()}).strict());
 const type=b.action==='activate'?'subscription.updated':b.action==='cancel'?'subscription.cancelled':b.action==='payment_failed'?'payment.failed':'payment.succeeded';
 const event={id:`manual:${b.reference}:${b.action}`,type,created:new Date().toISOString(),data:{organisationId:b.organisationId,subscriptionId:`manual:${b.organisationId}`,...(b.planCode?{planCode:b.planCode}:{}),...(b.action==='activate'?{status:'active' as const,modules:b.modules||[]}:{}),...(b.currentPeriodEnd?{currentPeriodEnd:b.currentPeriodEnd}:{})}} as const;
 return applyBillingEvent('manual',event as never,JSON.stringify({...event,recordedBy:actor.email}),`manual by ${actor.email}`);
});
