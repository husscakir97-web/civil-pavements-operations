// Forms engine — isomorphic definitions shared by the server (authoritative) and the renderer.
// A template version's schema is a list of sections holding fields with stable ids. Field ids,
// option values and condition references never change meaning once a version is published;
// labels may change in a later version without breaking historical responses.
import {z} from 'zod';

export const FIELD_TYPES=['text','textarea','number','date','datetime','boolean','select','multiselect','checkbox','person','asset','location','photo','file','signature'] as const;
export type FieldType=typeof FIELD_TYPES[number];
export const FIELD_TYPE_LABELS:Record<FieldType,string>={text:'Short text',textarea:'Long text',number:'Number',date:'Date',datetime:'Date & time',boolean:'Yes / No',select:'Single choice',multiselect:'Multiple choice',checkbox:'Checkbox / acknowledgement',person:'Person',asset:'Plant / asset',location:'Location',photo:'Photo',file:'File / document',signature:'Signature'};
export const CONDITION_OPS=['eq','neq','in','answered'] as const;
export type ConditionOp=typeof CONDITION_OPS[number];
export const CONDITION_LABELS:Record<ConditionOp,string>={eq:'equals',neq:'does not equal',in:'is one of',answered:'is answered'};
export const FORM_CONTEXTS=['organisation','project','shift','asset'] as const;
export type FormContext=typeof FORM_CONTEXTS[number];
export const isFormContext=(v:string):v is FormContext=>(FORM_CONTEXTS as readonly string[]).includes(v);
export const FORM_CATEGORIES=['Prestart','Inspection','Toolbox','Audit','Plant inspection','Environmental','Quality checklist','Project checklist','General'] as const;

export type Condition={field:string;op:ConditionOp;value?:string|string[]|null};
export type FormOption={value:string;label:string};
export type FormField={id:string;type:FieldType;label:string;required?:boolean;help?:string|null;options?:FormOption[];showIf?:Condition|null;min?:number|null;max?:number|null};
export type FormSection={id:string;title:string;showIf?:Condition|null;fields:FormField[]};
export type FormSchema={sections:FormSection[]};
export type Answers=Record<string,unknown>;
export type SignatureValue={name:string;confirmed:true;documentId?:string|null;signerUserId?:string;signedAt?:string};

const ID=/^[a-z][a-z0-9_]{0,63}$/;
const idSchema=z.string().regex(ID,'Field and section ids use lowercase letters, numbers and underscores, starting with a letter.');
const condition=z.object({field:idSchema,op:z.enum(CONDITION_OPS),value:z.union([z.string().max(200),z.array(z.string().max(200)).max(50)]).nullish()}).strict();
const option=z.object({value:z.string().trim().min(1).max(100),label:z.string().trim().min(1).max(200)}).strict();
const field=z.object({id:idSchema,type:z.enum(FIELD_TYPES),label:z.string().trim().min(1,'Every field needs a label.').max(300),required:z.boolean().optional(),help:z.string().max(500).nullish(),options:z.array(option).max(100).optional(),showIf:condition.nullish(),min:z.number().finite().nullish(),max:z.number().finite().nullish()}).strict();
const section=z.object({id:idSchema,title:z.string().trim().min(1,'Every section needs a title.').max(200),showIf:condition.nullish(),fields:z.array(field).max(200)}).strict();
export const formSchemaInput=z.object({sections:z.array(section).max(50)}).strict();

