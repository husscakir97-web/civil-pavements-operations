// Provider-independent logic tests for the project work map: geometry validation, bounds, projection round-trip,
// and the service/route contract (guards are asserted statically). No database or network.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=id=>id.startsWith('@/')?load(id.replace('@/','')+'.ts'):id.startsWith('./')?load(path.join(path.dirname(file),id)+'.ts'):require(id);
 new Function('exports','require','module',code)(m.exports,req,m);return m.exports;}
const w=load('lib/v1/work-areas.ts');
const o={lat:-33.8688,lng:151.2093};
const sq=(m,off={x:0,y:0})=>[[0,0],[m,0],[m,m],[0,m]].map(([x,y])=>w.fromLocal({x:x+off.x,y:y+off.y},o));
let n=0;const t=(name,fn)=>{fn();n++;console.log('PASS',name);};

t('valid square: open ring, area, bbox, centroid',()=>{const r=w.validateRing(sq(50));assert.ok(r.ok);assert.equal(r.ring.length,4);assert.ok(Math.abs(r.areaM2-2500)<5,String(r.areaM2));assert.ok(r.bbox.minLat<r.bbox.maxLat);assert.ok(Math.abs(r.centroid.lat-w.fromLocal({x:25,y:25},o).lat)<2e-6);});
t('closing duplicate vertex is accepted and removed',()=>{const s=sq(30);const r=w.validateRing([...s,s[0]]);assert.ok(r.ok);assert.equal(r.ring.length,4);});
t('winding order does not matter',()=>assert.ok(w.validateRing([...sq(30)].reverse()).ok));
t('rounds to 7 decimal places',()=>{const r=w.validateRing(sq(30).map(p=>({lat:p.lat+1e-9,lng:p.lng})));assert.ok(r.ok);for(const p of r.ring)assert.equal(p.lat,Math.round(p.lat*1e7)/1e7);});
for(const [name,input,re] of [
 ['not an array','x',/list of points/],['null',null,/list of points/],['two points',sq(30).slice(0,2),/at least 3/],['empty',[],/at least 3/],
 ['NaN lat',[{lat:NaN,lng:1},{lat:1,lng:1},{lat:1,lng:2}],/valid latitude/],['lat out of range',[{lat:91,lng:1},{lat:1,lng:1},{lat:1,lng:2}],/valid latitude/],['lng out of range',[{lat:1,lng:181},{lat:1,lng:1},{lat:1,lng:2}],/valid latitude/],
 ['string coordinates',[{lat:'1',lng:'2'},{lat:1,lng:1},{lat:1,lng:2}],/valid latitude/],['null island',[{lat:0,lng:0},{lat:1,lng:1},{lat:1,lng:2}],/valid latitude/],['missing field',[{lat:1},{lat:1,lng:1},{lat:1,lng:2}],/valid latitude/],
 ['collinear (no area)',[0,10,20].map(x=>w.fromLocal({x,y:0},o)),/no area|too small|folds back/],
 ['bow-tie self-intersection',[[0,0],[40,40],[40,0],[0,40]].map(([x,y])=>w.fromLocal({x,y},o)),/crosses itself/],
 ['duplicate non-adjacent vertex',(()=>{const a=sq(30);return [a[0],a[1],a[2],a[1],a[3]];})(),/repeats a point/],
 ['fold-back spike',[[0,0],[40,0],[20,0],[20,30]].map(([x,y])=>w.fromLocal({x,y},o)),/folds back|crosses itself|repeats/],
 ['tiny (under 1 m²)',sq(0.5),/too small/],
 ['too large span',sq(11000),/too large/],
 ['too large area',sq(9000),/too large/],
 ['too many points',Array.from({length:101},(_,i)=>w.fromLocal({x:30*Math.cos(i/101*Math.PI*2),y:30*Math.sin(i/101*Math.PI*2)},o)),/too many/],
]){t('rejects '+name,()=>{const r=w.validateRing(input);assert.equal(r.ok,false,JSON.stringify(r).slice(0,100));assert.match(r.error,re);});}
t('accepts the maximum vertex count (100) on a circle',()=>{const r=w.validateRing(Array.from({length:100},(_,i)=>w.fromLocal({x:80*Math.cos(i/100*Math.PI*2),y:80*Math.sin(i/100*Math.PI*2)},o)));assert.ok(r.ok,r.error);assert.equal(r.ring.length,100);});
t('concave L-shape is valid',()=>{const r=w.validateRing([[0,0],[60,0],[60,20],[20,20],[20,60],[0,60]].map(([x,y])=>w.fromLocal({x,y},o)));assert.ok(r.ok,r.error);assert.ok(Math.abs(r.areaM2-2000)<10);});
t('projection round-trips within 1 cm',()=>{const p={lat:-33.87,lng:151.21},q=w.fromLocal(w.toLocal(p,o),o);assert.ok(Math.abs(q.lat-p.lat)<1e-9&&Math.abs(q.lng-p.lng)<1e-9);});
t('limits are bounded',()=>{assert.ok(w.WORK_AREA_LIMITS.maxVertices<=200&&w.WORK_AREA_LIMITS.maxSpanMetres<=10000&&w.WORK_AREA_LIMITS.maxActivePerProject<=200);});
t('DEMO marker',()=>{assert.ok(w.isDemoName('DEMO – Asphalt'));assert.ok(!w.isDemoName('Asphalt DEMO'));});

// Static contract checks on the server code (guards that cannot be bypassed by a client).
const route=fs.readFileSync('app/api/projects/work-areas/route.ts','utf8'),svc=fs.readFileSync('lib/modules/projects/work-areas.ts','utf8');
t('route: every handler is wrapped by api() with module+capability',()=>{assert.equal((route.match(/api\(\{permission:/g)||[]).length,3);assert.equal((route.match(/module:'projects'/g)||[]).length,3);assert.match(route,/GET=api\(\{permission:'read',module:'projects',capability:'project.view'/);assert.match(route,/POST=api\(\{permission:'write',module:'projects',capability:'project.edit'/);assert.match(route,/PATCH=api\(\{permission:'write',module:'projects',capability:'project.edit'/);});
t('service: scoped by organisation, project access, closed rule, revision, audit',()=>{assert.match(svc,/loadProject\(/);assert.match(svc,/stageOf\(p\)==='closed'/);assert.match(svc,/revision=\?/);assert.match(svc,/workmap\.area_created/);assert.match(svc,/workmap\.area_updated|workmap\.area_archived/);assert.ok(!/DELETE FROM project_work_areas/.test(svc),'areas are archived, never deleted');for(const line of svc.split('\n').filter(l=>/(FROM|UPDATE|INTO) project_work_areas/.test(l)))assert.match(line,/organisation_id/,line.slice(0,80));});
t('service: strict input schemas and one geometry gate',()=>{assert.equal((svc.match(/\)\.strict\(\)/g)||[]).length,2,'create and update schemas are strict');assert.match(svc,/function geometry\(/);assert.equal((svc.match(/geometry\(input\.ring\)/g)||[]).length,2,'both write paths validate through validateRing');assert.ok(!/INSERT INTO project_work_areas[^\n]*\$\{/.test(svc),'no interpolated SQL');});
t('service: no cross-module imports',()=>{assert.ok(!/from '@\/lib\/modules\/(?!projects)/.test(svc));});
console.log(`\n${n} passed, 0 failed`);
