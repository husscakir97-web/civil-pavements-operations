// Unit tests for the shared upload/download safety rules (lib/platform/upload-safety.ts).
const ts=require('typescript'),fs=require('node:fs'),assert=require('node:assert/strict');
const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/platform/upload-safety.ts','utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m,m.exports);
const u=m.exports,B=(s)=>new Uint8Array(Buffer.from(s,'latin1')),cat=(...p)=>new Uint8Array(Buffer.concat(p.map(x=>Buffer.from(x))));
const PDF=B('%PDF-1.4\n1 0 obj'),PNG=new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,0]),JPG=new Uint8Array([0xFF,0xD8,0xFF,0xE0,0,0x10]),GIF=B('GIF89a....'),WEBP=B('RIFF\0\0\0\0WEBPVP8 '),ZIP=new Uint8Array([0x50,0x4B,0x03,0x04,0,0]),OLE=new Uint8Array([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]),HEIC=B('\0\0\0\x18ftypheic');
const HTML=B('<!DOCTYPE html><html><script>alert(1)</script></html>'),SVG=B('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),XML=B('<?xml version="1.0"?><x/>');
const ok=(name,bytes,allowed)=>{const v=u.checkUpload(name,bytes,allowed);assert.equal(v.ok,true,name+' should be accepted: '+JSON.stringify(v));return v;};
const no=(label,name,bytes,allowed)=>{const v=u.checkUpload(name,bytes,allowed);assert.equal(v.ok,false,label+' must be rejected');assert.equal(v.status,415,label);return v;};

// Active content and unsupported types are rejected (415) by extension, whatever the bytes are.
for(const n of ['a.html','a.htm','a.svg','a.svgz','a.xhtml','a.xml','a.js','a.mjs','a.mhtml','a.php','a.exe','a.shtml','noextension','a.pdf.html','.html','a.HTML','a.SvG'])no('extension '+n,n,PDF);
// Misleading extension: a supported name over active-content or mismatched bytes.
no('HTML bytes named .pdf','evil.pdf',HTML);no('SVG bytes named .png','evil.png',SVG);no('HTML bytes named .jpg','evil.jpg',HTML);no('XML bytes named .docx','evil.docx',XML);
no('PNG bytes named .pdf','x.pdf',PNG);no('PDF bytes named .png','x.png',PDF);no('JPEG bytes named .png','x.png',JPG);no('plain text named .pdf','x.pdf',B('hello'));no('empty .pdf','x.pdf',new Uint8Array());
no('HTML in a .txt','x.txt',HTML);no('SVG in a .csv','x.csv',SVG);no('XML in a .eml','x.eml',XML);no('BOM + whitespace + <script in .txt','x.txt',cat([0xEF,0xBB,0xBF],'  \n\t<script>x</script>'));no('comment-led HTML in a .csv','x.csv',B('<!-- x --><html>'));no('UTF-16 text','x.txt',new Uint8Array([0xFF,0xFE,0x3C,0x00]));
no('zip bytes named .doc? (allowed) but html named .xlsx','x.xlsx',HTML);no('script in .docx','x.docx',B('<script>'));
// Legitimate supported files are accepted and get the fixed safe type (never the client's).
assert.equal(ok('a.pdf',PDF).contentType,'application/pdf');assert.equal(ok('a.PNG',PNG).contentType,'image/png');assert.equal(ok('a.jpg',JPG).contentType,'image/jpeg');assert.equal(ok('a.jpeg',JPG).contentType,'image/jpeg');
assert.equal(ok('a.gif',GIF).contentType,'image/gif');assert.equal(ok('a.webp',WEBP).contentType,'image/webp');assert.equal(ok('a.heic',HEIC).contentType,'image/heic');
for(const n of ['a.docx','a.xlsx','a.pptx','a.zip'])ok(n,ZIP);for(const n of ['a.doc','a.xls','a.ppt'])ok(n,OLE);ok('rtf.doc',B('{\\rtf1\\ansi'));ok('doc-as-docx.doc',ZIP);
assert.equal(ok('a.csv',B('Client,Scope\nCouncil,Pave road\n')).contentType,'text/csv; charset=utf-8');ok('a.txt',B('Tender notes: 4 < 5 and 7 > 3'));ok('a.eml',B('From: a@b.c\r\nSubject: x\r\n\r\nbody'));ok('a.msg',OLE);ok('a.dwg',B('AC1027\0\0'));ok('a.dxf',B('  0\r\nSECTION\r\n  2\r\nHEADER\r\n'));ok('leading-pdf-junk.pdf',cat('x'.repeat(500),'%PDF-1.7'));
no('PDF header beyond the first 1024 bytes','late.pdf',cat('x'.repeat(2000),'%PDF-1.7'));
// Docket source files: PDF and photos only.
for(const n of ['a.pdf','a.png','a.jpg','a.jpeg','a.webp'])assert.ok(u.DOCKET_UPLOAD_NAME.test(n));
for(const n of ['a.html','a.svg','a.csv','a.docx','a.gif','a.zip'])no('docket '+n,n,n==='a.csv'?B('a,b'):ZIP,u.DOCKET_UPLOAD_NAME);
no('docket HTML named .pdf','a.pdf',HTML,u.DOCKET_UPLOAD_NAME);ok('a.pdf',PDF,u.DOCKET_UPLOAD_NAME);ok('a.png',PNG,u.DOCKET_UPLOAD_NAME);ok('a.webp',WEBP,u.DOCKET_UPLOAD_NAME);
// The shared document service and these routes use ONE allowlist.
assert.match(fs.readFileSync('lib/platform/documents.ts','utf8'),/ALLOWED=ALLOWED_UPLOAD_NAME/);

// Fixed extension -> type mapping with an octet-stream fallback (stored/client types are never consulted).
for(const [n,t] of [['a.pdf','application/pdf'],['a.png','image/png'],['a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['a.html','application/octet-stream'],['a.svg','application/octet-stream'],['a.xml','application/octet-stream'],['a.unknown','application/octet-stream'],['noext','application/octet-stream'],['a.dwg','application/octet-stream']])assert.equal(u.safeContentType(n),t,n);

// Inline preview needs extension + MIME + signature to agree; anything uncertain is a download (null).
assert.equal(u.inlinePreviewType('a.pdf','application/pdf',PDF),'application/pdf');assert.equal(u.inlinePreviewType('a.PDF','Application/PDF; charset=x',PDF),'application/pdf');
assert.equal(u.inlinePreviewType('a.png','image/png',PNG),'image/png');assert.equal(u.inlinePreviewType('a.jpg','image/jpeg',JPG),'image/jpeg');assert.equal(u.inlinePreviewType('a.jpeg','image/jpg',JPG),'image/jpeg');assert.equal(u.inlinePreviewType('a.webp','image/webp',WEBP),'image/webp');
assert.equal(u.inlinePreviewType('a.pdf','text/html',PDF),null,'declared HTML MIME');assert.equal(u.inlinePreviewType('a.pdf','application/octet-stream',PDF),null,'declared octet-stream is uncertain');assert.equal(u.inlinePreviewType('a.pdf',null,PDF),null,'no declared type');assert.equal(u.inlinePreviewType('a.pdf','',PDF),null);
assert.equal(u.inlinePreviewType('a.pdf','application/pdf',HTML),null,'HTML bytes behind a pdf name+MIME');assert.equal(u.inlinePreviewType('a.png','image/png',SVG),null,'SVG bytes behind a png name+MIME');assert.equal(u.inlinePreviewType('a.png','image/png',JPG),null,'signature of another format');
assert.equal(u.inlinePreviewType('a.png','image/jpeg',PNG),null,'MIME for another format');assert.equal(u.inlinePreviewType('a.svg','image/svg+xml',SVG),null,'svg is never inline');assert.equal(u.inlinePreviewType('a.html','text/html',HTML),null);assert.equal(u.inlinePreviewType('a.gif','image/gif',GIF),'image/gif');
assert.equal(u.inlinePreviewType('a.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',ZIP),null,'Office files are never inline');assert.equal(u.inlinePreviewType('a.txt','text/plain',B('hi')),null);

// Headers.
{const h=u.attachmentHeaders("it's (a) file*.pdf",'application/pdf');assert.equal(h['Content-Type'],'application/pdf');assert.match(h['Content-Disposition'],/^attachment; filename\*=UTF-8''/);assert.ok(!/['()*]/.test(h['Content-Disposition'].split("''")[1]),'filename is fully RFC 5987 encoded');assert.equal(h['X-Content-Type-Options'],'nosniff');assert.equal(h['Cache-Control'],'private, no-store');}
// objectBytes handles each storage adapter shape.
(async()=>{
 const same=new Uint8Array([1,2,3]);assert.deepEqual([...await u.objectBytes({body:same})],[1,2,3]);assert.deepEqual([...await u.objectBytes({body:same.buffer})],[1,2,3]);assert.deepEqual([...await u.objectBytes({body:Buffer.from([1,2,3])})],[1,2,3]);
 assert.deepEqual([...await u.objectBytes({arrayBuffer:async()=>same.buffer})],[1,2,3]);assert.deepEqual([...await u.objectBytes({body:new Blob([same]).stream()})],[1,2,3]);
 console.log('PASS upload safety: active content and misleading extension/MIME/signature rejected (415), supported files accepted with a fixed type, docket allowlist, inline previews need extension+MIME+signature, fixed attachment headers');
})().catch(e=>{console.error(e);process.exitCode=1;});
