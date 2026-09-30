// Pure classification of `npm audit --json` output. Kept separate from the runner so it is unit-tested offline.
// Policy: unresolved high/critical PRODUCTION vulnerabilities fail; a scanner that did not produce a usable
// report fails (it must never pass silently). There is deliberately no ignore/allow list: an exception is a human
// decision made in review, not something this tool grants itself.
export const GATE_SEVERITIES=['high','critical'];
const ORDER=['info','low','moderate','high','critical'];

/** Returns {ok:boolean,scannerFailure:string|null,blocking:Finding[],reported:Finding[],counts}. */
export function classifyAudit(raw,{exitCode=0,spawnError=null,signal=null}={}){
 const fail=(scannerFailure)=>({ok:false,scannerFailure,blocking:[],reported:[],counts:null});
 if(spawnError)return fail('could not run npm audit: '+spawnError);
 if(signal)return fail('npm audit was terminated by signal '+signal);
 let d;
 try{d=JSON.parse(raw);}catch{return fail('npm audit did not return JSON (exit '+exitCode+'): '+String(raw).slice(0,200));}
 if(d&&d.error)return fail('npm audit reported an error: '+(d.error.summary||d.error.code||JSON.stringify(d.error)).toString().slice(0,300));
 const counts=d?.metadata?.vulnerabilities;
 if(!counts||typeof counts!=='object'||!d.vulnerabilities||typeof d.vulnerabilities!=='object')return fail('npm audit output has no vulnerability report');
 // npm exits 1 when it FINDS vulnerabilities; any other non-zero exit with a report is still a scanner problem.
 if(exitCode!==0&&exitCode!==1)return fail('npm audit exited with code '+exitCode);
 const findings=Object.entries(d.vulnerabilities).map(([name,v])=>({
  name,severity:v.severity,direct:Boolean(v.isDirect),range:v.range,
  advisories:(v.via||[]).filter(x=>x&&typeof x==='object').map(x=>({title:x.title,url:x.url,severity:x.severity,range:x.range})),
  via:(v.via||[]).filter(x=>typeof x==='string'),fix:v.fixAvailable&&typeof v.fixAvailable==='object'?`${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor?' (semver-major)':''}`:v.fixAvailable===true?'available':'none',
 })).sort((a,b)=>ORDER.indexOf(b.severity)-ORDER.indexOf(a.severity)||a.name.localeCompare(b.name));
 const blocking=findings.filter(f=>GATE_SEVERITIES.includes(f.severity));
 // The reported total must agree with the parsed list; a mismatch means the report is unusable.
 const declared=ORDER.reduce((n,s)=>n+Number(counts[s]||0),0);
 if(declared!==findings.length)return fail(`npm audit counts (${declared}) do not match its findings (${findings.length})`);
 return {ok:blocking.length===0,scannerFailure:null,blocking,reported:findings.filter(f=>!GATE_SEVERITIES.includes(f.severity)),counts};
}
