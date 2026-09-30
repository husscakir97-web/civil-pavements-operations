import {getPool} from './database';
import {seedDemo} from './demo';
import {provisionTrial} from './entitlements';

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
  // Every new organisation gets the beta full-access trial and an empty profile
  // that drives onboarding. No customer values are copied from other tenants.
  await provisionTrial(org,db);
  // Every organisation starts with one default division so single-division companies never need to think about divisions.
  await db.execute("INSERT INTO business_units (id,organisation_id,name,code,description,status,is_default,sort_order,revision,created_at,updated_at) VALUES (?,?,'General','GEN','Default division. Rename it or add more divisions in Admin.','active',1,0,1,?,?) ON DUPLICATE KEY UPDATE id=id",[`bu_default_${org}`,org,now,now]);
  await db.execute('INSERT INTO organisation_profiles (organisation_id,onboarding_step,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)',[org,0,1,user.id,now,now]);
  if(first&&process.env.SEED_DEMO_DATA==='true')await seedDemo(db,org,now);
  await db.commit();
 }catch(error){await db.rollback();throw error;}
 finally{await db.execute('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});db.release();}
}
