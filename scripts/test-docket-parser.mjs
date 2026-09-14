import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/docket-parser.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseDocket, splitDocketText, parseDocketPage } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const complete = `Docket No: ABC-1234\nDate: 09/09/2026\nClient: Example Civil\nJob Location: Test Road\nOrder No: PO-123\nQuantity: 18.4 tonnes`;
const record = parseDocket(complete, 'test.pdf', 95);
assert.equal(record.project, 'Test Road');
assert.equal(record.poNumber, 'PO-123');
assert.equal(record.quantity, 18.4);
assert.equal(record.quantityUnit, 't');
assert.equal(record.workDate, '2026-09-09');
assert.equal(record.status, 'ready');

const incomplete = parseDocket(`Docket No: F305L54\nDate: 09/09/2026\nClient: Transport for NSW\n24 hr service`, 'scan.png', 99);
assert.equal(incomplete.quantity, 0, 'Printed service hours must not become a billable quantity');
assert.equal(incomplete.status, 'review', 'Missing project must prevent automatic readiness');
assert.equal(parseDocket('Docket No: A123\nClient: Example Civil\nProject: Test Road', 'scan.png', 99).status, 'review');
const overnight = parseDocket(`Docket No: TC123\nDate: 09/09/2026\nClient: Example Civil\nProject: Test Road\nTraffic control\nStart: 19:00\nFinish: 05:00\nBreak: 30 mins\nCrew size: 5`, 'scan.png', 99);
assert.equal(overnight.labourHours, 47.5);
assert.equal(splitDocketText(`${complete}\n${complete.replace('ABC-1234', 'ABC-1235')}`).length, 2);

// Exercise the scanned-PDF consumer with a real recogniser-shaped result.
const dashboard = readFileSync(new URL('../components/docket-dashboard.tsx', import.meta.url), 'utf8');
const start = dashboard.indexOf('async function readPdf(');
const end = dashboard.indexOf('\nfunction escapeCsv', start);
const functionJs = ts.transpileModule(dashboard.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const fakePage = { getTextContent: async () => ({ items: [] }), getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() }) };
const fakeWindow = { pdfjsLib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => fakePage }) }) } };
const readPdf = new Function('window', 'document', 'loadPdfReader', 'textFromPdfItems', 'hasUsefulPdfText', 'recogniseDocketCanvas', `${functionJs}; return readPdf;`)(fakeWindow, { createElement: () => ({ getContext: () => ({}) }) }, async () => {}, () => '', () => false, async () => ({ text: complete, confidence: 95, score: 100 }));
const pages = await readPdf({ arrayBuffer: async () => new ArrayBuffer(0) }, {}, () => {}, () => {});
assert.equal(pages[0].text, complete);
assert.equal(pages[0].confidence, 95);
console.log('Passed: extraction, missing-field review, quantity, dates, overnight hours, splitting and scanned-PDF result handling.');

const fixtures=JSON.parse(readFileSync(new URL('./docket-regression-fixtures.json',import.meta.url),'utf8'));
for(const f of fixtures){const d=parseDocket(f.text,f.filename,71);assert.equal(d.docketNo,f.expected);assert.equal(d.client,'Transport for NSW');assert.equal(d.status,'review');}
assert.equal(parseDocket('No readable docket text','IMG_5590.jpg',95).docketNo,'UNREAD');
assert.equal(parseDocket('Contractor: Roadworx\nDocket No: A123','scan.jpg',95).client,'');
assert.equal(parseDocket('Docket No: A123\nClient: Test Civil\nProject: Test Road','09092026102415-0001.pdf',99).status,'review');
const inline=parseDocket('Docket No: ABC123  Date: 11/09/2026  Client: Test Civil  Project: Test Road','scan.pdf',95);
assert.equal(inline.client,'Test Civil');assert.equal(inline.project,'Test Road');assert.equal(inline.workDate,'2026-09-11');
const merged=parseDocketPage([{text:complete,confidence:95},{text:'Docket No: ABC-1234\nVehicle: AB1234',confidence:80}],'scan.png')[0];assert.equal(merged.vehicle,'AB1234');assert.equal(merged.status,'review');
const conflict=parseDocketPage([{text:complete,confidence:95},{text:complete.replace('Example Civil','Other Civil'),confidence:91}],'scan.png')[0];assert.equal(conflict.status,'review');assert.equal(conflict.fieldConfidence.client,35);
const separate=parseDocketPage([{text:complete,confidence:95},{text:'Docket No: XYZ-5678\nVehicle: ZZ9999',confidence:85}],'scan.png')[0];assert.equal(separate.vehicle,'');assert.equal(separate.status,'review');
console.log(`Passed: ${fixtures.length} saved failing TfNSW samples; inline fields; no photo-name docket IDs, contractor/client confusion or ready filename dates; alternate-pass recovery and conflict isolation.`);
