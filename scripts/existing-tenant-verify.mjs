// Read-only verification of the demonstration records inside an existing tenant (allow-listed target). Writes nothing.
import {connect} from './mysql-config.mjs';
import {assertReadOnlySql} from './live-tenant-inventory.mjs';
import {evaluateExistingTenantAllowlist} from './demo/existing-tenant.mjs';
import {verifyImport} from './demo/import-verify.mjs';
const arg=n=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:undefined;};
const org=arg('--organisation-id'),file=arg('--existing-tenant-allowlist');
if(!org||!file){console.error('Usage: --organisation-id <id> --existing-tenant-allowlist <file>');process.exit(2);}
const ev=evaluateExistingTenantAllowlist(file,process.env);
if(ev.problems.length||ev.entry.organisationId!==org){console.error('Refusing (existing-tenant allow-list):\n - '+[...ev.problems,...(ev.entry&&ev.entry.organisationId!==org?['--organisation-id is not the allow-listed organisation']:[])].join('\n - '));process.exit(2);}
const raw=await connect();
try{
 await raw.query('SET SESSION TRANSACTION READ ONLY');await raw.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
 const r=await verifyImport(async(sql,p=[])=>{assertReadOnlySql(sql);return (await raw.query(sql,p))[0];},org,console.log);
 await raw.query('ROLLBACK');
 console.log(r.failed?`\nVERIFICATION FAILED: ${r.failed} check(s)`:'\nDemonstration records verified in the existing tenant.');process.exitCode=r.failed?1:0;
}finally{await raw.end();}
