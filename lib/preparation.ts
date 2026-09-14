import { z } from 'zod';
export const preparationKinds=['company','answer','template','submission','plan','risk','itp','action','project-pack','allowance','settings'] as const;
export const referenceSchema=z.object({id:z.string().min(1).max(100),revision:z.number().int().positive()});
export type EvidenceRef=z.infer<typeof referenceSchema>;
export const rowSchema=z.object({id:z.string().min(1).max(100),question:z.string().max(10000).default(''),answer:z.string().max(30000).default(''),sourceId:z.string().max(100).default(''),sourceRef:z.string().max(300).default(''),owner:z.string().max(100).default(''),due:z.string().max(10).default(''),mandatory:z.boolean().default(true),stage:z.enum(['Tender','Pre-commencement']).default('Tender'),status:z.enum(['Draft','Internal Review','Approved','Changes requested']).default('Draft'),evidence:z.array(referenceSchema).max(50).default([]),requiresAcceptance:z.boolean().default(false),acceptance:z.object({date:z.string(),reference:z.string(),by:z.string()}).optional(),notApplicable:z.object({reason:z.string(),by:z.string()}).optional(),comment:z.string().max(3000).default(''),wordLimit:z.number().int().nonnegative().default(0),format:z.string().max(200).default(''),weighting:z.string().max(100).default(''),uncertain:z.boolean().default(true),fields:z.record(z.string(),z.string().max(5000)).default({})});
export type PreparationRow=z.infer<typeof rowSchema>;
export const dataSchema=z.object({owner:z.string().max(100).default(''),reviewDate:z.string().max(10).default(''),expiryDate:z.string().max(10).default(''),category:z.string().max(150).default(''),sections:z.array(z.object({title:z.string().max(200),text:z.string().max(50000),source:z.string().max(300).default('')})).max(100).default([]),rows:z.array(rowSchema).max(500).default([]),evidence:z.array(referenceSchema).max(100).default([]),attachments:z.array(z.string().min(1).max(100)).max(100).default([]),sourcePages:z.array(z.object({fileId:z.string(),ref:z.string(),text:z.string().max(50000),method:z.string(),confidence:z.number()})).max(500).default([]),submission:z.object({date:z.string(),method:z.string(),reference:z.string(),by:z.string()}).optional(),manifest:z.array(referenceSchema).max(500).default([]),origin:referenceSchema.optional(),entitlements:z.record(z.string(),z.boolean()).default({}),matrix:z.record(z.string(),z.string()).default({}),notes:z.string().max(10000).default('')});
export type PreparationData=z.infer<typeof dataSchema>;
export type PreparationRecord={id:string;organisation_id:string;revision:number;kind:typeof preparationKinds[number];title:string;status:string;job_id:string|null;opportunity_id:string|null;data:PreparationData;actor_id:string;reason:string;created_at:string};
export const DOCUMENT_TYPES=['Project management plan','Quality management plan','Inspection and test plan','Project risk register','WHS management plan','Environmental management plan','Construction methodology','Emergency response plan','SWMS / task risk assessment','Traffic-management supporting plan','Pre-commencement checklist'];
export const PLAN_SECTIONS=['Project overview','Scope and commitments','Roles and responsibilities','Programme and work hours','Resources and subcontractors','Risks and controls','Quality checks and hold points','Emergency arrangements','Required approvals'];
export const TABLE_FIELDS:Record<string,string[]>={risk:['Activity/location','Hazard or risk','Cause','Consequence','Initial likelihood','Initial consequence','Initial rating','Controls','Residual likelihood','Residual consequence','Residual rating','Evidence','Review'],itp:['Activity','Inspection/test','Specification reference','Acceptance criteria','Frequency/lot','Inspector','Hold/witness point','Required evidence','Result','Release authority','Sign-off'],action:['Action/clarification','Response','Scope impact','Cost impact','Programme impact','Resolution'],allowance:['Requirement','Quantity','Unit','Rate','Estimate ID']};
export function blankRow(question=''):PreparationRow{return rowSchema.parse({id:crypto.randomUUID(),question});}
export function blankData():PreparationData{return dataSchema.parse({});}
export function extractQuestions(pages:PreparationData['sourcePages']):PreparationRow[]{
 const out:PreparationRow[]=[];
 for(const page of pages)for(const [i,raw] of page.text.split(/\n+/).entries()){
 const line=raw.trim();if(!line||!/(\?|\b(provide|describe|demonstrate|submit|attach|must|shall|closing|deadline|weighting|evaluation|pricing|schedule|word limit)\b)/i.test(line))continue;
 const row=blankRow(line);row.id=`${page.fileId}:${page.ref}:${i}`.slice(0,100);row.sourceId=page.fileId;row.sourceRef=`${page.ref}, line ${i+1}`;row.stage=/before commenc|prior to commenc|pre.commenc/i.test(line)?'Pre-commencement':'Tender';row.wordLimit=Number(line.match(/(\d+)\s*words?/i)?.[1]||0);row.weighting=line.match(/\d+(?:\.\d+)?\s*%/)?.[0]||'';row.comment=`${page.method}; text confidence ${Math.round(page.confidence)}%. Confirm interpretation against original.`;out.push(row);
 }return out;
}
export function recordIssues(record:PreparationRecord,resolve:(ref:EvidenceRef)=>PreparationRecord|undefined,today=new Date().toISOString().slice(0,10)):string[]{
 const issues:string[]=[];
 const check=(ref:EvidenceRef)=>{const e=resolve(ref);if(!e){issues.push(`Evidence ${ref.id} revision ${ref.revision} is unavailable.`);return;}if(!['Approved','Submitted','Accepted'].includes(e.status))issues.push(`${e.title}: evidence revision is not approved.`);if(e.data.expiryDate&&e.data.expiryDate<today)issues.push(`${e.title}: evidence has expired.`);if(e.data.reviewDate&&e.data.reviewDate<today)issues.push(`${e.title}: review is overdue.`);};
 record.data.evidence.forEach(check);
 for(const r of record.data.rows){if(r.notApplicable)continue;if(!r.mandatory)continue;
 const name=r.question||r.fields.Activity||r.fields['Activity/location']||'Untitled requirement';
 if(r.uncertain)issues.push(`${name}: source interpretation requires confirmation.`);
 if(!r.owner)issues.push(`${name}: assign an owner.`);
 if(!r.due)issues.push(`${name}: set a due date.`);
 if(r.status!=='Approved')issues.push(`${name}: internal approval required.`);
 if(!r.answer.trim()&&record.kind==='submission')issues.push(`${name}: answer missing.`);
 if(r.wordLimit&&r.answer.trim().split(/\s+/).length>r.wordLimit)issues.push(`${name}: exceeds ${r.wordLimit} words.`);
 if(r.fields['Required evidence']&&!r.evidence.length)issues.push(`${name}: supporting evidence missing.`);
 if(r.requiresAcceptance&&!r.acceptance)issues.push(`${name}: client acceptance required.`);
 r.evidence.forEach(check);
 }
 if(['answer','company'].includes(record.kind)&&!record.data.attachments.length&&!record.data.evidence.length)issues.push('Link verified supporting evidence.');
 if(['plan','template','answer','company'].includes(record.kind)&&!record.data.sections.some(s=>s.text.trim()))issues.push('Document content is empty.');
 if(record.kind==='risk')for(const r of record.data.rows){for(const f of ['Activity/location','Hazard or risk','Cause','Consequence','Controls','Initial rating','Residual rating'])if(!r.fields[f])issues.push(`${r.question||'Risk'}: ${f} required.`);}
 if(record.kind==='itp')for(const r of record.data.rows){for(const f of ['Activity','Inspection/test','Specification reference','Acceptance criteria','Frequency/lot','Inspector','Required evidence'])if(!r.fields[f])issues.push(`${r.question||'Inspection'}: ${f} required.`);if(r.fields['Hold/witness point']&&!r.fields['Release authority'])issues.push('Name the authorised release person for each hold/witness point.');}
 if(['submission','risk','itp','project-pack'].includes(record.kind)&&!record.data.rows.length)issues.push('Add applicable requirements or structured rows.');
 record.data.sections.forEach(s=>{if(!s.text.trim())issues.push(`${s.title}: complete this section or record its applicability.`);if(/\{\{[^}]+\}\}/.test(s.text))issues.push(`${s.title}: complete missing project inputs.`);});
 return [...new Set(issues)];
}
export function suggestedAnswers(question:string,records:PreparationRecord[]){const words=new Set(question.toLowerCase().match(/[a-z]{4,}/g)||[]);return records.filter(r=>r.kind==='answer'&&r.status==='Approved').map(r=>({record:r,score:(r.title+' '+r.data.sections.map(s=>s.text).join(' ')).toLowerCase().split(/\W+/).filter(w=>words.has(w)).length})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,3).map(r=>r.record);}
