// After an import has stopped (finished, failed, hit its deadline or was killed) make sure NO database session of this user is still executing
// anything in this database — an in-flight statement or transaction of an importer that died can keep running on the server for a while. Any
// such session is killed (its open transaction rolls back) and the result is reported. Sleeping sessions (idle pools) are left alone.
// Only valid while the app is in maintenance, when the only active sessions are the importer's.
export async function quiesce(db,{timeoutMs=20000,pollMs=250}={}){
 let killed=0;const t0=Date.now();
 const active=async()=>(await db.query("SELECT ID id FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND DB=DATABASE() AND USER=SUBSTRING_INDEX(USER(),'@',1) AND COMMAND<>'Sleep'"))[0];
 for(;;){
  const rows=await active();
  if(!rows.length)return {killed,remaining:0,ms:Date.now()-t0};
  for(const r of rows){try{await db.query('KILL '+Number(r.id));killed++;}catch{/* already gone */}}
  if(Date.now()-t0>timeoutMs)return {killed,remaining:(await active()).length,ms:Date.now()-t0};
  await new Promise(r=>setTimeout(r,pollMs));
 }
}
