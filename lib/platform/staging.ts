// Staging demonstration policy, TypeScript copy used by the app (lib/platform/database.ts, auth). scripts/ load the plain-JS twin
// lib/platform/staging-policy.mjs (the legacy unit-test loaders and plain `node` cannot share one file); scripts/test-staging-path.mjs asserts the
// two agree over a large matrix of environments. The rest of this header describes both:
// the app pool (lib/platform/database.ts), migrate.mjs (run by `npm run build` through prebuild AND by `npm start`), the importer and
// every script that opens a connection through scripts/mysql-config.mjs. The check therefore runs before any connection is opened, i.e.
// before any migration, bootstrap write or import mutation. OFF unless STAGING_DEMO_MODE=true; then it can only be MORE restrictive.
//
// Protected targets are refused regardless of any suffix such as _test. The database NAME is never treated as proof of safety:
// the staging target must be named EXACTLY, twice (STAGING_DEMO_DATABASE, STAGING_DEMO_URL), and must not be a known live target.
export const PROTECTED_DATABASES:string[]=['u840559204_infra_test','u840559204_infrastruct'];
// Known live hosts. A bare label prefix is protected too because the repository only records the start of one name (docs/LOCATIONS.md).
export const PROTECTED_HOSTS:string[]=['darkgray-buffalo-804670.hostingersite.com'];
export const PROTECTED_HOST_PREFIXES:string[]=['darkgray-','navajowhite-'];

type Env=Record<string,string|undefined>;
const truthy=(v?:string)=>String(v||'').trim().toLowerCase()==='true';
const list=(v?:string)=>String(v||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
export const stagingActive=(env:Env=process.env)=>truthy(env.STAGING_DEMO_MODE);

export function protectedDatabase(name:string|undefined,env:Env=process.env){return [...PROTECTED_DATABASES,...list(env.STAGING_REFUSE_DATABASES)].includes(String(name||'').trim().toLowerCase());}
export function protectedUrl(url:string|undefined,env:Env=process.env){
 let host:string;try{host=new URL(String(url)).hostname.toLowerCase();}catch{return true;}   // unparseable counts as unsafe
 return PROTECTED_HOSTS.includes(host)||PROTECTED_HOST_PREFIXES.some(p=>host.startsWith(p))||list(env.STAGING_REFUSE_URLS).some((u:string)=>{try{return new URL(u).hostname.toLowerCase()===host;}catch{return u===host;}});
}

/** Everything wrong with the staging configuration; empty means safe to run. */
export function stagingProblems(env:Env=process.env):string[]{
 const p:string[]=[];const need=(ok:boolean,why:string)=>{if(!ok)p.push(why);};
 const db=env.MYSQL_DATABASE||'';
 need(Boolean(env.STAGING_DEMO_DATABASE)&&env.STAGING_DEMO_DATABASE===db,'STAGING_DEMO_DATABASE must be set and equal MYSQL_DATABASE (the allow-listed database)');
 need(!protectedDatabase(db,env)&&!protectedDatabase(env.STAGING_DEMO_DATABASE,env),'the database is a protected live database (refused regardless of any suffix such as _test)');
 need(Boolean(env.STAGING_DEMO_URL)&&env.STAGING_DEMO_URL===env.BETTER_AUTH_URL,'STAGING_DEMO_URL must be set and equal BETTER_AUTH_URL (the allow-listed public address)');
 need(!protectedUrl(env.STAGING_DEMO_URL,env)&&!protectedUrl(env.BETTER_AUTH_URL,env),'the app URL is a protected live address or is not a valid URL');
 need(/^https:\/\//.test(String(env.STAGING_DEMO_URL||''))||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(env.STAGING_DEMO_URL||'')),'STAGING_DEMO_URL must be https (or a local address)');
 need(Boolean(env.STAGING_DEMO_ADMIN_EMAIL&&/^[^@\s]+@[^@\s]+$/.test(env.STAGING_DEMO_ADMIN_EMAIL)),'STAGING_DEMO_ADMIN_EMAIL (the only account that may register) must be set');
 need(!truthy(env.EMAIL_ENABLED),'EMAIL_ENABLED must be false');
 need(!truthy(env.AI_ENABLED),'AI_ENABLED must be false');
 need(['fake','none'].includes(String(env.LOCATION_PROVIDER||'').toLowerCase()),'LOCATION_PROVIDER must be fake or none (no map provider)');
 for(const name of ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','MAIL_FROM','BILLING_PROVIDER','BILLING_WEBHOOK_SECRET','ABR_GUID','AI_API_KEY','OPENAI_API_KEY','TWILIO_AUTH_TOKEN','SMS_PROVIDER','GOOGLE_MAPS_BROWSER_KEY','GOOGLE_MAPS_SERVER_KEY','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','PLATFORM_OPERATOR_EMAILS'])
  need(!env[name],`${name} is set: external integrations must be unconfigured in staging`);
 return p;
}
/** Throws unless the environment is exactly the allow-listed staging one. No-op when staging mode is off. */
export function assertStagingSafe(env:Env=process.env):void{
 if(!stagingActive(env))return;
 const p=stagingProblems(env);
 if(p.length)throw new Error('Staging demonstration mode refused to start (nothing was connected or changed):\n - '+p.join('\n - '));
}
/** Sign-up rule in staging: only the allow-listed administrator, only while no user exists. Outside staging everything is allowed. */
export function stagingSignupDecision(email:string,existingUsers:number,env:Env=process.env):{allowed:boolean;reason?:string}{
 if(!stagingActive(env))return {allowed:true};
 if(existingUsers>0)return {allowed:false,reason:'Sign-up is closed on this demonstration environment.'};
 if(String(email||'').trim().toLowerCase()!==String(env.STAGING_DEMO_ADMIN_EMAIL||'').trim().toLowerCase())return {allowed:false,reason:'This email is not allowed to register on this demonstration environment.'};
 return {allowed:true};
}
