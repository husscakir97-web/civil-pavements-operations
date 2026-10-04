// Identifying history entries for the unsaved-work navigation guard (see useRoute in app/pavement-os.tsx).
// Matching URL hashes cannot tell entries apart: Work map → Overview → Work map → Overview has two of each, so a Forward and a
// Back to "Overview" look identical. Instead every entry this app creates is stamped with a position that only ever grows
// along a stack, and a traversal is the difference between two stamps. The stamp is added to a copy of the entry's existing
// state: Next's own fields (__NA, the router tree) are carried over untouched, because Next reloads the page on state it did
// not write. The browser keeps each entry's state across reloads, so positions survive a reload too.
const KEY='infrastructNavIdx';
const isObject=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null;
/** The position stamped on a history entry, or null for entries this app did not create (or created before stamping). */
export function entryIndex(state:unknown):number|null{
 if(!isObject(state))return null;
 const v=state[KEY];
 return typeof v==='number'&&Number.isInteger(v)&&v>=0?v:null;
}
/** The entry's state with our position added; every other key is copied unchanged. */
export function stampState(state:unknown,idx:number):Record<string,unknown>{
 return {...(isObject(state)?state:{}),[KEY]:idx};
}
/** How far the browser moved (negative = Back) from position `at` to the entry carrying `state`; null when either is unknown or unchanged. */
export function moveBetween(at:number|null,state:unknown):number|null{
 const to=entryIndex(state);
 if(at===null||to===null||to===at)return null;
 return to-at;
}
