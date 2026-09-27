import type {Route} from '@/components/v1/nav';

export const ENGINE_KEYS=['Win Work','Prepare Work','Resource Work','Deliver Work','Control Money','Learn'] as const;
export type EngineKey=typeof ENGINE_KEYS[number];

export type EngineMeta={
 key:EngineKey;
 number:number;
 short:string;
 purpose:string;
 question:string;
 output:string;
 next:EngineKey|null;
};

export const ENGINES:EngineMeta[]=[
 {key:'Win Work',number:1,short:'Win',purpose:'Turn opportunities into controlled, profitable awarded work.',question:'What should we chase, price and submit next?',output:'Awarded project + approved estimate baseline',next:'Prepare Work'},
 {key:'Prepare Work',number:2,short:'Prepare',purpose:'Turn an award into a project that is genuinely ready to mobilise.',question:'What must be approved, planned or supplied before work starts?',output:'Mobilisation-ready project + controlled plans',next:'Resource Work'},
 {key:'Resource Work',number:3,short:'Resource',purpose:'Put the right people, plant and capacity onto the right work.',question:'Who and what is available, compliant and needed next?',output:'Conflict-checked schedule + assigned resources',next:'Deliver Work'},
 {key:'Deliver Work',number:4,short:'Deliver',purpose:'Run the work simply in the field and capture what actually happened.',question:'What is happening today and what evidence must be captured?',output:'Completed work + dockets + field/HSEQ evidence',next:'Control Money'},
 {key:'Control Money',number:5,short:'Money',purpose:'Convert delivered work into controlled cost, variations, claims, invoices and margin.',question:'What has it cost, what can we claim and where is margin moving?',output:'Commercial position + actual cost/revenue',next:'Learn'},
 {key:'Learn',number:6,short:'Learn',purpose:'Feed real production, cost and performance back into future decisions.',question:'What did we estimate, what actually happened and what should change next time?',output:'Reusable actuals + better estimating assumptions',next:'Win Work'},
];

export const engineMeta=(key:EngineKey)=>ENGINES.find(e=>e.key===key)!;
export const isEngineKey=(value:string):value is EngineKey=>(ENGINE_KEYS as readonly string[]).includes(value);

/**
 * Existing links/bookmarks keep working while the product moves to the six-engine IA.
 * The URL is left untouched; the workspace shell resolves the legacy area to its engine.
 */
export function resolveEngineRoute(route:Route):Route{
 if(isEngineKey(route.area)||route.area==='Home'||route.area==='Admin'||route.area==='Search')return route;
 if(route.area==='Pipeline')return {...route,area:'Win Work',sub:route.sub||'Tenders'};
 if(route.area==='Projects')return {...route,area:'Prepare Work',sub:'Projects'};
 if(route.area==='Operations'){
  if(route.sub==='Dockets')return {...route,area:'Deliver Work',sub:'Dockets'};
  if(route.sub==='Resources')return {...route,area:'Resource Work',sub:'Resources'};
  return {...route,area:'Resource Work',sub:'Schedule'};
 }
 if(route.area==='Commercial')return {...route,area:'Control Money',sub:'Commercial'};
 if(route.area==='IMS & HSEQ')return {...route,area:'Prepare Work',sub:'IMS & HSEQ'};
 if(route.area==='Reports')return {...route,area:'Learn',sub:'Reports'};
 return route;
}

export const ENGINE_ROUTE_OUTPUTS:Record<EngineKey,{label:string;target:[string,string?]}>={
 'Win Work':{label:'Awarded work moves into project setup',target:['Prepare Work','Projects']},
 'Prepare Work':{label:'Ready projects move into resourcing',target:['Resource Work','Schedule']},
 'Resource Work':{label:'Scheduled work moves into delivery',target:['Deliver Work','Projects']},
 'Deliver Work':{label:'Delivered work moves into commercial control',target:['Control Money','Commercial']},
 'Control Money':{label:'Actual cost and revenue move into learning',target:['Learn','Overview']},
 'Learn':{label:'Actual performance feeds the next opportunity and estimate',target:['Win Work','Overview']},
};
