'use client';
// Temporary local browser harness, removed before commit. All API requests are intercepted by the journey.
import {useState} from 'react';
import {WorkspaceBrandProvider} from '@/components/workspace-brand';
import {ResourcesArea} from '@/components/v1/resources';
import {ScheduleResourceRail} from '@/components/v1/schedule-resource-rail';
import {EstimatesQuotes} from '@/components/estimates-quotes';
import {Planning} from '@/components/v1/planning';
import {confirmLeave} from '@/components/v1/nav';
import type {DeliveryRecord} from '@/lib/planning';
const workers:DeliveryRecord[]=[{id:'worker01',name:'Jordan Taylor',status:'Active',metadata:{employmentType:'full_time'}},{id:'worker02',name:'Casey Review',status:'Active',metadata:{employmentType:'Seasonal?'}}];
export default function Fixture(){
 const [view,setView]=useState('People');
 const [shift,setShift]=useState<DeliveryRecord>({id:'shift01',name:'Disposable fixture shift',status:'Draft',metadata:{date:'2026-10-20',start:'07:00',finish:'15:00',assignments:[]}});
 return <WorkspaceBrandProvider><main className="mx-auto max-w-6xl space-y-4 p-4"><p>Disposable local UI fixture — no live data</p><nav className="flex gap-3">{['People','Schedule','Planning','Estimate'].map(v=><button key={v} onClick={()=>{if(confirmLeave())setView(v);}}>{v}</button>)}</nav>{view==='People'?<ResourcesArea initial="workers" only/>:view==='Schedule'?<ScheduleResourceRail shift={shift} data={{workers}} onAssign={(r,category)=>setShift(s=>({...s,metadata:{...s.metadata,assignments:[{resourceId:r.id,name:r.name,category,role:'Worker',hours:8,rate:0,payload:0,trips:0}]}}))} onUnassign={()=>setShift(s=>({...s,metadata:{...s.metadata,assignments:[]}}))}/>:view==='Planning'?<Planning/>:<EstimatesQuotes/>}</main></WorkspaceBrandProvider>;
}
