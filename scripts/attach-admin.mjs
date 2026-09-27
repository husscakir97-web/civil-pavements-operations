import {connect,required} from './mysql-config.mjs';
const userId=required('MIGRATION_ADMIN_USER_ID'),orgId=required('MIGRATION_ORGANISATION_ID');
const db=await connect();
try{
 await db.beginTransaction();
 const [users]=await db.execute('SELECT id,email,email_verified FROM auth_user WHERE id=? FOR UPDATE',[userId]);
 if(!users[0]?.email_verified)throw new Error('Target must be an existing email-verified Better Auth account');
 const [orgs]=await db.execute('SELECT id FROM organisations WHERE id=? FOR UPDATE',[orgId]);if(!orgs.length)throw new Error('Imported organisation not found');
 const [claimed]=await db.execute("SELECT id FROM audit_events WHERE organisation_id=? AND name='migration.admin.attached'",[orgId]);if(claimed.length)throw new Error('Organisation already claimed. Use normal membership administration.');
 const [updated]=await db.execute("UPDATE users SET organisation_id=?,role='admin' WHERE id=?",[orgId,userId]);if(updated.affectedRows!==1)throw new Error('Target account membership was not created successfully');
 await db.execute('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),orgId,'migration.admin.attached','recorded',JSON.stringify({userId,email:users[0].email}),new Date().toISOString()]);
 await db.commit();console.log('Existing organisation attached to verified account',userId);
}catch(e){await db.rollback();throw e;}finally{await db.end();}
