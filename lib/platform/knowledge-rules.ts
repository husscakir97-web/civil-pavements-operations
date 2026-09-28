import {z} from 'zod';

export const KNOWLEDGE_OPS=['eq','neq','in','not_in','exists','not_exists','gt','gte','lt','lte','contains','between'] as const;
export type KnowledgeOp=typeof KNOWLEDGE_OPS[number];

export const predicateSchema=z.object({
 field:z.string().trim().min(1).max(160),
 op:z.enum(KNOWLEDGE_OPS),
 value:z.unknown().optional(),
});
export type KnowledgePredicate=z.infer<typeof predicateSchema>;

export const conditionSetSchema=z.object({
 all:z.array(predicateSchema).max(40).default([]),
 any:z.array(predicateSchema).max(40).default([]),
}).default({all:[],any:[]});
export type KnowledgeConditionSet=z.infer<typeof conditionSetSchema>;

export type KnowledgeRuleForCheck={
 id:string;
 ruleCode:string;
 title:string;
 topic:string;
 ruleType:string;
 appliesWhen:KnowledgeConditionSet;
 assertion:KnowledgePredicate|null;
 severity:'block'|'warning'|'advisory';
 message:string;
 source:{id:string;title:string;authority:string|null;referenceCode:string|null;revisionLabel:string|null;jurisdiction:string|null;sourceClause:string|null;sourcePage:string|null;effectiveFrom:string|null;effectiveTo:string|null};
};

export type KnowledgeCheckResult={
 ruleId:string;
 ruleCode:string;
 title:string;
 topic:string;
 severity:'block'|'warning'|'advisory';
 applicability:'applicable'|'not_applicable'|'unknown';
 result:'pass'|'fail'|'needs_context'|'advisory';
 message:string;
 field:string|null;
 actual:unknown;
 expected:unknown;
 source:KnowledgeRuleForCheck['source'];
};

const getPath=(input:unknown,path:string)=>{
 let cur:unknown=input;
 for(const part of path.split('.')){
  if(cur==null||typeof cur!=='object'||Array.isArray(cur)||!(part in cur))return undefined;
  cur=(cur as Record<string,unknown>)[part];
 }
 return cur;
};
const scalar=(v:unknown)=>{
 if(typeof v==='number'||typeof v==='boolean')return v;
 if(typeof v==='string'){
  const s=v.trim(),n=Number(s);
  if(s!==''&&Number.isFinite(n))return n;
  return s.toLowerCase();
 }
 return v;
};
const same=(a:unknown,b:unknown)=>scalar(a)===scalar(b);
const list=(v:unknown)=>Array.isArray(v)?v:[v];

export function evaluatePredicate(predicate:KnowledgePredicate,input:unknown):true|false|null{
 const actual=getPath(input,predicate.field);
 if(predicate.op==='exists')return actual!==undefined&&actual!==null&&actual!=='';
 if(predicate.op==='not_exists')return actual===undefined||actual===null||actual==='';
 if(actual===undefined||actual===null||actual==='')return null;
 const expected=predicate.value;
 switch(predicate.op){
  case 'eq':return same(actual,expected);
  case 'neq':return !same(actual,expected);
  case 'in':return list(expected).some(v=>same(actual,v));
  case 'not_in':return !list(expected).some(v=>same(actual,v));
  case 'contains':{
   if(Array.isArray(actual))return actual.some(v=>same(v,expected));
   return String(actual).toLowerCase().includes(String(expected??'').toLowerCase());
  }
  case 'gt':
  case 'gte':
  case 'lt':
  case 'lte':{
   const a=Number(actual),b=Number(expected);
   if(!Number.isFinite(a)||!Number.isFinite(b))return false;
   if(predicate.op==='gt')return a>b;
   if(predicate.op==='gte')return a>=b;
   if(predicate.op==='lt')return a<b;
   return a<=b;
  }
  case 'between':{
   const a=Number(actual),range=Array.isArray(expected)?expected:[];
   if(!Number.isFinite(a)||range.length!==2)return false;
   const lo=Number(range[0]),hi=Number(range[1]);
   return Number.isFinite(lo)&&Number.isFinite(hi)&&a>=lo&&a<=hi;
  }
 }
}

export function evaluateConditions(set:KnowledgeConditionSet,input:unknown):true|false|null{
 const all=set.all.map(p=>evaluatePredicate(p,input));
 if(all.some(v=>v===false))return false;
 const any=set.any.map(p=>evaluatePredicate(p,input));
 if(any.length&&any.every(v=>v===false))return false;
 if(all.some(v=>v===null)||any.some(v=>v===null))return null;
 if(any.length&&!any.some(Boolean))return false;
 return true;
}

export function evaluateKnowledgeRule(rule:KnowledgeRuleForCheck,input:unknown):KnowledgeCheckResult{
 const applicable=evaluateConditions(rule.appliesWhen,input);
 const base={ruleId:rule.id,ruleCode:rule.ruleCode,title:rule.title,topic:rule.topic,severity:rule.severity,message:rule.message,source:rule.source};
 if(applicable===false)return {...base,applicability:'not_applicable',result:'pass',field:rule.assertion?.field??null,actual:undefined,expected:rule.assertion?.value} as KnowledgeCheckResult;
 if(applicable===null)return {...base,applicability:'unknown',result:'needs_context',field:rule.assertion?.field??null,actual:undefined,expected:rule.assertion?.value} as KnowledgeCheckResult;
 if(!rule.assertion)return {...base,applicability:'applicable',result:'advisory',field:null,actual:undefined,expected:undefined};
 const actual=getPath(input,rule.assertion.field);
 const passed=evaluatePredicate(rule.assertion,input);
 return {...base,applicability:'applicable',result:passed===null?'needs_context':passed?'pass':'fail',field:rule.assertion.field,actual,expected:rule.assertion.value};
}

export function sourceReference(source:KnowledgeRuleForCheck['source']){
 return [source.authority,source.referenceCode,source.revisionLabel,source.sourceClause&&'Clause '+source.sourceClause,source.sourcePage&&'Page '+source.sourcePage].filter(Boolean).join(' · ');
}

export function knowledgeSummary(results:KnowledgeCheckResult[]){
 const applicable=results.filter(r=>r.applicability==='applicable');
 return {
  rules:results.length,
  applicable:applicable.length,
  passed:applicable.filter(r=>r.result==='pass').length,
  failed:applicable.filter(r=>r.result==='fail').length,
  advisory:applicable.filter(r=>r.result==='advisory').length,
  needsContext:results.filter(r=>r.result==='needs_context').length,
  blocking:applicable.filter(r=>r.result==='fail'&&r.severity==='block').length,
 };
}
