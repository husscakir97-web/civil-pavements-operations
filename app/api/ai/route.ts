import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {exec,one,nowIso} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {can} from '@/lib/platform/permissions';
import {availability,suggestionsFor,usage,envGates,AI_FEATURES,type AiFeature} from '@/lib/platform/ai';
import {suggestTenderRequirements,draftResponse,assistSwms,draftImsDocument,decideSuggestion} from '@/lib/seams/ai-assist';
export const dynamic='force-dynamic';
const features=Object.keys(AI_FEATURES) as [AiFeature,...AiFeature[]];
// Reading AI status is part of core (so the UI can explain why AI is off); running it needs the `ai` entitlement.
export const GET=api({permission:'read',module:'core'},async({params,actor})=>{
 if(params.get('usage')==='1'){if(!can(actor.role,'org.admin'))fail(403,'Only administrators can view AI usage.');return {usage:await usage()};}
 const entityType=params.get('entityType'),entityId=params.get('entityId');
 if(entityType&&entityId)return {suggestions:await suggestionsFor(entityType,entityId,(params.get('feature')||undefined) as AiFeature|undefined)};
 const org=await one<{ai_enabled:number;ai_enabled_at:string|null}>('SELECT ai_enabled,ai_enabled_at FROM organisation_profiles WHERE organisation_id=?',[actor.organisationId]);
 return {installation:envGates(),organisationEnabled:Boolean(Number(org?.ai_enabled)),organisationEnabledAt:org?.ai_enabled_at??null,features:await Promise.all(features.map(f=>availability(f).then(x=>({...x,label:AI_FEATURES[f].label}))))};
});
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('tender-requirements'),tenderId:z.string().max(191)}),
 z.object({action:z.literal('draft-response'),requirementId:z.string().max(191)}),
 z.object({action:z.literal('swms-assist'),swmsId:z.string().max(191)}),
 z.object({action:z.literal('ims-draft'),title:z.string().max(255),category:z.string().max(60),brief:z.string().max(4000).default('')}),
 z.object({action:z.literal('decide'),id:z.string().max(191),decision:z.enum(['accepted','rejected'])}),
]);
export const POST=api({permission:'write',module:'ai'},async({request})=>{
 const b=await body(request,action);
 switch(b.action){
  case 'tender-requirements':return suggestTenderRequirements(b.tenderId);
  case 'draft-response':return draftResponse(b.requirementId);
  case 'swms-assist':return assistSwms(b.swmsId);
  case 'ims-draft':return draftImsDocument(b);
  case 'decide':return decideSuggestion(b.id,b.decision);
 }
});
// The organisation switch is an administrator decision, recorded with who and when.
export const PUT=api({permission:'admin',module:'core',capability:'org.admin'},async({request,actor})=>{
 const b=await body(request,z.object({enabled:z.boolean(),acknowledged:z.boolean().optional()}).strict());
 if(b.enabled&&!b.acknowledged)fail(422,'Confirm that your organisation accepts that AI suggestions are drafts to be reviewed, and that document text is sent to the configured AI provider.');
 const now=nowIso();
 await exec('INSERT INTO organisation_profiles (organisation_id,onboarding_step,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE organisation_id=organisation_id',[actor.organisationId,0,1,actor.userId,now,now]);
 await exec('UPDATE organisation_profiles SET ai_enabled=?,ai_enabled_by=?,ai_enabled_at=?,updated_at=? WHERE organisation_id=?',[b.enabled?1:0,actor.userId,now,now,actor.organisationId]);
 await audit({event:b.enabled?'ai.enabled':'ai.disabled',entityType:'organisation',entityId:actor.organisationId,summary:b.enabled?'AI assistance switched on for the organisation (drafts only; provider data use acknowledged)':'AI assistance switched off for the organisation'});
 return {enabled:b.enabled};
});
