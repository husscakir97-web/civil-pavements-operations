'use client';
import {createContext,useContext,useEffect,useState,type ReactNode,type CSSProperties} from 'react';
import {defaultBrand,type WorkspaceBrand} from '@/lib/workspace-brand';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
const Context=createContext({brand:defaultBrand,canEdit:false,userEmail:'',role:'read-only',refresh:async()=>{}});
export const useWorkspaceBrand=()=>useContext(Context);
export function WorkspaceBrandProvider({children}:{children:ReactNode}){
 const [data,setData]=useState({brand:defaultBrand,canEdit:false,userEmail:'',role:'read-only'});
 async function refresh(){const r=await fetch('/api/workspace',{cache:'no-store'});if(r.ok)setData(await r.json());}
 useEffect(()=>{let active=true;fetch('/api/workspace',{cache:'no-store'}).then(async r=>{if(r.ok&&active)setData(await r.json());}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{document.title=data.brand.productName;},[data.brand.productName]);
 return <Context.Provider value={{...data,refresh}}><div style={{'--primary':data.brand.accentColor} as CSSProperties}>{children}</div></Context.Provider>;
}
export function WorkspaceBrandSettings(){
 const {brand,canEdit,refresh}=useWorkspaceBrand(),[edits,setDraft]=useState<WorkspaceBrand|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const draft=edits??brand;
 async function save(){setBusy(true);try{const r=await fetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)}),p=await r.json() as {error?:string};if(!r.ok)throw new Error(p.error);await refresh();setMessage('Workspace branding saved.');}catch(e){setMessage(e instanceof Error?e.message:'Could not save branding.');}finally{setBusy(false)}}
 return <section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Company branding</h3><p className="mt-1 text-sm text-slate-600">Customise this company’s workspace. Commercial records and rates remain attached to the same company.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{([['productName','Product name'],['companyName','Company display name'],['workspaceName','Workspace name'],['accentColor','Brand colour']] as const).map(([key,label])=><label key={key} className="text-sm">{label}<Input disabled={!canEdit||busy} type={key==='accentColor'?'color':'text'} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div><Button className="mt-4" disabled={!canEdit||busy} onClick={()=>void save()}>Save branding</Button>{message&&<p role="status" className="mt-3 text-sm">{message}</p>}<div className="mt-5 border-t pt-4"><h4 className="font-semibold">Subscription and AI usage</h4><p className="mt-1 text-sm text-slate-600">Standard OCR is available. Paid AI scanning is optional and requires an explicit cost confirmation. Subscription checkout, scan pricing and payment collection are not configured yet.</p></div></section>;
}
