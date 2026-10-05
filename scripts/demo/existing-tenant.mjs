// The smallest safe hosted path for adding the demonstration dataset to an EXISTING tenant (the owner's own company, login and records are
// preserved; other tenants are untouched). It is NOT the staging path and does not touch it: staging mode keeps refusing the live database.
// This path is different on purpose — the live target is NAMED, exactly, in a reviewed allow-list, and an apply additionally needs
//   1. the SHA-256 of that allow-list typed in (EXISTING_TENANT_CONFIRM_SHA256),
//   2. the reviewed plan hash (the importer's own conflict detection and provenance baseline are unchanged),
//   3. backup evidence whose fingerprint equals the database's CURRENT state, i.e. nothing was written after the backup (the write freeze),
// and resuming an interrupted import needs the baseline that was created under (3). Nothing here proves a backup is restorable: that
// remains a human attestation recorded in the evidence file (restoreVerified), checked for presence and consistency only.
import {readFileSync,statSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshot} from './import-guards.mjs';

export const ENVIRONMENT='existing-tenant-additive';
const KEYS=['environment','host','port','database','user','appUrl','organisationId','adminEmail'];
const EVIDENCE_KEYS=['takenAt','database','organisationId','restoreVerified','restoredInto','operator','fingerprint'];
export const MAX_BACKUP_AGE_HOURS=24;
const sha256=b=>createHash('sha256').update(b).digest('hex');

function readJson(file,problems,label){
 try{
  const st=statSync(file);
  if(!st.isFile())problems.push(`${label} is not a regular file`);
  if(st.mode&0o077)problems.push(`${label} is accessible by other users (it must be mode 600)`);
  const raw=readFileSync(file);
  try{return {obj:JSON.parse(raw.toString('utf8')),sha:sha256(raw)};}catch{problems.push(`${label} is not valid JSON`);}
 }catch{problems.push(`${label} cannot be read`);}
 return {obj:null,sha:null};
}

/** Pure check of the allow-list file against the process environment. Empty problems = exact match. */
export function evaluateExistingTenantAllowlist(file,env=process.env){
 const problems=[];const {obj:entry,sha}=readJson(file,problems,'the allow-list');
 if(sha&&env.EXISTING_TENANT_CONFIRM_SHA256!==sha)problems.push('EXISTING_TENANT_CONFIRM_SHA256 must equal the SHA-256 of the allow-list file you reviewed ('+sha+')');
 if(!entry||typeof entry!=='object'||Array.isArray(entry))return {problems:[...problems,'the allow-list must be a JSON object'],entry:null};
 for(const k of Object.keys(entry))if(!KEYS.includes(k))problems.push('unknown allow-list key: '+k);
 if(entry.environment!==ENVIRONMENT)problems.push(`environment must be "${ENVIRONMENT}"`);
 for(const k of ['host','database','user','appUrl','organisationId','adminEmail'])if(typeof entry[k]!=='string'||!entry[k].trim())problems.push(k+' must be a non-empty string');
 if(!Number.isInteger(entry.port)||entry.port<1||entry.port>65535)problems.push('port must be an integer');
 if(problems.length)return {problems,entry};
 if(/[*?%\s]/.test(entry.host+entry.database+entry.user+entry.organisationId))problems.push('wildcards are not allowed in the allow-list');
 if(!/^https:\/\//.test(entry.appUrl))problems.push('appUrl must be https');
 if(String(env.STAGING_DEMO_MODE||'').toLowerCase()==='true')problems.push('STAGING_DEMO_MODE is on: staging mode and this path are mutually exclusive (staging refuses this database by design)');
 if(env.MYSQL_HOST!==entry.host)problems.push('MYSQL_HOST does not equal the allow-listed host');
 if(String(env.MYSQL_PORT||'3306')!==String(entry.port))problems.push('MYSQL_PORT does not equal the allow-listed port');
 if(env.MYSQL_DATABASE!==entry.database)problems.push('MYSQL_DATABASE does not equal the allow-listed database');
 if(env.MYSQL_USER!==entry.user)problems.push('MYSQL_USER does not equal the allow-listed user');
 if(String(env.DEMO_SEED_EMAIL||'').toLowerCase()!==entry.adminEmail.toLowerCase())problems.push('DEMO_SEED_EMAIL is not the allow-listed administrator');
 return {problems,entry};
}

/** Fingerprint of the whole database as it is NOW (every row of every table except login sessions/tokens), under a fixed salt. */
export async function databaseFingerprint(raw){
 const s=await snapshot(raw,'existing-tenant-fingerprint-v1');
 return sha256(JSON.stringify({schema:s.schema,tables:s.tables,keyless:s.keyless}));
}

/** Backup evidence must name this database and organisation, be recent, carry the human restore attestation, and match the current state. */
export function evaluateBackupEvidence(file,entry,currentFingerprint,{now=Date.now()}={}){
 const problems=[];const {obj:e}=readJson(file,problems,'the backup evidence');
 if(!e||typeof e!=='object'||Array.isArray(e))return {problems:[...problems,'the backup evidence must be a JSON object'],evidence:null};
 for(const k of Object.keys(e))if(!EVIDENCE_KEYS.includes(k))problems.push('unknown backup-evidence key: '+k);
 const t=Date.parse(e.takenAt);
 if(!Number.isFinite(t))problems.push('takenAt must be an ISO timestamp');
 else{if(t>now+60_000)problems.push('takenAt is in the future');if(now-t>MAX_BACKUP_AGE_HOURS*3600_000)problems.push(`the backup is older than ${MAX_BACKUP_AGE_HOURS} hours: take a new one`);}
 if(e.database!==entry.database)problems.push('the backup evidence names a different database');
 if(e.organisationId!==entry.organisationId)problems.push('the backup evidence names a different organisation');
 if(e.restoreVerified!==true)problems.push('restoreVerified must be true (a human restored the backup into a scratch database and compared it)');
 if(typeof e.restoredInto!=='string'||!e.restoredInto.trim())problems.push('restoredInto must say where the backup was test-restored (a name, never a credential)');
 if(typeof e.operator!=='string'||!e.operator.trim())problems.push('operator must say who attested');
 if(!/^[0-9a-f]{64}$/.test(String(e.fingerprint||'')))problems.push('fingerprint must be the 64-hex value printed by the fingerprint step');
 else if(e.fingerprint!==currentFingerprint)problems.push('the database has changed since the backup (its fingerprint differs): freeze writes, take a new backup and a new fingerprint');
 return {problems,evidence:e,sha:sha256(JSON.stringify(e))};
}

// A baseline may only be reused (resume) if it was created under verified backup evidence: the sidecar is written next to it at that moment.
export const sidecarPath=baseline=>baseline+'.evidence-ok';
export const writeSidecar=(baseline,sha)=>writeFileSync(sidecarPath(baseline),JSON.stringify({evidenceSha256:sha,acceptedAt:new Date().toISOString()}),{mode:0o600});
export const hasSidecar=baseline=>existsSync(sidecarPath(baseline));
