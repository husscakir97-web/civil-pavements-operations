// Optional real-browser smoke. Uses installed Chrome, no downloaded tooling.
const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),ts=require('typescript');
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'reader-smoke-'));
const code=ts.transpileModule(fs.readFileSync('lib/document-readers.ts','utf8')+'\n'+fs.readFileSync('lib/tender-reader.ts','utf8').replace(/^import .*;\r?\n/gm,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const html=`<script src="/pdf-lib.js"></script><script>window.readerExports=(()=>{const exports={};${code};return exports;})();</script><script>
async function run(){
 const readers=window.readerExports;
 // Exercise an actual failed module import, followed by concurrent retry.
 const append=document.head.appendChild.bind(document.head);
 document.head.appendChild=script=>{if(script.dataset.docketPdf)script.src='/missing-module.mjs';return append(script);};
 let failed=false;try{await readers.loadPdfReader();}catch(e){failed=/failed to load/.test(e.message);}
 document.head.appendChild=append;
 if(!failed||document.querySelector('script[data-docket-pdf]'))throw Error('Failed module was not rejected and removed');
 await Promise.all([readers.loadPdfReader(),readers.loadPdfReader()]);
 if(window.pdfjsLib.version!==readers.PDF_READER_VERSION)throw Error('Wrong PDF.js version');
 if(window.pdfjsLib.GlobalWorkerOptions.workerSrc!==readers.PDF_READER_WORKER_URL)throw Error('Wrong worker version');
 if(document.querySelectorAll('script[data-docket-pdf]').length!==1)throw Error('Concurrent module loads were duplicated');
 const originalGetDocument=window.pdfjsLib.getDocument;
 let realWorker=false;
 window.pdfjsLib.getDocument=options=>{const task=originalGetDocument(options);task.promise.then(()=>{realWorker=task._worker?.port instanceof Worker;},()=>{});return task;};
 const results=[];
 for(const scanned of [false,true]){
  const pdf=await PDFLib.PDFDocument.create(),page=pdf.addPage([600,300]);
  const text='LOCAL TEST: Council pavement project quantity 120 total hours 8';
  if(scanned){const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,1200,600);c.fillStyle='black';c.font='28px Arial';c.fillText(text,30,100);const png=await pdf.embedPng(canvas.toDataURL());page.drawImage(png,{x:0,y:0,width:600,height:300});}
  else page.drawText(text,{x:20,y:180,size:15});
  const pages=[];await window.readerExports.readTender(new File([await pdf.save()],'synthetic.pdf',{type:'application/pdf'}),async p=>pages.push(p),()=>{});
  const ocrLoaded=!!document.querySelector('script[data-docket-ocr]');
  results.push({version:window.pdfjsLib.version,workerSrc:window.pdfjsLib.GlobalWorkerOptions.workerSrc,realWorker,scanned,ocrLoaded,pages});
  if(!realWorker)throw Error('PDF.js used a fake worker');
  if(!scanned&&ocrLoaded)throw Error('Digital PDF downloaded OCR');
 }
 return results;
}
</script>`;
const server=http.createServer((req,res)=>{if(req.url==='/missing-module.mjs'){res.writeHead(404,{'Content-Type':'text/javascript'});res.end();return;}res.setHeader('Content-Type',req.url==='/pdf-lib.js'?'text/javascript':'text/html');res.end(req.url==='/pdf-lib.js'?fs.readFileSync(require.resolve('pdf-lib/dist/pdf-lib.min.js')):html);});
let browser,socket;
const watchdog=setTimeout(()=>{console.error('Browser smoke exceeded 100 seconds');socket?.close();browser?.kill();server.close();process.exit(1);},100000);
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 console.log('Local synthetic-document server ready');
 browser=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const browserWs=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Browser startup timed out')),20000);browser.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});browser.on('error',reject);});
 console.log('Chrome started; connecting DevTools');
 socket=new WebSocket(browserWs);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
 let next=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('DevTools timed out: '+method));},70000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params,sessionId}));});
 console.log('DevTools connected');
 const {targetInfos}=await send('Target.getTargets');
 const targetId=targetInfos.find(t=>t.type==='page')?.targetId;
 if(!targetId)throw Error('No browser page target available');
 console.log('Browser page found');
 const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port},sessionId);
 let ready=false;for(let i=0;i<40&&!ready;i++){const r=await send('Runtime.evaluate',{expression:'typeof run',returnByValue:true},sessionId);ready=r.result.value==='function';if(!ready)await new Promise(r=>setTimeout(r,100));}
 console.log('Reader harness ready:',ready);
 const result=await send('Runtime.evaluate',{expression:'Promise.race([run(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Reader smoke timed out")),60000))])',awaitPromise:true,returnByValue:true,timeout:150000},sessionId);
 console.log(JSON.stringify(result,null,2));
 if(result.exceptionDetails||!Array.isArray(result.result?.value)||result.result.value.length!==2||result.result.value.some(r=>r.pages.length!==1||r.pages[0].error||r.pages[0].method!==(r.scanned?'local-ocr':'pdf-text')||!r.pages[0].text.includes('LOCAL')))process.exitCode=1;
 socket.send(JSON.stringify({id:++next,method:'Browser.close'}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{clearTimeout(watchdog);socket?.close();browser?.kill();server.close();console.log('Temporary browser profile:',profile);});
