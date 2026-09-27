import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {S3Client,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {required} from './mysql-config.mjs';
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const out=resolve(option('--out','exports/'+new Date().toISOString().replaceAll(':','-')));await mkdir(out,{recursive:true});
let dump;
if(option('--sql'))dump=await readFile(option('--sql'),'utf8');else{
 const endpoint=`https://api.cloudflare.com/client/v4/accounts/${required('CLOUDFLARE_ACCOUNT_ID')}/d1/database/${required('D1_DATABASE_ID')}/export`;
 let bookmark;
 for(let attempt=0;attempt<600;attempt++){
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${required('CLOUDFLARE_API_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({output_format:'polling',...(bookmark?{current_bookmark:bookmark}:{})})});
  const body=await response.json();if(!response.ok||!body.success||body.result?.status==='error')throw new Error(`D1 export failed: ${JSON.stringify(body.errors||body.result?.error)}`);
  const result=body.result;
  if(result.status==='complete'){const downloaded=await fetch(result.result.signed_url);if(!downloaded.ok)throw new Error('D1 download failed');dump=await downloaded.text();break;}
  bookmark=result.at_bookmark;await new Promise(r=>setTimeout(r,1000));
 }
 if(!dump)throw new Error('D1 export timed out');
}
await writeFile(resolve(out,'all-tables.sql'),dump,{flag:'wx'});
const db=new DatabaseSync(':memory:');db.exec(dump);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):value instanceof Uint8Array?`X'${Buffer.from(value).toString('hex')}'`:"'"+String(value).replaceAll("'","''")+"'";
const tables={};
for(const {name,sql} of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new Error('Unsupported table name '+name);
 const columns=db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>c.name),rows=db.prepare(`SELECT * FROM ${quote(name)}`).all();
 // JSON is the lossless import format; CSV is for review, not re-import from Excel.
 const json=JSON.stringify({columns,rows},(_key,value)=>value instanceof Uint8Array?{__binaryBase64:Buffer.from(value).toString('base64')}:value,2)+'\n';
 await writeFile(resolve(out,name+'.json'),json);
 await writeFile(resolve(out,name+'.csv'),[columns,...rows.map(r=>columns.map(c=>r[c]))].map(row=>row.map(v=>'"'+String(v instanceof Uint8Array?Buffer.from(v).toString('hex'):v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n');
 await writeFile(resolve(out,name+'.sql'),sql+';\n'+rows.map(row=>`INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(c=>literal(row[c])).join(',')});`).join('\n')+'\n');
 tables[name]={count:rows.length,columns,sha256:createHash('sha256').update(json).digest('hex'),system:name==='d1_migrations'||name.startsWith('_cf_')};
}
db.close();
const s3=new S3Client({region:'auto',endpoint:required('R2_ENDPOINT'),credentials:{accessKeyId:required('R2_ACCESS_KEY_ID'),secretAccessKey:required('R2_SECRET_ACCESS_KEY')}});
const objects=[];let continuation;
do{const page=await s3.send(new ListObjectsV2Command({Bucket:required('R2_BUCKET_NAME'),ContinuationToken:continuation}));for(const o of page.Contents||[])objects.push({key:o.Key,size:o.Size,etag:o.ETag,lastModified:o.LastModified});if(page.IsTruncated&&!page.NextContinuationToken)throw new Error('R2 truncated response without continuation token');continuation=page.IsTruncated?page.NextContinuationToken:undefined;}while(continuation);
await writeFile(resolve(out,'r2-files.json'),JSON.stringify(objects,null,2)+'\n');
await writeFile(resolve(out,'r2-files.csv'),[['key','size','etag','lastModified'],...objects.map(o=>[o.key,o.size,o.etag,o.lastModified?.toISOString()])].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n');
const expected=Number(option('--expected-dockets','64')),actual=tables.dockets?.count;
await writeFile(resolve(out,'manifest.json'),JSON.stringify({format:1,exportedAt:new Date().toISOString(),expectedDockets:expected,tables,r2Count:objects.length},null,2)+'\n');
if(actual!==expected)throw new Error(`Export saved, but expected ${expected} dockets and found ${actual}. Investigate before importing.`);
console.log(`Export complete: ${Object.keys(tables).length} tables, ${actual} dockets, ${objects.length} R2 objects. ${out}`);
