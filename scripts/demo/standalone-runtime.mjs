// Shared identity check for the two opt-in runtime hooks (state probe, existing-tenant loader). It must hold under ANY launcher: Hostinger starts the generated
// standalone server through its own process manager, so process.argv[1] is not server.js and cannot be part of the proof. Instead the process must be shown to
// be the generated standalone Next *server*, by independent evidence that an operator-set variable or a build/CLI process cannot satisfy by accident:
//   1. runtime context: NODE_ENV=production, no explicit non-Node NEXT_RUNTIME, and not any Next build phase (NEXT_PHASE unset or phase-production-server);
//   2. not a child of the loader (EXISTING_TENANT_RUNTIME_PARENT_PID marks the loader's own children);
//   3. the standalone config variable is present AND byte-identical to the config literal embedded in <cwd>/server.js, which is the file that sets it
//      (the variable alone is never accepted), and that literal declares output "standalone";
//   4. <cwd> holds the standalone output: server.js, .next/BUILD_ID and .next/required-server-files.json are regular files.
// server.js changes into its own directory before Next starts, so <cwd> is the artifact root however it was launched (symlinked release directories included).
// Returns null when valid, otherwise a short reason code. It never reads or returns an environment value.
import {readFileSync,statSync} from 'node:fs';
import {join,basename} from 'node:path';

export const BUILD_PHASE='phase-production-build',SERVER_PHASE='phase-production-server';
const MAX_SERVER_JS_BYTES=2*1024*1024;
const regularFile=p=>{try{return statSync(p).isFile();}catch{return false;}};

export function standaloneRuntimeProblem(env=process.env,root=process.cwd()){
 if(env.NODE_ENV!=='production')return 'not-production';
 // NEXT_RUNTIME is a compile-time constant inside Next's bundles (instrumentation.ts is gated on it there); the live process environment does NOT carry it.
 // So only an explicit non-Node value declines here; unset is the normal case in the real server.
 if(env.NEXT_RUNTIME&&env.NEXT_RUNTIME!=='nodejs')return 'not-node-runtime';
 if(env.NEXT_PHASE&&env.NEXT_PHASE!==SERVER_PHASE)return env.NEXT_PHASE===BUILD_PHASE?'build-phase':'unexpected-next-phase';
 if(env.EXISTING_TENANT_RUNTIME_PARENT_PID)return 'loader-child-process';
 const cfg=env.__NEXT_PRIVATE_STANDALONE_CONFIG;
 if(!cfg)return 'standalone-config-missing';
 const server=join(root,'server.js');
 if(!regularFile(server)||!regularFile(join(root,'.next','BUILD_ID'))||!regularFile(join(root,'.next','required-server-files.json')))return 'standalone-files-missing';
 let text;
 try{if(statSync(server).size>MAX_SERVER_JS_BYTES)return 'server-js-unrecognised';text=readFileSync(server,'utf8');}catch{return 'server-js-unreadable';}
 const m=text.match(/^const nextConfig = (\{.*\})\r?$/m);
 if(!m||!text.includes('process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)'))return 'server-js-unrecognised';
 let literal,parsed;
 try{parsed=JSON.parse(m[1]);literal=JSON.stringify(parsed);}catch{return 'server-js-unrecognised';}
 if(parsed.output!=='standalone')return 'not-standalone-output';
 if(literal!==cfg)return 'standalone-config-mismatch';
 return null;
}
/** Concise, private skip line: a reason code and the launcher's file name only; never an environment value or a full path. */
export const skipNote=(label,reason,argv=process.argv)=>`${label} skipped: reason=${reason} launcher=${basename(String(argv[1]||'')).slice(0,60)||'unknown'}`;
