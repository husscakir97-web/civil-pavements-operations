// The ONE explicit way the demonstration importer may write to a database that is not a local *_test database: a reviewed allow-list file.
// It never relaxes any other importer guard (plan hash, baseline, integrations off, administrator of the named organisation, own isolated app).
// The database NAME proves nothing. Instead the operator writes the exact host/port/database/user and public URL into a file, reviews it, and
// supplies the file's SHA-256 as a typed confirmation. Anything that differs from the file, a production database, or a database that holds
// anything but the one named organisation is refused. There is no flag that bypasses this.
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';

import {protectedDatabase,protectedUrl,PROTECTED_DATABASES} from '../../lib/platform/staging-policy.mjs';
import {DEMO_TEAM} from './import-guards.mjs';
export const KNOWN_PRODUCTION_DATABASES=PROTECTED_DATABASES;
const KEYS=['environment','host','port','database','user','appUrl','adminEmail','refuseDatabases'];

/** Returns {problems, entry}; problems is empty only when the file and the environment agree exactly. */
export function evaluateAllowlist(file,env=process.env){
 const problems=[];let entry=null;
 try{
  const st=statSync(file);
  if(!st.isFile())problems.push('the allow-list is not a regular file');
  if(st.mode&0o022)problems.push('the allow-list is writable by other users');
  const raw=readFileSync(file);
  const sha=createHash('sha256').update(raw).digest('hex');
  if(env.STAGING_DEMO_CONFIRM_SHA256!==sha)problems.push('STAGING_DEMO_CONFIRM_SHA256 must equal the SHA-256 of the allow-list file you reviewed ('+sha+')');
  try{entry=JSON.parse(raw.toString('utf8'));}catch{problems.push('the allow-list is not valid JSON');}
 }catch{problems.push('the allow-list file cannot be read');}
 if(!entry||typeof entry!=='object'||Array.isArray(entry))return {problems:[...problems,'the allow-list must be a JSON object'],entry:null};
 for(const k of Object.keys(entry))if(!KEYS.includes(k))problems.push('unknown allow-list key: '+k);
 if(entry.environment!=='staging-demo')problems.push('environment must be "staging-demo"');
 for(const k of ['host','database','user','appUrl','adminEmail'])if(typeof entry[k]!=='string'||!entry[k].trim())problems.push(k+' must be a non-empty string');
 if(!Number.isInteger(entry.port)||entry.port<1||entry.port>65535)problems.push('port must be an integer');
 if(entry.refuseDatabases!==undefined&&!(Array.isArray(entry.refuseDatabases)&&entry.refuseDatabases.every(x=>typeof x==='string')))problems.push('refuseDatabases must be a list of names');
 if(problems.length)return {problems,entry};
 if(protectedDatabase(entry.database,{STAGING_REFUSE_DATABASES:(entry.refuseDatabases||[]).join(',')}))problems.push('the allow-listed database is a protected live database (refused regardless of any suffix such as _test)');
 if(protectedUrl(entry.appUrl,{}))problems.push('the allow-listed app URL is a protected live address');
 if(/[*?%\s]/.test(entry.host+entry.database+entry.user))problems.push('wildcards are not allowed in the allow-list');
 if(!/^https:\/\//.test(entry.appUrl)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(entry.appUrl))problems.push('appUrl must be https (or a local address)');
 if(env.MYSQL_HOST!==entry.host)problems.push('MYSQL_HOST does not equal the allow-listed host');
 if(String(env.MYSQL_PORT||'3306')!==String(entry.port))problems.push('MYSQL_PORT does not equal the allow-listed port');
 if(env.MYSQL_DATABASE!==entry.database)problems.push('MYSQL_DATABASE does not equal the allow-listed database');
 if(env.MYSQL_USER!==entry.user)problems.push('MYSQL_USER does not equal the allow-listed user');
 if(String(env.DEMO_SEED_EMAIL||'').toLowerCase()!==entry.adminEmail.toLowerCase())problems.push('DEMO_SEED_EMAIL is not the allow-listed administrator');
 return {problems,entry};
}

/**
 * The target database must hold exactly the one named organisation, its allow-listed administrator, and at most the dataset's own five
 * demonstration team members (who have no login). It must have exactly ONE login (the administrator). That keeps a first run, a repeat run,
 * an interrupted run and a verification all legitimate, while any other tenant, user or login is refused. `raw` is a mysql2 connection.
 */
export async function assertOnlyNamedOrganisation(raw,org,entry){
 const [orgs]=await raw.query('SELECT id FROM organisations');
 const [users]=await raw.query('SELECT organisation_id,email,role FROM users');
 const [logins]=await raw.query('SELECT email FROM auth_user');
 const problems=[],admin=entry.adminEmail.toLowerCase();
 if(orgs.length!==1||orgs[0].id!==org)problems.push(`the staging database must contain exactly one organisation and it must be the named one (found ${orgs.length})`);
 if(users.some(u=>u.organisation_id!==org))problems.push('the staging database has users in another organisation');
 if(users.filter(u=>String(u.email||'').toLowerCase()===admin&&u.role==='admin').length!==1)problems.push('the allow-listed administrator must exist exactly once, with the administrator role');
 const strangers=users.filter(u=>String(u.email||'').toLowerCase()!==admin&&!DEMO_TEAM.has(String(u.email||'').toLowerCase()));
 if(strangers.length)problems.push(`the staging database has ${strangers.length} user(s) who are neither the administrator nor a demonstration team member`);
 if(logins.length!==1||String(logins[0]?.email||'').toLowerCase()!==admin)problems.push('the staging database must have exactly one login: the allow-listed administrator');
 return problems;
}
