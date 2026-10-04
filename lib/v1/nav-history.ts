// Unsaved-work navigation guard: how the app knows where the browser is in its history, so a Back/Forward the user cancels can
// be undone exactly. This file is pure (no window, no React) so the whole model is tested against a simulated browser
// (scripts/test-nav-history.cjs). useRoute in app/pavement-os.tsx only wires it to window.history.
//
// MODEL
//   A history entry has an IDENTITY and a POSITION, and they are different things.
//   - identity  = `id`: unique to one entry, never reused. Says "this exact entry".
//   - position  = (`epoch`, `pos`): `epoch` names one run of entries known to be adjacent; `pos` is the entry's offset in that
//     run. Distance between two entries is only defined inside one epoch and is simply pos(b) - pos(a).
//   The stamp is stored in a COPY of the entry's history.state under one key; every other key (Next's __NA and router tree)
//   is carried over untouched, because Next reloads the page on state it did not write.
//
// INVARIANTS (all asserted by the simulator test, together, over many sequences)
//   I1 adjacency   For any two live entries in the same epoch, pos(b) - pos(a) is exactly the number of browser steps between
//                  them. Every entry this app pushes gets pos = (live current entry).pos + 1, taken from the browser's own
//                  current state, never from memory. The browser truncates the forward branch on a push, so the survivors
//                  stay consistent and the new entry is adjacent by construction. (A running maximum would not be: after
//                  Back and a push it leaves a gap, [0,1,3] for three adjacent entries.)
//   I2 tracking    After an event is handled, the remembered position equals the stamp of the live current entry.
//   I3 no guessing An entry with no stamp, or one from another epoch, has an UNKNOWN distance. Cancelling a move onto it
//                  never calls history.go(n); the URL is rewritten back instead (explicit fallback). Accepting a move onto an
//                  unstamped entry starts a NEW epoch there rather than extending the old one, since entries we cannot see
//                  may sit between.
//   I4 consistency After any event, the URL and the screen name the same place. A cancelled move is undone by exactly its
//                  distance (known) or by a URL rewrite (unknown); a confirmed move shows the entry landed on.
//   I5 no needless prompt  confirmLeave() is only asked when the move changes the screen. Same-screen moves (including
//                  repeated URLs and spelling variants) are tracked, never prompted.
//   I6 reload      Stamps live in the entries' own state, which the browser keeps across reloads, so positions survive.

export type Stamp={epoch:string;pos:number;id:string};
const KEY='infrastructNav';
const isObject=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null;
const isStamp=(v:unknown):v is Stamp=>isObject(v)&&typeof v.epoch==='string'&&v.epoch!==''&&typeof v.id==='string'&&v.id!==''&&typeof v.pos==='number'&&Number.isInteger(v.pos);

/** The stamp on a history entry, or null for entries this app did not create (or created before stamping). */
export function readStamp(state:unknown):Stamp|null{
 if(!isObject(state))return null;
 const v=state[KEY];
 return isStamp(v)?{epoch:v.epoch,pos:v.pos,id:v.id}:null;
}
/** The entry's state with our stamp added; every other key is copied unchanged. */
export function withStamp(state:unknown,stamp:Stamp):Record<string,unknown>{
 return {...(isObject(state)?state:{}),[KEY]:{epoch:stamp.epoch,pos:stamp.pos,id:stamp.id}};
}
/** First entry of a new run of known-adjacent entries. */
export function newEpoch(makeId:()=>string):Stamp{return {epoch:makeId(),pos:0,id:makeId()};}
/** Stamp for an entry pushed right after `current` (the live current entry). Unknown current: a new epoch. */
export function nextStamp(current:Stamp|null,makeId:()=>string):Stamp{
 return current?{epoch:current.epoch,pos:current.pos+1,id:makeId()}:newEpoch(makeId);
}
/** Browser steps from `from` to `to` (negative = Back); null when the distance is unknown (either stamp missing, other epoch) or zero. */
export function moveBetween(from:Stamp|null,to:Stamp|null):number|null{
 if(!from||!to||from.epoch!==to.epoch||from.pos===to.pos)return null;
 return to.pos-from.pos;
}

/** What the controller needs from the browser. */
export interface HistoryPort{
 state():unknown;
 hash():string;
 /** pushState(state, '', hash): never fires hashchange; truncates the forward branch. */
 push(state:unknown,hash:string):void;
 /** replaceState on the current entry; `hash` undefined keeps the URL. */
 replace(state:unknown,hash?:string):void;
 go(delta:number):void;
}
export interface GuardUi{
 /** Asks only when something is unsaved; true = fine to leave (nothing unsaved, or the user confirmed discarding). */
 confirmLeave():boolean;
 sameScreen(a:string,b:string):boolean;
 show(hash:string):void;
 makeId():string;
}
export interface NavController{
 mount():void;
 /** The user (or code) asks to go to `hash`. Returns false when the user cancelled. */
 navigate(hash:string):boolean;
 onHashChange():void;
 /** popstate: the only event for a traversal between two entries with the same fragment. */
 onPopState():void;
 /** Test hook: what the controller believes. */
 snapshot():{stamp:Stamp|null;hash:string};
}

export function createNavController(port:HistoryPort,ui:GuardUi):NavController{
 let at:{stamp:Stamp|null;hash:string}={stamp:null,hash:''};
 /** Stamp of the live current entry, stamping it into a NEW epoch if it has none (never extends an old epoch by guessing). */
 const adopt=():Stamp=>{
  const known=readStamp(port.state());
  if(known)return known;
  const fresh=newEpoch(ui.makeId);
  port.replace(withStamp(port.state(),fresh));
  return fresh;
 };
 const track=()=>{at.stamp=adopt();};
 return {
  mount(){at={stamp:adopt(),hash:port.hash()};if(at.hash!=='#main-content')ui.show(at.hash);},
  navigate(hash){
   if(!ui.sameScreen(hash,at.hash)&&!ui.confirmLeave())return false;
   ui.show(hash);
   if(port.hash()!==hash){
    // I1: adjacent to the live current entry (read from the browser, not from memory); unknown current starts a new epoch.
    port.push(withStamp(port.state(),nextStamp(readStamp(port.state()),ui.makeId)),hash);
    at={stamp:readStamp(port.state()),hash};
   }else at={stamp:adopt(),hash};            // already on that URL (nothing to push): still bring the remembered position and hash up to date (I2)
   return true;
  },
  onHashChange(){
   const hash=port.hash();
   if(hash==='#main-content')return;
   if(!ui.sameScreen(hash,at.hash)){
    if(!ui.confirmLeave()){
     const move=moveBetween(at.stamp,readStamp(port.state()));
     if(move!==null)port.go(-move);          // known distance: step back exactly that far
     else{                                    // I3: unknown distance: never guess, rewrite the URL and adopt this entry
      const fresh=newEpoch(ui.makeId);
      port.replace(withStamp(port.state(),fresh),at.hash);
      at.stamp=fresh;
     }
     return;
    }
    at.hash=hash;
   }
   track();
   ui.show(hash);
  },
  onPopState(){
   // A traversal that keeps the fragment fires no hashchange; keep the remembered position current (I2).
   if(ui.sameScreen(port.hash(),at.hash))track();
  },
  snapshot(){return {stamp:at.stamp,hash:at.hash};},
 };
}
