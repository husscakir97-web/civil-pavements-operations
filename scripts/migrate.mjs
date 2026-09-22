import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';
const db=await connect();
try{
 await db.execute('CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(191) PRIMARY KEY, sha256 CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
 const [lock]=await db.query("SELECT GET_LOCK('civil_operations_migrations',30) AS acquired");if(!lock[0].acquired)throw new Error('Another migration is running');
 for(const name of (await readdir(new URL('../migrations/mysql/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  const sql=await readFile(new URL('../migrations/mysql/'+name,import.meta.url),'utf8').then(text=>text.replaceAll('\r\n','\n')),hash=createHash('sha256').update(sql).digest('hex');
  const [existing]=await db.execute('SELECT sha256 FROM app_migrations WHERE name=?',[name]);if(existing.length){if(existing[0].sha256!==hash)throw new Error(`Migration checksum changed: ${name}`);continue;}
  for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.query(statement);
  await db.execute('INSERT INTO app_migrations(name,sha256) VALUES (?,?)',[name,hash]);console.log('Applied',name);
 }
}finally{await db.query("SELECT RELEASE_LOCK('civil_operations_migrations')").catch(()=>{});await db.end();}
