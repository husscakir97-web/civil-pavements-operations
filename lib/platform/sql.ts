// Thin mysql2 helpers for typed V1 tables. Uses client-side placeholder
// escaping (conn.query) so `IN (?)` accepts arrays. Never interpolate input.
import type {Pool,PoolConnection,ResultSetHeader} from 'mysql2/promise';
import {getPool} from './database';
export type Conn=Pool|PoolConnection;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row=Record<string,any>;
const clean=(params:unknown[])=>params.map(v=>v===undefined?null:v);
export async function query<T=Row>(sql:string,params:unknown[]=[],conn:Conn=getPool()):Promise<T[]>{const [rows]=await conn.query(sql,clean(params));return rows as T[];}
export async function one<T=Row>(sql:string,params:unknown[]=[],conn:Conn=getPool()):Promise<T|null>{return (await query<T>(sql,params,conn))[0]??null;}
export async function exec(sql:string,params:unknown[]=[],conn:Conn=getPool()):Promise<number>{const [r]=await conn.query(sql,clean(params));return Number((r as ResultSetHeader).affectedRows||0);}
/** Runs fn inside a transaction; rolls back on any thrown error. */
export async function tx<T>(fn:(c:PoolConnection)=>Promise<T>):Promise<T>{
 const c=await getPool().getConnection();
 try{await c.beginTransaction();const out=await fn(c);await c.commit();return out;}
 catch(e){await c.rollback().catch(()=>{});throw e;}
 finally{c.release();}
}
export const nowIso=()=>new Date().toISOString();
export const uuid=()=>crypto.randomUUID();
export const round2=(n:unknown)=>Math.round((Number(n)||0)*100)/100;
