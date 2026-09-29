import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {notificationsFeed,markNotification,saveNotificationPreferences} from '@/lib/platform/communications';
export const dynamic='force-dynamic';
export const GET=api({permission:'field-read',module:'core',capability:'communication.view'},async({params})=>notificationsFeed(Number(params.get('limit')||50)));
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('read'),id:z.string().max(191).nullable()}),
 z.object({action:z.literal('preferences'),email:z.boolean(),sms:z.boolean(),quietStart:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),quietEnd:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),timezone:z.string().min(1).max(80)}),
]);
export const PATCH=api({permission:'field-read',module:'core',capability:'communication.view'},async({request})=>{
 const b=await body(request,action);return b.action==='read'?markNotification(b.id):saveNotificationPreferences(b);
});
