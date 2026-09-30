// Fast deterministic tests for V1 platform logic (no database, no network):
// lifecycle state machines, capability matrix, ABN checksum, financial
// arithmetic, risk ratings, estimate items, docket cost lines and stage mapping.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const wf=load('lib/platform/workflow.ts'),perm=load('lib/platform/permissions.ts'),abn=load('lib/platform/abn.ts'),fin=load('lib/platform/finance.ts'),reg=load('lib/v1/registers.ts'),calc=load('lib/estimate-calculations.ts');

// Lifecycles: valid edges pass, skipped/critical edges fail, capability enforced.
assert.equal(wf.assertTransition('estimate','draft','review','office').to,'review');
assert.throws(()=>wf.assertTransition('estimate','draft','approved','admin'),/Cannot move/,'estimate cannot skip review');
assert.throws(()=>wf.assertTransition('estimate','review','approved','field'),/not authorised/);
assert.throws(()=>wf.assertTransition('tender','approval','submitted','admin'),/dedicated action/,'submission must use submission checks');
assert.equal(wf.assertTransition('tender','approval','submitted','admin',{system:true}).to,'submitted');
assert.throws(()=>wf.assertTransition('tender','draft','awarded','admin',{system:true}),/Cannot move/);
assert.throws(()=>wf.assertTransition('project','setup','active','admin'),/Cannot move/,'project must be ready before active');
assert.throws(()=>wf.assertTransition('claim','draft','submitted','admin'),/Cannot move/,'claim needs internal approval');
assert.throws(()=>wf.assertTransition('claim','internal_approval','submitted','field'),/not authorised/);
assert.throws(()=>wf.assertTransition('docket','review','approved','field'),/not authorised/,'field cannot approve dockets');
assert.equal(wf.assertTransition('docket','draft','review','field').to,'review','field may submit dockets');
assert.throws(()=>wf.assertTransition('swms','draft','approved','admin'),/Cannot move/);
assert.throws(()=>wf.assertTransition('swms','review','approved','field'),/not authorised/,'AI/field never approve SWMS');
assert.throws(()=>wf.assertTransition('variation','approved','draft','admin'),/Cannot move/,'approved variation is final');
assert.throws(()=>wf.assertTransition('requirement','suggested','complete','admin'),/Cannot move/,'suggested requirement must be confirmed first');
assert.deepEqual(wf.allowedTransitions('opportunity','bidding','admin').map(t=>t.to),['lost'],'conversion is not a UI transition');
for(const [k,m] of Object.entries(wf.MACHINES)){assert(m.states[m.initial],k+' initial');for(const [from,edges] of Object.entries(m.transitions)){assert(m.states[from],k+' '+from);for(const e of edges)assert(m.states[e.to],`${k} ${from}->${e.to}`);}}

// Capabilities: field users never hold commercial, rates, approval or admin capabilities.
for(const c of ['commercial.view','rates.edit','estimate.approve','tender.approve','claim.approve','docket.approve','team.admin','invoice.manage','pipeline.view'])assert.equal(perm.can('field',c),false,'field must not have '+c);
for(const c of ['rates.edit','team.admin','entitlements.manage','org.admin'])assert.equal(perm.can('office',c),false,'office must not have '+c);
assert(perm.CAPABILITIES.every(c=>perm.can('admin',c)));
assert.equal(perm.can('read_only','commercial.view'),false);assert.equal(perm.can(undefined,'project.view'),false);assert.equal(perm.can('hacker','project.view'),false);
// Role model: eleven assignable roles (Project Engineer and Site Engineer added in the navigation tranche), route gate (roleAllows) and capability matrix per role.
assert.deepEqual([...perm.ROLES].sort(),['accounts','admin','estimator','field','office','project_engineer','project_manager','read_only','scheduler','site_engineer','supervisor']);
for(const r of perm.ROLES){assert(perm.ROLE_LABELS[r]&&perm.ROLE_DESCRIPTIONS[r],'label and description for '+r);assert(perm.roleAllows(r,'field-read'));}
assert.equal(perm.roleAllows('hacker','field-read'),false);
const gate=(r,p,m)=>perm.roleAllows(r,p,m);
const matrix={
 admin:{yes:[['admin'],['approve','estimating'],['write','commercial'],['read','dockets']],no:[]},
 office:{yes:[['approve','estimating'],['write','commercial'],['write','operations']],no:[['admin']]},
 estimator:{yes:[['read','pipeline'],['write','pipeline'],['write','estimating'],['read','commercial'],['write','commercial']],no:[['approve','estimating'],['write','operations'],['write','dockets'],['admin']]},
 scheduler:{yes:[['read','operations'],['write','operations'],['read','projects']],no:[['read','commercial'],['read','dockets'],['read','pipeline'],['write','projects'],['admin']]},
 project_manager:{yes:[['write','projects'],['write','ims'],['write','operations'],['read','dockets'],['write','dockets'],['write','commercial'],['read','commercial']],no:[['approve','estimating'],['approve','commercial'],['write','pipeline'],['admin']]},
 supervisor:{yes:[['field'],['read','projects'],['read','operations'],['write','ims']],no:[['read','commercial'],['read','dockets'],['write','operations'],['read','pipeline']]},
 field:{yes:[['field'],['field-read']],no:[['read','projects'],['read','commercial'],['write','ims']]},
 accounts:{yes:[['read','commercial'],['write','commercial'],['approve','commercial'],['read','dockets'],['read','projects']],no:[['write','projects'],['read','pipeline'],['write','operations'],['admin']]},
 project_engineer:{yes:[['read','projects'],['write','projects'],['read','operations'],['write','ims'],['field']],no:[['read','commercial'],['write','commercial'],['approve','commercial'],['read','pipeline'],['write','operations'],['approve','estimating'],['admin']]},
 site_engineer:{yes:[['read','projects'],['read','operations'],['write','ims'],['field']],no:[['read','commercial'],['read','pipeline'],['write','projects'],['write','operations'],['admin']]},
 read_only:{yes:[['read','projects'],['read','pipeline'],['read','operations'],['read','ims'],['read','reports']],no:[['read','commercial'],['read','dockets'],['write','projects'],['field'],['write','ims'],['admin']]},
};
for(const [r,{yes,no}] of Object.entries(matrix)){for(const [p,m] of yes)assert(gate(r,p,m),`${r} should pass ${p}/${m||'core'}`);for(const [p,m] of no)assert(!gate(r,p,m),`${r} must not pass ${p}/${m||'core'}`);}
for(const r of ['scheduler','supervisor','field','read_only'])assert.equal(perm.can(r,'commercial.view'),false,r+' never sees money');
assert.equal(perm.can('estimator','estimate.approve'),false);assert.equal(perm.can('project_manager','claim.approve'),false);assert.equal(perm.can('accounts','claim.approve'),true);
for(const r of perm.ROLES)assert.equal(perm.can(r,'communication.view'),true,r+' can read authorised contextual communication');
for(const r of ['admin','office','estimator','scheduler','project_manager','project_engineer','site_engineer','supervisor','field','accounts'])assert.equal(perm.can(r,'communication.send'),true,r+' can send within an authorised context');
assert.equal(perm.can('read_only','communication.send'),false,'read-only cannot send');
for(const r of ['admin','office','scheduler','project_manager'])assert.equal(perm.can(r,'external.share'),true,r+' may create external job links');
for(const r of ['estimator','project_engineer','site_engineer','supervisor','field','accounts','read_only'])assert.equal(perm.can(r,'external.share'),false,r+' cannot create external job links');
// Admin navigation is capability-driven: no role sees administration it cannot use.
const navDef=load('lib/v1/navigation.ts');
// Intended change (navigation tranche): People/Plant moved to Resources, Company Library to Documents.
assert.deepEqual(navDef.adminSubsFor('admin'),['Company','Rates','Civil Knowledge','Team & Permissions','Integrations','Settings']);
assert.deepEqual(navDef.adminSubsFor('estimator'),['Rates'],'estimator: rates (read), no organisation/security/entitlements');
assert.deepEqual(navDef.adminSubsFor('scheduler'),[],'operations: no admin area (people and plant live under Resources)');
assert.deepEqual(navDef.adminSubsFor('project_manager'),[]);
for(const r of ['project_engineer','site_engineer'])assert.deepEqual(navDef.adminSubsFor(r),[],r+': no admin area');
assert.deepEqual(navDef.adminSubsFor('accounts'),[],'accounts: no admin area');
assert.deepEqual(navDef.adminSubsFor('read_only'),[],'read-only: no admin area');
assert.deepEqual(navDef.adminSubsFor('field'),[]);assert.deepEqual(navDef.adminSubsFor('supervisor'),[]);
assert(!navDef.adminSubsFor('office').some(k=>['Team & Permissions','Integrations','Settings','Company'].includes(k)),'office has no organisation administration');
assert.deepEqual(navDef.FIELD_SHELL_ROLES,['field','supervisor']);
// Project/Site Engineer: delivery capabilities without money, rates, approvals, HR or administration.
for(const r of ['project_engineer','site_engineer'])for(const c of ['commercial.view','commercial.edit','rates.edit','team.admin','entitlements.manage','org.admin','claim.approve','variation.approve','estimate.approve','tender.approve','swms.approve','pipeline.view','estimate.edit','docket.approve','schedule.edit','library.edit'])assert.equal(perm.can(r,c),false,r+' must not have '+c);
for(const c of ['project.view','project.edit','programme.edit','schedule.view','hseq.edit','itp.complete','field.capture','document.upload'])assert(perm.can('project_engineer',c),'project_engineer needs '+c);
for(const c of ['project.view','programme.edit','schedule.view','hseq.edit','itp.complete','field.capture','document.upload'])assert(perm.can('site_engineer',c),'site_engineer needs '+c);
// Project scope: engineers are limited to their project memberships; organisation-wide roles keep project.all.view.
for(const r of ['project_engineer','site_engineer'])assert.equal(perm.can(r,'project.all.view'),false,r+' is project-scoped');
for(const r of ['admin','office','estimator','scheduler','project_manager','supervisor','accounts','read_only'])assert(perm.can(r,'project.all.view'),r+' keeps organisation-wide project access');
assert.equal(perm.can('field','project.view'),false,'field users keep assigned-shift rules (no project access to scope)');
const roles=load('lib/v1/project-roles.ts');assert.deepEqual([...roles.PROJECT_ROLES],['project_manager','project_engineer','site_engineer','supervisor','commercial','hseq','other']);
for(const r of roles.PROJECT_ROLES)assert(roles.PROJECT_ROLE_LABELS[r]);
assert.equal(perm.can('site_engineer','project.edit'),false);assert.equal(perm.can('site_engineer','reports.view'),false,'site engineer: no company reporting');
assert(!navDef.FIELD_SHELL_ROLES.includes('site_engineer'),'site engineer uses the responsive office shell with Today');
// Primary navigation: conventional areas, filtered by capability and entitlement; engines are not primary.
const appNav=load('lib/v1/app-nav.ts'),{ENGINES}=load('lib/v1/engines.ts');
const ALL=['pipeline','estimating','projects','ims','operations','field','dockets','commercial','reports','workshop','ai'];
const access=(role,mods=ALL)=>({can:c=>perm.can(role,c),module:m=>mods.includes(m)});
const areas=(role,mods)=>appNav.navFor(access(role,mods)).map(a=>a.key);
const subs=(role,area,mods)=>(appNav.navFor(access(role,mods)).find(a=>a.key===area)?.subs||[]).map(s=>s.key);
assert.deepEqual(areas('admin'),['Home','CRM','Pipeline','Projects','Schedule','Resources','Commercial','IMS & HSEQ','Documents','Reports','Admin']);
assert(!areas('admin').some(k=>ENGINES.some(e=>e.key===k)),'no engine names in primary navigation');
assert.deepEqual(subs('admin','Pipeline'),['Opportunities','Tenders','Estimates']);
assert.deepEqual(subs('admin','Resources'),['People','Plant & Equipment','Crews','Suppliers & Subcontractors','Depots','Workshop']);
assert.deepEqual(subs('admin','Documents'),['All Documents','Company Library'],'Documents opens with the cross-workspace file view, while Company Library remains separate');
assert.deepEqual(areas('project_engineer'),['Home','Today','CRM','Projects','Schedule','Resources','IMS & HSEQ','Documents','Reports']);
assert.deepEqual(subs('project_engineer','Resources'),['People','Plant & Equipment','Crews','Suppliers & Subcontractors','Depots','Workshop']);
assert.deepEqual(subs('project_engineer','Reports'),['Reports','Lifecycle']);
assert.deepEqual(areas('site_engineer'),['Home','Today','CRM','Projects','Schedule','Resources','IMS & HSEQ','Documents']);
for(const r of ['project_engineer','site_engineer'])for(const k of ['Commercial','Pipeline','Admin'])assert(!areas(r).includes(k),r+' must not see '+k);
assert.deepEqual(areas('scheduler'),['Home','CRM','Projects','Schedule','Resources','IMS & HSEQ','Documents','Reports']);
assert(!areas('accounts').includes('Schedule')&&areas('accounts').includes('Commercial'));
assert(!areas('office').includes('Today')&&!areas('scheduler').includes('Today'),'Today only for field-capture roles without office planning');
// Reduced-module organisations: coherent menus, no disabled items for unpurchased modules.
assert.deepEqual(areas('admin',['ims']),['Home','IMS & HSEQ','Documents','Reports','Admin']);
assert.deepEqual(subs('admin','Reports',['ims']),['Lifecycle']);
assert.deepEqual(areas('admin',['operations']),['Home','CRM','Schedule','Resources','Documents','Reports','Admin']);
assert.deepEqual(subs('admin','Resources',['operations']),['People','Plant & Equipment','Crews','Suppliers & Subcontractors','Depots']);
assert.deepEqual(areas('admin',['pipeline','estimating']),['Home','CRM','Pipeline','Documents','Reports','Admin']);
assert.deepEqual(subs('admin','Pipeline',['estimating']),['Estimates']);
assert.deepEqual(subs('admin','Admin',['ims']),['Company','Civil Knowledge','Team & Permissions','Integrations','Settings'],'rates hidden without estimating');
assert.equal(appNav.canOpen(access('site_engineer'),'Commercial'),false);assert.equal(appNav.canOpen(access('admin',['ims']),'Schedule'),false);
// Legacy routes and bookmarks translate to the new areas, keeping record id and tab.
const R=appNav.resolveRoute;
assert.deepEqual(R({area:'Win Work',sub:'Tenders',id:'t1',tab:'estimate'}),{area:'Pipeline',sub:'Tenders',id:'t1',tab:'estimate'});
assert.deepEqual(R({area:'Win Work',sub:'Clients',id:'Acme'}),{area:'CRM',sub:'Clients',id:'Acme',tab:undefined});
assert.equal(R({area:'Win Work',sub:'Overview'}).area,'Pipeline');
assert.deepEqual(R({area:'Prepare Work',sub:'Projects',id:'p1',tab:'quality'}),{area:'Projects',sub:'Projects',id:'p1',tab:'quality'});
assert.deepEqual(R({area:'Deliver Work',sub:'Dockets'}),{area:'Commercial',sub:'Dockets',id:undefined,tab:undefined});
assert.deepEqual(R({area:'Prepare Work',sub:'Company Library',id:'Insurance'}),{area:'Documents',sub:'Company Library',id:'Insurance',tab:undefined});
assert.deepEqual(R({area:'Resource Work',sub:'Resources',id:'TMA001',tab:'plant'}),{area:'Resources',sub:'Plant & Equipment',id:'TMA001',tab:undefined});
assert.deepEqual(R({area:'Resource Work',sub:'Resources',id:'Sam',tab:'workers'}),{area:'Resources',sub:'People',id:'Sam',tab:undefined});
assert.deepEqual(R({area:'Operations',sub:'Schedule',id:'p1'}),{area:'Schedule',sub:'Schedule',id:'p1',tab:undefined});
assert.equal(R({area:'Control Money'}).area,'Commercial');assert.deepEqual(R({area:'Learn'}),{area:'Reports',sub:'Lifecycle',id:undefined,tab:undefined});
assert.deepEqual(R({area:'Admin',sub:'Plant'}),{area:'Resources',sub:'Plant & Equipment',id:undefined,tab:undefined});
assert.deepEqual(R({area:'Admin',sub:'Settings'}),{area:'Admin',sub:'Settings'},'current admin pages unchanged');
assert.deepEqual(R({area:'Field'}),{area:'Today'});assert.deepEqual(R({area:'Projects',id:'p1',tab:'setup'}),{area:'Projects',sub:'Projects',id:'p1',tab:'setup'});
assert.deepEqual(R({area:'Home'}),{area:'Home'});assert.deepEqual(R({area:'Search',id:'abc'}),{area:'Search',id:'abc'});
// Home quick actions: role priorities, never more than three, never a shortcut the user cannot open.
const qa=(r,mods)=>appNav.quickActions(r,access(r,mods)).map(q=>q.label);
assert.deepEqual(qa('scheduler'),['Schedule','People','Plant & equipment']);
assert.deepEqual(qa('project_manager'),['My projects','Programme','Commercial']);
assert.deepEqual(qa('project_engineer'),['Projects','Programme','IMS & HSEQ']);
assert.deepEqual(qa('site_engineer'),['Today','Projects','IMS & HSEQ']);
assert.deepEqual(qa('accounts'),['Commercial','Dockets','Reports']);
assert.deepEqual(qa('admin',['ims']),['IMS & HSEQ','Documents']);
for(const r of perm.ROLES)for(const q of appNav.quickActions(r,access(r)))assert(appNav.canOpen(access(r),q.area,q.sub),r+' quick action '+q.label+' must be openable');

