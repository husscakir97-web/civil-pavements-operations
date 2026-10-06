// Test-only (not packaged): a minimal directory that looks like Next's generated standalone output, for guard tests that must not need a build.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const NEXT_CONFIG={output:'standalone',distDir:'./.next'};
/** Writes server.js (with the generated `const nextConfig = {...}` literal and the assignment that sets the variable), .next/BUILD_ID, required-server-files.json
 *  and, optionally, the loader script. Returns the environment the real server has at instrumentation time. */
export function standaloneFixture(root,{config=NEXT_CONFIG,loaderAssets=false}={}){
 mkdirSync(join(root,'.next'),{recursive:true});
 const literal=JSON.stringify(config);
 writeFileSync(join(root,'server.js'),`process.chdir(__dirname)\nconst nextConfig = ${literal}\n\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)\n`);
 writeFileSync(join(root,'.next','BUILD_ID'),'test');writeFileSync(join(root,'.next','required-server-files.json'),'{}');
 if(loaderAssets){mkdirSync(join(root,'scripts'),{recursive:true});writeFileSync(join(root,'scripts','existing-tenant-load.mjs'),'');}
 // NEXT_RUNTIME is deliberately absent: Next inlines it at compile time, the live process environment of the real server does not carry it.
 return {NODE_ENV:'production',__NEXT_PRIVATE_STANDALONE_CONFIG:literal};
}
