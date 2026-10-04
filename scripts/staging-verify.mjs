// Read-only verification of an allow-listed staging demonstration database: the allow-list matches the environment, the database holds
// only the named organisation (administrator + the dataset's five team members, one login), and the demonstration records verify.
// Safe to run any time, including after an interrupted or repeated import. Writes nothing.
//   node scripts/staging-verify.mjs --organisation-id <id> --staging-allowlist allow.json   (env: MYSQL_*, DEMO_SEED_EMAIL, STAGING_DEMO_CONFIRM_SHA256)
import {connect} from './mysql-config.mjs';
import {assertReadOnlySql} from './live-tenant-inventory.mjs';
import {evaluateAllowlist,assertOnlyNamedOrganisation} from './demo/staging-allowlist.mjs';
import {verifyImport} from './demo/import-verify.mjs';
const arg=n=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:undefined;};
const org=arg('--organisation-id'),file=arg('--staging-allowlist');
if(!org||!file){console.error('Usage: --organisation-id <id> --staging-allowlist <file>');process.exit(2);}
const ev=evaluateAllowlist(file,process.env);
if(ev.problems.length){console.error('Refusing (staging allow-list):\n - '+ev.problems.join('\n - '));process.exit(2);}
const raw=await connect();
try{
 const bad=await assertOnlyNamedOrganisation(raw,org,ev.entry);
 if(bad.length){console.error('Staging database check failed:\n - '+bad.join('\n - '));process.exitCode=3;}
 else{
  await raw.query('SET SESSION TRANSACTION READ ONLY');await raw.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const r=await verifyImport(async(sql,p=[])=>{assertReadOnlySql(sql);return (await raw.query(sql,p))[0];},org,console.log);
  await raw.query('ROLLBACK');
  console.log(r.failed?`\nVERIFICATION FAILED: ${r.failed} check(s)`:'\nStaging demonstration database verified.');process.exitCode=r.failed?1:0;
 }
}finally{await raw.end();}
