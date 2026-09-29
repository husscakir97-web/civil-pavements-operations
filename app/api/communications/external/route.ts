import {z} from 'zod';
import {api} from '@/lib/platform/http';
import {createExternalShiftLink,listExternalShiftLinks,revokeExternalLink} from '@/lib/platform/communications';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'core',capability:'external.share'},async({params})=>({links:await listExternalShiftLinks(String(params.get('shiftId')||''))}));
const create=z.object({action:z.literal('create'),shiftId:z.string().min(1).max(191),recipientName:z.string().max(180).optional(),recipientEmail:z.string().email().max(254).optional().or(z.literal('')),recipientPhone:z.string().max(60).optional(),expiresDays:z.number().int().min(1).max(30).optional()});
const revoke=z.object({action:z.literal('revoke'),id:z.string().min(1).max(191)});
export const POST=api({permission:'write',module:'core',capability:'external.share'},async({request})=>{const raw=await request.json().catch(()=>({}));if(raw.action==='revoke'){const b=revoke.parse(raw);return revokeExternalLink(b.id);}const b=create.parse(raw);return createExternalShiftLink(b);});
