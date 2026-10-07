// Runs the standalone server (or source-checkout `next start`) on 127.0.0.1:<port> and makes sure it never outlives the importer (including when it is
// killed outright): it polls the parent and stops the app when the parent is gone.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {isolatedAppEnv} from './import-app.mjs';
const port=process.argv[2];
if(!/^\d+$/.test(port||'')||Number(port)<1||Number(port)>65535)throw new Error('Invalid isolated app port');
const parent=process.ppid;
// A packaged deployment has server.js at its root; a source checkout may hold
// .next/standalone/server.js. Neither path uses next start for standalone output.
const server=['server.js','.next/standalone/server.js'].map(p=>resolve(p)).find(p=>existsSync(p));
const env={...isolatedAppEnv(process.env,`http://127.0.0.1:${port}`),PORT:String(port),HOSTNAME:'127.0.0.1'};
const args=server?[server]:['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'];
// The server's own output is forwarded to this process's stdout/stderr (the importer captures both, bounded and redacted); supervisor events are tagged.
const note=m=>{try{process.stderr.write('[supervisor] '+m+'\n');}catch{/* closed */}};
note(`starting ${server?server.split(/[\\/]/).slice(-2).join('/'):'next start'} on 127.0.0.1:${port}`);
const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],env});
child.stdout.on('data',c=>{try{process.stdout.write(c);}catch{/* closed */}});child.stderr.on('data',c=>{try{process.stderr.write(c);}catch{/* closed */}});
const stop=()=>{try{child.kill('SIGTERM');}catch{/* already gone */}process.exit(0);};
setInterval(()=>{try{process.kill(parent,0);}catch{stop();}},500).unref?.();
child.on('exit',(code,signal)=>{note(`server exited code=${code} signal=${signal}`);setTimeout(()=>process.exit(0),100);});
child.on('error',e=>{note('server failed to start: '+String(e&&e.code||'error'));setTimeout(()=>process.exit(1),100);});
process.on('SIGTERM',stop);process.on('SIGINT',stop);
