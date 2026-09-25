import {aiEnvReady} from '@/lib/platform/ai';
import {billingConfigured} from '@/lib/platform/billing';
import {api} from '@/lib/platform/http';
import {isEmailEnabled} from '@/lib/platform/email';
export const dynamic='force-dynamic';
// Configuration status only — never returns secret values.
export const GET=api({permission:'admin',module:'core',capability:'org.admin'},async()=>({integrations:[
 {key:'storage',label:'Document storage (Cloudflare R2)',status:['R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'].every(k=>process.env[k])?'connected':'not-configured',detail:'Private bucket; files are served only through authenticated routes.'},
 {key:'email',label:'Email (SMTP)',status:isEmailEnabled()?'connected':'disabled',detail:isEmailEnabled()?'Verification, invitations and password reset are available.':'EMAIL_ENABLED=false: invitations and password reset are unavailable.'},
 {key:'ai',label:'AI assistance',status:aiEnvReady()?'installation-ready':process.env.AI_API_KEY||process.env.OPENAI_API_KEY?'key-present-not-activated':'not-configured',detail:aiEnvReady()?'Installation is ready. AI runs only for organisations with the AI module whose administrator has switched it on, and only for permitted roles. Output is always a draft.':'AI is off: it needs AI_ENABLED=true plus AI_PROVIDER, AI_API_KEY and AI_MODEL. A provider key alone never enables AI. All workflows work without AI.'},
 {key:'abn',label:'ABN registry lookup (ABR)',status:process.env.ABR_GUID?'connected':'not-configured',detail:process.env.ABR_GUID?'ABNs can be confirmed against the Australian Business Register; results are saved only when an administrator confirms them.':'ABN format and checksum are validated. Set ABR_GUID to confirm ABNs against the Australian Business Register.'},
 {key:'billing',label:'Subscription billing',status:billingConfigured()?'connected':'not-configured',detail:billingConfigured()?`Signed webhooks from ${process.env.BILLING_PROVIDER} update entitlements; every event is logged once.`:'No billing provider is connected. Organisations run on the beta full-access trial and nothing is charged. Set BILLING_PROVIDER and BILLING_WEBHOOK_SECRET to connect one.'},
]}));
