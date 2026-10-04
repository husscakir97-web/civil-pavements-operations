// Staging demonstration mode. OFF unless STAGING_DEMO_MODE=true, and then it can only make the app MORE restrictive:
//  - it fails closed (authentication refuses to start) unless the environment is exactly the allow-listed one: the database and public URL
//    must equal the values the operator typed into STAGING_DEMO_DATABASE / STAGING_DEMO_URL, the database must not be a production one,
//    and every external integration must be unconfigured (email, SMS, billing, AI, ABR, Google Maps, object storage);
//  - public sign-up is closed: only the one allow-listed administrator email may register, and only while the database has no users.
// The database NAME is never treated as proof of safety. Nothing here weakens any other guard.
export const KNOWN_PRODUCTION_DATABASES=['u840559204_infrastruct'];
type Env=Record<string,string|undefined>;
const truthy=(v?:string)=>String(v||'').trim().toLowerCase()==='true';
export const stagingActive=(env:Env=process.env)=>truthy(env.STAGING_DEMO_MODE);

/** Everything wrong with the staging configuration; empty means safe to run. */
export function stagingProblems(env:Env=process.env):string[]{
 const p:string[]=[];
 const need=(ok:boolean,why:string)=>{if(!ok)p.push(why);};
 const db=env.MYSQL_DATABASE||'';
 need(Boolean(env.STAGING_DEMO_DATABASE)&&env.STAGING_DEMO_DATABASE===db,'STAGING_DEMO_DATABASE must be set and equal MYSQL_DATABASE (the allow-listed database)');
 need(Boolean(env.STAGING_DEMO_URL)&&env.STAGING_DEMO_URL===env.BETTER_AUTH_URL,'STAGING_DEMO_URL must be set and equal BETTER_AUTH_URL (the allow-listed public address)');
 need(Boolean(db)&&![...KNOWN_PRODUCTION_DATABASES,...String(env.STAGING_REFUSE_DATABASES||'').split(',').map(s=>s.trim()).filter(Boolean)].includes(db),'MYSQL_DATABASE is a production database');
 need(Boolean(env.STAGING_DEMO_ADMIN_EMAIL&&/^[^@\s]+@[^@\s]+$/.test(env.STAGING_DEMO_ADMIN_EMAIL)),'STAGING_DEMO_ADMIN_EMAIL (the only account that may register) must be set');
 need(!truthy(env.EMAIL_ENABLED),'EMAIL_ENABLED must be false');
 need(!truthy(env.AI_ENABLED),'AI_ENABLED must be false');
 need(['fake','none'].includes(String(env.LOCATION_PROVIDER||'').toLowerCase()),'LOCATION_PROVIDER must be fake or none (no map provider)');
 for(const name of ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','MAIL_FROM','BILLING_PROVIDER','BILLING_WEBHOOK_SECRET','ABR_GUID','AI_API_KEY','OPENAI_API_KEY','TWILIO_AUTH_TOKEN','SMS_PROVIDER','GOOGLE_MAPS_BROWSER_KEY','GOOGLE_MAPS_SERVER_KEY','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','PLATFORM_OPERATOR_EMAILS'])
  need(!env[name],`${name} is set: external integrations must be unconfigured in staging`);
 return p;
}
/** Throws (so authentication cannot start) when staging mode is on but the environment is not exactly the allow-listed one. */
export function assertStagingSafe(env:Env=process.env){
 if(!stagingActive(env))return;
 const p=stagingProblems(env);
 if(p.length)throw new Error('Staging demonstration mode refused to start:\n - '+p.join('\n - '));
}
/** Sign-up rule in staging: only the allow-listed administrator, and only while no user exists. Outside staging everything is allowed (unchanged). */
export function stagingSignupDecision(email:string,existingUsers:number,env:Env=process.env):{allowed:boolean;reason?:string}{
 if(!stagingActive(env))return {allowed:true};
 if(existingUsers>0)return {allowed:false,reason:'Sign-up is closed on this demonstration environment.'};
 if(String(email||'').trim().toLowerCase()!==String(env.STAGING_DEMO_ADMIN_EMAIL||'').trim().toLowerCase())return {allowed:false,reason:'This email is not allowed to register on this demonstration environment.'};
 return {allowed:true};
}
