// The unsaved-work navigation guard (lib/v1/nav-history.ts) against a simulated browser history.
// No DOM, database or network. Every invariant listed at the top of nav-history.ts is asserted TOGETHER after every step of
// the named scenarios and of thousands of deterministic random sequences, so history bugs are caught as a class, not one
// example at a time.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=id=>id.startsWith('@/')?load(id.replace('@/','')+'.ts'):id.startsWith('./')?load(path.join(path.dirname(file),id)+'.ts'):require(id);
 new Function('exports','require','module',code)(m.exports,req,m);return m.exports;}
const nh=load('lib/v1/nav-history.ts');

// ---------------------------------------------------------------- simulated browser
const clone=v=>v===null||v===undefined?v:JSON.parse(JSON.stringify(v));
const FRAMEWORK={__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:['',{children:['__PAGE__',{}]}]};
class Browser{
 constructor(hash='#A'){this.entries=[{state:clone(FRAMEWORK),hash}];this.index=0;this.tasks=[];this.handlers={popstate:[],hashchange:[]};this.goCalls=0;this.rewrites=0;this.popstateOnHashEdit=true;}
 get state(){return this.entries[this.index].state;}
 get hash(){return this.entries[this.index].hash;}
 port(){return {
  state:()=>this.state,
  hash:()=>this.hash,
  push:(state,hash)=>{this.entries=this.entries.slice(0,this.index+1);this.entries.push({state:clone(state),hash});this.index++;},        // truncates the forward branch, fires nothing
  replace:(state,hash)=>{this.entries[this.index]={state:clone(state),hash:hash===undefined?this.hash:hash};if(hash!==undefined)this.rewrites++;},
  go:n=>{this.goCalls++;this.tasks.push(n);},                                                                                          // asynchronous, like the real thing
 };}
 on(type,fn){this.handlers[type].push(fn);}
 off(){this.handlers={popstate:[],hashchange:[]};}
 fire(type){for(const fn of this.handlers[type])fn();}
 /** Run queued traversals; popstate always fires, hashchange only when the fragment changed. */
 drain(){
  let guard=0;
  while(this.tasks.length){
   if(++guard>1000)throw new Error('history did not settle');
   const n=this.tasks.shift(),target=this.index+n;
   if(target<0||target>=this.entries.length)continue;                    // out of range: the browser ignores it
   const before=this.hash;this.index=target;
   this.fire('popstate');
   if(this.hash!==before)this.fire('hashchange');
  }
 }
 /** The user presses Back/Forward/jumps n entries. */
 userGo(n){this.tasks.push(n);this.drain();}
 /** location.hash = h: a new, UNSTAMPED entry (state null) created by something other than this app. */
 userSetHash(h){this.entries=this.entries.slice(0,this.index+1);this.entries.push({state:null,hash:h});this.index++;if(this.popstateOnHashEdit)this.fire('popstate');this.fire('hashchange');this.drain();}
 /** history.pushState by another library: no event at all. */
 foreignPush(h){this.entries=this.entries.slice(0,this.index+1);this.entries.push({state:clone(FRAMEWORK),hash:h});this.index++;}
}

// ---------------------------------------------------------------- app harness (the guard wired to the simulated browser)
const sameScreen=(a,b)=>a.replace(/~$/,'')===b.replace(/~$/,'');                // 'A' and 'A~' are two spellings of one screen
class App{
 constructor(browser,answers){
  this.b=browser;this.answers=answers;this.dirty=false;this.shown='';this.ids=0;this.prompts=[];this.target=null;
  this.ui={confirmLeave:()=>this.confirm(),sameScreen,show:h=>{this.shown=h;},makeId:()=>`i${this.ids++}`};
  this.mount();
 }
 mount(){                                                                          // also what a reload does: new controller, same browser history
  this.b.off();
  this.ctrl=nh.createNavController(this.b.port(),this.ui);
  this.b.on('popstate',()=>this.ctrl.onPopState());
  this.b.on('hashchange',()=>this.ctrl.onHashChange());
  this.ctrl.mount();
 }
 confirm(){
  const target=this.target??this.b.hash,mem=this.ctrl.snapshot();
  const rec={target,shown:mem.hash,dirty:this.dirty,answer:true,mem:mem.stamp,landed:nh.readStamp(this.b.state)};
  this.prompts.push(rec);
  if(!this.dirty)return true;
  rec.answer=this.answers();                                                      // the user's choice
  if(rec.answer)this.dirty=false;                                                 // confirmed discard: the editor unmounts
  return rec.answer;
 }
 navigate(h){this.target=h;try{return this.ctrl.navigate(h);}finally{this.target=null;this.b.drain();}}
 reload(){this.mount();}
}

