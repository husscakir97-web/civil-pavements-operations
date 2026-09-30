// Business unit / division backfill (migration 0023). The statements live once, in the migration file
// after the "-- BACKFILL" marker, so the migration and this re-runnable script cannot drift.
// Deterministic (default division id = bu_default_<organisation id>) and idempotent: reruns change nothing.
import {readFile} from 'node:fs/promises';
export const BUSINESS_UNIT_MIGRATION='0023_business_units';
export async function backfillStatements(){
 const sql=(await readFile(new URL('../migrations/mysql/'+BUSINESS_UNIT_MIGRATION+'.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const chunks=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
 const start=chunks.findIndex(c=>c.startsWith('-- BACKFILL'));
 if(start<0)throw new Error('BACKFILL marker missing from '+BUSINESS_UNIT_MIGRATION);
 return chunks.slice(start);
}
/** `db` is any mysql2 promise connection/pool. Returns rows changed per statement. */
export async function backfillBusinessUnits(db){
 const changed=[];
 for(const statement of await backfillStatements()){const [r]=await db.query(statement);changed.push(Number(r.affectedRows||0));}
 return changed;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const {connect}=await import('./mysql-config.mjs');const db=await connect();
 try{console.log('business unit backfill changed rows per statement:',(await backfillBusinessUnits(db)).join(', '));}finally{await db.end();}
}
