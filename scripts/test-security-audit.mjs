// Offline tests for the security gate's classification (no network, no npm).
import assert from 'node:assert/strict';
import {classifyAudit} from './security-audit-lib.mjs';
const report=(vulns,over={})=>{const counts={info:0,low:0,moderate:0,high:0,critical:0};for(const v of Object.values(vulns))counts[v.severity]++;return JSON.stringify({auditReportVersion:2,vulnerabilities:vulns,metadata:{vulnerabilities:{...counts,total:Object.keys(vulns).length,...over}}});};
const v=(severity,extra={})=>({severity,isDirect:true,range:'<1.0.0',via:[{title:'x',url:'https://github.com/advisories/GHSA-x',severity,range:'<1.0.0'}],fixAvailable:{name:'p',version:'1.0.1',isSemVerMajor:false},...extra});
// Clean and moderate-only reports pass; moderate/low findings are reported, not gating.
assert.equal(classifyAudit(report({}),{exitCode:0}).ok,true);
{const r=classifyAudit(report({a:v('moderate'),b:v('low')}),{exitCode:1});assert.equal(r.ok,true);assert.equal(r.reported.length,2);assert.equal(r.blocking.length,0);}
// High and critical fail, sorted most severe first, with advisory links kept.
{const r=classifyAudit(report({a:v('high'),b:v('critical'),c:v('moderate')}),{exitCode:1});assert.equal(r.ok,false);assert.deepEqual(r.blocking.map(f=>f.name),['b','a']);assert.equal(r.blocking[0].advisories[0].url,'https://github.com/advisories/GHSA-x');assert.equal(r.scannerFailure,null);}
// A transitive high finding still fails.
assert.equal(classifyAudit(report({t:v('high',{isDirect:false,via:['inner']})}),{exitCode:1}).ok,false);
// Scanner failures NEVER pass: no JSON, npm error payload, spawn error, signal, odd exit code, missing/inconsistent report.
for(const [label,args] of [
 ['empty output',['',{exitCode:1}]],['not json',['<html>502</html>',{exitCode:1}]],
 ['error payload',[JSON.stringify({error:{code:'ENOTFOUND',summary:'request failed'}}),{exitCode:1}]],
 ['spawn error',['',{spawnError:'ENOENT'}]],['killed',['',{signal:'SIGTERM'}]],
 ['unexpected exit code',[report({}),{exitCode:127}]],
 ['no metadata',[JSON.stringify({vulnerabilities:{}}),{exitCode:0}]],['no vulnerabilities map',[JSON.stringify({metadata:{vulnerabilities:{high:0}}}),{exitCode:0}]],
 ['counts disagree with findings',[report({a:v('moderate')},{moderate:0,high:0}),{exitCode:1}]],
]){const r=classifyAudit(...args);assert.equal(r.ok,false,label+' must fail');assert.ok(r.scannerFailure,label+' must be reported as a scanner failure');}
// There is no way to suppress a finding through the input: unknown keys are ignored, the finding still blocks.
assert.equal(classifyAudit(JSON.stringify({...JSON.parse(report({a:v('high')})),ignore:['a'],allowlist:['a']}),{exitCode:1}).ok,false);
console.log('PASS security audit gate: high/critical production findings fail, moderate/low are reported, every scanner-failure shape fails, no suppression path');
