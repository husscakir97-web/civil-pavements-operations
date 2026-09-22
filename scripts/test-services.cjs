// External service doubles for the existing fast business regression suite.
// Production auth/session/SQL are also exercised against MySQL by test-mysql.mjs.
const path=require('node:path');
exports.prepare=sql=>{
 const now=new Date().toISOString();
 for(const id of ['test-owner','admin@example.invalid'])sql.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)').run(id,'roadworx-sydney','admin@example.invalid','Test admin','admin',now);
 const prepare=sql.prepare.bind(sql);
 sql.prepare=query=>{
  query=query.replace(/JSON_UNQUOTE\((JSON_EXTRACT\([^)]*\))\)/gi,'$1').replace(/ ON DUPLICATE KEY UPDATE id=id/g,' ON CONFLICT DO NOTHING').replace("ON DUPLICATE KEY UPDATE metadata=IF(organisation_id=VALUES(organisation_id) AND status='workspace-settings',VALUES(metadata),metadata)","ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata WHERE attachments.organisation_id=excluded.organisation_id AND attachments.status='workspace-settings'");
  return prepare(query);
 };
};
exports.mock=(file,db,sql,bucket)=>{
 const end=name=>file.endsWith(path.join('lib','platform',name+'.ts'));
 if(end('database'))return {database:db};
 if(end('runtime'))return {env:{DB:db,BUCKET:bucket}};
 if(end('auth'))return {getAuth:()=>({api:{getSession:async({headers})=>{const id=headers.get('x-test-user-id'),email=headers.get('x-test-user-email');return id&&email?{user:{id,email}}:null;}}})};
};
