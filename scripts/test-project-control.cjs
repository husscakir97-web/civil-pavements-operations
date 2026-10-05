// Disposable SQLite fixtures execute the real aggregation and route guards.
// Only database/auth I/O is replaced; no environment files or services are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`
 CREATE TABLE jobs (id TEXT, organisation_id TEXT, name TEXT, contract_value REAL, original_budget REAL, metadata TEXT);
 CREATE TABLE project_baselines (organisation_id TEXT, project_id TEXT, revision INTEGER, snapshot TEXT, contract_value REAL, budget_total REAL, budget_labour REAL, budget_plant REAL, budget_material REAL, budget_subcontract REAL, budget_other REAL, budget_indirect REAL);
 CREATE TABLE project_variations (organisation_id TEXT, project_id TEXT, status TEXT, value REAL, cost REAL, approved_value REAL);
 CREATE TABLE cost_transactions (organisation_id TEXT, project_id TEXT, status TEXT, category TEXT, amount REAL, quantity REAL);
 CREATE TABLE shifts (id TEXT, organisation_id TEXT, name TEXT, status TEXT, metadata TEXT);
 CREATE TABLE field_records (shift_id TEXT, organisation_id TEXT, status TEXT, data TEXT);
 CREATE TABLE dockets (organisation_id TEXT, links TEXT, status TEXT, labour_hours REAL, quantity REAL, quantity_unit TEXT);
 CREATE TABLE progress_claims (organisation_id TEXT, project_id TEXT, status TEXT, gross_amount REAL, certified_amount REAL, retention_withheld REAL, certified_retention REAL, retention_released REAL);
 CREATE TABLE client_invoices (organisation_id TEXT, project_id TEXT, status TEXT, amount_ex_gst REAL, paid_amount REAL, total REAL);
