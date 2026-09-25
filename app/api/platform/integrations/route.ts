import {api} from '@/lib/platform/http';
import {isEmailEnabled} from '@/lib/platform/email';
export const dynamic='force-dynamic';
// Configuration status only — never returns secret values.
export const GET=api({permission:'admin',module:'core',capability:'org.admin'},async()=>({integrations:[
 {key:'storage',label:'Document storage (Cloudflare R2)',status:['R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'].every(k=>process.env[k])?'connected':'not-configured',detail:'Private bucket; files are served only through authenticated routes.'},
 {key:'email',label:'Email (SMTP)',status:isEmailEnabled()?'connected':'disabled',detail:isEmailEnabled()?'Verification, invitations and password reset are available.':'EMAIL_ENABLED=false: invitations and password reset are unavailable.'},
 {key:'ai',label:'AI assistance',status:process.env.OPENAI_API_KEY?'key-present-not-activated':'not-configured',detail:'AI is not activated until billing, consent and usage controls are connected. All workflows work without AI.'},
 {key:'abn',label:'ABN registry lookup (ABR)',status:'not-configured',detail:'ABN format and checksum are validated. Registry lookup needs an ABR web-services GUID.'},
 {key:'billing',label:'Subscription billing',status:'not-configured',detail:'Organisations run on the beta full-access trial. Plans can be applied through the entitlement service once billing is connected.'},
]}));
