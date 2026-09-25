// V1 reports: every number is derived from stored records; nothing is sampled
// or invented. Sections are omitted when the module is not entitled or the
// role may not see them (commercial figures require commercial.view).
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {query,one,round2} from '@/lib/platform/sql';
import {easternDate} from '@/lib/reporting';
import {projectFinancials,estimateVsActual} from './project-control';
import {legacyOpportunityStage} from '@/lib/v1/register-server';
import {stageOf} from '@/lib/modules/projects/projects';

export async function reportsV1(){
 const a=actorContext.getStore()!,org=a.organisationId,e=await getEntitlements(org),money=can(a.role,'commercial.view')&&usable(e,'commercial');
 const today=easternDate(new Date()),past30=new Date(Date.parse(today)-30*86400000).toISOString().slice(0,10),next14=new Date(Date.parse(today)+14*86400000).toISOString().slice(0,10);
 const out:Record<string,unknown>={generatedAt:new Date().toISOString(),commercialVisible:money};
 if(usable(e,'pipeline')){
  const opps=await query("SELECT stage,status,estimated_value,probability,metadata FROM opportunities WHERE organisation_id=? AND LOWER(status)<>'archived'",[org]);
  const stages:Record<string,{count:number;value:number;weighted:number}>={};
  for(const o of opps){const s=o.stage||legacyOpportunityStage(o.status);const v=Number(o.estimated_value??0);const g=stages[s]||={count:0,value:0,weighted:0};g.count++;g.value+=v;g.weighted+=v*Math.min(100,Math.max(0,Number(o.probability||0)))/100;}
  const tenders=await query('SELECT stage,estimated_value FROM tenders WHERE organisation_id=?',[org]);
  const byStage:Record<string,{count:number;value:number}>={};for(const t of tenders){const g=byStage[t.stage]||={count:0,value:0};g.count++;g.value+=Number(t.estimated_value||0);}
  const won=byStage.awarded?.count||0,lost=byStage.lost?.count||0;
  out.pipeline={opportunities:Object.entries(stages).map(([stage,v])=>({stage,count:v.count,...(money?{value:round2(v.value),weighted:round2(v.weighted)}:{})})),tenders:Object.entries(byStage).map(([stage,v])=>({stage,count:v.count,...(money?{value:round2(v.value)}:{})})),conversionPct:won+lost?round2(won/(won+lost)*100):null,decided:won+lost};
 }
 if(usable(e,'projects')){
  const projects=await query("SELECT id,name,project_number,stage,status,contract_value FROM jobs WHERE organisation_id=? AND LOWER(status)<>'archived'",[org]);
  const counts:Record<string,number>={};for(const p of projects){const s=stageOf(p);counts[s]=(counts[s]||0)+1;}
  const live=projects.filter(p=>!['closed'].includes(stageOf(p)));
  out.projects={byStage:counts,active:counts.active||0,total:projects.length};
  if(money&&usable(e,'commercial')){
   const rows:Array<Record<string,unknown>>=[];let learn=[] as unknown[];
   for(const p of live){const f=await projectFinancials(p.id);rows.push({id:p.id,name:p.name,projectNumber:p.project_number,stage:stageOf(p),...f.forecast});}
   const sum=(k:string)=>round2(rows.reduce((n,r)=>n+Number((r as Record<string,unknown>)[k]||0),0));
   const revenue=sum('forecastRevenue'),ffc=sum('forecastFinalCost');
   const variations=await query('SELECT status,COUNT(*) AS n,COALESCE(SUM(value),0) AS v FROM project_variations WHERE organisation_id=? GROUP BY status',[org]);
   const claims=await query('SELECT status,COUNT(*) AS n,COALESCE(SUM(gross_amount),0) AS v FROM progress_claims WHERE organisation_id=? GROUP BY status',[org]);
   learn=await Promise.all(live.slice(0,50).map(async p=>{const x=await estimateVsActual(p.id);return x.available?{id:p.id,name:p.name,estimatedCost:x.cost.estimated,actualCost:x.cost.actual,forecastFinalCost:x.cost.forecastFinal,tenderMarginPct:x.margin.tender,forecastMarginPct:x.margin.forecast,estimatedLabourHours:x.labourHours.estimated,actualLabourHours:x.labourHours.actual,categories:x.categories}:null;})).then(r=>r.filter(Boolean));
   out.commercial={projects:rows,totals:{originalContract:sum('originalContract'),currentContract:sum('currentContract'),approvedVariations:sum('approvedVariations'),pendingVariations:sum('pendingVariations'),actual:sum('actual'),committed:sum('committed'),forecastFinalCost:ffc,forecastRevenue:revenue,forecastProfit:round2(revenue-ffc),forecastMarginPct:revenue?round2((revenue-ffc)/revenue*100):null,claimed:sum('claimed'),certified:sum('certified'),invoiced:sum('invoiced'),paid:sum('paid'),unbilled:sum('unbilled')},variations:variations.map(v=>({status:v.status,count:Number(v.n),value:Number(v.v)})),claims:claims.map(c=>({status:c.status,count:Number(c.n),value:Number(c.v)}))};
   out.learn=learn;
  }
 }
 if(usable(e,'operations')){
  const upcoming=await one<{n:number}>("SELECT COUNT(*) AS n FROM shifts WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date')) BETWEEN ? AND ? AND status NOT IN ('Cancelled','Archived')",[org,today,next14]);
  const completed=await one<{n:number}>("SELECT COUNT(*) AS n FROM shifts WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date')) BETWEEN ? AND ? AND status='Completed'",[org,past30,today]);
  const assignments=await query("SELECT metadata FROM shifts WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date')) BETWEEN ? AND ? AND status NOT IN ('Cancelled','Archived')",[org,past30,next14]);
  const use:Record<string,number>={};for(const s of assignments){for(const x of (JSON.parse(s.metadata||'{}').assignments||[]) as Array<{category?:string;hours?:number}>){use[x.category||'other']=(use[x.category||'other']||0)+Number(x.hours||0);}}
  const production=await one<{t:number;n:number}>("SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(data,'$.tonnes')) AS DECIMAL(15,3))),0) AS t,COUNT(*) AS n FROM field_records WHERE organisation_id=? AND status='Submitted' AND updated_at>=?",[org,past30]);
  out.operations={upcomingShifts14d:Number(upcoming?.n||0),completedShifts30d:Number(completed?.n||0),plannedHoursByCategory:Object.fromEntries(Object.entries(use).map(([k,v])=>[k,round2(v)])),fieldRecords30d:Number(production?.n||0),tonnesRecorded30d:round2(Number(production?.t||0))};
 }
 if(usable(e,'dockets')&&can(a.role,'docket.approve')){
  const d=await query("SELECT status,COUNT(*) AS n,COALESCE(SUM(amount),0) AS v FROM dockets WHERE organisation_id=? AND LOWER(status)<>'archived' GROUP BY status",[org]);
  const pick=(ss:string[])=>d.filter(x=>ss.includes(x.status)).reduce<{count:number;value:number}>((acc,x)=>({count:acc.count+Number(x.n),value:round2(acc.value+Number(x.v))}),{count:0,value:0});
  const strip=(v:{count:number;value:number})=>money?v:{count:v.count};
  out.dockets={pendingReview:strip(pick(['review','uploaded','processing','matched','ready','duplicate'])),approvedUnclaimed:strip(pick(['approved'])),claimed:strip(pick(['included_claim','invoiced'])),rejected:strip(pick(['rejected']))};
 }
 if(usable(e,'ims')&&can(a.role,'hseq.view')){
  const [actions,incidents,ncrs,swms,itp]=await Promise.all([
   one<{open:number;overdue:number}>("SELECT SUM(status IN ('open','in_progress')) AS open,SUM(status IN ('open','in_progress') AND due_date<?) AS overdue FROM hseq_actions WHERE organisation_id=?",[today,org]),
   query("SELECT incident_type,status,COUNT(*) AS n FROM hseq_incidents WHERE organisation_id=? GROUP BY incident_type,status",[org]),
   query("SELECT status,COUNT(*) AS n FROM hseq_ncrs WHERE organisation_id=? GROUP BY status",[org]),
   query("SELECT status,COUNT(*) AS n FROM swms WHERE organisation_id=? GROUP BY status",[org]),
   query("SELECT status,COUNT(*) AS n FROM itp_items WHERE organisation_id=? GROUP BY status",[org]),
  ]);
  const map=(rows:Array<Record<string,unknown>>)=>Object.fromEntries(rows.map(r=>[String(r.status),Number(r.n)]));
  out.hseq={openActions:Number(actions?.open||0),overdueActions:Number(actions?.overdue||0),incidents:incidents.map(i=>({type:i.incident_type,status:i.status,count:Number(i.n)})),ncrs:map(ncrs),swms:map(swms),itpItems:map(itp)};
 }
 return out;
}
