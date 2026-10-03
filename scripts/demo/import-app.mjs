// The importer starts its OWN application instance, so the writer is bound to the database that was verified and to a safe
// configuration by construction: the app gets exactly the importer's (already verified) MYSQL_* settings, a random auth secret,
// and every external integration switched off or pointed at nothing. It listens on a free local port only. An already-running app
// can never be used, because nothing outside this process can prove what database or integrations it is configured with.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';

const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});s.on('error',reject);});

/** Environment for the isolated app: copied database settings, nothing else from the importer's environment. */
export function isolatedAppEnv(source,base){
 const e={PATH:source.PATH||'',EMAIL_ENABLED:'false',AI_ENABLED:'false',LOCATION_PROVIDER:'fake',
  BETTER_AUTH_SECRET:randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,
  R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x'};
 for(const k of ['HOME','TZ','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL_CA'])if(source[k]!==undefined)e[k]=source[k];
 return e;
}

export async function startIsolatedApp(source=process.env){
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['scripts/demo/app-supervisor.mjs',String(port)],{env:isolatedAppEnv(source,base),stdio:'ignore'});
 let dead=false;child.on('exit',()=>{dead=true;});
 const stop=()=>{try{child.kill('SIGTERM');}catch{/* already gone */}};
 process.on('exit',stop);
 for(let i=0;i<180;i++){
  if(dead)throw new Error('The isolated app exited before it was ready (is the production build present? run npm run build).');
  try{if((await fetch(base+'/login')).ok)return {base,stop};}catch{/* starting */}
  await new Promise(r=>setTimeout(r,500));
 }
 stop();throw new Error('The isolated app did not become ready in time.');
}