// Civil Knowledge Engine: deterministic rule evaluation, missing-context handling and source provenance.
{const k=load('lib/platform/knowledge-rules.ts');
 const source={id:'s1',title:'Client pavement specification',authority:'Example client',referenceCode:'SPEC-01',revisionLabel:'R2',jurisdiction:'NSW',sourceClause:'4.2',sourcePage:'18',effectiveFrom:'2026-01-01',effectiveTo:null};
 const rule={id:'r1',ruleCode:'fixture.mix.minimum',title:'Fixture minimum layer',topic:'asphalt',ruleType:'minimum',severity:'block',message:'Fixture rule only.',source,
  appliesWhen:{all:[{field:'asphalt.mix',op:'eq',value:'TEST14'}],any:[]},assertion:{field:'asphalt.compactedDepthMm',op:'gte',value:40}};
 let r=k.evaluateKnowledgeRule(rule,{asphalt:{mix:'TEST14',compactedDepthMm:35}});
 assert.deepEqual([r.applicability,r.result,r.actual,r.expected],['applicable','fail',35,40]);
 r=k.evaluateKnowledgeRule(rule,{asphalt:{mix:'TEST14',compactedDepthMm:50}});assert.equal(r.result,'pass');
 r=k.evaluateKnowledgeRule(rule,{asphalt:{mix:'OTHER',compactedDepthMm:20}});assert.equal(r.applicability,'not_applicable');
 r=k.evaluateKnowledgeRule(rule,{asphalt:{mix:'TEST14'}});assert.equal(r.result,'needs_context');
 assert.equal(k.evaluatePredicate({field:'x',op:'between',value:[10,20]},{x:15}),true);
 assert.equal(k.evaluatePredicate({field:'x',op:'in',value:['a','b']},{x:'B'}),true);
 assert.equal(k.sourceReference(source),'Example client · SPEC-01 · R2 · Clause 4.2 · Page 18');
 const sum=k.knowledgeSummary([k.evaluateKnowledgeRule(rule,{asphalt:{mix:'TEST14',compactedDepthMm:35}})]);
 assert.deepEqual([sum.failed,sum.blocking],[1,1]);
}
// Six-engine operating model: fixed order, explicit hand-offs and backwards-compatible legacy routes.
{const eng=load('lib/v1/engines.ts');
 assert.deepEqual(eng.ENGINE_KEYS,['Win Work','Prepare Work','Resource Work','Deliver Work','Control Money','Learn']);
 assert.deepEqual(eng.ENGINES.map(e=>e.number),[1,2,3,4,5,6]);
 assert.deepEqual(eng.ENGINES.map(e=>e.next),['Prepare Work','Resource Work','Deliver Work','Control Money','Learn','Win Work']);
 assert.deepEqual(eng.resolveEngineRoute({area:'Pipeline',sub:'Tenders',id:'t1',tab:'estimate'}),{area:'Win Work',sub:'Tenders',id:'t1',tab:'estimate'});
 assert.deepEqual(eng.resolveEngineRoute({area:'Projects',id:'p1',tab:'delivery'}),{area:'Prepare Work',sub:'Projects',id:'p1',tab:'delivery'});
 assert.deepEqual(eng.resolveEngineRoute({area:'Operations',sub:'Resources'}),{area:'Resource Work',sub:'Resources'});
 assert.deepEqual(eng.resolveEngineRoute({area:'Operations',sub:'Dockets'}),{area:'Deliver Work',sub:'Dockets'});
 assert.deepEqual(eng.resolveEngineRoute({area:'Commercial'}),{area:'Control Money',sub:'Commercial'});
 assert.deepEqual(eng.resolveEngineRoute({area:'IMS & HSEQ'}),{area:'Prepare Work',sub:'IMS & HSEQ'});
 assert.deepEqual(eng.resolveEngineRoute({area:'Reports'}),{area:'Learn',sub:'Reports'});
 assert.deepEqual(eng.resolveEngineRoute({area:'Deliver Work',sub:'Projects',id:'p2'}),{area:'Deliver Work',sub:'Projects',id:'p2'},'new engine routes remain stable');
}
// Tender lifecycle presentation: step states and next-action targets mirror the tender stage and stats.
{const tf=load('lib/v1/tender-flow.ts');
 const base={stage:'pricing',approvalStatus:'not_requested',submittedAt:null,estimateId:'e1',projectId:null,checks:[{key:'estimate',ok:true},{key:'requirements',ok:false},{key:'returnables',ok:false},{key:'approval',ok:false}],stats:{documents:1,requirements:3,suggested:0,mandatoryOpen:2,returnables:1,returnablesMandatoryOpen:1,clarificationsOpen:0,estimateState:'approved',bidDecision:'bid',approvedRevisionNumber:1}};
 const by=t=>Object.fromEntries(tf.tenderSteps(t).map(s=>[s.key,s.state]));
 assert.equal(tf.nextStep(base),'requirements','open mandatory requirements come next once the estimate is approved');
 assert.deepEqual(by(base),{intake:'done',requirements:'attention',bid:'done',estimate:'done',returnables:'attention',approval:'todo',submission:'todo',clarifications:'todo',award:'todo'});
 assert.equal(tf.tenderSteps(base).find(s=>s.key==='requirements').count,2);
 assert.equal(tf.nextStep({...base,stats:{...base.stats,approvedRevisionNumber:null,estimateState:'draft'}}),'estimate');
 assert.equal(tf.nextStep({...base,stats:{...base.stats,suggested:1}}),'requirements','suggestions must be confirmed first');
 assert.equal(tf.nextStep({...base,stats:{...base.stats,mandatoryOpen:0,returnablesMandatoryOpen:0}}),'approval');
 assert.equal(tf.nextStep({...base,stage:'approval',approvalStatus:'approved',checks:base.checks.map(c=>({...c,ok:true}))}),'submission');
 assert.equal(tf.nextStep({...base,stage:'draft',stats:{...base.stats,documents:0,requirements:0}}),'intake');
 assert.equal(tf.nextStep({...base,stage:'submitted',submittedAt:'x',stats:{...base.stats,clarificationsOpen:1}}),'clarifications');
 assert.equal(tf.nextStep({...base,stage:'awarded',projectId:'p1'}),'project');
 assert.equal(by({...base,stage:'draft',stats:{...base.stats,bidDecision:'pending',mandatoryOpen:2}}).requirements,'todo','requirements are not flagged before pricing');
 assert(Object.values(by({...base,stage:'lost'})).every(s=>['done','closed'].includes(s)),'a lost tender has no current or attention steps');
 assert.deepEqual(tf.TENDER_PHASES.flatMap(p=>p.stages).sort(),['approval','awarded','clarification','draft','lost','pricing','reviewing','submitted'],'every tender stage belongs to exactly one phase');}
