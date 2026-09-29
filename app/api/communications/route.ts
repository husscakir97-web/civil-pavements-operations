import {z} from 'zod';
import {api} from '@/lib/platform/http';
import {isCommunicationContext,threadFeed,sendMessage,acknowledgeMessage} from '@/lib/platform/communications';
export const dynamic='force-dynamic';
const send=z.object({action:z.literal('send'),contextType:z.string(),contextId:z.string().min(1).max(191),body:z.string().trim().min(1).max(5000),recipientUserIds:z.array(z.string().max(191)).max(50).optional(),mentionedUserIds:z.array(z.string().max(191)).max(50).optional(),requiresAck:z.boolean().optional(),parentMessageId:z.string().max(191).nullable().optional()});
const ack=z.object({action:z.literal('acknowledge'),messageId:z.string().min(1).max(191)});
export const GET=api({permission:'field-read',module:'core',capability:'communication.view'},async({params})=>{
 const type=String(params.get('contextType')||''),id=String(params.get('contextId')||'');
 if(!isCommunicationContext(type)||!id)return {context:null,thread:null,messages:[],people:[]};
 return threadFeed(type,id);
});
export const POST=api({permission:'field-read',module:'core',capability:'communication.send'},async({request})=>{
 const raw=await request.json().catch(()=>({}));
 if(raw.action==='acknowledge'){const b=ack.parse(raw);return acknowledgeMessage(b.messageId);}
 const b=send.parse(raw);if(!isCommunicationContext(b.contextType))throw Object.assign(new Error('Unknown communication context.'),{status:400});
 return sendMessage({...b,contextType:b.contextType});
});
