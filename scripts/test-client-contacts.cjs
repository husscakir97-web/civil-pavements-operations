// Client contact input validation and lookup matching (pure logic; DB-backed
// CRUD/tenant isolation for client_contacts is exercised by npm run test:mysql,
// the same way client_sites is — see lib/platform/clients.ts).
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const clients=load('lib/platform/clients.ts'),lookup=load('lib/v1/lookup.ts');
const {contactInput}=clients,{filterLookup,matchesLookup}=lookup;

// contactInput: name and clientId are required; other fields are optional.
assert.throws(()=>contactInput.parse({clientId:'c1',name:''}),/Contact name is required/);
assert.throws(()=>contactInput.parse({clientId:'',name:'Jane'}),/Choose a client first/);
const parsed=contactInput.parse({clientId:'c1',name:' Jane Doe ',roleTitle:'Site Manager',email:'jane@example.com',phone:'0400000000'});
assert.equal(parsed.name,'Jane Doe','trims name');
assert.equal(parsed.roleTitle,'Site Manager');

// Partial update accepts a subset of fields plus status.
const partial=contactInput.partial().extend({status:require('zod').z.enum(['active','inactive']).optional()}).safeParse({name:'New name'});
assert.ok(partial.success,'partial update accepts a single field');

// Contacts are searchable the same way plant/workers are: name, role, email, phone.
const contacts=[
 {id:'1',name:'Jane Doe',roleTitle:'Site Manager',email:'jane@acme.example',phone:'0400000000',mobile:null},
 {id:'2',name:'Sam Lee',roleTitle:'Procurement',email:'sam@acme.example',phone:null,mobile:'0411111111'},
];
const f=c=>[c.name,c.roleTitle,c.email,c.phone,c.mobile];
assert.deepEqual(filterLookup(contacts,'procurement',f).map(c=>c.id),['2'],'search by role');
assert.deepEqual(filterLookup(contacts,'0400 000 000',f).map(c=>c.id),['1'],'search by phone ignoring spacing');
assert.ok(matchesLookup(f(contacts[0]),'jane doe'),'search by full name');
assert.ok(!matchesLookup(f(contacts[0]),'sam'));

console.log('PASS client contacts: validation, trimming, partial update, lookup by role/email/phone');
