// Docket parsing accuracy: identities, dates, resource rows, digital vs OCR and multi-page assembly.
// Fixtures are synthetic (names, companies, numbers and signatures are invented); no real docket is committed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const load=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const parser=await import(`data:text/javascript;base64,${Buffer.from(load('../lib/docket-parser.ts')).toString('base64')}`);
const {parseDocket,splitDocketText,parseDocketDocument,parseDocketPage,isReadablePdfText,docketIdentities}=parser;
const works=readFileSync(new URL('./fixtures/dockets/works-docket-1p.txt',import.meta.url),'utf8').trim();
const lines=works.split('\n');

// ---- The one-page works docket: one record, not two; correct dates, references and resource rows.
assert.equal(splitDocketText(works).length,1,'the heading "WORKS DOCKET" is not a boundary');
assert.deepEqual(docketIdentities(works).map(i=>i.value),['9042'],'the physical docket number "NA" and the heading are not identities');
const d=parseDocket(works,'works.pdf',99);
assert.equal(d.docketNo,'9042');
assert.equal(d.workDate,'2026-09-23','work date comes from the rows, not the sign-off');
assert.equal(d.links.signOffDate,'2026-09-28');assert.equal(d.links.jobReference,'8123');assert.equal(d.links.contractReference,'X100 - ZZ001');
assert.notEqual(d.workDate,d.links.signOffDate);
assert.equal(d.project,'Sample Road Upgrade Stage 2');assert.equal(d.client,'Example Builder Group');
assert.equal(d.labourHours,30,'three 10-hour rows total 30 labour hours');
const labour=d.lineItems.filter(i=>i.kind==='labour'),travel=d.lineItems.filter(i=>i.kind==='travel');
assert.deepEqual(labour.map(i=>i.quantity),[10,10,10]);assert.equal(travel.reduce((n,i)=>n+i.quantity,0),5.05,'travel is kept separately');
assert.equal(d.labourHours,labour.reduce((n,i)=>n+i.quantity,0),'travel is not in labour hours');
assert(d.lineItems.every(i=>i.rate===null&&i.amount===null),'absent rates and amounts stay unknown');
assert.equal(d.amount,0);assert.equal(d.poNumber,'','an absent PO stays unknown');assert.equal(d.vehicle,'TST01A');
assert.equal(d.startTime,'07:00');assert.equal(d.finishTime,'17:30');assert.equal(d.breakHours,0.5);
assert.equal(d.status,'review','inferred fields are checked by a person');assert(d.fieldConfidence.workDate<=70);
assert.match(d.notes,/travel hours kept separate/);

// ---- Work date: never today, never a sign-off, never a placeholder.
const noRows=lines.filter(l=>!/^(TC|Ute)\s*:/.test(l)).join('\n');
const undated=parseDocket(noRows,'works.pdf',99);
assert.equal(undated.workDate,'','a docket whose only date is the sign-off has no work date');assert.match(undated.notes,/No work date was found/);
assert.equal(parseDocket('Docket No: ABC-77\nClient: Example Civil\nProject: Test Road','09092026102415-0001.pdf',99).workDate,'','no date from the file name or from today');
assert.equal(parseDocket('Docket No: ABC-77\nWork date: 14/09/2026\nSigned off on 20/09/2026\nClient: Example Civil\nProject: Test Road','a.pdf',99).workDate,'2026-09-14');
assert.equal(parseDocket('Docket No: ABC-77\nSigned off on 20/09/2026\nPrinted 21/09/2026\nClient: Example Civil\nProject: Test Road','a.pdf',99).workDate,'');
assert.equal(parseDocket('Docket No: ABC-77\nDate: 14/09/2026\nSigned off on 20/09/2026','a.pdf',99).workDate,'2026-09-14');

