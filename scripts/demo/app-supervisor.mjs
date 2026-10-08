// Runs the standalone server (or source-checkout `next start`) on 127.0.0.1:<port> -- or, when the importer passes a unix socket path as the second argument, on that
// socket (private-socket-preload.mjs redirects the server's single listen call) -- and makes sure it never outlives the importer (including when it is killed
// outright): it polls the parent and stops the app when the parent is gone.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,isAbsolute,dirname,basename} from 'node:path';
import {rmSync} from 'node:fs';
import {isolatedAppEnv} from './import-app.mjs';
const port=process.argv[2];
if(!/^\d+$/.test(port||'')||Number(port)<1||Number(port)>65535)throw new Error('Invalid isolated app port');
const socket=process.argv[3];
if(socket!==undefined){   // the importer's own private directory only: absolute, short enough for sun_path, <tmp>/private-app-*/app.sock
 if(!isAbsolute(socket)||socket.includes('\0')||socket.length>100||basename(socket)!=='app.sock'||!/^private-app-/.test(basename(dirname(socket))))throw new Error('Invalid isolated app socket path');
}
const parent=process.ppid;
// A packaged deployment has server.js at its root; a source checkout may hold
// .next/standalone/server.js. Neither path uses next start for standalone output.
const server=['server.js','.next/standalone/server.js'].map(p=>resolve(p)).find(p=>existsSync(p));
const env={...isolatedAppEnv(process.env,`http://127.0.0.1:${port}`),PORT:String(port),HOSTNAME:'127.0.0.1',...(socket?{PRIVATE_APP_SOCKET:socket}:{})};
const args=server?[server]:['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'];
// The server's own output is forwarded to this process's stdout/stderr (the importer captures both, bounded and redacted); supervisor events are tagged.
const note=m=>{try{process.stderr.write('[supervisor] '+m+'\n');}catch{/* closed */}};
note(`starting ${server?server.split(/[\\/]/).slice(-2).join('/'):'next start'} ${socket?'on a unix socket (app.sock)':'on 127.0.0.1:'+port}`);
const preload=socket?['--import',new URL('./private-socket-preload.mjs',import.meta.url).href]:[];
const child=spawn(process.execPath,[...preload,...args],{stdio:['ignore','pipe','pipe'],env});
child.stdout.on('data',c=>{try{process.stdout.write(c);}catch{/* closed */}});child.stderr.on('data',c=>{try{process.stderr.write(c);}catch{/* closed */}});
const cleanup=()=>{if(socket)try{rmSync(dirname(socket),{recursive:true,force:true});}catch{/* best effort */}};
const stop=()=>{try{child.kill('SIGTERM');}catch{/* already gone */}cleanup();process.exit(0);};
setInterval(()=>{try{process.kill(parent,0);}catch{stop();}},500).unref?.();
child.on('exit',(code,signal)=>{note(`server exited code=${code} signal=${signal}`);cleanup();setTimeout(()=>process.exit(0),100);});
child.on('error',e=>{note('server failed to start: '+String(e&&e.code||'error'));setTimeout(()=>process.exit(1),100);});
process.on('SIGTERM',stop);process.on('SIGINT',stop);