// Project setup presentation: readiness categories become a checklist whose buttons lead to where each gap is fixed.
{const ps=load('lib/v1/project-setup.ts');
 const item=(category,title,ok,source='checklist',mandatory=true)=>({category,title,ok,source,mandatory});
 const cats=[{category:'contract',items:[item('contract','Contract executed',true),item('contract','Approved baseline recorded',false,'derived')]},{category:'SWMS',items:[item('SWMS','SWMS approved for planned high-risk work',false,'derived')]},{category:'permits',items:[item('permits','Road occupancy permit',false)]},{category:'plant',items:[item('plant','Plant inspected',true)]}];
 const areas=ps.setupAreas(cats,{complete:false,missing:['Contract number']});
 assert.deepEqual(areas.map(a=>[a.label,a.status]),[['Contract details','attention'],['Contract','attention'],['SWMS','not_started'],['Permits & approvals','not_started'],['Plant','complete']]);
 assert.deepEqual(areas.find(a=>a.key==='contract').target,{kind:'anchor',anchor:'setup-baseline'},'a missing baseline opens the baseline section');
 assert.deepEqual(areas.find(a=>a.key==='SWMS').target,{kind:'tab',tab:'quality'},'SWMS gaps open Quality & HSEQ');
 assert.deepEqual(areas.find(a=>a.key==='permits').target,{kind:'checklist',category:'permits'},'checklist gaps open the checklist filtered to their category');
 assert.equal(ps.fixFor(item('project plans','Project IMS pack approved',false,'derived')).target.area,'IMS & HSEQ');
 assert.equal(ps.fixFor(item('competencies','Scheduled workers hold current competencies',false,'derived')).target.sub,'Resources');
 assert.deepEqual(ps.nextActionTarget('setup','Approve SWMS before mobilisation'),{kind:'tab',tab:'quality'});
 assert.deepEqual(ps.nextActionTarget('setup','Complete 3 readiness requirements'),{kind:'tab',tab:'setup'});
 assert.deepEqual(ps.nextActionTarget('active','Record the client decision on 1 submitted variation'),{kind:'tab',tab:'commercial'});
 assert.deepEqual(ps.nextActionTarget('closeout','Final claim'),{kind:'tab',tab:'closeout'});
 assert.equal(ps.nextActionTarget('closed',null),null);
 assert.equal(ps.nextActionTarget('setup','Mark the project ready'),null,'the header button is the action: no competing Go button');
 assert.equal(ps.nextActionTarget('ready','Start delivery'),null);}
// Search opens the work context a record belongs to, falling back to the register without one.
{const sr=load('lib/v1/search-routing.ts');const r=(type,o={})=>({id:'x1',type,area:'Pipeline/Estimates',projectId:null,tenderId:null,...o});
 assert.deepEqual(sr.searchTarget(r('Estimate',{tenderId:'t1'}),'estimator'),['Pipeline','Tenders','t1','estimate'],'estimate linked to a tender opens the tender estimate step');
 assert.deepEqual(sr.searchTarget(r('Estimate'),'estimator'),['Pipeline','Estimates','x1'],'unlinked estimate opens in the estimate register');
 assert.deepEqual(sr.searchTarget(r('Tender'),'admin'),['Pipeline','Tenders','x1']);
 assert.deepEqual(sr.searchTarget(r('Project'),'admin'),['Projects',undefined,'x1']);
 assert.deepEqual(sr.searchTarget(r('Variation',{projectId:'p1',area:'Commercial'}),'admin'),['Projects',undefined,'p1','commercial']);
 assert.deepEqual(sr.searchTarget(r('Claim',{projectId:'p1',area:'Commercial'}),'accounts'),['Projects',undefined,'p1','commercial']);
 assert.deepEqual(sr.searchTarget(r('SWMS',{projectId:'p1',area:'IMS & HSEQ'}),'admin'),['Projects',undefined,'p1','quality']);
 assert.deepEqual(sr.searchTarget(r('Document',{projectId:'p1',name:'IFC drawing',area:'Documents'}),'admin'),['Projects',undefined,'p1','documents'],'project document opens in project context');
 assert.deepEqual(sr.searchTarget(r('Document',{name:'Quality policy',area:'Documents'}),'admin'),['Documents','All Documents','Quality policy'],'standalone document opens the central document workspace pre-filtered');
 assert.deepEqual(sr.searchTarget(r('Docket',{projectId:'p1',area:'Operations/Dockets'}),'admin'),['Projects',undefined,'p1','delivery']);
 assert.deepEqual(sr.searchTarget(r('Docket',{area:'Operations/Dockets'}),'admin'),['Operations','Dockets'],'docket without a project opens the docket register');
 assert.deepEqual(sr.searchTarget(r('Shift',{projectId:'p1',area:'Operations/Schedule'}),'scheduler'),['Operations','Schedule','p1']);
 assert.deepEqual(sr.searchTarget(r('Shift',{projectId:'p1',area:'Operations/Schedule'}),'field'),['Operations','Schedule']);
 // Intended change (CRM tranche): clients, contacts and sites open the client record in CRM by id.
 assert.deepEqual(sr.searchTarget(r('Client',{id:'c1',name:'Abergeldie'}),'admin'),['CRM','Clients','c1'],'client opens its CRM record');
 assert.deepEqual(sr.searchTarget(r('Contact',{id:'k1',clientId:'c1'}),'admin'),['CRM','Clients','c1'],'contact opens its client');
 assert.deepEqual(sr.searchTarget(r('Site',{id:'s1',clientId:'c1'}),'admin'),['CRM','Clients','c1'],'site opens its client');
 assert.deepEqual(sr.searchTarget(r('Plant',{name:'TMA truck'}),'scheduler'),['Resource Work','Resources','TMA truck','plant'],'plant opens the Plant tab filtered to it');
 assert.deepEqual(sr.searchTarget(r('Worker',{name:'John Smith'}),'scheduler'),['Resource Work','Resources','John Smith','workers']);
 assert.deepEqual(sr.searchTarget(r('Library item',{name:'Public Liability'}),'office'),['Prepare Work','Company Library','Public Liability']);
 assert.deepEqual(sr.searchTarget(r('Opportunity',{name:'Marrickville'}),'estimator'),['Win Work','Opportunities','Marrickville']);}
// Shift cards list the most urgent readiness warnings first; nothing is added or dropped.
{const sw=load('lib/v1/shift-warnings.ts');
 const list=['Missing purchase order.','Missing TMP.','John Smith: competency expired 2026-01-01.','Casey: competency expiry not recorded.','Excavator 05: overlaps Depot yard.'];
 const p=sw.prioritiseWarnings(list);
 assert.deepEqual(p.top,['John Smith: competency expired 2026-01-01.','Excavator 05: overlaps Depot yard.']);
 assert.equal(p.rest.length,3);assert.deepEqual([...p.all].sort(),[...list].sort(),'same warnings, only reordered');
 assert.deepEqual(p.all.slice(2),['Casey: competency expiry not recorded.','Missing purchase order.','Missing TMP.']);}
