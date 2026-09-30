// Pure classification of `npm audit --json` output. Kept separate from the runner so it is unit-tested offline.
// Policy: unresolved high/critical PRODUCTION vulnerabilities fail; a scanner that did not produce a usable,
// internally consistent report fails (it must never pass silently). There is deliberately no ignore/allow list:
// an exception is a human decision made in review, not something this tool grants itself.
export const GATE_SEVERITIES=['high','critical'];
export const SEVERITIES=['info','low','moderate','high','critical'];
const isObject=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isCount=(v)=>typeof v==='number'&&Number.isInteger(v)&&v>=0;
const isString=(v)=>typeof v==='string';

/** Structural validation. Returns null when the report is well-formed, else a description of the first defect. */
export function malformedReason(d){
 if(!isObject(d))return 'the report is not a JSON object';
 const counts=d.metadata?.vulnerabilities;
 if(!isObject(d.metadata)||!isObject(counts))return 'missing metadata.vulnerabilities';
 for(const k of Object.keys(counts))if(k!=='total'&&!SEVERITIES.includes(k))return `unknown severity "${k}" in the counts`;
 for(const s of [...SEVERITIES,'total'])if(!isCount(counts[s]))return `count "${s}" is missing or not a non-negative integer`;
 if(!isObject(d.vulnerabilities))return 'missing vulnerabilities object';
 for(const [name,v] of Object.entries(d.vulnerabilities)){
  if(!isObject(v))return `finding "${name}" is not an object`;
  if(!SEVERITIES.includes(v.severity))return `finding "${name}" has an unknown severity ${JSON.stringify(v.severity)}`;
  if(v.name!==undefined&&!isString(v.name))return `finding "${name}" has an invalid name`;
  if(v.isDirect!==undefined&&typeof v.isDirect!=='boolean')return `finding "${name}" has an invalid isDirect`;
  if(v.range!==undefined&&!isString(v.range))return `finding "${name}" has an invalid range`;
  if(!Array.isArray(v.via))return `finding "${name}" has no via list`;
  for(const x of v.via){
   if(isString(x))continue;
   if(!isObject(x))return `finding "${name}" has an invalid via entry`;
   if(!SEVERITIES.includes(x.severity))return `finding "${name}" has an advisory with an unknown severity ${JSON.stringify(x.severity)}`;
   if(!isString(x.title)||!isString(x.url))return `finding "${name}" has an advisory without a title or url`;
   if(x.range!==undefined&&!isString(x.range))return `finding "${name}" has an advisory with an invalid range`;
  }
  const fa=v.fixAvailable;
  if(fa!==undefined&&typeof fa!=='boolean'&&!(isObject(fa)&&isString(fa.name)&&isString(fa.version)))return `finding "${name}" has an invalid fixAvailable`;
 }
 return null;
}

/** Returns {ok,scannerFailure,blocking,reported,counts}. ok is true ONLY for a valid report with no high/critical finding. */
export function classifyAudit(raw,{exitCode=0,spawnError=null,signal=null}={}){
 const fail=(scannerFailure)=>({ok:false,scannerFailure,blocking:[],reported:[],counts:null});
 if(spawnError)return fail('could not run npm audit: '+spawnError);
 if(signal)return fail('npm audit was terminated by signal '+signal);
 let d;
 try{d=JSON.parse(raw);}catch{return fail('npm audit did not return JSON (exit '+exitCode+'): '+String(raw).slice(0,200));}
 if(isObject(d)&&d.error)return fail('npm audit reported an error: '+(isObject(d.error)?(d.error.summary||d.error.code||JSON.stringify(d.error)):String(d.error)).toString().slice(0,300));
 const bad=malformedReason(d);
 if(bad)return fail('malformed npm audit report: '+bad);
 // npm exits 1 when it FINDS vulnerabilities and 0 when it finds none; anything else is a scanner problem.
 if(exitCode!==0&&exitCode!==1)return fail('npm audit exited with code '+exitCode);
 const findings=Object.entries(d.vulnerabilities).map(([name,v])=>({
  name,severity:v.severity,direct:Boolean(v.isDirect),range:v.range,
  advisories:v.via.filter(isObject).map(x=>({title:x.title,url:x.url,severity:x.severity,range:x.range})),
  via:v.via.filter(isString),fix:isObject(v.fixAvailable)?`${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor?' (semver-major)':''}`:v.fixAvailable===true?'available':'none',
 })).sort((a,b)=>SEVERITIES.indexOf(b.severity)-SEVERITIES.indexOf(a.severity)||a.name.localeCompare(b.name));
 // Internal consistency: per-severity counts and the total must equal what the report actually lists.
 const counts=d.metadata.vulnerabilities;
 for(const s of SEVERITIES){const listed=findings.filter(f=>f.severity===s).length;if(listed!==counts[s])return fail(`inconsistent report: ${counts[s]} ${s} declared but ${listed} listed`);}
 const declaredTotal=SEVERITIES.reduce((n,s)=>n+counts[s],0);
 if(counts.total!==declaredTotal||declaredTotal!==findings.length)return fail(`inconsistent report: total ${counts.total}, per-severity sum ${declaredTotal}, findings listed ${findings.length}`);
 // The exit code must agree with the report: findings with exit 0, or a failing exit with an empty report, is contradictory.
 if(findings.length>0&&exitCode===0)return fail('inconsistent report: vulnerabilities listed but npm audit exited 0');
 if(findings.length===0&&exitCode===1)return fail('inconsistent report: npm audit exited 1 with no vulnerabilities listed');
 const blocking=findings.filter(f=>GATE_SEVERITIES.includes(f.severity));
 return {ok:blocking.length===0,scannerFailure:null,blocking,reported:findings.filter(f=>!GATE_SEVERITIES.includes(f.severity)),counts:{...counts}};
}
