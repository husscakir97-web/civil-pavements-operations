// Reproducible dependency security gate: `npm run security:audit`.
// Audits the PRODUCTION dependency set (`npm audit --omit=dev`, i.e. what a production install ships).
// Fails on unresolved high/critical findings and on any scanner failure. Uses the public npm registry advisory
// endpoint through npm itself: no credentials, no extra services, no suppression file.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {classifyAudit} from './security-audit-lib.mjs';

const args=process.argv.slice(2),reportPath=args.includes('--report')?args[args.indexOf('--report')+1]:null;
const run=(extra)=>{const r=spawnSync('npm',['audit','--json',...extra],{encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});return {raw:r.stdout||'',exitCode:r.status,signal:r.signal,spawnError:r.error?String(r.error.message||r.error):null,stderr:r.stderr||''};};

const prod=run(['--omit=dev']);
const result=classifyAudit(prod.raw,{exitCode:prod.exitCode??-1,spawnError:prod.spawnError,signal:prod.signal});
const line=(f)=>`  - ${f.name} [${f.severity}] ${f.direct?'direct':'transitive'} ${f.range||''}  fix: ${f.fix}\n${f.advisories.map(a=>`\n      ${a.severity} ${a.title} ${a.url}`).join('')}${f.via.length?`\n      via ${f.via.join(', ')}`:''}`;

if(result.scannerFailure){console.error('SECURITY AUDIT SCANNER FAILURE (this is a failure, not a pass): '+result.scannerFailure);if(prod.stderr)console.error(prod.stderr.slice(0,500));process.exit(2);}
console.log(`Production dependency audit: ${JSON.stringify(result.counts)}`);
if(result.reported.length)console.log(`Reported (moderate/low, not gating; review in docs/SECURITY-DEPENDENCIES.md):\n${result.reported.map(line).join('\n')}`);
// Informational: the full tree including development-only packages. Never gates, never hides the production result.
const full=run([]);const all=classifyAudit(full.raw,{exitCode:full.exitCode??-1,spawnError:full.spawnError,signal:full.signal});
if(all.scannerFailure)console.log('Note: the full-tree (development included) audit could not be read: '+all.scannerFailure);
else console.log(`Full tree audit (informational): ${JSON.stringify(all.counts)}`);
if(reportPath)writeFileSync(reportPath,JSON.stringify({generatedAt:new Date().toISOString(),production:{counts:result.counts,blocking:result.blocking,reported:result.reported},fullTree:all.scannerFailure?null:{counts:all.counts}},null,1));
if(!result.ok){console.error(`\nBLOCKING: ${result.blocking.length} unresolved high/critical production vulnerabilit${result.blocking.length===1?'y':'ies'}:\n${result.blocking.map(line).join('\n')}\n\nNo suppression is available in this tool. Upgrade to a fixed version, or record the finding and a proposed mitigation for human review.`);process.exit(1);}
console.log('PASS: no unresolved high/critical production vulnerabilities.');
