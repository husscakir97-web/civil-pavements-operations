// External service doubles for the existing fast business regression suite.
// Production auth/session/SQL are also exercised against MySQL by test-mysql.mjs.
const path=require('node:path');
// Apply the V1 MySQL migrations (0003, 0004) to the SQLite double. ALTERs against legacy tables
// that a suite creates later are retried after each subsequent CREATE TABLE.
function v1(sql){
 const fs=require('node:fs');
 const statements=['0003_v1_platform.sql','0004_v1_resources_retention.sql'].flatMap(f=>fs.readFileSync(path.join(__dirname,'..','migrations','mysql',f),'utf8').split('--> statement-breakpoint')).map(s=>s.trim()).filter(s=>s&&!/ADD CONSTRAINT/.test(s));
 let pending=[];
 const exec=sql.exec.bind(sql);
 const attempt=()=>{pending=pending.filter(s=>{try{exec(s);return false;}catch(e){return !/duplicate column|already exists/.test(String(e.message));}});};
 pending=statements;attempt();
 sql.exec=text=>{const r=exec(text);if(/CREATE TABLE/i.test(text)&&pending.length)attempt();return r;};
}
exports.prepare=sql=>{
 v1(sql);
 const now=new Date().toISOString();
 for(const id of ['test-owner','admin@example.invalid'])sql.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)').run(id,'roadworx-sydney','admin@example.invalid','Test admin','admin',now);
 sql.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
 const prepare=sql.prepare.bind(sql);
 sql.prepare=query=>{
  query=query.replace(/INSERT INTO (estimates|jobs|opportunities|shifts|workers|plant) VALUES/g,'INSERT INTO $1 (id,organisation_id,name,status,metadata,created_at) VALUES').replace(/INSERT INTO users VALUES/g,'INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES').replace(/JSON_UNQUOTE\((JSON_EXTRACT\([^)]*\))\)/gi,'$1').replace(/ ON DUPLICATE KEY UPDATE id=id/g,' ON CONFLICT DO NOTHING').replace("ON DUPLICATE KEY UPDATE metadata=IF(organisation_id=VALUES(organisation_id) AND status='workspace-settings',VALUES(metadata),metadata)","ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata WHERE attachments.organisation_id=excluded.organisation_id AND attachments.status='workspace-settings'");
  return prepare(query);
 };
};
exports.mock=(file,db,sql,bucket)=>{
 const end=name=>file.endsWith(path.join('lib','platform',name+'.ts'));
 if(end('database'))return {database:db};
 if(end('runtime'))return {env:{DB:db,BUCKET:bucket}};
 if(end('auth'))return {getAuth:()=>({api:{getSession:async({headers})=>{const id=headers.get('x-test-user-id'),email=headers.get('x-test-user-email');return id&&email?{user:{id,email}}:null;}}})};
};