// ---- Splitting: genuine identities only.
const second=works.replace('9042','9043').replace('Job  8123','Job  8124');
const bodyStart=lines.findIndex(l=>l.startsWith('Job'));
const two=`${works}\n${lines.slice(0,1).join('\n')}\n${second.split('\n').slice(bodyStart-0).join('\n')}`;
const parts=splitDocketText(two);assert.equal(parts.length,2,'two identities, two dockets');
assert.deepEqual(parts.map(p=>docketIdentities(p)[0].value),['9042','9043']);
assert.equal(splitDocketText(`${works}\nWORKS DOCKET - copy for client\nPage 1 of 1`).length,1,'a repeated heading is not a boundary');
assert.equal(splitDocketText(`${works}\nDocket number: 9042`).length,1,'a repeated identity is the same docket');
assert.equal(splitDocketText(`${works}\nReplaces docket no: 9041`).length,1,'a cross-reference is not an identity');
assert.equal(splitDocketText(`${works}\nPhysical docket number: 5555`).length,1,'the paper docket number is not the identity');
assert.equal(splitDocketText(`${works}\n${works}`.replace(/\n9042[^\n]*$/,'')).length,1);
assert.equal(splitDocketText('WORKS DOCKET\nExample Pty Ltd\nNo number printed here\nDate: 14/09/2026').length,1);

// ---- Pages: one docket over several pages, several dockets per page, several dockets over several pages.
const page=(text,pageNumber,pageCount,confidence=99)=>({text,confidence,pageNumber,pageCount});
const continuation=`WORKS DOCKET (continued)\nPage 2 of 2\nTC  : Quinn Continued  24/09 7:00  15:00  0.50  -  -  7.50\nWorker:  Quinn Continued  Client rep:  Chris Client`;
const longDocket=parseDocketDocument([page(works,1,2),page(continuation,2,2)],'long.pdf');
assert.equal(longDocket.length,1,'a continuation page joins its docket');
assert.equal(longDocket[0].docketNo,'9042');assert.equal(longDocket[0].labourHours,37.5);assert.equal(longDocket[0].sourcePage,1);assert.match(longDocket[0].notes,/pages 1, 2 of 2/);assert.equal(longDocket[0].sourceCrop,'pages-1+2');
assert.match(longDocket[0].notes,/Rows are dated 2026-09-23 to 2026-09-24/);assert.equal(longDocket[0].workDate,'2026-09-23');
const repeated=parseDocketDocument([page(works,1,2),page(`Docket number: 9042\nPage 2 of 2\nTC  : Quinn Continued  23/09 7:00  15:00  0.50  -  -  7.50`,2,2)],'long.pdf');
assert.equal(repeated.length,1,'the same identity on the next page is the same docket');
const bare=parseDocketDocument([page(works,1,2),page('Signature\nWorker: Quinn Continued','2'==='2'?2:2,2)],'long.pdf');
assert.equal(bare.length,1,'a page with no header of its own continues the docket');
const threePages=parseDocketDocument([page(works,1,3),page(continuation,2,3),page(second.replace('Docket number: 9043','Docket number: 9043'),3,3)],'three.pdf');
assert.deepEqual(threePages.map(r=>r.docketNo),['9042','9043'],'a docket over two pages plus one more docket');
const perPage=parseDocketDocument([page(works,1,2),page(second,2,2)],'two.pdf');assert.deepEqual(perPage.map(r=>r.docketNo),['9042','9043'],'one docket per page');assert.equal(perPage[0].sourcePage,1);assert.equal(perPage[1].sourcePage,2);
const manyOnPage=parseDocketDocument([page(two,1,1)],'many.pdf');assert.equal(manyOnPage.length,2,'two dockets on one page');assert.deepEqual(manyOnPage.map(r=>r.sourceCrop),['section-1-of-2','section-2-of-2']);
const newUnnamed=parseDocketDocument([page(works,1,2),page('WORKS DOCKET\nClient: Other Civil\nProject: Elsewhere\nDate: 10/09/2026\nQuantity: 4 hours',2,2)],'x.pdf');
assert.equal(newUnnamed.length,2,'a page with its own heading and header fields is a new docket even without a number');assert.equal(newUnnamed[1].docketNo,'UNREAD');assert.equal(newUnnamed[1].status,'review');

// ---- Digital text is readable regardless of whether every field was understood.
assert.equal(isReadablePdfText(works),true);
const labelsOnly='WORKS DOCKET\nExample Pty Ltd\nDocket number:\nClient:\nProject:\nDate:\nStart  Finish  Total\nNotes:\nWorker:  Client rep:\nSigned off on';
assert.equal(isReadablePdfText(labelsOnly),true,'readable text with missing fields is still readable (no OCR); it goes to review');
{const blank=parseDocket(labelsOnly,'f.pdf',99);assert.equal(blank.client,'','a blank Client: field is not filled with the next label');assert.equal(blank.project,'');}
assert.equal(parseDocket(labelsOnly,'f.pdf',99).status,'review');assert.equal(parseDocket(labelsOnly,'f.pdf',99).workDate,'');
assert.equal(isReadablePdfText(''),false);assert.equal(isReadablePdfText('a b c'),false);assert.equal(isReadablePdfText('#$%^&*()_+{}|:<>?~`'.repeat(10)),false,'garbage text is not readable');

