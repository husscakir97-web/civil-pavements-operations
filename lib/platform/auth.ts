import {betterAuth} from 'better-auth';
import {drizzleAdapter} from 'better-auth/adapters/drizzle';
import {drizzle} from 'drizzle-orm/mysql2';
import * as schema from '@/db/auth-schema';
import {getPool} from './database';
import {sendEmail,isEmailEnabled} from './email';
import {provisionOrganisation} from './provision';
let auth:ReturnType<typeof createAuth>|undefined;
function createAuth(){
 if(!process.env.BETTER_AUTH_SECRET||process.env.BETTER_AUTH_SECRET.length<32)throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters');
 if(!process.env.BETTER_AUTH_URL)throw new Error('Missing BETTER_AUTH_URL');
 return betterAuth({appName:'Infrastruct',baseURL:process.env.BETTER_AUTH_URL,secret:process.env.BETTER_AUTH_SECRET,
 database:drizzleAdapter(drizzle(getPool(),{schema,mode:'default'}),{provider:'mysql',schema}),
 advanced:{database:{generateId:'uuid'}},
 emailAndPassword:{enabled:true,requireEmailVerification:isEmailEnabled(),minPasswordLength:12,revokeSessionsOnPasswordReset:true,sendResetPassword:async({user,url})=>sendEmail(user.email,'Reset your password',`Reset your password: ${url}`)},
 emailVerification:{sendOnSignUp:isEmailEnabled(),sendOnSignIn:isEmailEnabled(),autoSignInAfterVerification:true,sendVerificationEmail:async({user,url})=>sendEmail(user.email,'Verify your email',`Verify your email address: ${url}`)},
 session:{expiresIn:60*60*24*7,updateAge:60*60*24,cookieCache:{enabled:false}},
 databaseHooks:{user:{create:{after:provisionOrganisation}}}
 });
}
export function getAuth(){return auth??=createAuth();}
