import {isEmailEnabled} from '@/lib/platform/email';
export const dynamic='force-dynamic';
export function GET(){return Response.json({emailEnabled:isEmailEnabled()},{headers:{'Cache-Control':'no-store'}});}
