import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
// DDL commits implicitly. Persist intent before each statement to recover an
// interrupted deployment without treating unrelated existing objects as ours.
async function objectExists(db,sql){
 let match=sql.match(/^CREATE TABLE `([^`]+)`/);
 if(match){const [rows]=await db.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[match[1]]);return rows.length>0;}
 match=sql.match(/^CREATE (?:UNIQUE )?INDEX `([^`]+)` ON `([^`]+)`/);
 if(match){const [rows]=await db.execute('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',[match[2],match[1]]);return rows.length>0;}
 match=sql.match(/^ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)`/);
 if(match){const [rows]=await db.execute('SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?',[match[1],match[2]]);return rows.length>0;}
 if(sql==='ALTER TABLE `dockets` MODIFY COLUMN `organisation_id` varchar(191) NOT NULL;')return false;
 match=sql.match(/^ALTER TABLE `([^`]+)` ADD `([^`]+)` /);
 if(match){const [rows]=await db.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[match[1],match[2]]);return rows.length>0;}
 return null;
}
const db=await connect(),lockName='civil_migrations_'+hash(process.env.MYSQL_DATABASE).slice(0,32);
try{
 const [lock]=await db.execute('SELECT GET_LOCK(?,60) AS acquired',[lockName]);
 if(!lock[0].acquired)throw new Error('Another migration is running; restart the deployment to retry');
 await db.execute('CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(191) PRIMARY KEY, sha256 CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
 await db.execute('CREATE TABLE IF NOT EXISTS app_migration_steps (name VARCHAR(191) NOT NULL, step INT NOT NULL, sha256 CHAR(64) NOT NULL, complete BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(name,step))');
 for(const name of (await readdir(new URL('../migrations/mysql/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  const sql=(await readFile(new URL('../migrations/mysql/'+name,import.meta.url),'utf8')).replaceAll('\r\n','\n'),checksum=hash(sql);
  const [existing]=await db.execute('SELECT sha256 FROM app_migrations WHERE name=?',[name]);
  if(existing.length){if(existing[0].sha256!==checksum)throw new Error(`Migration checksum changed: ${name}`);continue;}
  for(const [step,statement] of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).entries()){
   const [journal]=await db.execute('SELECT sha256,complete FROM app_migration_steps WHERE name=? AND step=?',[name,step]);
   if(journal.length&&journal[0].sha256!==checksum)throw new Error(`Migration checksum changed: ${name}`);
   if(journal[0]?.complete)continue;
   const exists=await objectExists(db,statement);
   if(!journal.length){
    if(exists)throw new Error(`Untracked database object in ${name}, step ${step}. Use a fresh database; existing data was not changed.`);
    await db.execute('INSERT INTO app_migration_steps(name,step,sha256) VALUES (?,?,?)',[name,step,checksum]);
   }else if(exists===null)throw new Error(`Interrupted non-repeatable migration ${name}, step ${step}; manual database recovery required`);
   // Pending intent + matching hash allows recovery of our completed CREATE.
   // Errors stop startup; requests cannot arrive before the schema is ready.
   if(!exists)await db.query(statement);
   await db.execute('UPDATE app_migration_steps SET complete=TRUE WHERE name=? AND step=?',[name,step]);
  }
  await db.execute('INSERT INTO app_migrations(name,sha256) VALUES (?,?)',[name,checksum]);console.log('Applied',name);
 }
 // Typed-column backfills run after the schema is ready, under the same lock.
 const {backfillResources}=await import('./backfill-resources.mjs');
 await backfillResources(db);
 console.log('Database migrations ready');
}finally{await db.execute('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});await db.end();}