// ---- The upload reader: readable text never triggers OCR; no text layer does.
const dashboard=readFileSync(new URL('../components/docket-dashboard.tsx',import.meta.url),'utf8');
const start=dashboard.indexOf('async function readPdf('),end=dashboard.indexOf('\nfunction escapeCsv',start);
const functionJs=ts.transpileModule(dashboard.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const makeReader=(textLayer)=>{let ocr=0;const fakePage={getTextContent:async()=>({items:[]}),getViewport:()=>({width:100,height:100}),render:()=>({promise:Promise.resolve()})};
 const win={pdfjsLib:{getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>fakePage})})}};
 const read=new Function('window','document','loadPdfReader','textFromPdfItems','hasUsefulPdfText','recogniseDocketCanvas','PDF_READER_OPTIONS',`${functionJs}; return readPdf;`)(win,{createElement:()=>({getContext:()=>({})})},async()=>{},()=>textLayer,isReadablePdfText,async()=>{ocr++;return {text:'ocr text',confidence:60,score:1};},{isEvalSupported:false});
 return {read:(options)=>read({arrayBuffer:async()=>new ArrayBuffer(0)},async()=>({}),()=>{},()=>{},options),ocrCalls:()=>ocr};};
{const r=makeReader(labelsOnly);const pages=await r.read();assert.equal(r.ocrCalls(),0,'readable text with missing fields does not run OCR');assert.equal(pages[0].text,labelsOnly);assert.equal(pages[0].confidence,99);}
{const r=makeReader(works);await r.read();assert.equal(r.ocrCalls(),0);}
{const r=makeReader('');const pages=await r.read();assert.equal(r.ocrCalls(),1,'a page with no text layer is scanned');assert.equal(pages[0].text,'ocr text');}

// ---- Mixed PDFs: an explicit local "Run OCR" runs OCR on readable-label pages, keeps the native text and records the choice.
{const r=makeReader(labelsOnly);const pages=await r.read({forceOcr:true});
 assert.equal(r.ocrCalls(),1,'Run OCR scans a page even though its text is readable');assert.equal(pages[0].method,'local-ocr:run');assert.equal(pages[0].nativeText,labelsOnly,'the native text is kept for comparison');
 assert(pages[0].candidates.some(c=>c.text===labelsOnly),'the native text stays a candidate so differences are flagged');
 const normal=makeReader(labelsOnly);const np=await normal.read();assert.equal(normal.ocrCalls(),0);assert.equal(np[0].method,'pdf-text');
 const records=parseDocketDocument(pages,'mixed.pdf');assert.equal(records[0].extractionMethod,'local-ocr:run','the choice is stored with the record');
 assert.equal(parseDocketDocument(np,'mixed.pdf')[0].extractionMethod,'pdf-text');}
{const source=readFileSync(new URL('../components/docket-dashboard.tsx',import.meta.url),'utf8');
 assert(!/PaidAiScan|paid-ai|paid AI/i.test(source),'the dashboard no longer points to the disabled paid-AI scan');
 assert(source.includes("const forceOcr=action==='reprocess-ocr'||record.extractionMethod==='local-ocr:run';"),'Reprocess honours Run OCR');
 assert(/readPdf\(file,getWorker,\(\)=>\{\},\(\)=>\{\},\{forceOcr\}\)/.test(source),'Reprocess passes the choice to the reader');
 assert(source.includes('data-testid="ocr-compare"'),'the comparison panel exists');
 assert(source.includes("openReview(record.id)"),'the upload list reopens the current server record');}

// ---- Scanned pages: alternate OCR passes still merge and conflict-check; document assembly keeps that behaviour.
const scan=parseDocketDocument([{text:works,confidence:70,candidates:[{text:works,confidence:70},{text:works.replace('9042','9042'),confidence:80}],pageNumber:1,pageCount:1}],'scan.png');
assert.equal(scan.length,1);assert.equal(scan[0].docketNo,'9042');
const disagree=parseDocketDocument([{text:works,confidence:90,candidates:[{text:works,confidence:90},{text:works.replace('9042','9047'),confidence:85}],pageNumber:1,pageCount:1}],'scan.png');
assert.equal(disagree.length,1);assert.equal(disagree[0].status,'review');assert.match(disagree[0].notes,/disagree|differs/);

