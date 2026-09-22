import {getPool} from './database';
import {seedDemo} from './demo';

export async function provisionOrganisation(user:{id:string;name:string;email:string}){
 const db=await getPool().getConnection();
 const lockName='civil_first_account_'+process.env.MYSQL_DATABASE?.slice(0,40);
 try{
  const [rows]=await db.query('SELECT GET_LOCK(?,30) AS acquired',[lockName]);
  if(!(rows as Array<{acquired:number}>)[0].acquired)throw new Error('Account setup is busy; please retry');
  await db.beginTransaction();
  const [members]=await db.query('SELECT id FROM users LIMIT 1');
  const first=(members as unknown[]).length===0;
  const org=crypto.randomUUID(),now=new Date().toISOString();
  await db.execute('INSERT INTO organisations (id,name,created_at) VALUES (?,?,?)',[org,`${user.name}\'s organisation`,now]);
  await db.execute('INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)',[user.id,org,user.email,user.name,'admin',now]);
  if(first&&process.env.SEED_DEMO_DATA==='true')await seedDemo(db,org,now);
  await db.commit();
 }catch(error){await db.rollback();throw error;}
 finally{await db.execute('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});db.release();}
}
