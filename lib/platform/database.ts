import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
let pool: Pool | undefined;
export function getPool() {
  if (!pool) {
    for (const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD']) if (!process.env[key]) throw new Error(`Missing ${key}`);
    pool = mysql.createPool({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT || 3306),database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,charset:'utf8mb4',connectionLimit:5,decimalNumbers:true,ssl:process.env.MYSQL_SSL_CA?{ca:process.env.MYSQL_SSL_CA,rejectUnauthorized:true}:undefined});
  }
  return pool;
}
export type QueryResult<T=Record<string,unknown>> = {results:T[];success:boolean;meta:{changes:number}};
export class Statement {
  constructor(readonly query:string, readonly values:unknown[]=[]) {}
  bind(...values:unknown[]) { return new Statement(this.query,values); }
  async execute<T=Record<string,unknown>>(connection:Pool|PoolConnection=getPool()):Promise<QueryResult<T>> {
    const [result] = await connection.execute(this.query,this.values.map(value=>{if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value instanceof Date||Buffer.isBuffer(value))return value;throw new Error('Unsupported SQL parameter');}));
    return {results:Array.isArray(result)?result as T[]:[],success:true,meta:{changes:Array.isArray(result)?0:Number((result as ResultSetHeader).affectedRows)}};
  }
  async all<T=Record<string,unknown>>() {return this.execute<T>();}
  async first<T=Record<string,unknown>>(column?:string):Promise<T|null> {const r=(await this.execute<RowDataPacket>()).results[0];return r?(column?r[column]:r) as T:null;}
  async run() {return this.execute();}
}
export class Database {
  prepare(query:string) {return new Statement(query);}
  async batch<T=Record<string,unknown>>(statements:Statement[]):Promise<QueryResult<T>[]> {
    const conn=await getPool().getConnection();
    try {await conn.beginTransaction();const out=[];for(const statement of statements)out.push(await statement.execute<T>(conn));await conn.commit();return out;}
    catch(error){await conn.rollback();throw error;} finally {conn.release();}
  }
}
export const database=new Database();
