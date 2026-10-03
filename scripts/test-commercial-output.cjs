// Synthetic commercial journey. SQLite verifies persisted values; it does not simulate MySQL row locks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {AsyncLocalStorage} = require('node:async_hooks');
const ts = require('typescript');
const db = new DatabaseSync(':memory:');
for (const f of ['0000_jittery_forge.sql','0001_pavement_os.sql','20260910105008_field.sql','20260910110000_docket_enrichment.sql','20260910123000_claims.sql']) db.exec(fs.readFileSync(`drizzle/${f}`,'utf8'));
require('./test-services.cjs').prepare(db);
db.function('CONCAT', (...args) => args.join(''));
const context = new AsyncLocalStorage();
const conn = {};
let locked = false;
let outputSpec;
let duringRender;
const auditEntries=[];
function statement(sql, params = []) {
  sql = sql.replace(/ FOR UPDATE/g, '').replace(/ON DUPLICATE KEY UPDATE (.*)/, (_, s) => 'ON CONFLICT(organisation_id,source_type,source_id,source_line) DO UPDATE SET ' + s.replace(/VALUES\((\w+)\)/g, 'excluded.$1'));
  const flat = [];
  let n = 0;
  sql = sql.replace(/\?/g, () => { const v = params[n++]; if (Array.isArray(v)) { flat.push(...v); return v.map(() => '?').join(','); } flat.push(v ?? null); return '?'; });
  return {s: db.prepare(sql), flat};
}
const query = async (sql, params, c) => {
  if (/progress_claims.*FOR UPDATE/.test(sql)) { assert.equal(c, conn); locked = true; }
  if (/SELECT description,this_claim FROM claim_lines/.test(sql)) {assert.equal(c,conn);assert(locked,'export reads lines under claim lock');}
  const {s,flat} = statement(sql, params); return s.all(...flat);
};
const exec = async (sql, params) => { const {s,flat} = statement(sql, params); return Number(s.run(...flat).changes); };
const database = {prepare(sql) { let values = []; return {bind(...v) {values = v; return this;}, async execute() {const {s,flat} = statement(sql, values); return /^SELECT/.test(sql) ? {results:s.all(...flat)} : s.run(...flat);}}; }};
const sqlApi = {query,one:async (...a) => (await query(...a))[0] ?? null,exec,nowIso:() => new Date().toISOString(),uuid:() => crypto.randomUUID(),round2:n => Math.round((Number(n)||0)*100)/100,
  tx:async fn => {db.exec('BEGIN');locked = false;try {const out = await fn(conn);db.exec('COMMIT');return out;} catch(e) {db.exec('ROLLBACK');throw e;}}};
