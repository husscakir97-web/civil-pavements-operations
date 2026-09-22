import {betterAuth} from 'better-auth';
import {drizzleAdapter} from 'better-auth/adapters/drizzle';
import {drizzle} from 'drizzle-orm/mysql2';
import * as schema from '@/db/auth-schema';
import {getPool,database} from './database';
import {sendEmail} from './email';
let auth:ReturnType<typeof createAuth>|undefined;
function createAuth(){
 if(!process.env.BETTER_AUTH_SECRET||process.env.BETTER_AUTH_SECRET.length<32)throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters');
 if(!process.env.BETTER_AUTH_URL)throw new Error('Missing BETTER_AUTH_URL');
 return betterAuth({appName:'Civil & Pavements Operations',baseURL:process.env.BETTER_AUTH_URL,secret:process.env.BETTER_AUTH_SECRET,
 database:drizzleAdapter(drizzle(getPool(),{schema,mode:'default'}),{provider:'mysql',schema}),
 advanced:{database:{generateId:'uuid'}},
 emailAndPassword:{enabled:true,requireEmailVerification:true,minPasswordLength:12,sendResetPassword:async({user,url})=>sendEmail(user.email,'Reset your password',`Reset your password: ${url}`)},
 emailVerification:{sendOnSignUp:true,autoSignInAfterVerification:true,sendVerificationEmail:async({user,url})=>sendEmail(user.email,'Verify your email',`Verify your email address: ${url}`)},
 session:{expiresIn:60*60*24*7,updateAge:60*60*24,cookieCache:{enabled:false}},
 databaseHooks:{user:{create:{after:async(user)=>{
  const org=crypto.randomUUID(),now=new Date().toISOString();
  await database.batch([
   database.prepare('INSERT INTO organisations (id,name,created_at) VALUES (?,?,?)').bind(org,`${user.name}'s organisation`,now),
   database.prepare('INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)').bind(user.id,org,user.email,user.name,'admin',now)
  ]);
 }}}}
 });
}
export function getAuth(){return auth??=createAuth();}