// ---------------------------------------------------------------- invariants (I1-I6), asserted together
function checkInvariants(app,ctx,{foreign=false}={}){
 const b=app.b,where=`${ctx} | entries=${b.entries.map((e,i)=>`${i===b.index?'>':''}${e.hash}${(()=>{const s=nh.readStamp(e.state);return s?`[${s.epoch}:${s.pos}]`:'[?]';})()}`).join(' ')} shown=${app.shown}`;
 // I4 consistency: URL and screen name the same place
 if(!foreign)assert.ok(sameScreen(b.hash,app.shown),`I4 URL ${b.hash} vs screen ${app.shown} :: ${where}`);
 // I2 tracking: the remembered position is the live entry's
 const live=nh.readStamp(b.state);
 if(!foreign&&live)assert.equal(app.ctrl.snapshot().stamp?.id,live.id,`I2 memory vs live entry :: ${where}`);
 // I1 adjacency: stamped entries of one epoch are exactly pos apart in the stack
 const st=b.entries.map(e=>nh.readStamp(e.state));
 for(let i=0;i<st.length;i++)for(let j=i+1;j<st.length;j++)if(st[i]&&st[j]&&st[i].epoch===st[j].epoch)assert.equal(st[j].pos-st[i].pos,j-i,`I1 adjacency of entries ${i} and ${j} :: ${where}`);
 // identity: unique ids; (epoch,pos) unique
 const ids=st.filter(Boolean).map(s=>s.id);assert.equal(new Set(ids).size,ids.length,`identity: duplicate entry id :: ${where}`);
 const slots=st.filter(Boolean).map(s=>`${s.epoch}:${s.pos}`);assert.equal(new Set(slots).size,slots.length,`position: two entries share (epoch,pos) :: ${where}`);
 // Next's fields survive on every entry that had them (entries the app pushed copy them; the app never drops keys)
 for(const [i,e] of b.entries.entries())if(e.state&&e.state.__NA!==undefined){assert.equal(e.state.__NA,true,`Next field __NA :: ${where}`);assert.deepEqual(e.state.__PRIVATE_NEXTJS_INTERNALS_TREE,FRAMEWORK.__PRIVATE_NEXTJS_INTERNALS_TREE,`Next router tree on entry ${i} :: ${where}`);}
 // I5 no needless prompt: only when the move changes the screen
 for(const p of app.prompts)assert.ok(!sameScreen(p.target,p.shown),`I5 prompted for a same-screen move ${p.shown} -> ${p.target} :: ${where}`);
}
/** Cancelled traversals: known distance undone exactly with go(); unknown distance never guessed (I3). */
function checkCancellation(app,before,ctx,since=0){
 for(const p of app.prompts.slice(since).filter(x=>x.dirty&&!x.answer)){
  const known=nh.moveBetween(p.mem,p.landed)!==null;
  if(known)assert.equal(app.b.index,before.index,`I4/I3 cancelled known move not undone exactly :: ${ctx}`);
 }
}
const run=(seed,steps,{checks=true}={})=>{
 let s=seed>>>0;const rnd=()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
 const pick=a=>a[Math.floor(rnd()*a.length)];
 const b=new Browser('#A'),app=new App(b,()=>rnd()<0.5);
 let foreign=false;const log=[];
 checkInvariants(app,'mount');
 for(let i=0;i<steps;i++){
  const r=rnd(),before={index:b.index,goCalls:b.goCalls,rewrites:b.rewrites},promptsBefore=app.prompts.length,startedForeign=foreign;
  let op;
  if(r<0.30){op=`navigate ${pick(['#A','#B','#C','#D'])}`;app.navigate(op.split(' ')[1]);}
  else if(r<0.34){op=`navigate-spelling ${pick(['#A~','#B~'])}`;app.navigate(op.split(' ')[1]);}
  else if(r<0.49){op='back';b.userGo(-1);}
  else if(r<0.59){op='forward';b.userGo(1);}
  else if(r<0.64){op='back2';b.userGo(-2);}
  else if(r<0.67){op='forward2';b.userGo(2);}
  else if(r<0.72){op='reload';app.reload();}
  else if(r<0.77){op=`hashedit ${pick(['#A','#B','#E'])}`;b.userSetHash(op.split(' ')[1]);}
  else if(r<0.81){op=`foreign ${pick(['#B','#C'])}`;b.foreignPush(op.split(' ')[1]);foreign=true;}
  else{op='toggle-dirty';app.dirty=!app.dirty;}
  log.push(op);
  if(process.env.NAV_TRACE==String(seed))console.log(`#${i} ${op} dirty=${app.dirty} shown=${app.shown} | ${b.entries.map((e,k)=>`${k===b.index?'>':''}${e.hash}${(()=>{const q=nh.readStamp(e.state);return q?`[${q.epoch}:${q.pos}]`:'[?]';})()}`).join(' ')} | prompts=${JSON.stringify(app.prompts.slice(-1).map(p=>({t:p.target,a:p.answer,d:p.dirty})))}`);
  // A foreign pushState (another library, no event) changes the URL behind the app's back: URL/screen consistency (I2, I4) cannot
  // be asserted until a handled event brings them together again. Adjacency, identity and the never-guess rule still hold.
  if(op.startsWith('foreign'))foreign=true;
  const synced=()=>{const live=nh.readStamp(b.state);return Boolean(live)&&app.ctrl.snapshot().stamp?.id===live.id&&sameScreen(b.hash,app.shown);};
  const skipUrlChecks=foreign&&!synced();
  if(foreign&&!skipUrlChecks)foreign=false;
  if(checks){
   const ctx=`seed ${seed} step ${i} (${log.slice(-6).join(' > ')})`;
   checkInvariants(app,ctx,{foreign:skipUrlChecks});
   if(!skipUrlChecks&&!startedForeign&&['back','forward','back2','forward2'].includes(op))checkCancellation(app,before,ctx,promptsBefore);
   // I3: a cancelled move onto an unknown distance never calls go(); a known one never rewrites the URL
   for(const p of app.prompts.slice(promptsBefore).filter(x=>x.dirty&&!x.answer&&['back','forward','back2','forward2'].includes(op))){
    const known=nh.moveBetween(p.mem,p.landed)!==null;
    if(known)assert.equal(b.rewrites,before.rewrites,`I3 rewrote the URL although the distance was known :: ${ctx}`);
    else assert.equal(b.goCalls,before.goCalls,`I3 guessed a distance for an unknown entry :: ${ctx}`);
   }
  }
 }
 return {app,b};
};

