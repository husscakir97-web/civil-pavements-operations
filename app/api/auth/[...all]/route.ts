import {getAuth} from '@/lib/platform/auth';
import {isEmailEnabled} from '@/lib/platform/email';
export const runtime='nodejs';
function handle(request:Request){
 const action=decodeURIComponent(new URL(request.url).pathname).split('/').filter(Boolean)[2];
 if(!isEmailEnabled()&&['request-password-reset','reset-password','send-verification-email','verify-email'].includes(action))return Response.json({code:'EMAIL_DISABLED',message:'Email is not configured. Password recovery is unavailable.'},{status:503});
 return getAuth().handler(request);
}
export const GET=handle;
export const POST=handle;