/** Structural checks beyond zod: unique ids, options where needed, conditions reference earlier fields only (no cycles). */
export function checkSchema(raw:unknown,{forPublish=false}:{forPublish?:boolean}={}):{schema:FormSchema|null;errors:string[]}{
 const parsed=formSchemaInput.safeParse(raw);
 if(!parsed.success)return {schema:null,errors:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)};
 const schema=parsed.data as FormSchema,errors:string[]=[],seen=new Map<string,FormField>(),sectionIds=new Set<string>();
 const checkCondition=(c:Condition|null|undefined,where:string)=>{
  if(!c)return;
  const target=seen.get(c.field);
  if(!target){errors.push(`${where}: the condition must refer to an earlier field.`);return;}
  if(c.op!=='answered'&&(c.value===undefined||c.value===null||c.value===''))errors.push(`${where}: choose a value for the condition.`);
  if(c.op==='in'&&!Array.isArray(c.value))errors.push(`${where}: "is one of" needs a list of values.`);
  if((target.type==='select'||target.type==='multiselect')&&c.value!=null){const allowed=new Set((target.options||[]).map(o=>o.value));for(const v of [c.value].flat())if(!allowed.has(String(v)))errors.push(`${where}: "${v}" is not an option of ${target.label}.`);}
  if((target.type==='boolean'||target.type==='checkbox')&&c.value!=null)for(const v of [c.value].flat())if(v!=='true'&&v!=='false')errors.push(`${where}: yes/no conditions compare with true or false.`);
 };
 for(const s of schema.sections){
  if(sectionIds.has(s.id))errors.push(`Section id "${s.id}" is used twice.`);sectionIds.add(s.id);
  checkCondition(s.showIf,`Section ${s.title}`);
  for(const f of s.fields){
   if(seen.has(f.id))errors.push(`Field id "${f.id}" is used twice.`);
   checkCondition(f.showIf,`Field ${f.label}`);
   if(f.showIf?.field===f.id)errors.push(`Field ${f.label}: a field cannot depend on itself.`);
   if(f.type==='select'||f.type==='multiselect'){
    if(!f.options?.length)errors.push(`Field ${f.label}: add at least one option.`);
    else if(new Set(f.options.map(o=>o.value)).size!==f.options.length)errors.push(`Field ${f.label}: option values must be unique.`);
   }else if(f.options?.length)errors.push(`Field ${f.label}: only choice fields have options.`);
   if(f.min!=null&&f.max!=null&&f.min>f.max)errors.push(`Field ${f.label}: minimum is above maximum.`);
   seen.set(f.id,f);
  }
 }
 if(forPublish&&!seen.size)errors.push('Add at least one field before publishing.');
 return {schema:errors.length?null:schema,errors};
}

export const allFields=(s:FormSchema)=>s.sections.flatMap(x=>x.fields);
export const isAnswered=(v:unknown)=>!(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length));
const asStrings=(v:unknown)=>Array.isArray(v)?v.map(String):v===undefined||v===null?[]:[String(v)];

/** Deterministic: a condition on a hidden field sees it as unanswered. */
export function conditionMet(c:Condition|null|undefined,answers:Answers,visible:Set<string>):boolean{
 if(!c)return true;
 const v=visible.has(c.field)?answers[c.field]:undefined;
 if(c.op==='answered')return isAnswered(v);
 if(!isAnswered(v))return c.op==='neq';
 const have=asStrings(v),want=asStrings(c.value);
 if(c.op==='eq')return want.length===1&&have.includes(want[0]);
 if(c.op==='neq')return !(want.length===1&&have.includes(want[0]));
 return have.some(x=>want.includes(x));
}
/** Visible field ids, evaluated in schema order (conditions only look backwards). */
export function visibleFields(schema:FormSchema,answers:Answers):Set<string>{
 const visible=new Set<string>();
 for(const s of schema.sections){
  if(!conditionMet(s.showIf,answers,visible))continue;
  for(const f of s.fields)if(conditionMet(f.showIf,answers,visible))visible.add(f.id);
 }
 return visible;
}

export type FieldError={field:string;message:string};
export type ShapeResult={values:Answers;errors:FieldError[];refs:{people:string[];assets:string[];documents:string[]};locations:Record<string,unknown>};
const DATE=/^\d{4}-\d{2}-\d{2}$/,DATETIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const docIds=(v:unknown)=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=191)&&v.length<=20;

/**
 * Pure shape validation against one exact schema. Unknown field ids are rejected; values for
 * hidden fields are dropped (never stored, never required); required applies only to visible
 * fields. References (people, assets, documents, locations) are returned for the server to check.
 */