`);
const query = async (sql, values = []) => db.prepare(sql.replace(/JSON_UNQUOTE\((JSON_EXTRACT\([^)]*\))\)/gi, '$1')).all(...values);
const mocks = {
 'lib/platform/sql.ts': {query, one:async (...args) => (await query(...args))[0] || null, round2:n => Math.round((Number(n)||0)*100)/100},
 'lib/platform/database.ts': {database:{}},
 'lib/platform/runtime.ts': {env:{}},
 'lib/platform/auth.ts': {getAuth:() => {throw new Error('Unexpected external auth access');}},
};
const cache = {};
function load(file) {
 file = path.posix.normalize(file.replaceAll('\\', '/'));
 if (mocks[file]) return mocks[file];
 if (cache[file]) return cache[file].exports;
 const m = {exports:{}}; cache[file] = m;
 const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:1,target:9}}).outputText;
 new Function('require','module','exports',code)(name => name.startsWith('@/') ? load(name.slice(2)+'.ts') : name.startsWith('.') ? load(path.posix.join(path.posix.dirname(file),name)+'.ts') : require(name), m, m.exports);
 return m.exports;
}
const {actorContext} = load('lib/platform/context.ts');
const {estimateVsActual, projectFinancials} = load('lib/seams/project-control.ts');
const route = load('app/api/projects/control/route.ts');
const actor = {userId:'synthetic',email:'synthetic@example.invalid',organisationId:'org-a',role:'admin',entitlements:{core:'active',commercial:'active'}};
const docket = (quantity, unit, hours=0, shiftId, status='approved', org='org-a', jobId='p1') => db.prepare('INSERT INTO dockets VALUES (?,?,?,?,?,?)').run(org, JSON.stringify({jobId,shiftId}), status, hours, quantity, unit);
const field = (shiftId, tonnes, hours, status='Submitted', org='org-a', jobId='p1') => {
 db.prepare('INSERT INTO shifts VALUES (?,?,?,?,?)').run(shiftId,org,'Synthetic shift','Completed',JSON.stringify({jobId}));
 db.prepare('INSERT INTO field_records VALUES (?,?,?,?)').run(shiftId,org,status,JSON.stringify({tonnes,resources:[{category:'workers',attendance:'Present',hours,rate:50},{category:'plant',hours:20,rate:100},{category:'workers',attendance:'Absent',hours:8,rate:50}],materialCost:100,otherCost:0}));
};
db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?)').run('p1','org-a','Synthetic project',10000,7000,'{}');
db.prepare('INSERT INTO project_baselines VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('org-a','p1',1,JSON.stringify({data:{includePaving:true,labour:[],items:[],productionTonnesPerShift:50},totals:{totalTonnes:500,estimatedShifts:10}}),10000,7000,2000,1000,3000,500,500,0);
db.prepare('INSERT INTO cost_transactions VALUES (?,?,?,?,?,?)').run('org-a','p1','actual','labour',400,8);
async function main() {
 await actorContext.run(actor, async () => {
  // A shift link does not say whether a docket covers all, part, or separate work.
  // Reproduce overlap without imposing a new precedence/partial-coverage policy.
  field('s1','100',8);
  docket(100,'t',8,'s1');
  const overlap = await estimateVsActual('p1');
  console.log('DIAGNOSIS same-shift field 100 t/8 h + docket 100 t/8 h:', JSON.stringify({quantity:overlap.quantity.actual,hours:overlap.labourHours.actual,accrued:(await projectFinancials('p1')).forecast.accrued}));
  db.exec('UPDATE dockets SET quantity=40,labour_hours=3');
  const partial = await estimateVsActual('p1');
  console.log('DIAGNOSIS same-shift field 100 t/8 h + docket 40 t/3 h:', JSON.stringify({quantity:partial.quantity.actual,hours:partial.labourHours.actual}));
  db.exec('DELETE FROM dockets; DELETE FROM field_records; DELETE FROM shifts;');

  docket(12,'item',3);
  docket(80,'m²',5);
  let result = await estimateVsActual('p1');
  console.log('DIAGNOSIS 12 items + 80 square metres:', JSON.stringify(result.quantity));
  assert.equal(result.quantity.actual,null,'non-mass quantities must not be labelled tonnes');
  assert.equal(result.labourHours.actual,8,'unit filtering must not discard labour hours');
  assert.equal(result.docketsCounted,2,'unit filtering must not discard docket counts');
  const money = await projectFinancials('p1');

  docket(10,'t'); docket(2,' T ','1'); docket(3,'tonne',2,undefined,'included_claim'); docket(4,'tonnes',3,undefined,'invoiced');
  for (const unit of ['m2','m3','item','kg','ton','unknown','',null]) docket(999,unit);
  docket(999,'t',999,undefined,'review');
  docket(999,'t',999,undefined,'approved','org-b');
  docket(999,'t',999,undefined,'approved','org-a','other-project');
  field('uncovered','25',4); field('draft','999',999,'Draft'); field('other-org','999',999,'Submitted','org-b');
  result = await estimateVsActual('p1');
  assert.equal(result.quantity.actual,44,'only explicit tonne units plus submitted field tonnes');
  assert.equal(result.quantity.estimated,500); assert.equal(result.quantity.unit,'t');
  assert.equal(result.labourHours.actual,18); assert.equal(result.fieldRecordsCounted,1);
  assert.equal(result.docketsCounted,14);
  assert.deepEqual(result.cost,{estimated:7000,actual:400,forecastFinal:7000});
  assert.equal(money.forecast.actual,400);
  const before = await projectFinancials('p1');
  assert.equal(before.forecast.accrued,2300);
  db.exec("UPDATE dockets SET quantity_unit='m2'");
  assert.deepEqual(await projectFinancials('p1'),before,'quantity units must not change financial calculations');
  result = await estimateVsActual('p1'); assert.equal(result.quantity.actual,25,'an unrelated non-tonne docket must not suppress field production');
  const response = await route.GET(new Request('https://test.invalid/api/projects/control?id=p1'));
  assert.equal(response.status,200);
 });
 for (const role of ['field','read_only','scheduler']) {
  await actorContext.run({...actor,role}, async () => {
   const response = await route.GET(new Request('https://test.invalid/api/projects/control?id=p1'));
   assert.equal(response.status,403); assert.equal((await response.json()).estimateVsActual,undefined);
  });
 }
 await actorContext.run({...actor,entitlements:{core:'active',commercial:'disabled'}}, async () => {
  const response = await route.GET(new Request('https://test.invalid/api/projects/control?id=p1'));
  assert.equal(response.status,404);
 });
 db.close();
 console.log('PASS project control tonne units, status/project/tenant scope, field totals, unchanged costs and role/module guards');
}
main().catch(error => {console.error(error); db.close(); process.exitCode=1;});
