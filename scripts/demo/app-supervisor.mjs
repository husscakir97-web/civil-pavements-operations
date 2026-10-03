// Runs `next start` on 127.0.0.1:<port> and makes sure it never outlives the importer that started it (including when that process is
// killed outright): it polls the parent and stops the app when the parent is gone.
import {spawn} from 'node:child_process';
const port=process.argv[2];
const parent=process.ppid;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{stdio:'ignore',env:process.env});
const stop=()=>{try{child.kill('SIGTERM');}catch{/* already gone */}process.exit(0);};
setInterval(()=>{try{process.kill(parent,0);}catch{stop();}},500).unref?.();
child.on('exit',()=>process.exit(0));
process.on('SIGTERM',stop);process.on('SIGINT',stop);
