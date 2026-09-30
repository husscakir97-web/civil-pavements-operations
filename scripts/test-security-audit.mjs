// Tests for the security gate: offline classifier unit tests AND real subprocess runs of the CLI against a fake `npm`
// placed first on PATH (no network, no real audit). The CLI cases prove exit codes and that PASS is never printed on failure.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {classifyAudit} from './security-audit-lib.mjs';

const SEV=['info','low','moderate','high','critical'];
const finding=(severity,extra={})=>({name:'p',severity,isDirect:true,via:[{title:'x',url:'https://github.com/advisories/GHSA-x',severity,range:'<1.0.0'}],effects:[],range:'<1.0.0',nodes:['node_modules/p'],fixAvailable:{name:'p',version:'1.0.1',isSemVerMajor:false},...extra});
const report=(vulns,over={},countsOver={})=>{const counts=Object.fromEntries(SEV.map(s=>[s,0]));for(const v of Object.values(vulns))counts[v.severity]++;counts.total=Object.keys(vulns).length;return JSON.stringify({auditReportVersion:2,vulnerabilities:vulns,metadata:{vulnerabilities:{...counts,...countsOver}},...over});};
const CLEAN=report({}),MODERATE=report({a:finding('moderate'),b:finding('low')}),HIGH=report({a:finding('high'),b:finding('critical'),c:finding('moderate')});

// ---------------------------------------------------------------- offline unit tests
assert.equal(classifyAudit(CLEAN,{exitCode:0}).ok,true);
{const r=classifyAudit(MODERATE,{exitCode:1});assert.equal(r.ok,true);assert.equal(r.reported.length,2);assert.equal(r.blocking.length,0);}
{const r=classifyAudit(HIGH,{exitCode:1});assert.equal(r.ok,false);assert.equal(r.scannerFailure,null);assert.deepEqual(r.blocking.map(f=>f.name),['b','a']);assert.equal(r.blocking[0].advisories[0].url,'https://github.com/advisories/GHSA-x');assert.equal(r.reported.length,1);}
assert.equal(classifyAudit(report({t:finding('high',{isDirect:false,via:['inner']})}),{exitCode:1}).ok,false,'a transitive high finding still fails');