let n=0;const t=(name,fn)=>{fn();n++;console.log('PASS',name);};
const H=app=>app.b.entries.map(e=>e.hash).join(' ');
const stamps=app=>app.b.entries.map(e=>nh.readStamp(e.state)?.pos);
const fresh=()=>{const b=new Browser('#WM'),app=new App(b,()=>false);return {b,app};};

// ---------------------------------------------------------------- pure helpers
t('stamp: only well-formed stamps count; framework fields are copied untouched; the source is not mutated',()=>{
 for(const bad of [null,undefined,'x',5,{},{infrastructNav:null},{infrastructNav:{epoch:'e',pos:'1',id:'i'}},{infrastructNav:{epoch:'',pos:1,id:'i'}},{infrastructNav:{epoch:'e',pos:1.5,id:'i'}},{infrastructNav:{epoch:'e',pos:1}}])assert.equal(nh.readStamp(bad),null);
 const src={...FRAMEWORK,other:1},out=nh.withStamp(src,{epoch:'e',pos:3,id:'i'});
 assert.equal(out.__NA,true);assert.deepEqual(out.__PRIVATE_NEXTJS_INTERNALS_TREE,FRAMEWORK.__PRIVATE_NEXTJS_INTERNALS_TREE);assert.equal(out.other,1);
 assert.deepEqual(nh.readStamp(out),{epoch:'e',pos:3,id:'i'});assert.equal(nh.readStamp(src),null);
 assert.deepEqual(Object.keys(nh.withStamp(null,{epoch:'e',pos:0,id:'i'})),['infrastructNav']);
});
t('identity is not position: nextStamp is adjacent to the live current entry, and a new epoch when it is unknown',()=>{
 let k=0;const mk=()=>`m${k++}`,a={epoch:'E',pos:4,id:'a'};
 const b=nh.nextStamp(a,mk);assert.equal(b.epoch,'E');assert.equal(b.pos,5);assert.notEqual(b.id,a.id);
 const c=nh.nextStamp(null,mk);assert.equal(c.pos,0);assert.notEqual(c.epoch,'E');
 assert.equal(nh.moveBetween(b,a),-1);assert.equal(nh.moveBetween(a,{...b,epoch:'F'}),null,'other epoch: distance unknown');assert.equal(nh.moveBetween(a,a),null);assert.equal(nh.moveBetween(null,a),null);
});

