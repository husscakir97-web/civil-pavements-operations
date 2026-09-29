// Isomorphic free-text lookup used by registers, resource lists and pickers.
// Every whitespace-separated term must appear in one of the record's fields.
// Identifiers are compared without spaces, dashes, dots or slashes, so
// "TMA 001", "tma-001" and "TMA001" all find plant number TMA001.

const compact=(s:string)=>s.toLowerCase().replace(/[\s\-_./]+/g,'');

export type LookupValue=string|number|null|undefined;

/** Lower-cased haystack for a record; build once per record and reuse. */
export function lookupText(values:readonly LookupValue[]){
 const parts=values.filter(v=>v!==null&&v!==undefined&&v!=='').map(String);
 const plain=parts.join(' ').toLowerCase();
 return {plain,compact:parts.map(compact).join('|')};
}

export function matchesLookup(values:readonly LookupValue[]|ReturnType<typeof lookupText>,query:string){
 const q=query.trim().toLowerCase();
 if(!q)return true;
 const text=Array.isArray(values)?lookupText(values):values as ReturnType<typeof lookupText>;
 return q.split(/\s+/).every(term=>text.plain.includes(term)||(compact(term)!==''&&text.compact.includes(compact(term))))||(compact(q)!==''&&text.compact.includes(compact(q)));
}

/**
 * Orders matches so exact identifier hits come first (typing "TMA001" puts that
 * asset at the top even if "TMA0010" also matches), then prefix hits, then the rest.
 * `ids` are the identifier-like fields (plant number, registration, employee number).
 */
export function lookupRank(ids:readonly LookupValue[],label:string,query:string){
 const q=compact(query);
 if(!q)return 3;
 const keys=ids.filter(v=>v!==null&&v!==undefined&&v!=='').map(v=>compact(String(v)));
 if(keys.includes(q))return 0;
 if(keys.some(k=>k.startsWith(q))||compact(label).startsWith(q))return 1;
 return 2;
}

export function filterLookup<T>(items:readonly T[],query:string,fields:(item:T)=>readonly LookupValue[],ids?:(item:T)=>readonly LookupValue[],label?:(item:T)=>string){
 if(!query.trim())return [...items];
 const hits=items.filter(i=>matchesLookup(fields(i),query));
 if(!ids)return hits;
 return hits.map((item,index)=>({item,index,rank:lookupRank(ids(item),label?label(item):'',query)})).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(x=>x.item);
}