for(const r of navDef.FIELD_SHELL_ROLES)assert.equal(perm.can(r,'commercial.view'),false,r+' shell never carries money');
assert.equal(perm.can('read_only','project.edit'),false);assert(perm.capabilitiesFor('read_only').every(c=>c.endsWith('.view')),'read-only holds view capabilities only');

// ABN checksum (ATO algorithm) — format only, no fake registry lookups.
assert.equal(abn.isValidAbn('51 824 753 556'),true);assert.equal(abn.isValidAbn('51824753557'),false);assert.equal(abn.isValidAbn('1234'),false);assert.equal(abn.formatAbn('51824753556'),'51 824 753 556');

// Finance: forecast, earned value, claim limits, GST.
let f=fin.forecast({originalContract:100000,approvedVariations:10000,pendingVariations:5000,originalBudget:80000,approvedVariationCost:6000,actual:30000,committed:10000,accrued:5000,claimed:40000,certified:38000,invoiced:38000,paid:20000});
assert.equal(f.currentContract,110000);assert.equal(f.currentBudget,86000);assert.equal(f.costToComplete,41000);assert.equal(f.forecastFinalCost,86000);assert.equal(f.forecastProfit,24000);assert.equal(f.forecastMarginPct,21.82);assert.equal(f.outstanding,18000);
assert.equal(f.approvedVariationCost,6000,'forecast exposes the approved budget change it already used (current budget = original + approved change)');assert.equal(f.currentBudget,f.originalBudget+f.approvedVariationCost);
f=fin.forecast({originalContract:100000,approvedVariations:0,pendingVariations:0,originalBudget:80000,approvedVariationCost:0,actual:90000,committed:5000,accrued:0,claimed:0,certified:0,invoiced:0,paid:0});
assert.equal(f.costToComplete,0,'overspend: no negative cost to complete');assert.equal(f.forecastFinalCost,95000);assert.equal(f.forecastProfit,5000);
f=fin.forecast({originalContract:0,approvedVariations:0,pendingVariations:0,originalBudget:0,approvedVariationCost:0,actual:0,committed:0,accrued:0,claimed:0,certified:0,invoiced:0,paid:0});
assert.equal(f.forecastMarginPct,null,'no contract → margin not available (not 0%)');
assert.deepEqual(fin.claimLine(1000,400,600),{contractValue:1000,previousClaimed:400,thisClaim:600,claimedToDate:1000,remaining:0});
assert.throws(()=>fin.claimLine(1000,400,601),/exceeds the remaining/);
// Retention (ex GST): % of gross, cumulative cap, release bounded by held, negative adjustments withhold nothing.
const T={enabled:true,pct:5,cap:null};
assert.deepEqual(fin.retention({enabled:false,pct:5,cap:null},1000,0),{gross:1000,withheld:0,released:0,net:1000,heldAfter:0});
assert.deepEqual(fin.retention(T,1000,0),{gross:1000,withheld:50,released:0,net:950,heldAfter:50});
assert.deepEqual(fin.retention({...T,cap:70},1000,40),{gross:1000,withheld:30,released:0,net:970,heldAfter:70});
assert.deepEqual(fin.retention({...T,cap:70},1000,70),{gross:1000,withheld:0,released:0,net:1000,heldAfter:70},'cap reached');
assert.deepEqual(fin.retention(T,0,50,50),{gross:0,withheld:0,released:50,net:50,heldAfter:0},'release-only');
assert.deepEqual(fin.retention(T,-200,50),{gross:-200,withheld:0,released:0,net:-200,heldAfter:50});
assert.throws(()=>fin.retention(T,100,40,40.01),/exceeds retention held/);assert.throws(()=>fin.retention(T,100,40,-1),/negative/);
assert.equal(fin.retention(T,333.33,0).withheld,16.67,'rounded to cents');
assert.deepEqual(fin.retentionHeld([{status:'certified',retentionWithheld:50,certifiedRetention:40,retentionReleased:0},{status:'submitted',retentionWithheld:30,certifiedRetention:null,retentionReleased:20}]),{withheld:70,released:20,held:50},'certified retention supersedes claimed');
assert.deepEqual(fin.retentionHeld([{status:'invoiced',retentionWithheld:50,certifiedRetention:40,retentionReleased:0},{status:'draft',retentionWithheld:30,certifiedRetention:null,retentionReleased:20},{status:'internal_approval',retentionWithheld:10,certifiedRetention:null,retentionReleased:0}]),{withheld:40,released:0,held:40},'drafts and claims awaiting internal approval hold no retention');
assert.deepEqual([...fin.RETENTION_HELD_STATES],['submitted','certified','invoiced','paid']);assert.throws(()=>fin.claimLine(1000,100,-200),/negative adjustment/);
assert.deepEqual(fin.gst(19800),{amountExGst:19800,gst:1980,total:21780});
assert.equal(fin.readinessPercent([{mandatory:true,ok:true},{mandatory:true,ok:false},{mandatory:false,ok:false}]),50);assert.equal(fin.readinessPercent([]),null);

// Risk rating (5×5, organisation thresholds).
assert.equal(reg.riskRating(4,5),'Extreme');assert.equal(reg.riskRating(2,4),'Medium');assert.equal(reg.riskRating(2,5),'High');assert.equal(reg.riskRating(1,1),'Low');assert.equal(reg.riskRating(6,1),null);assert.equal(reg.riskRating(3,3,{low:9,medium:12,high:20}),'Low');
// Every register column name is a safe identifier (they are interpolated into SQL).
for(const d of Object.values(reg.REGISTERS)){assert(/^[a-z_]+$/.test(d.table));for(const fd of d.fields)assert(/^[a-z_]+$/.test(fd.key),d.key+'.'+fd.key);}

// Estimate engine: discipline-neutral items and legacy paving compatibility.
const general={...calc.makeGeneralEstimate(),clientName:'C',projectName:'P',items:[{id:'1',section:'S',costCode:'100',category:'labour',description:'Crew',quantity:120,unit:'m',productivity:10,rateBasis:'hour',rate:95},{id:'2',section:'S',costCode:'300',category:'material',description:'Pipe',quantity:120,unit:'m',productivity:0,rateBasis:'unit',rate:180}],marginValue:0,overheadsPct:0,contingencyPct:0};
let t=calc.calculateEstimate(general);assert.equal(t.directCost,1140+21600);assert.equal(t.materialCost,0,'paving material excluded');assert.deepEqual(calc.validateEstimate(general,t).errors,[]);
const b=calc.costBreakdown(t);assert.equal(b.labour,1140);assert.equal(b.material,21600);
const bad={...general,items:[{...general.items[0],productivity:0}]};assert(calc.validateEstimate(bad,calc.calculateEstimate(bad)).errors.some(e=>/productivity/.test(e)));
const legacy=calc.normaliseEstimateData({clientName:'A',projectName:'B'});assert.equal(legacy.includePaving,true,'legacy estimates keep the paving engine');assert(calc.calculateEstimate(legacy).materialCost>0);

// Docket → cost lines: itemised lines, total fallback, adjustment to the approved amount.
const seam=load('lib/seams/docket-to-cost.ts');
let lines=seam.docketCostLines({docket_no:'D1',amount:1300,quantity:0,quantity_unit:'',line_items:JSON.stringify([{description:'Paver operator',quantity:8,rate:100},{description:'AC14 asphalt',quantity:2,rate:200,amount:400}]),notes:''});
assert.deepEqual(lines.map(l=>[l.line,l.category,l.amount]),[['L1','labour',800],['L2','material',400],['ADJ','other',100]]);
lines=seam.docketCostLines({docket_no:'D2',amount:500,quantity:3,quantity_unit:'t',line_items:'[]',notes:'Tipper hire'});assert.deepEqual(lines.map(l=>[l.line,l.category,l.amount]),[['TOTAL','plant',500]]);
assert.equal(seam.docketCostLines({docket_no:'D3',amount:0,line_items:'[]',notes:''}).length,0,'zero dockets post nothing');

// Stage mapping for legacy free-text statuses.
const rs=load('lib/v1/register-server.ts');assert.equal(rs.legacyOpportunityStage('Tendering'),'bidding');assert.equal(rs.legacyOpportunityStage('Won'),'won');assert.equal(rs.legacyOpportunityStage('Qualifying'),'qualified');
// Conflict engine (pure).
const cf=load('lib/modules/operations/conflicts.ts'),rm=load('lib/v1/resource-mapping.ts');
const res=new Map([['worker:w1',{id:'w1',type:'worker',name:'Alex',status:'Active',active:true,competencies:[{type:'White card',expiryDate:'2030-01-01',status:'current'},{type:'First aid',expiryDate:'2020-01-01',status:'current'}]}],['plant:p1',{id:'p1',type:'plant',name:'Paver',status:'Available',active:true,complianceExpiry:'2026-01-01'}]]);
const sh=(o={})=>({id:'s1',name:'Night',status:'Planned',date:'2026-03-01',start:'20:00',finish:'04:00',assignments:[{resourceType:'worker',resourceId:'w1'}],requiredCompetencies:[],...o});
const codes=c=>c.map(x=>`${x.code}:${x.severity}`).sort();
// Availability before saving: each candidate is judged by the same engine for the draft window.
{const busy=[{id:'s2',name:'Depot',status:'Planned',date:'2026-03-01',start:'22:00',finish:'02:00',assignments:[{resourceType:'plant',resourceId:'p1'}]}];
 const av=cf.availability(sh({assignments:[]}),[{resourceType:'worker',resourceId:'w1'},{resourceType:'plant',resourceId:'p1'},{resourceType:'worker',resourceId:'ghost'}],res,busy);
 assert.deepEqual(codes(av.w1),['COMPETENCY_EXPIRED_OTHER:warn'],'available worker only carries a warning');
 assert.deepEqual(codes(av.p1),['PLANT_COMPLIANCE_EXPIRED:block','PLANT_DOUBLE_BOOKED:block'],'plant clash and expired compliance are known before saving');
 assert.deepEqual(codes(av.ghost),['RESOURCE_MISSING:block']);
 assert.deepEqual(cf.availability(sh({status:'Cancelled'}),[{resourceType:'plant',resourceId:'p1'}],res,busy),{p1:[]},'cancelled shifts have no conflicts');}