const mocks = {
  'lib/platform/context.ts': {actorContext:context},
  'lib/platform/sql.ts': sqlApi,
  'lib/platform/database.ts': {database},
  'lib/platform/audit.ts': {audit:async (entry,c) => {assert.equal(c,conn);auditEntries.push(entry);}},
  'lib/platform/entitlements.ts': {seamEnabled:async () => true,requireSeam:async () => true},
  'lib/platform/domain-events.ts': {domainEventStatement:async () => database.prepare('SELECT 1')},
  'lib/estimates-db.ts': {safeJson:(s,fallback) => {try {return JSON.parse(s);} catch {return fallback;}}},
  'lib/platform/http.ts': {fail:(status,message) => {throw Object.assign(new Error(message),{status});}},
};
const cache = {};
function load(file) {
  file = file.replaceAll('\\','/');
  if (mocks[file]) return mocks[file];
  if (cache[file]) return cache[file].exports;
  const m = {exports:{}}; cache[file] = m;
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText;
  new Function('require','module','exports',code)(n => n.startsWith('@/') ? load(n.slice(2)+'.ts') : n.startsWith('.') ? load(path.join(path.dirname(file),n)+'.ts') : require(n),m,m.exports);
  return m.exports;
}
const org = 'roadworx-sydney', now = '2026-10-02T00:00:00.000Z';
db.prepare('UPDATE organisations SET name=? WHERE id=?').run('Synthetic Civil Contractor',org);
const insert = (table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
for (const id of ['alpha','bravo']) insert('jobs',{id,organisation_id:org,name:`Synthetic ${id}`,client_name:'Synthetic Client',contract_number:'SYNTH-CONTRACT-001',status:'Active',stage:'active',metadata:'{}',created_at:now,retention_enabled:1,retention_pct:5,retention_cap_amount:500});
insert('project_baselines',{id:'baseline',organisation_id:org,project_id:'alpha',revision:1,contract_value:5000,reason:'Synthetic contract',source_type:'manual',budget_labour:0,budget_plant:0,budget_material:600,budget_subcontract:0,budget_other:0,budget_indirect:0,budget_total:600,created_at:now});
insert('dockets',{id:'supplier-docket',organisation_id:org,docket_no:'SYNTH-COST-001',work_date:'2026-10-02',client:'Synthetic client',project:'Synthetic alpha',quantity:2,quantity_unit:'t',amount:600,status:'review',confidence:100,source_name:'Manual supplier cost fixture',source_key:'',raw_text:'',created_at:now,updated_at:now,line_items:JSON.stringify([{description:'Supplier material cost',quantity:2,rate:300,amount:600}]),links:JSON.stringify({jobId:'alpha'})});
const seam = load('lib/seams/docket-to-cost.ts');
const claims = load('lib/modules/commercial/claims.ts');
const pdf = load('lib/platform/pdf.ts');
const render = pdf.renderDocument;
pdf.renderDocument = async spec => {outputSpec = spec;if (duringRender) await duringRender();return render(spec);};
const costs = () => db.prepare("SELECT project_id,source_line,amount,status FROM cost_transactions ORDER BY source_line").all().map(r => ({...r}));
async function postCost(status, links) {
  const next = links ? {links:JSON.stringify(links)} : {};
  const result = await seam.docketCostStatements('supplier-docket',status,next);
  for (const s of result.statements) await s.execute();
  await exec('UPDATE dockets SET status=? WHERE id=?',[status,'supplier-docket']);
  if (links) await exec('UPDATE dockets SET links=? WHERE id=?',[JSON.stringify(links),'supplier-docket']);
  return result;
}
context.run({organisationId:org,userId:'test-owner',email:'synthetic@example.invalid',role:'admin'}, async () => {
  await postCost('approved'); await postCost('approved');
  assert.deepEqual(costs(),[{project_id:'alpha',source_line:'L1',amount:600,status:'actual'}],'approval retry posts once');
  await postCost('review'); assert.equal(costs()[0].status,'reversed');
  await postCost('approved'); assert.equal(costs().length,1,'reapproval reuses row');
  await postCost('approved',seam.nextAllocationLinks({jobId:'alpha'},{jobId:'bravo'}).links);
  assert.deepEqual(costs().map(r => [r.project_id,r.status]),[['alpha','reversed'],['bravo','actual']]);
  await postCost('approved',seam.nextAllocationLinks({jobId:'bravo',allocationSeq:1},{jobId:'alpha'}).links);
  assert.equal(costs().filter(r => r.status==='actual').length,1);
  assert.equal(costs().find(r => r.status==='actual').amount,600);
  const empty = seam.docketCostLines({docket_no:'MISSING',amount:0,line_items:'[]',notes:''}); assert.equal(empty.length,0,'unknown cost is not a zero-cost transaction');
  // Revenue comes from independently agreed contract works, NOT from supplier cost amounts.
  const created = await claims.createClaim('alpha',{period:'2026-10',claimDate:'2026-10-02',lines:[{lineType:'contract',sourceId:'baseline',thisClaim:1000}]});
  assert.equal(created.grossAmount,1000);assert.equal(created.retentionWithheld,50);assert.equal(created.netAmount,950);
  assert.deepEqual({...db.prepare('SELECT line_type,source_id,this_claim FROM claim_lines WHERE claim_id=?').get(created.claimId)},{line_type:'contract',source_id:'baseline',this_claim:1000},'billable amount was independently entered against the agreed contract');
  await assert.rejects(() => claims.createClaim('alpha',{period:'2026-10',lines:[{lineType:'contract',sourceId:'baseline',thisClaim:1000}]}),/open draft/);
  await claims.transitionClaim(created.claimId,'internal_approval');
  await claims.transitionClaim(created.claimId,'submitted');
  const stored = db.prepare('SELECT * FROM progress_claims WHERE id=?').get(created.claimId);
  assert.equal(stored.revision,3);assert.equal(stored.gross_amount,1000);
  await verifyOutput(created.claimId);
  await verifyBillingBoundary();
}).catch(e => {console.error(e);process.exitCode = 1;});

async function verifyOutput(id) {
  const reject = (fn,status) => assert.rejects(fn,e => e.status===status);
  const download = (revision=3,project='alpha') => claims.claimPdf(id,project,revision);
  await reject(() => download(2),409);
  await reject(() => download(3,'bravo'),404);
  await reject(() => download(0),400);
  await reject(() => download(NaN),400);
  await reject(() => claims.claimPdf('missing','alpha',3),404);
  await context.run({...context.getStore(),organisationId:'another-tenant'},() => reject(download,404));
  await context.run({...context.getStore(),role:'field'},() => reject(download,403));
  for (const status of ['draft','internal_approval']) {
    await exec('UPDATE progress_claims SET status=? WHERE id=?',[status,id]);await reject(download,409);
  }
  await exec("UPDATE progress_claims SET status='submitted',approved_by=NULL WHERE id=?",[id]);await reject(download,409);
  await exec('UPDATE progress_claims SET approved_by=? WHERE id=?',['test-owner',id]);
  await exec('UPDATE progress_claims SET net_amount=NULL WHERE id=?',[id]);await reject(download,409);
  await exec('UPDATE progress_claims SET net_amount=950 WHERE id=?',[id]);
  const before = db.prepare('SELECT * FROM progress_claims WHERE id=?').get(id);
  const response = await download();
  assert.equal(response.headers.get('Content-Type'),'application/pdf');
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('Content-Disposition'),'attachment; filename="Client-review-alpha-Claim-1-rev-3.pdf"');
  const bytes = Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const parsed = await require('pdf-lib').PDFDocument.load(bytes);assert(parsed.getPageCount()>0);
  assert.equal(outputSpec.revision,3);assert.equal(outputSpec.status,'Submitted');
  assert.equal(outputSpec.title,'Progress claim - client review');assert.equal(outputSpec.number,'Claim-1');
  assert.deepEqual(outputSpec.blocks.find(b=>b.rows).rows.slice(0,4),[['Client','Synthetic Client'],['Project','Synthetic alpha'],['Contract','SYNTH-CONTRACT-001'],['Claim period','2026-10']]);
  assert.match(outputSpec.control,/AUD excluding GST/);
  assert.match(outputSpec.blocks[0].text,/original claimed amounts/);
  assert.deepEqual(outputSpec.blocks.find(b=>b.heading==='Claimed work').table.rows,[['Original contract works','$1,000.00']]);
  assert.deepEqual(outputSpec.blocks.find(b=>b.heading==='Claim summary').rows,[['Gross claimed','$1,000.00'],['Retention withheld','$50.00'],['Retention released','$0.00'],['Net claimed (ex GST)','$950.00']]);
  assert.match(outputSpec.control,/not a tax invoice/);
  assert(!JSON.stringify(outputSpec).includes('$600.00'),'supplier actual cost is not disclosed as client revenue');
  assert(!JSON.stringify(outputSpec).match(/margin|profit/i),'unknown or GST-incomparable margin is not presented');
  const spec = structuredClone(outputSpec);
  await download();assert.deepEqual(outputSpec,spec,'retry renders the same stored figures');
  assert.deepEqual(db.prepare('SELECT * FROM progress_claims WHERE id=?').get(id),before,'export does not mutate the claim');
  // Export boundary only: the existing claim picker still exposes ambiguous docket.amount.
  // An independently entered supplier cost correction must not change agreed claim revenue.
  await exec('UPDATE dockets SET amount=725 WHERE id=?',['supplier-docket']);await postCost('approved');
  assert.equal(costs().filter(r=>r.status==='actual').reduce((sum,r)=>sum+r.amount,0),725);
  await download();assert.deepEqual(outputSpec,spec,'supplier cost correction cannot recalculate the stored client claim');
  await exec('UPDATE dockets SET amount=600 WHERE id=?',['supplier-docket']);await postCost('approved');
  // A transition after snapshot capture cannot mix old claim lines with a new header.
  duringRender = async () => {await exec("UPDATE progress_claims SET revision=4,status='certified',certified_amount=900,certified_net=855 WHERE id=?",[id]);};
  await download();assert.deepEqual(outputSpec,spec,'captured approved revision remains consistent during a later transition');
  duringRender = undefined;
  await reject(download,409);
  await download(4);assert.equal(outputSpec.status,'Certified');
  assert.deepEqual(outputSpec.blocks.find(b=>b.heading==='Claim summary').rows,spec.blocks.find(b=>b.heading==='Claim summary').rows,'certification never rewrites original claimed figures');
  assert.equal(costs().filter(r=>r.status==='actual')[0].amount,600,'commercial output leaves actual costs unchanged');
  if (process.env.COMMERCIAL_PREVIEW_DIR) {
    fs.mkdirSync(process.env.COMMERCIAL_PREVIEW_DIR,{recursive:true});
    fs.writeFileSync(path.join(process.env.COMMERCIAL_PREVIEW_DIR,'synthetic-claim.pdf'),bytes);
    fs.writeFileSync(path.join(process.env.COMMERCIAL_PREVIEW_DIR,'synthetic-claim.json'),JSON.stringify(spec,null,2));
  }
  console.log('PASS commercial output: actual 600; independent contract claim 1000 / retention 50 / net 950; cost retry/reapproval/reversal/reallocation; missing cost; approved revision PDF; tenant/project/role guards; stale revision rejection; snapshot consistency and read-only retries (SQLite, not MySQL concurrency).');
}

