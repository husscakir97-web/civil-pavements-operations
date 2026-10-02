const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function moduleIn(source, context, imports={}) {
  const loaded={exports:{}};
  vm.runInNewContext(compile(source), {...context,module:loaded,exports:loaded.exports,require:name=>{if (!(name in imports)) throw Error(name);return imports[name];}});
  return loaded.exports;
}
function environment() {
  const scripts=[],timers=new Map();let id=0;
  const context={window:{},File,console,Error,document:{
    querySelector:selector=>scripts.find(s=>s.marker===selector.slice(7,-1)),
    createElement:tag=>tag==='canvas'?{getContext:()=>({})}:{setAttribute(marker){this.marker=marker;},remove(){const i=scripts.indexOf(this);if(i>=0)scripts.splice(i,1);}},
    head:{appendChild:s=>scripts.push(s)},
  },setTimeout:(fn,delay)=>{assert.equal(delay,30000);timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)};
  const readers=moduleIn(fs.readFileSync('lib/document-readers.ts','utf8'),context);
  return {context,readers,scripts,timers};
}
async function loaders() {
  for(const [name,global,api] of [['loadTesseract','Tesseract',{createWorker(){}}],['loadPdfReader','pdfjsLib',{version:'6.3.289',getDocument(){},GlobalWorkerOptions:{}}]]) {
    const e=environment(),load=e.readers[name];
    const first=load(),concurrent=load();assert.equal(e.scripts.length,1);
    const failure=Promise.all([assert.rejects(first,/failed to load/),assert.rejects(concurrent,/failed to load/)]);
    const stale=e.scripts[0];stale.onerror();await failure;
    assert.equal(e.scripts.length,0);assert.equal(e.timers.size,0);assert.equal(stale.onload,null);
    const retry=load();
    if(global==='pdfjsLib'){
      assert.equal(e.scripts[0].type,'module');
      assert.equal(e.scripts[0].src,e.readers.PDF_READER_MODULE_URL+'?readerRetry=1');
    }
    e.context.window[global]=api;e.scripts[0].onload();await retry;
    assert.equal(e.timers.size,0);await load();assert.equal(e.scripts.length,1);
    if(global==='pdfjsLib')assert.match(api.GlobalWorkerOptions.workerSrc,/pdfjs-dist@6\.3\.289\/legacy\/build\/pdf\.worker\.min\.mjs$/);
    delete e.context.window[global];e.scripts[0].remove();
    const timeout=load(),rejected=assert.rejects(timeout,/timed out/);[...e.timers.values()][0]();await rejected;
    assert.equal(e.scripts.length,0);assert.equal(e.timers.size,0);
    const missing=load(),missingRejected=assert.rejects(missing,/initialise/);e.scripts[0].onload();await missingRejected;
    const recovered=load();e.context.window[global]=api;e.scripts[0].onload();await recovered;
  }
}
function pdfEnvironment(text) {
  const e=environment();let renders=0;
  e.context.window.pdfjsLib={version:'6.3.289',GlobalWorkerOptions:{},getDocument(options){
    assert.equal(options.isEvalSupported,false,'every runtime PDF load is hardened');
    for(const key of ['cMapUrl','standardFontDataUrl','wasmUrl'])assert.ok(options[key].startsWith('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/'));
    return {promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:text}]}),getViewport:()=>({width:10,height:10}),render:()=>{renders++;return {promise:Promise.resolve()};}})})};
  }};
  return {...e,renders:()=>renders};
}
async function moduleStartup() {
  const e=environment();e.context.window.pdfjsLib={version:'3.11.174',getDocument(){},GlobalWorkerOptions:{}};
  const attempt=e.readers.loadPdfReader(),rejected=assert.rejects(attempt,/initialise/);
  assert.equal(e.scripts[0].type,'module');assert.equal(e.scripts[0].src,e.readers.PDF_READER_MODULE_URL);
  e.scripts[0].onload();await rejected;
  const retry=e.readers.loadPdfReader();
  e.context.window.pdfjsLib={version:e.readers.PDF_READER_VERSION,getDocument(){},GlobalWorkerOptions:{}};
  e.scripts[0].onload();await retry;
  assert.equal(e.context.window.pdfjsLib.GlobalWorkerOptions.workerSrc,e.readers.PDF_READER_WORKER_URL);
}
async function tender() {
  for (const scanned of [false,true]) {
    const e=pdfEnvironment(scanned?'':'Client Council project pavement scope quantity total hours tender native text.');
    let created=0,terminated=0;
    const worker={recognize:async()=>({data:{text:'Scanned draft',confidence:61}}),terminate:async()=>terminated++};
    // Real loader, fake network event and OCR engine; no document leaves the test.
    const original=e.context.document.head.appendChild;
    e.context.document.head.appendChild=s=>{original(s);e.context.window.Tesseract={createWorker:async()=>{created++;return worker;}};s.onload();};
    const {readTender}=moduleIn(fs.readFileSync('lib/tender-reader.ts','utf8'),e.context,{'@/lib/document-readers':e.readers,'./tender':{}});
    const pages=[];await readTender(new File(['synthetic'],'test.pdf'),async p=>pages.push(p),()=>{});
    assert.equal(created,Number(scanned));assert.equal(terminated,Number(scanned));assert.equal(e.scripts.length,Number(scanned));
    assert.equal(pages[0].method,scanned?'local-ocr':'pdf-text');assert.equal(pages[0].confidence,scanned?61:99);
  }
  const e=pdfEnvironment('');
  e.context.document.head.appendChild=s=>s.onerror();
  const {readTender}=moduleIn(fs.readFileSync('lib/tender-reader.ts','utf8'),e.context,{'@/lib/document-readers':e.readers,'./tender':{}});
  const pages=[];await readTender(new File(['synthetic'],'test.pdf'),async p=>pages.push(p),()=>{});
  assert.match(pages[0].error,/failed to load/);assert.equal(pages[0].confidence,0);
}
async function dockets() {
  const source=fs.readFileSync('components/docket-dashboard.tsx','utf8');
  const ast=ts.createSourceFile('docket.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['readPdf','hasUsefulPdfText','textFromPdfItems'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
  for(const scanned of [false,true]) {
    const e=pdfEnvironment(scanned?'':'Docket No: ABC-1234\nDate: 09/09/2026\nClient: Example Civil\nJob Location: Test Road\nOrder No: PO-123\nQuantity: 18.4 tonnes');let requested=0;
    const {parseDocket}=moduleIn(fs.readFileSync('lib/docket-parser.ts','utf8'),{crypto:globalThis.crypto});
    const context={...e.context,...e.readers,parseDocket,recogniseDocketCanvas:async()=>({text:'scanned',confidence:60})};
    const {readPdf}=moduleIn(functions+'\nexport {readPdf};',context);
    const pages=await readPdf(new File(['synthetic'],'test.pdf'),async()=>{requested++;return {};},()=>{},()=>{});
    assert.equal(requested,Number(scanned));assert.equal(e.renders(),Number(scanned));assert.equal(pages[0].confidence,scanned?60:99);
    if(scanned)await assert.rejects(readPdf(new File(['synthetic'],'test.pdf'),async()=>{throw Error('OCR failed');},()=>{},()=>{}),/OCR failed/);
  }
  // Guard the two callers as well as the executable readPdf flow above.
  assert.match(source,/readPdf\(\s*item\.file,\s*getWorker,/);
  assert.match(source,/readPdf\(file,getWorker,/);
  assert.match(source,/status:'review',links:record.links,notes:parsed.notes\+' New OCR draft/);
  assert.match(source,/Saved values remain unchanged until you choose Save changes/);
  assert.match(source,/state: "error"/);
}
(async()=>{await loaders();await moduleStartup();await tender();await dockets();console.log('PASS document readers: hardened config, concurrent loads, fail/retry, timeout/retry, missing global, digital/scanned PDF, errors and review guards (mocked DOM/PDF/OCR).');})().catch(e=>{console.error(e);process.exitCode=1;});