export function validateShape(schema:FormSchema,raw:unknown):ShapeResult{
 const errors:FieldError[]=[],values:Answers={},refs={people:[] as string[],assets:[] as string[],documents:[] as string[]},locations:Record<string,unknown>={};
 const input=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Answers;
 const fields=new Map(allFields(schema).map(f=>[f.id,f]));
 for(const k of Object.keys(input))if(!fields.has(k))errors.push({field:k,message:'This field is not part of the form.'});
 // Normalise first so conditions evaluate against clean values.
 const clean:Answers={};
 for(const [id,f] of fields){
  const v=input[id];if(!isAnswered(v)&&v!==false){continue;}
  const bad=(m:string)=>errors.push({field:id,message:`${f.label}: ${m}`});
  switch(f.type){
   case 'text':case 'textarea':{if(typeof v!=='string'){bad('enter text.');break;}const t=v.trim(),max=f.type==='text'?500:5000;if(t.length>max){bad(`keep it under ${max} characters.`);break;}if(t)clean[id]=t;break;}
   case 'number':{const n=typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;if(!Number.isFinite(n)){bad('enter a number.');break;}if(f.min!=null&&n<f.min){bad(`must be at least ${f.min}.`);break;}if(f.max!=null&&n>f.max){bad(`must be at most ${f.max}.`);break;}clean[id]=n;break;}
   case 'date':if(typeof v!=='string'||!DATE.test(v))bad('enter a valid date.');else clean[id]=v;break;
   case 'datetime':if(typeof v!=='string'||!DATETIME.test(v.slice(0,16)))bad('enter a valid date and time.');else clean[id]=v.slice(0,16);break;
   case 'boolean':case 'checkbox':if(typeof v!=='boolean')bad('choose yes or no.');else clean[id]=v;break;
   case 'select':{const allowed=new Set((f.options||[]).map(o=>o.value));if(typeof v!=='string'||!allowed.has(v))bad('choose one of the listed options.');else clean[id]=v;break;}
   case 'multiselect':{const allowed=new Set((f.options||[]).map(o=>o.value));if(!Array.isArray(v)||!v.every(x=>typeof x==='string'&&allowed.has(x))){bad('choose from the listed options.');break;}const u=[...new Set(v as string[])];if(u.length)clean[id]=u;break;}
   case 'person':case 'asset':if(typeof v!=='string'||v.length>191)bad(f.type==='person'?'choose a person.':'choose a plant item.');else clean[id]=v;break;
   case 'photo':case 'file':if(!docIds(v))bad('attach up to 20 uploaded files.');else if((v as string[]).length)clean[id]=[...new Set(v as string[])];break;
   case 'location':if(typeof v!=='object'||Array.isArray(v))bad('choose a location.');else clean[id]=v;break;
   case 'signature':{const s=v as Partial<SignatureValue>;if(typeof s!=='object'||!s||typeof s.name!=='string'||!s.name.trim()||s.name.length>160||s.confirmed!==true||(s.documentId!=null&&(typeof s.documentId!=='string'||s.documentId.length>191))){bad('type your name and confirm to sign.');break;}clean[id]={name:s.name.trim(),confirmed:true,documentId:s.documentId||null,...(s.signerUserId?{signerUserId:s.signerUserId}:{}),...(s.signedAt?{signedAt:s.signedAt}:{})};break;}
  }
 }
 const visible=visibleFields(schema,clean);
 for(const [id,f] of fields){
  if(!visible.has(id))continue;
  const v=clean[id];
  if(f.required&&(!isAnswered(v)||(f.type==='checkbox'&&v!==true))){if(!errors.some(e=>e.field===id))errors.push({field:id,message:`${f.label} is required.`});continue;}
  if(v===undefined)continue;
  values[id]=v;
  if(f.type==='person')refs.people.push(v as string);
  if(f.type==='asset')refs.assets.push(v as string);
  if(f.type==='photo'||f.type==='file')refs.documents.push(...(v as string[]));
  if(f.type==='signature'&&(v as SignatureValue).documentId)refs.documents.push((v as SignatureValue).documentId!);
  if(f.type==='location')locations[id]=v;
 }
 return {values,errors,refs,locations};
}

/** Field ids whose stored value differs between two response snapshots. */
export function changedFields(a:Answers,b:Answers){
 const keys=new Set([...Object.keys(a),...Object.keys(b)]);
 return [...keys].filter(k=>JSON.stringify(a[k]??null)!==JSON.stringify(b[k]??null)).sort();
}
export const emptySchema=():FormSchema=>({sections:[{id:'section_1',title:'Details',fields:[]}]});
/** A stable id derived from a label, made unique against existing ids. */
export function fieldIdFrom(label:string,taken:Set<string>){
 const base=(label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').replace(/^([0-9])/,'f_$1')||'field').slice(0,56);
 let id=/^[a-z]/.test(base)?base:`f_${base}`,n=2;
 while(taken.has(id))id=`${base}_${n++}`;
 return id;
}