// ---- Existing layouts are unchanged: haulage, asphalt, traffic control, mixed services.
const haulage=parseDocket('Delivery docket 55\nDate: 10/09/2026\nClient: Example Haulage\nProject: Rosehill\nVehicle: ABC123\nLoad No: 2\nQuantity delivered: 20 tonnes','h.pdf',95);
assert.equal(haulage.docketNo,'55');assert.equal(haulage.quantity,20);assert.equal(haulage.quantityUnit,'t');assert.equal(haulage.workDate,'2026-09-10');
const asphalt=parseDocket('Docket No: ASP-1\nDate: 10/09/2026\nClient: Example Civil\nProject: Test Road\nAsphalt AC14 supply\nQuantity: 120 t','a.pdf',95);
assert.equal(asphalt.profileId,'Asphalt / profiling');assert.equal(asphalt.quantity,120);
const tc=parseDocket('Docket No: TC123\nDate: 09/09/2026\nClient: Example Civil\nProject: Test Road\nTraffic control\nStart: 19:00\nFinish: 05:00\nBreak: 30 mins\nCrew size: 5','t.pdf',99);
assert.equal(tc.labourHours,47.5);assert.equal(tc.profileId,'Traffic control');
const mixedPage='Docket No: ASP-1\nDate: 10/09/2026\nClient: Example Civil\nProject: Carlisle St\nQuantity: 120 t\n\nDelivery docket 55\nDate: 10/09/2026\nClient: Downer\nProject: Rosehill\nQuantity: 20 t';
assert.equal(splitDocketText(mixedPage).length,2);assert.deepEqual(parseDocketPage([{text:mixedPage,confidence:95}],'m.pdf').map(r=>r.docketNo),['ASP-1','55']);

// ======================= Review round 2 =======================
const warned=(r,re)=>assert((r.warnings||[]).some(w=>re.test(w))||re.test(r.notes),'expected a warning matching '+re+' in: '+r.notes+' | '+JSON.stringify(r.warnings));

