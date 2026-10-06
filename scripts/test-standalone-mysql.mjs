// Reuse every existing-tenant safety/recovery assertion, but run all product
// processes from an unrelated copied standalone artifact. Only fixture setup
// (migrations) and the test driver itself use the source checkout.
import assert from 'node:assert/strict';
import {cpSync,existsSync,lstatSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

assert.notEqual(process.env.NODE_ENV,'production','Fixture wrapper refuses production mode');
assert.equal(process.platform,'linux','Recovery suite requires Linux process-group semantics');
assert.equal(process.env.MYSQL_HOST,'127.0.0.1','Only the disposable loopback MySQL service is allowed');
assert.ok(process.env.MYSQL_DATABASE?.endsWith('_test'));
const source=resolve('.next/standalone'),temp=mkdtempSync(join(tmpdir(),'standalone-mysql-')),root=join(temp,'app');
try{
 const walk=p=>{assert.ok(!lstatSync(p).isSymbolicLink(),'Artifact link: '+p);if(lstatSync(p).isDirectory())for(const name of readdirSync(p))walk(join(p,name));};
 walk(source);cpSync(source,root,{recursive:true});assert.ok(existsSync(join(root,'server.js')));
 const keys=['PATH','HOME','TZ','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'];
 const env=Object.fromEntries(keys.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
 const child=spawn(process.execPath,['scripts/test-existing-tenant-path.mjs'],{env:{...env,EXISTING_TENANT_TEST_STANDALONE_ROOT:root},stdio:'inherit'});
 const [code,signal]=await once(child,'exit');assert.equal(signal,null);assert.equal(code,0,'Copied standalone MySQL safety/recovery suite failed');
 console.log('PASS copied standalone artifact: full existing-tenant MySQL suite, concurrent runtimes and lock-owner loss');
}finally{rmSync(temp,{recursive:true,force:true});}
