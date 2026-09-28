import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listKnowledge,saveKnowledgePack,saveKnowledgeRule,saveKnowledgeSource,transitionKnowledge} from '@/lib/modules/core/knowledge';

export const dynamic='force-dynamic';

export const GET=api({permission:'read',module:'core',capability:'knowledge.view'},async({params})=>listKnowledge(params.get('packId')));

const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('savePack'),id:z.string().max(191).nullable().optional(),revision:z.number().int().nullable().optional(),pack:z.unknown()}),
 z.object({action:z.literal('saveSource'),id:z.string().max(191).nullable().optional(),revision:z.number().int().nullable().optional(),source:z.unknown()}),
 z.object({action:z.literal('saveRule'),id:z.string().max(191).nullable().optional(),revision:z.number().int().nullable().optional(),rule:z.unknown()}),
 z.object({action:z.literal('transition'),entity:z.enum(['pack','source','rule']),id:z.string().max(191),status:z.string().max(30)}),
]);

export const POST=api({permission:'write',module:'core',capability:'knowledge.edit'},async({request})=>{
 const b=await body(request,action);
 if(b.action==='savePack')return saveKnowledgePack(b.id||null,b.revision??null,b.pack);
 if(b.action==='saveSource')return saveKnowledgeSource(b.id||null,b.revision??null,b.source);
 if(b.action==='saveRule')return saveKnowledgeRule(b.id||null,b.revision??null,b.rule);
 return transitionKnowledge(b.entity,b.id,b.status);
});
