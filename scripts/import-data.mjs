import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {connect,identifier} from './mysql-config.mjs';
const directory=process.argv[2];if(!directory)throw new Error('Usage: npm run data:import -- exports/<snapshot> [--verify-only]');
const dir=resolve(directory),manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
if(manifest.format!==1)throw new Error('Unsupported export format');
if(manifest.tables.dockets?.count!==manifest.expectedDockets)throw new Error('Docket count differs from expected count');
const db=await connect(),report={verifiedAt:new Date().toISOString(),tables:{}};
const normalize=value=>Buffer.isBuffer(value)?{__binaryBase64:value.toString('base64')}:value;
const digest=rows=>createHash('sha256').update(rows.map(r=>JSON.stringify(r.map(normalize))).sort().join('\n')).digest('hex');
try{
 await db.beginTransaction();
 const [schema]=await db.execute('SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?',[process.env.MYSQL_DATABASE]);
 for(const [table,info] of Object.entries(manifest.tables)){
  if(info.system)continue;identifier(table);
  const raw=await readFile(resolve(dir,table+'.json'),'utf8');if(createHash('sha256').update(raw).digest('hex')!==info.sha256)throw new Error(`Export checksum mismatch: ${table}`);
  const {columns,rows}=JSON.parse(raw);if(rows.length!==info.count)throw new Error(`Export count mismatch: ${table}`);
  const target=schema.filter(c=>c.tableName===table).map(c=>c.columnName);
  const expected=table==='users'&&!columns.includes('active')?target.filter(c=>c!=='active'):target;
  if(expected.length!==columns.length||columns.some(c=>!expected.includes(c)))throw new Error(`Schema mismatch: ${table}. Add a reviewed migration; no columns will be discarded.`);
  const names=columns.map(identifier).join(',');
  if(!process.argv.includes('--verify-only')){
   const [existing]=await db.query(`SELECT COUNT(*) AS n FROM ${identifier(table)}`);if(Number(existing[0].n)!==0)throw new Error(`Destination ${table} is not empty; import refuses to overwrite data`);
   for(const row of rows)await db.execute(`INSERT INTO ${identifier(table)} (${names}) VALUES (${columns.map(()=>'?').join(',')})`,columns.map(c=>row[c]&&typeof row[c]==='object'&&'__binaryBase64' in row[c]?Buffer.from(row[c].__binaryBase64,'base64'):row[c]));
  }
  const [imported]=await db.query(`SELECT ${names} FROM ${identifier(table)}`);
  const sourceHash=digest(rows.map(r=>columns.map(c=>r[c]))),targetHash=digest(imported.map(r=>columns.map(c=>r[c])));
  if(imported.length!==info.count||sourceHash!==targetHash)throw new Error(`Verification failed: ${table} (${info.count} source, ${imported.length} destination)`);
  report.tables[table]={source:info.count,destination:imported.length,sha256:targetHash,match:true};
 }
 await db.commit();await writeFile(resolve(dir,'mysql-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){await db.rollback();throw e;}finally{await db.end();}