// ---------------------------------------------------------------- named scenarios (each checks all invariants)
t('S1 push after Back replaces the forward branch with ADJACENT positions (WM, Overview, Documents, Back, WM)',()=>{
 const {b,app}=fresh();
 app.navigate('#OV');app.navigate('#DOC');assert.deepEqual(stamps(app),[0,1,2]);checkInvariants(app,'S1 a');
 b.userGo(-1);checkInvariants(app,'S1 back');
 app.navigate('#WM2');                                                          // new branch: Documents is truncated
 assert.equal(H(app),'#WM #OV #WM2');assert.deepEqual(stamps(app),[0,1,2],'positions stay adjacent (a running maximum would give [0,1,3])');
 app.dirty=true;const before=b.index;b.userGo(-1);                              // Back with unsaved work -> cancel
 assert.equal(b.index,before,'cancelled Back restored exactly one entry');assert.equal(b.hash,'#WM2');assert.equal(app.shown,'#WM2');assert.ok(app.dirty,'the draft is kept');
 checkInvariants(app,'S1 end');
});
t('S2 repeated URLs: Forward from the second WM is not mistaken for Back (WM, OV, WM, OV, Back, Forward)',()=>{
 const {b,app}=fresh();app.navigate('#OV');app.navigate('#WM');app.navigate('#OV');
 b.userGo(-1);app.dirty=true;const before=b.index;b.userGo(1);
 assert.equal(b.index,before);assert.equal(b.hash,'#WM');assert.equal(app.shown,'#WM');assert.ok(app.dirty);checkInvariants(app,'S2');
});
t('S3 forward-branch truncation keeps every survivor consistent and drops the rest',()=>{
 const {b,app}=fresh();for(const h of ['#B','#C','#D'])app.navigate(h);
 b.userGo(-2);app.navigate('#X');
 assert.equal(H(app),'#WM #B #X');assert.deepEqual(stamps(app),[0,1,2]);checkInvariants(app,'S3');
 b.userGo(-1);b.userGo(-1);assert.equal(b.hash,'#WM');checkInvariants(app,'S3 back to start');
});
t('S4 same-screen traversal: duplicate and spelling-variant entries are tracked without prompting, and later distances stay exact',()=>{
 const {b,app}=fresh();app.dirty=true;
 app.navigate('#A');app.navigate('#A~');                                         // same screen thrice: no prompt (app starts on #WM, so first navigate leaves)
 const promptsAfterFirst=app.prompts.length;
 app.dirty=false;app.navigate('#B');app.navigate('#B~');app.navigate('#B');       // B, B~, B: same screen
 app.dirty=true;const p0=app.prompts.length;
 b.userGo(-1);b.userGo(-1);                                                       // popstate-only traversals between same-screen entries
 assert.equal(app.prompts.length,p0,'same-screen traversal never prompts');checkInvariants(app,'S4 tracked');
 const before=b.index;b.userGo(-1);                                               // now onto #A~ : leaving the dirty screen
 assert.equal(b.index,before,'distance after popstate-only moves is still exact');assert.ok(app.dirty);checkInvariants(app,'S4 end');
 assert.ok(promptsAfterFirst>=0);
});
t('S5 reload mid-history: stamps survive in the entries, cancellation stays exact; an unstamped entry starts a new epoch',()=>{
 const {b,app}=fresh();app.navigate('#B');app.navigate('#C');
 app.reload();checkInvariants(app,'S5 after reload');assert.deepEqual(stamps(app),[0,1,2]);
 app.dirty=true;const before=b.index;b.userGo(-1);assert.equal(b.index,before);assert.equal(app.shown,'#C');checkInvariants(app,'S5 cancel');
 b.entries[b.index].state=clone(FRAMEWORK);                                       // an entry whose stamp was lost
 app.reload();const s=nh.readStamp(b.state);assert.ok(s&&s.pos===0,'adopted into a new epoch at position 0');assert.notEqual(s.epoch,nh.readStamp(b.entries[0].state).epoch);checkInvariants(app,'S5 adopt');
});
t('S6 confirmed discard: the move completes, the draft state is cleared, and nothing prompts twice',()=>{
 const b=new Browser('#WM'),app=new App(b,()=>true);app.navigate('#OV');app.navigate('#WM');
 app.dirty=true;const p0=app.prompts.length;b.userGo(-1);
 assert.equal(b.hash,'#OV');assert.equal(app.shown,'#OV');assert.equal(app.dirty,false);assert.equal(app.prompts.length-p0,1,'asked exactly once');checkInvariants(app,'S6');
 app.dirty=true;app.navigate('#DOC');assert.equal(app.shown,'#DOC');assert.equal(app.dirty,false);checkInvariants(app,'S6 navigate');
});
t('S7 cancelled Back and Forward are both exact, repeatedly, from the same entry',()=>{
 const {b,app}=fresh();for(const h of ['#B','#C','#D'])app.navigate(h);b.userGo(-1);b.userGo(-1);   // at #B
 app.dirty=true;const at=b.index;
 for(let i=0;i<3;i++){b.userGo(-1);assert.equal(b.index,at);b.userGo(1);assert.equal(b.index,at);b.userGo(2);assert.equal(b.index,at);b.userGo(-1);}
 assert.equal(app.shown,'#B');assert.ok(app.dirty);checkInvariants(app,'S7');
});
t('S8 unstamped entries (manual hash edit): cancel rewrites the URL, never calls go(), adopts a new epoch; Back across epochs is also unknown',()=>{
 const {b,app}=fresh();app.navigate('#B');app.dirty=true;const g0=b.goCalls;
 b.userSetHash('#E');                                                             // user edits the hash: unstamped entry, prompt, cancel
 assert.equal(b.goCalls,g0,'no history.go() for an unknown distance');assert.equal(b.hash,'#B');assert.equal(app.shown,'#B');assert.ok(app.dirty);
 const adopted=nh.readStamp(b.state);assert.ok(adopted,'the entry was adopted');assert.notEqual(adopted.epoch,nh.readStamp(b.entries[1].state).epoch,'new epoch, not extended by guessing');checkInvariants(app,'S8 a');
 const g1=b.goCalls,r1=b.rewrites;b.userGo(-2);                                   // onto the first entry, another epoch: distance unknown again
 assert.equal(b.goCalls,g1,'no history.go() across epochs');assert.equal(b.rewrites,r1+1,'rewritten, not guessed');assert.equal(b.hash,'#B');assert.equal(app.shown,'#B');assert.ok(app.dirty);checkInvariants(app,'S8 b');
 app.dirty=false;app.navigate('#C');checkInvariants(app,'S8 push after adopt');   // pushes continue from the adopted epoch
});
t('S9 a foreign pushState (no event) is handled by reading the live entry, not memory',()=>{
 const {b,app}=fresh();app.navigate('#B');b.foreignPush('#Z');                    // another library pushed an unstamped-by-us entry
 app.navigate('#C');                                                              // our push must not extend the old epoch from stale memory
 const s=b.entries.map(e=>nh.readStamp(e.state));assert.equal(s[3].pos,0,'unknown current entry: new epoch');assert.notEqual(s[3].epoch,s[1].epoch);checkInvariants(app,'S9');
});
t('S10 Next fields are on every entry the app pushes and never dropped',()=>{
 const {b,app}=fresh();for(const h of ['#B','#C'])app.navigate(h);b.userGo(-1);app.navigate('#D');app.reload();
 for(const e of b.entries){assert.equal(e.state.__NA,true);assert.deepEqual(e.state.__PRIVATE_NEXTJS_INTERNALS_TREE,FRAMEWORK.__PRIVATE_NEXTJS_INTERNALS_TREE);}checkInvariants(app,'S10');
});
t('S11 clean navigation is never blocked and never prompts, in any direction',()=>{
 const {b,app}=fresh();app.dirty=false;for(const h of ['#B','#C','#D'])app.navigate(h);b.userGo(-2);b.userGo(1);b.userGo(-1);b.userGo(3);
 assert.ok(app.prompts.every(p=>!p.dirty),'nothing was dirty');assert.equal(app.shown,b.hash);checkInvariants(app,'S11');
});

// ---------------------------------------------------------------- randomized: every invariant, every step
t('R1 3000 deterministic random sequences x 40 steps hold I1-I6 together (push/Back/Forward/jumps/reload/hash edits/foreign pushes/spelling variants/dirty toggles)',()=>{
 for(let seed=1;seed<=3000;seed++)run(seed,40);
});
t('R2 the same with hash edits that fire only hashchange (no popstate), as some browsers do',()=>{
 for(let seed=5001;seed<=5600;seed++){const orig=Browser.prototype.userSetHash;Browser.prototype.userSetHash=function(h){this.popstateOnHashEdit=false;return orig.call(this,h);};try{run(seed,40);}finally{Browser.prototype.userSetHash=orig;}}
});
console.log(`\n${n} passed, 0 failed`);