assert.deepEqual(codes(cf.evaluateShift(sh(),res,[])),['COMPETENCY_EXPIRED_OTHER:warn']);
assert.deepEqual(codes(cf.evaluateShift(sh({requiredCompetencies:['white card','Paver ticket']}),res,[])),['COMPETENCY_EXPIRED_OTHER:warn','COMPETENCY_MISSING:block']);
assert.deepEqual(codes(cf.evaluateShift(sh({requiredCompetencies:['First aid']}),res,[])),['COMPETENCY_EXPIRED:block']);
const other={id:'s2',name:'Early',status:'Planned',date:'2026-03-02',start:'03:00',finish:'06:00',assignments:[{resourceType:'worker',resourceId:'w1'}]};
assert(codes(cf.evaluateShift(sh(),res,[other])).includes('WORKER_DOUBLE_BOOKED:block'),'overnight overlap');
assert(codes(cf.evaluateShift(sh(),res,[{...other,status:'Draft'}])).includes('WORKER_DOUBLE_BOOKED:warn'),'draft bookings are tentative');
assert(!codes(cf.evaluateShift(sh(),res,[{...other,start:'04:00'}])).some(c=>c.startsWith('WORKER_DOUBLE')),'back-to-back is not an overlap');
assert(!codes(cf.evaluateShift(sh(),res,[{...other,status:'Cancelled'}])).some(c=>c.startsWith('WORKER_DOUBLE')));
assert.deepEqual(codes(cf.evaluateShift(sh({assignments:[{resourceType:'plant',resourceId:'p1'}]}),res,[])),['PLANT_COMPLIANCE_EXPIRED:block']);
assert.deepEqual(codes(cf.evaluateShift(sh({assignments:[{resourceType:'worker',resourceId:'gone'}]}),res,[])),['RESOURCE_MISSING:block']);
const inactive=new Map([['worker:w1',{...res.get('worker:w1'),active:false,competencies:[]}]]);
assert.deepEqual(codes(cf.evaluateShift(sh(),inactive,[])),['RESOURCE_INACTIVE:block']);
assert.deepEqual(cf.evaluateShift(sh({status:'Cancelled',assignments:[{resourceType:'worker',resourceId:'gone'}]}),res,[]),[]);
assert.equal(cf.blocking('Draft',[{code:'X',severity:'block',message:''}]).length,0,'drafts are never blocked');
assert.equal(cf.blocking('Planned',[{code:'X',severity:'block',message:''},{code:'Y',severity:'warn',message:''}]).length,1);
// Legacy mapping (pure, deterministic).
assert.deepEqual(rm.splitCompetencies('White card; white card, First aid\nEWP'),['White card','First aid','EWP']);
const mw=rm.mapWorker({id:'w',name:'Sam Lee',status:'Active',metadata:{rate:'x',competencyExpiry:'2026-02-30'}});
assert.equal(mw.columns.hourly_rate,null);assert.deepEqual(mw.issues.map(i=>i.field).sort(),['competencyExpiry','rate'],'invalid calendar date and rate are flagged');
assert.deepEqual(rm.mapWorker({id:'w',name:'Sam',status:'Active',metadata:{competencies:'White card'}}),rm.mapWorker({id:'w',name:'Sam',status:'Active',metadata:JSON.stringify({competencies:'White card'})}),'string and object metadata map identically');
// Offline queue semantics (pure): nothing dropped silently; retries idempotent; conflicts kept for the user.
(async()=>{
 const oq=load('lib/v1/offline-sync.ts');
 const mem=()=>{const m=new Map();return {m,list:async()=>[...m.values()].map(x=>structuredClone(x)),put:async i=>{m.set(i.id,structuredClone(i));},remove:async id=>{m.delete(id);}};};
 const st=mem(),t0=new Date('2026-03-01T00:00:00Z');
 const a=oq.newItem({id:'aaaaaaaaaaaaaaaa-1',userId:'u1',kind:'docket',label:'A',url:'/x',body:{n:1}},t0);
 assert.equal(a.body.clientRequestId,'aaaaaaaaaaaaaaaa-1','request id travels in the body');
 await st.put(a);await st.put(oq.newItem({id:'bbbbbbbbbbbbbbbb-2',userId:'u1',kind:'docket',label:'B',url:'/x',body:{}},new Date('2026-03-01T00:00:01Z')));
 await st.put(oq.newItem({id:'cccccccccccccccc-3',userId:'u2',kind:'docket',label:'other user',url:'/x',body:{}},t0));
 const sent=[];
 let out=await oq.syncQueue(st,async i=>{sent.push(i.id);return {ok:false,status:0,error:'offline'};},'u1',{now:t0});
 assert.deepEqual(sent,['aaaaaaaaaaaaaaaa-1'],'stops after a connectivity failure; other users\' items are never sent');
 assert.equal(st.m.size,3,'nothing dropped');assert.equal(st.m.get('aaaaaaaaaaaaaaaa-1').status,'failed');
 out=await oq.syncQueue(st,async()=>({ok:true,status:201,body:{}}),'u1',{now:t0});
 assert.deepEqual(out.map(o=>o.id),['bbbbbbbbbbbbbbbb-2'],'backoff defers the failed item; the next due item is sent');
 await st.put(oq.newItem({id:'eeeeeeeeeeeeeeee-5',userId:'u1',kind:'docket',label:'E',url:'/x',body:{}},new Date('2026-03-01T00:00:02Z')));
 await oq.syncQueue(st,async()=>({ok:false,status:0,error:'offline'}),'u1',{now:t0,only:'eeeeeeeeeeeeeeee-5'});
 out=await oq.syncQueue(st,async i=>({ok:true,status:201,body:{id:i.id}}),'u1',{now:t0,reconnected:true,only:'eeeeeeeeeeeeeeee-5'});
 assert.deepEqual(out.map(o=>o.result),['done'],'reconnecting retries immediately, ignoring backoff');
 out=await oq.syncQueue(st,async i=>i.id.startsWith('a')?{ok:false,status:409,body:{error:'Shift cancelled',code:'SHIFT_CANCELLED'}}:{ok:true,status:201,body:{}},'u1',{now:new Date(t0.getTime()+60_000)});
 const kept=st.m.get('aaaaaaaaaaaaaaaa-1');assert.equal(kept.status,'conflict');assert.equal(kept.code,'SHIFT_CANCELLED');assert.equal(kept.lastError,'Shift cancelled');
 out=await oq.syncQueue(st,async()=>{throw new Error('should not auto-retry a conflict');},'u1',{now:new Date(t0.getTime()+3600_000)});
 assert.equal(out.length,0,'conflicts wait for the user');
 out=await oq.syncQueue(st,async()=>({ok:false,status:503,body:{}}),'u1',{force:true,only:'aaaaaaaaaaaaaaaa-1'});
 assert.equal(st.m.get('aaaaaaaaaaaaaaaa-1').status,'failed','manual retry re-attempts; 5xx is retryable');
 out=await oq.syncQueue(st,async()=>({ok:true,status:200,body:{replay:true}}),'u1',{force:true});
 assert.equal(st.m.has('aaaaaaaaaaaaaaaa-1'),false,'removed only after the server accepted (a replay counts)');assert.equal(st.m.size,1);
 await st.put({...oq.newItem({id:'dddddddddddddddd-4',userId:'u1',kind:'incident',label:'D',url:'/x',body:{}}),status:'syncing'});
 await oq.recoverInterrupted(st);assert.equal(st.m.get('dddddddddddddddd-4').status,'failed','interrupted sends are retried');
 assert.equal(oq.backoff(1),2000);assert.equal(oq.backoff(20),oq.MAX_BACKOFF_MS);
 for(const [status,expected] of [[0,'retry'],[408,'retry'],[429,'retry'],[500,'retry'],[400,'conflict'],[403,'conflict'],[409,'conflict'],[422,'conflict']])assert.equal(oq.classify({ok:false,status,body:{}}),expected);
 console.log('PASS offline queue: per-user, ordered, backoff, conflicts retained, manual retry/discard, idempotent replay, interrupted recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
// External adapters (pure parts): ABR parsing/adapter, AI installation gates, billing signatures.
(async()=>{
 const abnLib=load('lib/platform/abn.ts');
 const found='callback({"Abn":"51824753556","AbnStatus":"Active","EntityName":"ALPHA CIVIL PTY LTD","EntityTypeName":"Australian Private Company","Gst":"2001-07-01","BusinessName":["Alpha Civil"],"AddressState":"NSW","AddressPostcode":"2000","Message":""})';
 const r=abnLib.parseAbrResponse(found,'51824753556',new Date('2026-01-01T00:00:00Z'));
 assert.equal(r.status,'found');assert.deepEqual([r.record.entityName,r.record.abnStatus,r.record.gstRegisteredFrom,r.record.source],['ALPHA CIVIL PTY LTD','Active','2001-07-01','ABR']);
 assert.equal(abnLib.parseAbrResponse('callback({"Abn":"","Message":"Search text is not a valid ABN or ACN"})','51824753556').status,'not-found');
 assert.equal(abnLib.parseAbrResponse('callback({"Message":"The GUID entered is not recognised as a Registered Party"})','51824753556').status,'error');
 assert.equal(abnLib.parseAbrResponse('<html>','51824753556').status,'error');
 assert.equal(abnLib.parseAbrResponse(found,'53004085616').status,'not-found','a record for a different ABN is never accepted');
 assert.equal((await abnLib.abrAdapter({}).lookup('51824753556')).status,'not-configured','no GUID → not configured, never a fake result');
 assert.equal((await abnLib.abrAdapter({ABR_GUID:'g'}).lookup('12345678901')).status,'invalid');
 let seen='';assert.equal((await abnLib.abrAdapter({ABR_GUID:'g u',ABR_BASE_URL:'https://abr.test/json'},async u=>{seen=u;return new Response(found);}).lookup('51 824 753 556')).status,'found');
 assert.equal(seen,'https://abr.test/json/AbnDetails.aspx?abn=51824753556&callback=callback&guid=g%20u');
 assert.equal((await abnLib.abrAdapter({ABR_GUID:'g'},async()=>new Response('x',{status:500})).lookup('51824753556')).status,'error');
 assert.equal((await abnLib.abrAdapter({ABR_GUID:'g'},async()=>{throw new TypeError('offline');}).lookup('51824753556')).status,'error');
 const ai=load('lib/platform/ai.ts');
 assert.equal(ai.aiEnvReady({OPENAI_API_KEY:'k',AI_API_KEY:'k',AI_PROVIDER:'openai',AI_MODEL:'m'}),false,'a provider key alone never enables AI');
 assert.equal(ai.aiEnvReady({AI_ENABLED:'true'}),false,'the flag alone is not enough');
 assert.equal(ai.aiEnvReady({AI_ENABLED:'true',AI_PROVIDER:'anthropic',AI_API_KEY:'k'}),false,'a model must be named');
 assert.equal(ai.aiEnvReady({AI_ENABLED:'true',AI_PROVIDER:'anthropic',AI_API_KEY:'k',AI_MODEL:'m'}),true);
 assert.equal(ai.aiEnvReady({AI_ENABLED:'yes',AI_PROVIDER:'anthropic',AI_API_KEY:'k',AI_MODEL:'m'}),false);
 assert.deepEqual(ai.jsonFrom('Sure: {"a":1} thanks'),{a:1});assert.throws(()=>ai.jsonFrom('no json'),/did not contain JSON/);
 let request;const prov=ai.providerFromEnv({AI_PROVIDER:'anthropic',AI_API_KEY:'k',AI_MODEL:'m',AI_BASE_URL:'https://ai.test'},async(u,i)=>{request={u,i};return new Response(JSON.stringify({model:'m',content:[{type:'text',text:'{"x":1}'}],usage:{input_tokens:5,output_tokens:7}}));});
 assert.deepEqual(await prov({system:'s',prompt:'p',maxTokens:10}),{text:'{"x":1}',inputTokens:5,outputTokens:7,model:'m'});assert.equal(request.u,'https://ai.test/v1/messages');assert.equal(request.i.headers['x-api-key'],'k');
 const bill=load('lib/platform/billing.ts');
 const raw='{"id":"evt_1"}',now=1_800_000_000,sig=bill.sign('secret',raw,now);
 assert.equal(bill.verifySignature('secret',raw,sig,now),true);
 assert.equal(bill.verifySignature('secret',raw+' ',sig,now),false,'tampered body');
 assert.equal(bill.verifySignature('other',raw,sig,now),false,'wrong secret');
 assert.equal(bill.verifySignature('secret',raw,sig,now+301),false,'replayed outside tolerance');
 assert.equal(bill.verifySignature('secret',raw,null,now),false);assert.equal(bill.verifySignature(undefined,raw,sig,now),false);
 assert.equal(bill.verifySignature('secret',raw,'t=1,v1=zz',now),false);
 const ents=bill.entitlementsFor('active',['pipeline','estimating']);assert.equal(ents.pipeline,'active');assert.equal(ents.commercial,'read_only');assert.equal(ents.core,undefined);
 assert(Object.values(bill.entitlementsFor('cancelled',['pipeline'])).every(v=>v==='read_only'),'cancellation keeps data read-only, never deleted');
 assert.equal(bill.entitlementsFor('past_due',['pipeline']).pipeline,'active','payment failure has a grace period');
 assert.equal(bill.billingConfigured({BILLING_PROVIDER:'x'}),false);assert.equal(bill.isPlatformOperator('Ops@Example.com',{PLATFORM_OPERATOR_EMAILS:'ops@example.com, x@y.z'}),true);assert.equal(bill.isPlatformOperator('a@b.c',{}),false);
 console.log('PASS adapters: ABR parse/adapter (not-configured/invalid/found/not-found/errors), AI gates (key alone never enables), provider call shape, billing signatures/tolerance/entitlement mapping');
})().catch(e=>{console.error(e);process.exitCode=1;});
// CRM matching: deterministic, normalised comparison; uncertain signals are only "possible".
{const m=load('lib/v1/crm-match.ts');
 assert.equal(m.abnDigits('51 824 753 556'),'51824753556');assert.equal(m.strongAbn('51 824 753 556'),'51824753556');assert.equal(m.strongAbn('51 824 753 557'),null,'an ABN with a bad checksum never matches');
 assert.equal(m.nameKey('  ABC   Civil Pty. Ltd. '),'abc civil pty ltd');assert.equal(m.coreNameKey('ABC Civil Pty Ltd'),'abc civil');assert.equal(m.coreNameKey('The ABC Civil Group'),'abc civil');
 assert.equal(m.phoneKey('+61 2 9000 0000'),'0290000000');assert.equal(m.phoneKey('12'),null);assert.equal(m.emailDomain('a@Example.com.au'),'example.com.au');assert.equal(m.emailDomain('a@gmail.com'),null,'free mail says nothing about the company');
 const existing=[{id:'a',name:'Abergeldie',legalName:'Abergeldie Complex Infrastructure Pty Ltd',abn:'51824753556',clientCode:'ABG',email:'office@abergeldie.com.au',phone:'02 9000 0000',status:'active'},{id:'b',name:'Example Civil',legalName:null,abn:null,clientCode:null,status:'active'},{id:'c',name:'Example Civil',legalName:null,abn:null,clientCode:null,status:'active'},{id:'d',name:'Old Name',abn:'53004085616',status:'merged'}];
 assert.equal(m.matchClient({name:'Anything',abn:'51 824 753 556'},existing).match.id,'a','valid ABN is a strong match');
 assert.equal(m.matchClient({name:'x',clientCode:' abg '},existing).match.id,'a','client code is a strong match');
 assert.equal(m.matchClient({name:'abergeldie  complex infrastructure pty ltd'},existing).match.id,'a','exact normalised legal name');
 assert.equal(m.matchClient({name:'Abergeldie',abn:'53 004 085 616'},existing).kind,'possible','same name but a different ABN is never merged');
 assert.equal(m.matchClient({name:'Example Civil'},existing).kind,'possible','two clients with one name are never guessed');
 assert.equal(m.matchClient({name:'Abergeldie Group'},existing).kind,'possible','suffix-insensitive similarity is only a suggestion');
 assert.equal(m.matchClient({name:'New Co',email:'jo@abergeldie.com.au'},existing).kind,'possible','shared business email domain is a suggestion');
 assert.equal(m.matchClient({name:'Brand New Pty Ltd'},existing).kind,'none');
 assert.equal(m.matchClient({name:'Old Name',abn:'53004085616'},existing).kind,'none','merged clients never match');
 const contacts=[{id:'k1',clientId:'a',name:'Guy Beca',email:'guy@abergeldie.com.au',phone:'0400 000 001',status:'active'},{id:'k2',clientId:'b',name:'Guy Beca',status:'active'}];
 assert.equal(m.matchContact('a',{name:'Someone',email:'GUY@abergeldie.com.au'},contacts).match.id,'k1','same email within the client');
 assert.equal(m.matchContact('a',{name:'guy  beca'},contacts).match.id,'k1','same name within the client');
 assert.equal(m.matchContact('a',{name:'Guy Beca',email:'other@abergeldie.com.au'},contacts).kind,'possible','same name, different email → a person decides');
 assert.equal(m.matchContact('a',{name:'G B',mobile:'+61 400 000 001'},contacts).kind,'possible','same phone only → possible');
 assert.equal(m.matchContact('c',{name:'Guy Beca'},contacts).kind,'none','contacts never match across clients');
 const sites=[{id:'s1',clientId:'a',name:'Dover Road',address:'1 Dover Rd, Rose Bay',status:'active'}];
 assert.equal(m.matchSite('a',{name:'dover road'},sites).match.id,'s1');assert.equal(m.matchSite('a',{name:'Depot',address:'1 Dover Rd,  Rose Bay'},sites).match.id,'s1','same exact address');assert.equal(m.matchSite('b',{name:'Dover Road'},sites).kind,'none');
 assert.equal(m.legacyClientFor('Example Civil',existing).status,'ambiguous','two candidates → not linked');assert.equal(m.legacyClientFor(' abergeldie ',existing).client.id,'a');assert.equal(m.legacyClientFor('Aberg',existing).status,'none','partial names never link');
 const imp=load('lib/platform/crm-import.ts')._test;
 let errors=[],warnings=[];let v=imp.clientValues({legalName:'Legal Only Pty Ltd',abn:'51 824 753 556',email:'x@y.com',paymentTermsDays:'30',status:'Inactive'},false,errors,warnings);
 assert.deepEqual(errors,[]);assert.equal(v.name,'Legal Only Pty Ltd','legal name stands in when there is no trading name');assert.equal(v.abn,'51824753556');assert.equal(v.status,'inactive');assert.equal(v.paymentTermsDays,undefined,'commercial columns ignored without commercial access');assert(warnings.length);
 errors=[];v=imp.clientValues({name:'Bad',abn:'123',email:'nope',paymentTermsDays:'many'},true,errors,[]);assert.equal(errors.length,3,'invalid ABN, email and terms are row errors');
 assert.equal(imp.guessKind('Contacts'),'contacts');assert.equal(imp.guessKind('Site list'),'sites');assert.equal(imp.guessKind('Customers'),'clients');
 const ExcelJS=require('exceljs'),sp=load('lib/platform/spreadsheet.ts'),wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Customers');ws.addRow(['Company','ABN','Contact','Mystery column']);ws.addRow(['ABC Civil','51 824 753 556','Sam Lee','x']);ws.addRow([]);ws.addRow(['DEF Roads','','','']);
 const parsed=sp.parseSheet(ws,imp.DEFS.clients);assert.deepEqual(parsed.heads.map(h=>h.key),['name','abn','contactName',null],'common headings map, unknown ones stay unmapped');assert.equal(parsed.rows.length,2,'blank rows skipped');
 const manual=sp.parseSheet(ws,imp.DEFS.clients,{'Mystery column':'notes'});assert.equal(manual.heads[3].key,'notes','manual mapping applies');
 assert.throws(()=>sp.parseSheet(ws,imp.DEFS.clients,{'Mystery column':'name'}),/More than one column/,'two columns cannot map to one field');}
// CRM capabilities: quick create for workflow roles; master edit and administration for Admin/Office only.
{const crm={admin:['crm.create','crm.edit','crm.manage'],office:['crm.create','crm.edit','crm.manage'],estimator:['crm.create'],scheduler:['crm.create'],project_manager:['crm.create'],project_engineer:[],site_engineer:[],supervisor:[],field:[],accounts:[],read_only:[]};
 for(const [r,caps] of Object.entries(crm))for(const c of ['crm.create','crm.edit','crm.manage'])assert.equal(perm.can(r,c),caps.includes(c),`${r} ${caps.includes(c)?'needs':'must not have'} ${c}`);
 for(const r of perm.ROLES)if(!perm.can(r,'commercial.view'))assert.equal(perm.can(r,'crm.edit')&&!perm.can(r,'commercial.view'),false,r+': CRM capability never implies commercial access');}
console.log('PASS CRM matching: ABN/phone/email normalisation, deterministic client/contact/site matching, possible duplicates, legacy linking, import value validation and heading mapping');
const {parsePastedItems}=load('lib/v1/estimate-paste.ts');
const pasted=parsePastedItems('Description\tQty\tUnit\tRate\nProfile 50mm\t1,200\tm2\t$4.50\nAC14\t180\tt\t165\tmaterial\tWearing\nbad row\tx\tm\t1',  'General',i=>'i'+i);
assert.equal(pasted.items.length,2);assert.equal(pasted.items[0].quantity,1200);assert.equal(pasted.items[0].rate,4.5);assert.equal(pasted.items[0].category,'other');assert.equal(pasted.items[1].category,'material');assert.equal(pasted.items[1].section,'Wearing');assert.deepEqual(pasted.skipped,[4]);
console.log('PASS estimate paste: header skipped, $ and thousands parsed, category/section, bad rows reported');
{
 const B=load('lib/v1/schedule-board.ts');
 const worker={id:'w1',name:'Taylor',status:'Available',metadata:{roleTitle:'Traffic Controller',employeeNumber:'E1'}};
 const plant={id:'p1',name:'TMA001',status:'Available',metadata:{type:'TMA',plantNumber:'TMA001'}};
 assert.equal(B.defaultAssignmentRole(worker,'workers'),'Traffic Controller');
 assert.equal(B.defaultAssignmentRole(plant,'plant'),'TMA');
 assert.deepEqual(B.quickAssignment(plant,'plant'),{resourceId:'p1',category:'plant',name:'TMA001',role:'TMA',hours:8,rate:0,payload:0,trips:0});
 const req=[{category:'plant',role:'TMA',quantity:1}],assigned=[];
 const ranked=B.rankResources([
  plant,
  {id:'p2',name:'Roller 1',status:'Available',metadata:{type:'Roller'}},
 ],'plant',req,assigned,{p1:{tone:'ok',text:'Available'},p2:{tone:'ok',text:'Available'}});
 assert.equal(ranked[0].id,'p1','resource that fills the missing requirement is suggested first');
 const blocked=B.rankResources([plant,{id:'p3',name:'TMA002',status:'Available',metadata:{type:'TMA'}}],'plant',req,assigned,{p1:{tone:'block',text:'Booked'},p3:{tone:'ok',text:'Available'}});
 assert.equal(blocked[0].id,'p3','available matching resource ranks before a blocked matching resource');
 console.log('PASS schedule board helpers: default roles, quick assignment, requirement fit and availability ranking');
}
(async()=>{
 const L=load('lib/v1/location.ts'),P=load('lib/platform/location-provider.ts'),S=load('lib/platform/locations.ts');
 // Address components map from both Places (New) and Geocoding shapes; free text is never parsed into parts.
 const parts=L.mapAddressComponents([{longText:'24',shortText:'24',types:['street_number']},{longText:'York Road',shortText:'York Rd',types:['route']},{longText:'Ingleburn',shortText:'Ingleburn',types:['locality']},{longText:'New South Wales',shortText:'NSW',types:['administrative_area_level_1']},{longText:'2565',shortText:'2565',types:['postal_code']},{longText:'Australia',shortText:'AU',types:['country']}]);
 assert.deepEqual(parts,{addressLine1:'24 York Road',addressLine2:null,locality:'Ingleburn',state:'NSW',postcode:'2565',country:'AU'});
 const noNumber=L.mapAddressComponents([{long_name:'Dover Road',short_name:'Dover Rd',types:['route']},{long_name:'Rose Bay',short_name:'Rose Bay',types:['locality']}]);
 assert.equal(noNumber.addressLine1,'Dover Road','no street number is invented');
 assert.deepEqual(L.mapAddressComponents(null),L.EMPTY_PARTS);
 assert.equal(L.placeResultKind(['street_address']),'ADDRESS','Place type describes the result, not rooftop coordinate accuracy');
 assert.equal(L.placeResultKind(['intersection']),'INTERSECTION');
 assert.equal(L.placeResultKind(['route']),'ROUTE');
 assert.equal(L.placeResultKind(['establishment']),'PLACE');
 assert.equal(L.validPoint({lat:0,lng:0}),false);assert.equal(L.validPoint({lat:-91,lng:0}),false);assert.equal(L.validPoint({lat:-33.9,lng:150.8}),true);
 assert.equal(L.pinState({geocoded:null,pin:null}),'none');assert.equal(L.pinState({geocoded:{lat:-33,lng:150},pin:{lat:-33,lng:150}}),'address');
 assert.equal(L.pinState({geocoded:{lat:-33,lng:150},pin:{lat:-33.001,lng:150}}),'adjusted');assert.equal(L.pinState({geocoded:null,pin:{lat:-33,lng:150}}),'manual');
 assert.equal(L.directionsUrl({pin:{lat:-33.999,lng:150.862},geocoded:{lat:-33.9985,lng:150.8612}}),'https://www.google.com/maps/dir/?api=1&destination=-33.9990000,150.8620000','directions go to the exact pin');
 assert.equal(L.directionsUrl(null),null);
 // Provider modes: no key means manual entry; a browser key never implies a server key.
 assert.deepEqual(P.locationConfig({}),{provider:'none',mode:'none',browserKey:null,mapId:null,region:'au'});
 assert.equal(P.locationConfig({LOCATION_PROVIDER:'fake'}).mode,'server');
 const g=P.locationConfig({GOOGLE_MAPS_BROWSER_KEY:'browser-key'});assert.equal(g.provider,'google');assert.equal(g.mode,'browser');assert.equal(g.mapId,'DEMO_MAP_ID');
 assert.equal(P.serverProvider({GOOGLE_MAPS_BROWSER_KEY:'browser-key'}),null,'the browser key is never used server-side');
 assert.equal(P.serverProvider({}),null);
 // Fake provider fixtures (CI makes no Google calls).
 const fp=P.fakeProvider,sug=await fp.autocomplete('24 York Road Ingleburn','t','au');assert.equal(sug[0].placeId,'fake-york-rd-ingleburn');
 const place=await fp.place('fake-york-rd-ingleburn','t');assert.equal(place.precision,'ROOFTOP');
 await assert.rejects(fp.autocomplete('offline','t','au'),P.ProviderUnavailable);
 assert.equal(await fp.reverse({lat:-12.3,lng:130.8}),null,'unknown points get no invented address');
 await assert.rejects(fp.reverse({lat:-1,lng:-1}));
 // Column rules: pin defaults to the geocoded point; a moved pin keeps the geocoded point; manual clears provider data.
 const base={...place,placeId:place.placeId,provider:'fake',source:'autocomplete',geocoded:place.point,pin:null};
 const c1=S.locationColumns(base);assert.equal(c1.pin_lat,c1.geocoded_lat);assert.equal(c1.pin_adjusted,0);assert.equal(c1.provider_place_id,'fake-york-rd-ingleburn');assert.equal(c1.pin_address,null);
 const c2=S.locationColumns({...base,pin:{lat:-33.999,lng:150.862},pinAddress:'Yard entrance, York Road'});assert.equal(c2.pin_adjusted,1);assert.equal(c2.geocoded_lat,-33.9985);assert.equal(c2.pin_address,'Yard entrance, York Road');assert.ok(c2.reverse_geocoded_at);
 const c3=S.locationColumns({...base,pin:place.point,pinAddress:'ignored'});assert.equal(c3.pin_adjusted,0,'reset pin to address');assert.equal(c3.pin_address,null);
 const c4=S.locationColumns({...base,source:'manual',pin:{lat:-33.9,lng:150.9}});assert.equal(c4.provider_place_id,null);assert.equal(c4.geocoded_lat,null);assert.equal(c4.precision,'manual');assert.equal(c4.source,'manual');assert.equal(c4.pin_adjusted,0);
 const c5=S.locationColumns({...L.EMPTY_PARTS,addressLine1:'Lot 7 Quarry Road',locality:'Marulan',source:'manual'});assert.equal(c5.formatted_address,'Lot 7 Quarry Road, Marulan');assert.equal(c5.pin_lat,null);
 assert.throws(()=>S.locationColumns({...L.EMPTY_PARTS,source:'manual'}),'an empty location is rejected');
 assert.throws(()=>S.locationColumns({...L.EMPTY_PARTS,source:'manual',pin:{lat:0,lng:0}}));
 console.log('PASS locations: address components, pin state, directions, provider modes, fake provider, geocoded vs exact pin columns, manual entry');
})().catch(e=>{console.error(e);process.exit(1);});
{
 const F=load('lib/v1/forms.ts'),Pm=load('lib/platform/permissions.ts');
 const schema={sections:[{id:'checks',title:'Checks',fields:[
  {id:'plant_safe',type:'boolean',label:'Plant safe to operate?',required:true},
  {id:'describe_defect',type:'textarea',label:'Describe the defect',required:true,showIf:{field:'plant_safe',op:'eq',value:'false'}},
  {id:'hazards',type:'multiselect',label:'Hazards',options:[{value:'noise',label:'Noise'},{value:'dust',label:'Dust'}]},
  {id:'dust_control',type:'select',label:'Dust control',options:[{value:'water',label:'Water cart'},{value:'none',label:'None'}],required:true,showIf:{field:'hazards',op:'in',value:['dust']}},
  {id:'notes',type:'text',label:'Notes',showIf:{field:'describe_defect',op:'answered'}},
  {id:'ack',type:'checkbox',label:'I have read the SWMS',required:true},
 ]}]};
 assert.deepEqual(F.checkSchema(schema).errors,[]);
 // Structural rules: forward references, duplicate ids, missing options, bad option values, publish needs a field.
 assert(F.checkSchema({sections:[{id:'s',title:'S',fields:[{id:'a',type:'text',label:'A',showIf:{field:'b',op:'answered'}},{id:'b',type:'text',label:'B'}]}]}).errors[0].includes('earlier field'));
 assert(F.checkSchema({sections:[{id:'s',title:'S',fields:[{id:'a',type:'text',label:'A'},{id:'a',type:'text',label:'A2'}]}]}).errors.some(e=>e.includes('used twice')));
 assert(F.checkSchema({sections:[{id:'s',title:'S',fields:[{id:'a',type:'select',label:'A'}]}]}).errors.some(e=>e.includes('option')));
 assert(F.checkSchema({sections:[{id:'s',title:'S',fields:[{id:'a',type:'select',label:'A',options:[{value:'x',label:'X'}]},{id:'b',type:'text',label:'B',showIf:{field:'a',op:'eq',value:'y'}}]}]}).errors.some(e=>e.includes('not an option')));
 assert(F.checkSchema({sections:[{id:'s',title:'S',fields:[]}]},{forPublish:true}).errors.some(e=>e.includes('at least one field')));
 assert(F.checkSchema({sections:[{id:'Bad Id',title:'S',fields:[]}]}).errors.length,'ids are stable machine keys');
 // Visibility is deterministic and chained: hidden parents hide dependants.
 assert.deepEqual([...F.visibleFields(schema,{plant_safe:true})].sort(),['ack','hazards','plant_safe']);
 assert([...F.visibleFields(schema,{plant_safe:false,describe_defect:'Cracked hose'})].includes('notes'));
 assert(![...F.visibleFields(schema,{plant_safe:true,describe_defect:'stale'})].includes('notes'),'a condition on a hidden field sees it unanswered');
 // Validation: required, conditional required, hidden values dropped, invalid choice, unknown field, checkbox must be ticked.
 let r=F.validateShape(schema,{plant_safe:true,ack:true,describe_defect:'left over',hazards:['noise']});
 assert.deepEqual(r.errors,[]);assert.equal(r.values.describe_defect,undefined,'hidden conditional values are never stored');assert.deepEqual(r.values.hazards,['noise']);
 r=F.validateShape(schema,{plant_safe:false,ack:true});assert(r.errors.some(e=>e.field==='describe_defect'),'visible conditional required enforced');
 r=F.validateShape(schema,{plant_safe:true,ack:true,hazards:['dust']});assert(r.errors.some(e=>e.field==='dust_control'),'"in" condition makes a required field visible');
 r=F.validateShape(schema,{plant_safe:true,ack:true,hazards:['smoke']});assert(r.errors.some(e=>e.field==='hazards'),'invalid multi-select value');
 r=F.validateShape(schema,{plant_safe:true,ack:true,hazards:['dust'],dust_control:'teleport'});assert(r.errors.some(e=>e.field==='dust_control'),'invalid single choice');
 r=F.validateShape(schema,{plant_safe:true,ack:true,sneaky:'x'});assert(r.errors.some(e=>e.field==='sneaky'),'unknown field rejected');
 r=F.validateShape(schema,{plant_safe:true,ack:false});assert(r.errors.some(e=>e.field==='ack'),'required acknowledgement must be ticked');
 r=F.validateShape(schema,{plant_safe:'yes',ack:true});assert(r.errors.some(e=>e.field==='plant_safe'),'booleans are typed');
 // Reference types are collected for the server to verify; signatures need a name and confirmation.
 const refSchema={sections:[{id:'s',title:'S',fields:[{id:'who',type:'person',label:'Who'},{id:'rig',type:'asset',label:'Rig'},{id:'pics',type:'photo',label:'Photos'},{id:'where',type:'location',label:'Where'},{id:'sig',type:'signature',label:'Sign',required:true},{id:'qty',type:'number',label:'Qty',min:0,max:10},{id:'on',type:'date',label:'On'}]}]};
 r=F.validateShape(refSchema,{who:'u1',rig:'p1',pics:['d1','d1'],where:{addressLine1:'1 Road'},sig:{name:'Casey',confirmed:true,documentId:'d2'},qty:'4',on:'2026-10-01'});
 assert.deepEqual(r.errors,[]);assert.deepEqual(r.refs,{people:['u1'],assets:['p1'],documents:['d1','d2']});assert.deepEqual(r.values.pics,['d1']);assert.equal(r.values.qty,4);assert(r.locations.where);
 assert(F.validateShape(refSchema,{sig:{name:'Casey',confirmed:false}}).errors.some(e=>e.field==='sig'));
 assert(F.validateShape(refSchema,{sig:{name:'C',confirmed:true},qty:11}).errors.some(e=>e.field==='qty'));
 assert(F.validateShape(refSchema,{sig:{name:'C',confirmed:true},on:'01/10/2026'}).errors.some(e=>e.field==='on'));
 assert(F.validateShape(refSchema,{sig:{name:'C',confirmed:true},pics:'data:image/png;base64,AAAA'}).errors.some(e=>e.field==='pics'),'no inline binary in responses');
 assert.deepEqual(F.changedFields({a:1,b:[1]},{a:1,b:[2],c:3}),['b','c']);
 assert.equal(F.fieldIdFrom('Is the plant safe?',new Set(['is_the_plant_safe'])),'is_the_plant_safe_2');
 // Capabilities: field workers view/submit only; managers and publishers are distinct; amendment is deliberate.
 for(const c of ['forms.view','forms.submit'])assert(Pm.can('field',c));
 for(const c of ['forms.manage','forms.publish','forms.amend'])assert(!Pm.can('field',c),'field cannot '+c);
 assert(Pm.can('project_manager','forms.publish')&&Pm.can('project_manager','forms.manage')&&Pm.can('office','forms.publish'));
 assert(Pm.can('project_engineer','forms.amend')&&!Pm.can('project_engineer','forms.manage')&&!Pm.can('site_engineer','forms.publish'));
 assert(Pm.can('read_only','forms.view')&&!Pm.can('read_only','forms.submit'));
 assert(!Pm.can('accounts','forms.view'));
 // workshop.defect.report is a narrow reporting authority: not repair, verify or Workshop administration.
 for(const r of ['admin','office','scheduler','project_manager','project_engineer','site_engineer','supervisor','field'])assert(Pm.can(r,'workshop.defect.report'),r+' can report defects');
 for(const r of ['estimator','accounts','read_only'])assert(!Pm.can(r,'workshop.defect.report'),r+' cannot report defects');
 for(const r of ['field','supervisor','site_engineer','project_engineer','project_manager'])assert(!Pm.can(r,'workshop.edit')&&!Pm.can(r,'workshop.verify'),r+' reporting grants no repair/verify');
assert.equal(load('lib/platform/modules.ts').MODULE_SEAMS['form.defect'].capability,'workshop.defect.report');
 console.log('PASS forms engine: schema rules, stable ids, deterministic chained conditions, hidden values dropped, required/conditional required, typed values and choices, unknown fields, references and signatures, changed fields, capabilities');
}
{
 const H=load('lib/modules/hseq/corrective.ts'),W=load('lib/platform/workflow.ts'),Pc=load('lib/platform/permissions.ts');
 // hseq.verify: Admin, Office, PM, PE — never field, supervisor, site engineer, scheduler, accounts, estimator, read-only.
 for(const r of ['admin','office','project_manager','project_engineer'])assert(Pc.can(r,'hseq.verify'),r+' verifies');
 for(const r of ['field','supervisor','site_engineer','scheduler','accounts','estimator','read_only'])assert(!Pc.can(r,'hseq.verify'),r+' does not verify');
 // Verification, rework and closure are dedicated actions, never plain status buttons.
 assert.throws(()=>W.assertTransition('action','complete','verified','admin'),/dedicated action/);
 assert.throws(()=>W.assertTransition('action','complete','in_progress','admin'),/dedicated action/);
 assert.throws(()=>W.assertTransition('action','complete','verified','site_engineer',{system:true}),/not authorised/);
 assert.throws(()=>W.assertTransition('ncr','verification','closed','admin'),/dedicated action/);
 assert.throws(()=>W.assertTransition('incident','investigating','closed','admin'),/dedicated action/);
 assert.equal(W.assertTransition('action','in_progress','complete','site_engineer').to,'complete');
 assert(!W.allowedTransitions('action','complete','admin').length,'no generic verify button');
 // Investigation completion needs facts/summary, a finding and a root cause or an explicit "not established".
 assert.equal(H.investigationGaps({}).length,3);
 assert.deepEqual(H.investigationGaps({facts:'x',finding:'y',root_cause_not_established:1}),[]);
 assert.equal(H.investigationGaps({summary:'x',finding:'y',root_cause:''}).length,1,'empty root cause is not a conclusion');
 // Overdue is derived: past due and not verified.
 assert.equal(H.isOverdue({status:'complete',due_date:'2026-01-01'},'2026-02-01'),true);
 assert.equal(H.isOverdue({status:'verified',due_date:'2026-01-01'},'2026-02-01'),false);
 assert.equal(H.isOverdue({status:'open',due_date:null},'2026-02-01'),false);
 // Closure gates.
 assert(H.closureBlockers('incident',{status:'investigating'},{status:'investigating'},[]).some(b=>b.includes('investigation')));
 assert(H.closureBlockers('incident',{status:'reported'},null,[]).some(b=>b.includes('rationale')),'nothing entered is not "no investigation required"');
 assert.deepEqual(H.closureBlockers('incident',{status:'reported'},null,[],{rationale:'Minor spill cleaned; no systemic cause.'}),[]);
 assert(H.closureBlockers('incident',{},{status:'complete'},[{status:'verified'},{status:'complete'}]).some(b=>b.includes('not yet independently verified')));
 assert(H.closureBlockers('ncr',{status:'verification',cause:'c',verification:'ok'},null,[{status:'complete'}]).some(b=>b.includes('verified')),'complete is not verified');
 assert.deepEqual(H.closureBlockers('ncr',{status:'verification',cause:'c'},null,[{status:'verified'}],{verification:'Retested OK'}),[]);
 assert(H.closureBlockers('ncr',{status:'verification'},null,[{status:'verified'}],{verification:'x'}).some(b=>b.includes('cause')));
 assert(H.closureBlockers('ncr',{status:'action',cause:'c',verification:'v'},null,[{status:'verified'}]).some(b=>b.includes('verification first')));
 console.log('PASS HSEQ chain: hseq.verify roles, verification/closure are dedicated actions, investigation completion rules, derived overdue, incident and NCR closure gates');
}
console.log('PASS V1 logic: lifecycle guards, capability matrix and eleven-role route gate, primary navigation, legacy route resolution, Home quick actions, ABN checksum, forecast/claim/GST/retention arithmetic, risk ratings, register identifiers, estimate items, docket cost lines, legacy stage mapping, scheduling conflict engine, legacy resource mapping');