// ---- 1. Record grouping
{// identical pages must not double quantities
 const twice=parseDocketDocument([page(works,1,2),page(works,2,2)],'dup.pdf');
 assert.equal(twice.length,1);assert.equal(twice[0].labourHours,30,'an identical page is not counted twice');assert.equal(twice[0].lineItems.filter(i=>i.kind==='labour').length,3);
 assert.equal(twice[0].status,'review');warned(twice[0],/identical|repeats|not added again/i);
 // a page that repeats rows already read is also not counted twice
 const overlap=parseDocketDocument([page(works,1,2),page(`Docket number: 9042\nPage 2 of 2\n${lines.filter(l=>/^TC\s*:/.test(l)).join('\n')}\nTC  : Quinn Continued  24/09 7:00  15:00  0.50  -  -  7.50`,2,2)],'overlap.pdf');
 assert.equal(overlap[0].labourHours,37.5,'rows already read are not added again');warned(overlap[0],/already|repeated|duplicate/i);assert.equal(overlap[0].status,'review');
 // different suppliers with the same docket number are different dockets
 const other=works.replace('Example Traffic Services','Other Supplier Pty Ltd').replace('ABN  00 000 000 000','ABN  11 111 111 111');
 const suppliers=parseDocketDocument([page(works,1,2),page(other,2,2)],'suppliers.pdf');
 assert.equal(suppliers.length,2,'the same number from different suppliers does not merge');assert(suppliers.every(r=>r.status==='review'&&r.labourHours===30));suppliers.forEach(r=>warned(r,/same docket number/i));
 // same number, no supplier evidence and no continuation marker: ambiguous, kept apart and flagged
 const bareA='Docket No: Q-77\nClient: Example Civil\nProject: Test Road\nDate: 14/09/2026\nQuantity: 10 t\nOperator: Pat';
 const bareB='Docket No: Q-77\nClient: Example Civil\nProject: Test Road\nDate: 14/09/2026\nQuantity: 25 t\nOperator: Sam';
 const ambiguous=parseDocketDocument([page(bareA,1,2),page(bareB,2,2)],'ambiguous.pdf');
 assert.equal(ambiguous.length,2,'ambiguous grouping is not combined');assert(ambiguous.every(r=>r.status==='review'));ambiguous.forEach(r=>warned(r,/same docket number/i));assert.deepEqual(ambiguous.map(r=>r.quantity),[10,25]);
 // a page that says it continues is evidence enough
 const marked=parseDocketDocument([page(works,1,2),page('Docket number: 9042\nPage 2 of 2\nTC  : Quinn Continued  24/09 7:00  15:00  0.50  -  -  7.50',2,2)],'marked.pdf');assert.equal(marked.length,1);
 // two complete dockets on one page keep their own preceding client/project headers
 const own='Client: Alpha Civil\nProject: Alpha Road\nDocket No: A-101\nDate: 01/10/2026\nQuantity: 10 t\nOperator: Pat Alpha\nClient: Beta Civil\nProject: Beta Street\nDocket No: B-202\nDate: 01/10/2026\nQuantity: 20 t\nOperator: Sam Beta';
 const pair=parseDocketDocument([page(own,1,1)],'pair.pdf');
 assert.deepEqual(pair.map(r=>[r.docketNo,r.client,r.project,r.quantity]),[['A-101','Alpha Civil','Alpha Road',10],['B-202','Beta Civil','Beta Street',20]],'each docket keeps its own header');
 // a shared page header still applies to dockets that have none of their own
 const shared='Client: Shared Civil\nProject: Shared Road\nDate: 02/10/2026\nDocket No: S-1\nQuantity: 4 t\nOperator: Pat\nDocket No: S-2\nQuantity: 6 t\nOperator: Sam';
 const sharedRecords=parseDocketDocument([page(shared,1,1)],'shared.pdf');assert.deepEqual(sharedRecords.map(r=>[r.docketNo,r.client,r.project,r.workDate,r.quantity]),[['S-1','Shared Civil','Shared Road','2026-10-02',4],['S-2','Shared Civil','Shared Road','2026-10-02',6]]);
 // warnings and page provenance survive assembly
 const conflict=parseDocketDocument([page(works,1,2),{text:continuation,confidence:90,candidates:[{text:continuation,confidence:90},{text:continuation.replace('Quinn Continued','Quinn Changed'),confidence:85}],pageNumber:2,pageCount:2}],'prov.pdf');
 assert.equal(conflict.length,1);assert.deepEqual(conflict[0].pages,[1,2],'every contributing page is recorded');assert.equal(conflict[0].sourceCrop,'pages-1+2');assert.match(conflict[0].rawText,/\[page 1\][\s\S]*\[page 2\]/);
 const withWarning=parseDocketDocument([{text:works,confidence:90,candidates:[{text:works,confidence:90},{text:works.replace('9042','9047'),confidence:85}],pageNumber:1,pageCount:2},page(continuation,2,2)],'prov2.pdf');
 assert.equal(withWarning.length,1);assert.equal(withWarning[0].status,'review');warned(withWarning[0],/disagree|differs/i);warned(withWarning[0],/No work date|inferred|Check against/i);
}

