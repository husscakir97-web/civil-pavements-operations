'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import {PageHeader,Tabs,Loading} from './kit';
import {RegisterView} from './register-view';
import {SwmsPanel} from './swms';

const IMSWorkspace=dynamic(()=>import('@/components/ims-workspace').then(m=>m.IMSWorkspace),{loading:()=><Loading label="Loading IMS documents…"/>});
type Tab='registers'|'swms'|'company-risks'|'documents';
// Company-level and cross-project HSEQ. Project-level records live in each
// project's Quality & HSEQ tab; this view aggregates them for the HSEQ team.
export function HseqArea(){
 const [tab,setTab]=useState<Tab>('registers');
 return <div>
  <PageHeader title="IMS & HSEQ" subtitle="Helps you operate systems aligned with ISO 9001, ISO 45001 and ISO 14001. Certification remains with external certifying bodies."/>
  <Tabs label="IMS and HSEQ" active={tab} onChange={setTab} tabs={[{key:'registers',label:'Incidents, NCRs & actions'},{key:'swms',label:'SWMS'},{key:'company-risks',label:'Risk register'},{key:'documents',label:'IMS documents'}]}/>
  {tab==='registers'&&<div className="grid gap-4"><RegisterView register="incidents" all/><RegisterView register="ncrs" all/><RegisterView register="actions" all/></div>}
  {tab==='swms'&&<SwmsPanel/>}
  {tab==='company-risks'&&<RegisterView register="risks" all title="Company and project risks" description="Records without a project are company risks. Create project risks from the project's Quality & HSEQ tab."/>}
  {tab==='documents'&&<IMSWorkspace onNavigate={()=>{}}/>}
 </div>;
}
