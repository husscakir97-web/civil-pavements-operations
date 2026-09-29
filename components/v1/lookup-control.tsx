'use client';
// Generic searchable lookup control shared by CRM/resource pickers and the address-location UI.
import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {Check,Plus,Search,X} from 'lucide-react';
import {field} from './kit';
import {filterLookup,type LookupValue} from '@/lib/v1/lookup';

export type LookupItem={id:string;label:string;detail?:string|null;badge?:ReactNode;search?:LookupValue[];ids?:LookupValue[]};

export function Lookup({label,items,value,onChange,placeholder,disabled,loading,createLabel,onCreate,emptyText,allowClear=true,hint,onQueryChange,selectedItem,heading,initialQuery=''}:{
 label:string;items:LookupItem[];value:string|null|undefined;onChange:(item:LookupItem|null)=>void;placeholder?:string;disabled?:boolean;loading?:boolean;
 onQueryChange?:(query:string)=>void;
 selectedItem?:LookupItem|null;
 heading?:string;
 /** Seeds the text box when a higher-level quick-create flow hands off what the user already typed. */
 initialQuery?:string;
 createLabel?:(query:string)=>string;onCreate?:(query:string)=>Promise<LookupItem|null|void>;
 emptyText?:string;allowClear?:boolean;hint?:ReactNode;
}){
 const id=useId(),listId=`${id}-list`;
 const selected=items.find(i=>i.id===value)||(selectedItem&&selectedItem.id===value?selectedItem:null);
 const [query,setQuery]=useState(initialQuery),[open,setOpen]=useState(false),[active,setActive]=useState(0),[creating,setCreating]=useState(false),[error,setError]=useState('');
 const box=useRef<HTMLDivElement>(null);
 const results=useMemo(()=>filterLookup(items,query,i=>i.search??[i.label,i.detail],i=>i.ids??[],i=>i.label).slice(0,50),[items,query]);
 const canCreate=Boolean(onCreate&&query.trim());
 const count=results.length+(canCreate?1:0);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[open]);
 const choose=(item:LookupItem|null)=>{onChange(item);setQuery('');setOpen(false);setActive(0);if(query)onQueryChange?.('');};
 const create=async()=>{if(!onCreate||creating)return;setCreating(true);setError('');try{const item=await onCreate(query.trim());if(item)choose(item);else setOpen(false);}catch(e){setError((e as Error).message);}finally{setCreating(false);}};
 const pick=(i:number)=>{if(i<results.length)choose(results[i]);else if(canCreate)void create();};
 return <div ref={box} className="relative grid gap-1 text-sm">
  <span id={`${id}-label`} className="font-medium text-slate-700">{label}</span>
  {selected&&!open?<div className={`${field} flex items-center gap-2`}>
   <button type="button" disabled={disabled} className="min-w-0 flex-1 text-left" onClick={()=>{setOpen(true);setQuery('');}} aria-label={`${label}: ${selected.label}. Change`}>
    <span className="block truncate font-medium text-slate-900">{selected.label}</span>{selected.detail&&<span className="block truncate text-xs text-slate-500">{selected.detail}</span>}
   </button>
   {allowClear&&!disabled&&<button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label={`Clear ${label}`} onClick={()=>choose(null)}><X aria-hidden className="size-4"/></button>}
  </div>:
  <div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400"/>
   <input role="combobox" aria-labelledby={`${id}-label`} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open&&count?`${id}-opt-${active}`:undefined}
    autoFocus={Boolean(selected)} className={`${field} pl-9`} disabled={disabled} placeholder={placeholder||`Search ${label.toLowerCase()}…`} value={query}
    onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(0);onQueryChange?.(e.target.value);}}
    onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(a=>Math.min(a+1,Math.max(count-1,0)));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,0));}else if(e.key==='Enter'&&open&&count){e.preventDefault();pick(active);}else if(e.key==='Escape'){setOpen(false);}}}/>
  </div>}
  {open&&!disabled&&<ul id={listId} role="listbox" aria-labelledby={`${id}-label`} className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
   {loading&&!items.length?<li className="px-3 py-2 text-slate-500" role="status">Loading…</li>:null}
   {heading&&!query&&results.length>0&&<li role="presentation" className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{heading}</li>}
   {results.map((item,i)=><li key={item.id} id={`${id}-opt-${i}`} role="option" aria-selected={item.id===value} className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${i===active?'bg-slate-100':''}`} onMouseEnter={()=>setActive(i)} onMouseDown={e=>{e.preventDefault();pick(i);}}>
    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{item.label}</span>{item.detail&&<span className="block truncate text-xs text-slate-500">{item.detail}</span>}</span>
    {item.badge}{item.id===value&&<Check aria-hidden className="size-4 text-emerald-600"/>}
   </li>)}
   {!loading&&!results.length&&!canCreate&&<li className="px-3 py-2 text-slate-500">{query?'No matches.':emptyText||'Nothing recorded yet.'}</li>}
   {canCreate&&<li id={`${id}-opt-${results.length}`} role="option" aria-selected={false} className={`flex cursor-pointer items-center gap-2 border-t px-3 py-2 font-medium text-sky-800 ${active===results.length?'bg-sky-50':''}`} onMouseEnter={()=>setActive(results.length)} onMouseDown={e=>{e.preventDefault();void create();}}>
    <Plus aria-hidden className="size-4"/>{creating?'Adding…':createLabel?createLabel(query.trim()):`Add “${query.trim()}”`}
   </li>}
  </ul>}
  {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  {hint&&<span className="text-xs text-slate-500">{hint}</span>}
 </div>;
}