const mustBeScannerFailure=(label,raw,opts={exitCode:1})=>{const r=classifyAudit(raw,opts);assert.equal(r.ok,false,label+' must not pass');assert.ok(r.scannerFailure,label+' must be a scanner failure, not a clean or blocking result');assert.deepEqual(r.blocking,[]);};
const parsed=(vulns={a:finding('moderate')})=>JSON.parse(report(vulns));
const withCounts=(mut,vulns)=>{const d=parsed(vulns);mut(d.metadata.vulnerabilities);return JSON.stringify(d);};
// Not JSON / wrong top-level shapes.
mustBeScannerFailure('empty output','');mustBeScannerFailure('not json','<html>502</html>');
for(const [label,value] of [['array','[]'],['array of reports',`[${report({})}]`],['null','null'],['string','"ok"'],['number','0'],['boolean','true']])mustBeScannerFailure('top-level '+label,value,{exitCode:0});
mustBeScannerFailure('error payload',JSON.stringify({error:{code:'ENOTFOUND',summary:'request failed'}}));
mustBeScannerFailure('error string payload',JSON.stringify({error:'boom'}));
// Missing / invalid metadata and counts.
mustBeScannerFailure('no metadata',JSON.stringify({vulnerabilities:{}}),{exitCode:0});
mustBeScannerFailure('metadata is an array',JSON.stringify({metadata:[],vulnerabilities:{}}),{exitCode:0});
mustBeScannerFailure('counts is an array',JSON.stringify({metadata:{vulnerabilities:[]},vulnerabilities:{}}),{exitCode:0});
mustBeScannerFailure('no vulnerabilities map',JSON.stringify({metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}}),{exitCode:0});
mustBeScannerFailure('vulnerabilities is an array',JSON.stringify({metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}},vulnerabilities:[]}),{exitCode:0});
for(const s of [...SEV,'total'])mustBeScannerFailure('missing count '+s,withCounts(c=>{delete c[s];},{}),{exitCode:0});
for(const [label,bad] of [['negative',-1],['fractional',1.5],['string','0'],['null',null],['NaN-like',Number.NaN],['array',[0]]])mustBeScannerFailure('invalid count ('+label+')',withCounts(c=>{c.high=bad;},{}),{exitCode:0});
mustBeScannerFailure('unknown severity key in counts',withCounts(c=>{c.catastrophic=1;},{}),{exitCode:0});
// Invalid finding structures.
for(const [label,mut] of [
 ['null finding',d=>{d.vulnerabilities.a=null;}],['array finding',d=>{d.vulnerabilities.a=[];}],['string finding',d=>{d.vulnerabilities.a='bad';}],
 ['unknown finding severity',d=>{d.vulnerabilities.a.severity='catastrophic';}],['missing finding severity',d=>{delete d.vulnerabilities.a.severity;}],
 ['numeric severity',d=>{d.vulnerabilities.a.severity=3;}],['no via',d=>{delete d.vulnerabilities.a.via;}],['via not an array',d=>{d.vulnerabilities.a.via='x';}],
 ['via entry null',d=>{d.vulnerabilities.a.via=[null];}],['via entry number',d=>{d.vulnerabilities.a.via=[7];}],
 ['advisory unknown severity',d=>{d.vulnerabilities.a.via=[{title:'t',url:'u',severity:'weird'}];}],['advisory without url',d=>{d.vulnerabilities.a.via=[{title:'t',severity:'high'}];}],['advisory without title',d=>{d.vulnerabilities.a.via=[{url:'u',severity:'high'}];}],
 ['isDirect not boolean',d=>{d.vulnerabilities.a.isDirect='yes';}],['range not a string',d=>{d.vulnerabilities.a.range=5;}],['fixAvailable garbage',d=>{d.vulnerabilities.a.fixAvailable='soon';}],['fixAvailable object without version',d=>{d.vulnerabilities.a.fixAvailable={name:'p'};}],
])mustBeScannerFailure(label,(()=>{const d=parsed();mut(d);return JSON.stringify(d);})());
// Inconsistent counts / totals.
mustBeScannerFailure('total too small',withCounts(c=>{c.total=0;}));mustBeScannerFailure('total too large',withCounts(c=>{c.total=9;}));
mustBeScannerFailure('per-severity count too low (hides a high)',(()=>{const d=JSON.parse(HIGH);d.metadata.vulnerabilities.high=0;d.metadata.vulnerabilities.total=2;return JSON.stringify(d);})());
mustBeScannerFailure('per-severity count too high',withCounts(c=>{c.moderate=2;c.total=2;}));
mustBeScannerFailure('severity shifted between buckets',withCounts(c=>{c.moderate=0;c.high=1;}));
mustBeScannerFailure('declared findings but none listed',withCounts(c=>{c.moderate=1;c.total=1;},{}));
mustBeScannerFailure('finding listed but zero declared',JSON.stringify({...JSON.parse(report({a:finding('high')})),metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}}));
// Exit code must agree with the report; other exits are scanner failures.
mustBeScannerFailure('findings but exit 0',MODERATE,{exitCode:0});mustBeScannerFailure('clean but exit 1',CLEAN,{exitCode:1});
for(const code of [2,127,-1])mustBeScannerFailure('exit '+code,CLEAN,{exitCode:code});
mustBeScannerFailure('spawn error','',{spawnError:'ENOENT'});mustBeScannerFailure('killed','',{signal:'SIGTERM'});
// There is no way to suppress a finding through the input: unknown keys are ignored, the finding still blocks.
assert.equal(classifyAudit(JSON.stringify({...JSON.parse(report({a:finding('high')})),ignore:['a'],allowlist:['a'],exceptions:['a']}),{exitCode:1}).ok,false);