async function verifyBillingBoundary() {
  const candidate=(await claims.claimable('alpha')).find(l=>l.sourceId==='supplier-docket');
  assert.equal(candidate.contractValue,null);assert.equal(candidate.remaining,null);assert.equal(candidate.billingRequired,true);
  const create=(billingBasis,thisClaim=1000,project='alpha')=>claims.createClaim(project,{period:'2026-10',lines:[{lineType:'docket',sourceId:'supplier-docket',thisClaim,billingBasis}]});
  const basis={confirmed:true,reference:'Client agreed daywork DW-001, ex GST',expectedUpdatedAt:candidate.docketVersion};
  const state=()=>JSON.stringify({claims:db.prepare('SELECT * FROM progress_claims').all(),lines:db.prepare('SELECT * FROM claim_lines').all(),costs:costs(),docket:db.prepare('SELECT * FROM dockets').all()});
  for(const bad of [undefined,{...basis,confirmed:false},{...basis,reference:''},{...basis,expectedUpdatedAt:'stale'}]){
    const before=state();await assert.rejects(()=>create(bad),e=>[409,422].includes(e.status));assert.equal(state(),before,'missing/stale billing basis makes no changes');
  }
  await assert.rejects(()=>create(basis,-1),e=>e.status===422);
  await assert.rejects(()=>create(basis,0),e=>e.status===422);
  await assert.rejects(()=>create(basis,1000,'bravo'),e=>e.status===409);
  await context.run({...context.getStore(),organisationId:'other-tenant'},()=>assert.rejects(()=>create(basis),e=>e.status===404));
  await context.run({...context.getStore(),role:'field'},()=>assert.rejects(()=>create(basis),e=>e.status===403));
  // Supplier cost changes before claim preparation. A stale confirmation is rejected;
  // refreshing does not copy that new supplier cost into the independently agreed charge.
  await exec('UPDATE dockets SET amount=725,updated_at=? WHERE id=?',['2026-10-02T00:01:00.000Z','supplier-docket']);await postCost('approved');
  await assert.rejects(()=>create(basis),e=>e.status===409);
  basis.expectedUpdatedAt='2026-10-02T00:01:00.000Z';
  const claim=await create(basis);assert.equal(claim.grossAmount,1000);assert.equal(claim.netAmount,950);
  const line=db.prepare('SELECT * FROM claim_lines WHERE claim_id=?').get(claim.claimId);
  assert.equal(line.this_claim,1000);assert.equal(line.contract_value,1000);assert.match(line.description,/Client agreed daywork DW-001/);
  assert.equal(costs().filter(r=>r.status==='actual').reduce((sum,r)=>sum+r.amount,0),725);
  const entry=auditEntries.find(e=>e.entityId===claim.claimId);
  assert.deepEqual(entry.after.billingConfirmations[0],{docketId:'supplier-docket',docketVersion:basis.expectedUpdatedAt,amountExGst:1000,reference:basis.reference,confirmedBy:'test-owner',confirmedAt:entry.after.billingConfirmations[0].confirmedAt});
  await assert.rejects(()=>create(basis),e=>e.status===409,'retry cannot double claim');
  await claims.deleteDraftClaim(claim.claimId);
  assert.equal(db.prepare('SELECT status FROM dockets WHERE id=?').get('supplier-docket').status,'approved');
  await assert.rejects(()=>create(),e=>e.status===422,'deleting draft does not preserve an implicit billable amount');
  const refreshed=(await claims.claimable('alpha')).find(l=>l.sourceId==='supplier-docket');
  const again=await create({...basis,expectedUpdatedAt:refreshed.docketVersion});
  await claims.transitionClaim(again.claimId,'internal_approval');await claims.transitionClaim(again.claimId,'submitted');
  await claims.claimPdf(again.claimId,'alpha',3);
  assert.deepEqual(outputSpec.blocks.find(b=>b.heading==='Claimed work').table.rows,[[line.description,'$1,000.00']]);
  console.log('PASS docket billing boundary: unknown remains null; missing/unconfirmed/stale basis refuses without writes; cost 600 -> 725, independently confirmed charge 1000; auditable reference; retry, draft deletion/reconfirmation, tenant/project/role guards and approved PDF.');
}
