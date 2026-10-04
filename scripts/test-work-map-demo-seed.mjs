// Checks the DEMO fixture is safe and repeatable (test databases only). The app must be running against the database.
//   MYSQL_DATABASE=<x>_test BETTER_AUTH_URL=http://localhost:3190 node scripts/test-work-map-demo-seed.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {connect} from './mysql-config.mjs';
import {seedWorkMapDemo,DEMO_AREAS,DEMO_PROJECT} from './seed-work-map-demo.mjs';
let n=0;const pass=m=>{n++;console.log('PASS',m);};
// Refusals: never touch a non-test database, a remote host or a non-local app URL.
const run=env=>spawnSync(process.execPath,['scripts/seed-work-map-demo.mjs'],{env:{...process.env,...env},encoding:'utf8'});
let r=run({MYSQL_DATABASE:'infrastruct'});assert.notEqual(r.status,0);assert.match(r.stderr,/_test/);pass('refuses a database whose name does not end in _test');
r=run({MYSQL_HOST:'db.example.com'});assert.notEqual(r.status,0);assert.match(r.stderr,/host must be local/);pass('refuses a non-local database host');
r=run({BETTER_AUTH_URL:'https://app.example.com'});assert.notEqual(r.status,0);assert.match(r.stderr,/local http address/);pass('refuses a non-local app URL');
const db=await connect();
const count=async()=>{const [[a]]=await db.query("SELECT COUNT(*) n FROM project_work_areas WHERE id LIKE 'demo-workmap-%'");const [[p]]=await db.query('SELECT COUNT(*) n FROM jobs WHERE name=?',[DEMO_PROJECT]);const [[u]]=await db.query("SELECT COUNT(*) n FROM users WHERE email='demo-workmap@example.invalid'");const [[l]]=await db.query("SELECT COUNT(*) n FROM audit_log WHERE id LIKE 'demo-workmap-audit-%'");return [a.n,p.n,u.n,l.n].map(Number);};
const quiet={log:()=>{}};
await seedWorkMapDemo(quiet);const first=await count();
assert.deepEqual(first,[DEMO_AREAS.length,1,1,DEMO_AREAS.length]);pass(`first run: ${DEMO_AREAS.length} areas, 1 project, 1 user, audit rows`);
await seedWorkMapDemo(quiet);await seedWorkMapDemo(quiet);assert.deepEqual(await count(),first);pass('repeated runs create nothing new');
const [[row]]=await db.query("SELECT id FROM project_work_areas WHERE id='demo-workmap-compound'");
await db.query("UPDATE project_work_areas SET name='DEMO – Compound (edited by a user)',revision=5 WHERE id=?",[row.id]);
await seedWorkMapDemo(quiet);const [[kept]]=await db.query("SELECT name,revision FROM project_work_areas WHERE id='demo-workmap-compound'");
assert.equal(kept.name,'DEMO – Compound (edited by a user)');assert.equal(Number(kept.revision),5);pass('a normal re-run leaves user edits alone');
await seedWorkMapDemo({...quiet,reset:true});const [[back]]=await db.query("SELECT name,revision FROM project_work_areas WHERE id='demo-workmap-compound'");
assert.equal(back.name,DEMO_AREAS.find(a=>a.slug==='compound').name);assert.equal(Number(back.revision),6);pass('--reset restores the original and bumps the revision');
const [rows]=await db.query("SELECT name,discipline,delivery,status FROM project_work_areas WHERE id LIKE 'demo-workmap-%'");
assert.ok(rows.every(x=>/^DEMO\b/.test(x.name)));pass('every demo area is labelled DEMO');
assert.deepEqual([...new Set(rows.map(x=>x.discipline))].sort(),['asphalt','other','stabilisation','traffic_management']);assert.ok(rows.some(x=>x.delivery==='subcontracted'&&x.discipline==='traffic_management'));assert.ok(rows.some(x=>x.status==='archived'));pass('covers asphalt, stabilisation, subcontracted traffic management and an archived area');
await db.end();console.log(`\n${n} passed, 0 failed`);