// ---- 3. One identity rule everywhere (primary ID and fallbacks)
{const base='\nClient: Example Civil\nProject: Test Road\nDate: 01/10/2026\n';
 for(const [label,text] of [['time','Docket No: 07:00'+base],['dotted time','Docket No: 07.00'+base],['date','Docket No: 01/10/2026'+base],['physical only','Physical docket number: 5555'+base],['replaces','Replaces docket 4741'+base],['replaces number','Replaces docket no: 4741'+base],['original','Original docket no: 4741'+base],['see','See docket 4741'+base],['reference fallback','Contract reference: ABC123'+base],['ref time fallback','Ref: 07:00'+base]])
  assert.equal(parseDocket(text,'x.pdf',99).docketNo,'UNREAD','not an identity: '+label);
 assert.equal(parseDocket('Physical docket number: 5555\nDocket number: 4888'+base,'x.pdf',99).docketNo,'4888');
 assert.equal(parseDocket('Replaces docket 4741\nDocket No: 4742'+base,'x.pdf',99).docketNo,'4742');
 assert.equal(parseDocket('Docket No: 07:00\nDocket No: 4742'+base,'x.pdf',99).docketNo,'4742','a time is skipped, the real number is used');
 assert.equal(parseDocket('Contract reference: ABC123\nRun sheet: RS-9'+base,'x.pdf',99).docketNo,'RS-9','a run sheet number remains a fallback');
 assert.equal(parseDocket('Client: Example Civil\nProject: Test Road\nDate: 01/10/2026','Docket_01-10-2026.pdf',99).docketNo,'UNREAD','a date in the file name is not an identity');
 assert.equal(parseDocket('Client: Example Civil','docket-AB1234.pdf',99).docketNo,'AB1234','a file-name number remains a fallback');
 assert.deepEqual(docketIdentities('Docket No: 07:00\nReplaces docket 4741\nDocket No: 4742').map(i=>i.value),['4742']);
 // a value stacked under its label (typical OCR output) is read; a bare heading followed by a number is not an identity
 assert.deepEqual(docketIdentities('Docket number:\n55621\nClient:').map(i=>i.value),['55621']);
 assert.deepEqual(docketIdentities('WORKS DOCKET\n4742\nClient: X').map(i=>i.value),[],'heading then number is not an identity');
 for(const stacked of ['Docket No\n07:00','Physical docket number:\n5555','Replaces docket no:\n4741','Docket number:\n01/10/2026','Docket number:\nPat Smith'])assert.deepEqual(docketIdentities(stacked).map(i=>i.value),[],'not an identity: '+JSON.stringify(stacked));
 assert.equal(parseDocket('WORKS DOCKET\nDocket number:\n55621\nClient:\nMixed Civil\nProject:\nMixed Road\nDate:\n23/09/2026','ocr.png',80).docketNo,'55621');
 // cross-references and times never split
 assert.equal(splitDocketText(`${works}\nReplaces docket 9041\nDocket No: 07:00`).length,1);
 assert.equal(splitDocketText(`${works}\nRef docket no: 9041\nOriginal docket 9040`).length,1);
}

// ---- 4. Resource tables: compound headers, flagged ambiguity, totals unchanged
{const compound=works.replace('Start  Finish  First  Travel  LAFHA  Total\non site  on site  Break','Start  Finish  First Break  Travel  LAFHA  Total');
 const c=parseDocket(compound,'c.pdf',99);assert.equal(c.labourHours,30,'"First Break" is one column');assert.equal(c.lineItems.filter(i=>i.kind==='travel').reduce((n,i)=>n+i.quantity,0),5.05);assert.equal(c.breakHours,0.5);assert(!/ambiguous|could not be matched/i.test(c.notes),'a recognised compound header is not flagged');
 const unpaid=works.replace('Start  Finish  First  Travel  LAFHA  Total\non site  on site  Break','Start on site  Finish on site  Unpaid Break  Travel Time  LAFHA  Total Hours');
 const u=parseDocket(unpaid,'u.pdf',99);assert.equal(u.labourHours,30);assert.equal(u.breakHours,0.5);
 // no header: the printed total is kept, the columns are flagged, nothing is silently recomputed
 const headerless=works.replace(/Start  Finish  First  Travel  LAFHA  Total\non site  on site  Break\n/,'');
 const h=parseDocket(headerless,'h.pdf',99);assert.equal(h.labourHours,30,'printed totals are kept');assert.equal(h.status,'review');warned(h,/columns/i);
 // header that does not match the row values
 const mismatch=works.replace('Start  Finish  First  Travel  LAFHA  Total\non site  on site  Break','Start  Finish  Break  Total');
 const m=parseDocket(mismatch,'m.pdf',99);assert.equal(m.labourHours,30);assert.equal(m.status,'review');warned(m,/columns/i);
 // duplicate column names are ambiguous
 const dup=works.replace('Start  Finish  First  Travel  LAFHA  Total\non site  on site  Break','Start  Finish  Break  Break  LAFHA  Total');
 const dd=parseDocket(dup,'d.pdf',99);assert.equal(dd.labourHours,30);warned(dd,/columns/i);
 // printed total disagrees with the times: the printed total is kept and flagged
 const off=works.replace('0.50  0.05  -  10.00','0.50  0.05  -  9.00');
 const o=parseDocket(off,'o.pdf',99);assert.equal(o.labourHours,29,'the printed total is not rewritten');warned(o,/differ|times/i);assert.equal(o.status,'review');
 // the original layout is untouched
 assert.equal(parseDocket(works,'w.pdf',99).labourHours,30);assert(!/columns could not/i.test(parseDocket(works,'w.pdf',99).notes));
}

console.log('Passed: docket accuracy — identities not headings, work vs sign-off date, job/contract references, resource rows and travel, readable digital text without OCR, continuation and multi-docket assembly, scanned alternates, existing layouts.');
