// Preloaded (node --import) into the private app ONLY when the importer reaches it over a unix socket (scripts/demo/app-supervisor.mjs, PRIVATE_APP_SOCKET).
// The standalone server calls server.listen(PORT, HOSTNAME) once; that single call is redirected to the unix socket path instead. Nothing else is changed: any
// other listen call, and every call when PRIVATE_APP_SOCKET is not set, behaves exactly as in node. The socket is created owner-only (umask 077, then chmod 600)
// inside a 0700 directory the importer made, so no other local user can reach the private app.
import net from 'node:net';
import {chmodSync} from 'node:fs';

const socket=process.env.PRIVATE_APP_SOCKET,port=Number(process.env.PORT);
if(socket&&Number.isInteger(port)){
 process.umask(0o077);
 const original=net.Server.prototype.listen;let redirected=false;
 net.Server.prototype.listen=function(...args){
  if(!redirected&&typeof args[0]==='number'&&args[0]===port){
   redirected=true;
   const callback=args.find(a=>typeof a==='function');
   if(callback)this.once('listening',callback);
   this.once('listening',()=>{try{chmodSync(socket,0o600);}catch{/* the directory is 0700 anyway */}});
   return original.call(this,socket);
  }
  return original.apply(this,args);
 };
}
