const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync('drizzle/0000_jittery_forge.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/0001_pavement_os.sql','utf8'));
require('./test-services.cjs').prepare(sql);const db = {prepare(query){ let values=[]; const stmt={bind(...v){values=v;return stmt;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};return stmt;},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements) result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
sql.exec(fs.readFileSync('drizzle/20260910105008_field.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/20260910110000_docket_enrichment.sql','utf8'));
const files=new Map(); const bucket={async put(k,b,opts){files.set(k,{body:b,writeHttpMetadata(h){h.set('Content-Type',opts?.httpMetadata?.contentType||'')}});},async get(k){return files.get(k)||null;}};
const cache={};

function load(file){file=path.resolve(file);const external=require('./test-services.cjs').mock(file,db,sql,typeof bucket==='undefined'?undefined:bucket);if(external)return external;if(cache[file])return cache[file].exports;const loadedModule={exports:{}};cache[file]=loadedModule;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts'):require(name),loadedModule,loadedModule.exports);return loadedModule.exports;}
const headers={'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'};
const dockets=load('app/api/dockets/route.ts'),docketFile=load('app/api/dockets/file/route.ts');
const bytesOf=(...p)=>new Uint8Array(Buffer.concat(p.map(x=>Buffer.from(x,'latin1'))));
const PDF=bytesOf('%PDF-1.4 docket'),PNG=new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0]),JPG=new Uint8Array([0xFF,0xD8,0xFF,0xE0,0,0x10]),WEBP=bytesOf('RIFF\0\0\0\0WEBPVP8 '),HTML=bytesOf('<!DOCTYPE html><script>alert(document.cookie)</script>'),SVG=bytesOf('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
const org='roadworx-sydney',now=new Date().toISOString();
(async()=>{
 sql.prepare('INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)').run('field-user',org,'field@example.invalid','Field','field',now);
 let n=0;const post=(name,content,type)=>{const f=new FormData();f.set('records',JSON.stringify([{docketNo:'UP-'+(++n),workDate:'2026-09-10',status:'review',amount:10,sourceName:name}]));f.set('file',new File([content],name,{type}));return dockets.POST(new Request('https://test.invalid/api/dockets',{method:'POST',headers,body:f}));};
 const dockCount=()=>sql.prepare('SELECT COUNT(*) AS n FROM dockets').get().n;
 // ---- Upload: active content, unsupported types and misleading extension/MIME/signature are rejected (415) before anything is stored.
 const filesBefore=files.size,rowsBefore=dockCount();
 for(const [label,name,content,type] of [['HTML','p.html',HTML,'text/html'],['SVG','p.svg',SVG,'image/svg+xml'],['XML','p.xml',bytesOf('<?xml version="1.0"?><a/>'),'text/xml'],['CSV (not a docket source)','d.csv','a,b\n1,2','text/csv'],['Office file','d.docx',new Uint8Array([0x50,0x4B,3,4]),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['GIF (not offered by the intake)','d.gif',bytesOf('GIF89a'),'image/gif'],
  ['HTML disguised as .pdf','docket.pdf',HTML,'application/pdf'],['SVG disguised as .png','photo.png',SVG,'image/png'],['PDF bytes named .jpg','photo.jpg',PDF,'image/jpeg'],['PNG bytes named .pdf','scan.pdf',PNG,'application/pdf'],['no extension','docket',PDF,'application/pdf'],['double extension','docket.pdf.html',PDF,'application/pdf']]){
  const r=await post(name,content,type);assert.equal(r.status,415,label+': '+await r.clone().text());}
 assert.equal(files.size,filesBefore,'nothing stored for rejected uploads');assert.equal(dockCount(),rowsBefore,'no docket rows for rejected uploads');
 // ---- Upload: supported PDF and photos are accepted; the stored type is the fixed mapping, not the client's MIME.
 for(const [name,content,clientType,stored] of [['a.pdf',PDF,'text/html','application/pdf'],['b.png',PNG,'application/octet-stream','image/png'],['c.jpg',JPG,'image/jpeg','image/jpeg'],['c2.jpeg',JPG,'','image/jpeg'],['d.webp',WEBP,'image/webp','image/webp']]){
  const before=files.size,r=await post(name,content,clientType);assert.equal(r.status,200,name+': '+await r.clone().text());assert.equal(files.size,before+1);
  const key=[...files.keys()].pop(),h=new Headers();files.get(key).writeHttpMetadata(h);assert.equal(h.get('Content-Type'),stored,name+' stored type');}
 // ---- Download: previews only for validated PDF/photos; everything else (including unsafe LEGACY rows) is an attachment with a fixed type.
 const seed=(id,name,stored,bytes,tenant=org)=>{const key='dockets/2026-09/'+id;files.set(key,{body:bytes,writeHttpMetadata(h){h.set('Content-Type',stored)}});sql.prepare('INSERT INTO dockets (id,organisation_id,docket_no,work_date,client,project,quantity,quantity_unit,amount,status,confidence,source_name,source_key,raw_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tenant,id,'2026-09-10','C','P',1,'t',1,'review',90,name,key,'',now,now);};
 const get=(id,h=headers)=>docketFile.GET(new Request('https://test.invalid/api/dockets/file?id='+id,{headers:h}));
 const inline=async(id,type,bytes)=>{const r=await get(id);assert.equal(r.status,200,id);assert.equal(r.headers.get('Content-Type'),type,id);assert.match(r.headers.get('Content-Disposition'),/^inline; filename\*=UTF-8''/,id);assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff',id);assert.equal(Buffer.from(await r.arrayBuffer()).compare(Buffer.from(bytes)),0,id+': original bytes');};
 const download=async(id,type)=>{const r=await get(id);assert.equal(r.status,200,id);assert.equal(r.headers.get('Content-Type'),type,id+' fixed type');assert.match(r.headers.get('Content-Disposition'),/^attachment; filename\*=UTF-8''/,id+' must be a download');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff',id);assert.ok(!/html|svg|xml|javascript/i.test(r.headers.get('Content-Type')),id);return r;};
 seed('ok-pdf','a.pdf','application/pdf',PDF);seed('ok-png','a.png','image/png',PNG);seed('ok-jpg','a.jpg','image/jpeg',JPG);seed('ok-jpeg','a.jpeg','image/jpeg',JPG);seed('ok-webp','a.webp','image/webp',WEBP);
 await inline('ok-pdf','application/pdf',PDF);await inline('ok-png','image/png',PNG);await inline('ok-jpg','image/jpeg',JPG);await inline('ok-jpeg','image/jpeg',JPG);await inline('ok-webp','image/webp',WEBP);
 const ok2=await get('ok-pdf');assert.equal(ok2.headers.get('Cache-Control'),'private, max-age=120');
 seed('bad-html','p.html','text/html',HTML);await download('bad-html','application/octet-stream');
 seed('bad-svg','p.svg','image/svg+xml',SVG);await download('bad-svg','application/octet-stream');
 seed('bad-svg-png','p.png','image/png',SVG);await download('bad-svg-png','image/png');            // misleading name+MIME, SVG bytes -> never inline
 seed('bad-html-pdf','p.pdf','application/pdf',HTML);await download('bad-html-pdf','application/pdf'); // right name+MIME, HTML bytes
 seed('bad-mime-pdf','p.pdf','text/html',PDF);await download('bad-mime-pdf','application/pdf');         // real PDF but declared HTML
 seed('unknown-mime-pdf','p.pdf','application/octet-stream',PDF);await download('unknown-mime-pdf','application/pdf'); // uncertain -> download
 seed('mismatch-jpg','p.jpg','image/png',PNG);await download('mismatch-jpg','image/jpeg');           // MIME and signature agree with each other but not the extension
 seed('mismatch-sig','p.png','image/png',JPG);await download('mismatch-sig','image/png');            // extension and MIME agree, signature differs
 seed('noext','legacy','text/html',HTML);await download('noext','application/octet-stream');
 seed('txt','notes.txt','text/plain',bytesOf('original docket fixture'));{const r=await download('txt','text/plain; charset=utf-8');assert.equal(await r.text(),'original docket fixture');}
 // ---- Boundaries are unchanged: tenant, role, missing file.
 seed('other-tenant','x.pdf','application/pdf',PDF,'other-org');assert.equal((await get('other-tenant')).status,404,'another organisation\'s docket');
 assert.equal((await get('ok-pdf',{'x-test-user-id':'field-user','x-test-user-email':'field@example.invalid'})).status,403,'field role');
 assert.equal((await get('missing')).status,404);files.delete('dockets/2026-09/ok-png');assert.equal((await get('ok-png')).status,404,'stored object missing');
 console.log('PASS docket files: active content and misleading extension/MIME/signature rejected (415) with nothing stored, PDF/photo previews only when extension+MIME+signature agree, unsafe legacy rows served as fixed-type attachments, nosniff always, tenant and role boundaries kept');
})().catch(e=>{console.error(e);process.exitCode=1;});