// ---------------------------------------------------------------- CLI subprocess tests (real process, fake npm on PATH)
const dir=mkdtempSync(path.join(tmpdir(),'fake-npm-'));
writeFileSync(path.join(dir,'npm'),`#!${process.execPath}
const s=JSON.parse(process.env.FAKE_NPM_SCENARIO);const c=s[process.argv.includes('--omit=dev')?'prod':'full'];
if(c.crash)process.kill(process.pid,'SIGKILL');
process.stdout.write(c.stdout??'');process.stderr.write(c.stderr??'');process.exit(c.exit??0);
`);chmodSync(path.join(dir,'npm'),0o755);
const cli=(scenario,{noNpm=false}={})=>{const r=spawnSync(process.execPath,['scripts/security-audit.mjs'],{encoding:'utf8',env:{...process.env,PATH:noNpm?path.join(dir,'empty'):dir+path.delimiter+process.env.PATH,FAKE_NPM_SCENARIO:JSON.stringify(scenario)},cwd:path.resolve(path.dirname(new URL(import.meta.url).pathname),'..')});return {code:r.status,out:r.stdout,err:r.stderr};};
const ok=(stdout,exit=0)=>({stdout,exit}),NET={stdout:JSON.stringify({error:{code:'ENOTFOUND',summary:'audit endpoint unreachable'}}),stderr:'npm error audit endpoint returned an error',exit:1};
const neverPassed=(r)=>assert.ok(!/PASS/.test(r.out),'PASS must not be printed. stdout: '+r.out);
try{
 // 1. Success path.
 {const r=cli({prod:ok(CLEAN),full:ok(CLEAN)});assert.equal(r.code,0);assert.match(r.out,/PASS: no unresolved high\/critical/);}
 // 2. Moderate/low production findings are shown but do not fail.
 {const r=cli({prod:ok(MODERATE,1),full:ok(MODERATE,1)});assert.equal(r.code,0);assert.match(r.out,/Reported \(moderate\/low/);assert.match(r.out,/\[moderate\]/);assert.match(r.out,/PASS/);}
 // 3. High/critical production findings: exit 1, listed with advisory links, no PASS.
 {const r=cli({prod:ok(HIGH,1),full:ok(HIGH,1)});assert.equal(r.code,1);neverPassed(r);assert.match(r.err,/BLOCKING: 2 unresolved/);assert.match(r.err,/GHSA-x/);assert.match(r.out,/\[moderate\]/,'moderate findings are still shown alongside blocking ones');}
 // 4. THE REGRESSION: production scan OK, then the full-tree scan fails (network error) -> exit 2, never PASS.
 {const r=cli({prod:ok(CLEAN),full:NET});assert.equal(r.code,2);neverPassed(r);assert.match(r.err,/SCANNER FAILURE \(full-tree scan/);}
 for(const [label,full] of [['non-JSON body',{stdout:'<html>502 Bad Gateway</html>',exit:1}],['empty body',{stdout:'',exit:1}],['killed by signal',{crash:true}],['array report',ok('[]')],['contradictory counts',ok(report({a:finding('moderate')},{},{total:5}),1)],['exit 0 with findings',ok(MODERATE,0)]]){
  const r=cli({prod:ok(CLEAN),full});assert.equal(r.code,2,'full-tree '+label+' must exit 2');neverPassed(r);assert.match(r.err,/SCANNER FAILURE \(full-tree/);}
 // 5. Production scanner failures.
 {const r=cli({prod:NET,full:ok(CLEAN)});assert.equal(r.code,2);neverPassed(r);assert.match(r.err,/SCANNER FAILURE \(production scan/);}
 for(const [label,prod] of [['array report',ok('[]',0)],['missing counts',ok(JSON.stringify({vulnerabilities:{}}))],['hidden high (counts say none)',ok(JSON.stringify({...JSON.parse(report({a:finding('high')})),metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}}),1)],['unknown severity',ok(JSON.stringify({...JSON.parse(CLEAN),vulnerabilities:{a:finding('catastrophic')},metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:1}}}),1)]]){
  const r=cli({prod,full:ok(CLEAN)});assert.equal(r.code,2,'production '+label+' must exit 2');neverPassed(r);}
 // 6. Both scanners fail, or a blocking production finding coexists with a failed full-tree scan: exit 2, findings still printed.
 {const r=cli({prod:NET,full:NET});assert.equal(r.code,2);neverPassed(r);assert.match(r.err,/production scan/);assert.match(r.err,/full-tree scan/);}
 {const r=cli({prod:ok(HIGH,1),full:NET});assert.equal(r.code,2);neverPassed(r);assert.match(r.err,/BLOCKING: 2/,'the blocking findings are not hidden by the scanner failure');}
 // 7. Development-only findings are informational: high findings only in the full tree do not fail a clean production scan.
 {const r=cli({prod:ok(CLEAN),full:ok(HIGH,1)});assert.equal(r.code,0);assert.match(r.out,/development findings are informational/);assert.match(r.out,/PASS/);}
 // 8. The scanner cannot be run at all.
 {const r=cli({prod:ok(CLEAN),full:ok(CLEAN)},{noNpm:true});assert.equal(r.code,2);neverPassed(r);assert.match(r.err,/could not run npm audit/);}
}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS security audit gate: strict report validation (shapes, counts, severities, findings, consistency, exit codes) and real CLI runs — high/critical production findings exit 1, any production OR full-tree scanner failure exits 2, PASS is never printed on failure, no suppression path');
