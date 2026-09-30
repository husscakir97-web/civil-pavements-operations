// Reproducible dependency security gate: `npm run security:audit`.
// Audits the PRODUCTION dependency set (`npm audit --omit=dev`, i.e. what a production install ships).
// Exit codes: 0 = scan completed and no unresolved high/critical production finding;
//             1 = unresolved high/critical production finding(s);
//             2 = a scanner failure (production OR full-tree scan produced no usable report). Never a pass.
// If both a scanner failure and a blocking finding occur, the exit code is 2 and both are printed.
// Development-only findings from the full-tree scan are informational; a FAILED full-tree scan is not.
// Uses the public npm registry advisory endpoint through npm itself: no credentials, no extra services, no suppression file.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {classifyAudit} from './security-audit-lib.mjs';

const args=process.argv.slice(2),reportPath=args.includes('--report')?args[args.indexOf('--report')+1]:null;
const run=(extra)=>{const r=spawnSync('npm',['audit','--json',...extra],{encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});return {raw:r.stdout||'',exitCode:r.status??-1,signal:r.signal,spawnError:r.error?String(r.error.message||r.error):null,stderr:r.stderr||''};};
const scan=(extra)=>{const r=run(extra);return {...classifyAudit(r.raw,r),stderr:r.stderr};};
const line=(f)=>`  - ${f.name} [${f.severity}] ${f.direct?'direct':'transitive'} ${f.range||''}  fix: ${f.fix}${f.advisories.map(a=>`\n      ${a.severity} ${a.title} ${a.url}`).join('')}${f.via.length?`\n      via ${f.via.join(', ')}`:''}`;

const production=scan(['--omit=dev']);
const fullTree=scan([]);
let scannerFailed=false;
if(production.scannerFailure){scannerFailed=true;console.error('SECURITY AUDIT SCANNER FAILURE (production scan; this is a failure, not a pass): '+production.scannerFailure);if(production.stderr)console.error(production.stderr.slice(0,500));}
else{
 console.log(`Production dependency audit: ${JSON.stringify(production.counts)}`);
 if(production.reported.length)console.log(`Reported (moderate/low, not gating; see docs/SECURITY-DEPENDENCIES.md):\n${production.reported.map(line).join('\n')}`);
}
if(fullTree.scannerFailure){scannerFailed=true;console.error('SECURITY AUDIT SCANNER FAILURE (full-tree scan; this is a failure, not a pass): '+fullTree.scannerFailure);if(fullTree.stderr)console.error(fullTree.stderr.slice(0,500));}
else console.log(`Full tree audit (development findings are informational): ${JSON.stringify(fullTree.counts)}`);

if(reportPath)writeFileSync(reportPath,JSON.stringify({generatedAt:new Date().toISOString(),scannerFailed,production:production.scannerFailure?{scannerFailure:production.scannerFailure}:{counts:production.counts,blocking:production.blocking,reported:production.reported},fullTree:fullTree.scannerFailure?{scannerFailure:fullTree.scannerFailure}:{counts:fullTree.counts}},null,1));
const blocking=production.scannerFailure?[]:production.blocking;
if(blocking.length)console.error(`\nBLOCKING: ${blocking.length} unresolved high/critical production vulnerabilit${blocking.length===1?'y':'ies'}:\n${blocking.map(line).join('\n')}\n\nNo suppression is available in this tool. Upgrade to a fixed version, or record the finding and a proposed mitigation for human review.`);
if(scannerFailed){console.error('\nFAILED: a scanner failure means the dependency state could not be verified.');process.exit(2);}
if(blocking.length)process.exit(1);
console.log('PASS: no unresolved high/critical production vulnerabilities.');
