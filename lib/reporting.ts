export type ReportRow = { id: string; name: string; status: string; metadata: Record<string, unknown> };
export type ReportData = Record<string, ReportRow[]>;
export const reportTables = ['opportunities','estimates','jobs','shifts','field_records','dockets','commercial_records','workers','plant','qa_safety_records'] as const;
export const easternDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const status = (r: ReportRow) => r.status.toLowerCase().replaceAll('_',' ');
export function summarise(data: ReportData, today = easternDate()) {
 const rows = (t:string) => (data[t] || []).filter(r=>status(r)!=='archived');
 const opportunities=rows('opportunities'), jobs=rows('jobs'), shifts=rows('shifts'), fields=rows('field_records'), dockets=rows('dockets'), estimates=rows('estimates');
 const open=opportunities.filter(r=>!['won','lost','withdrawn','cancelled'].includes(status(r)));
 const variations=rows('commercial_records').filter(r=>String(r.metadata.recordType||r.metadata.action||'').toLowerCase()==='variation');
 const unapproved=variations.filter(r=>!['approved','rejected','cancelled','paid'].includes(status(r)));
 const reviewed=estimates.filter(r=>['awarded','won','lost'].includes(status(r)));
 const counts=Object.fromEntries(reportTables.map(t=>[t,rows(t).length]));
 const pipeline=Object.entries(open.reduce<Record<string,{count:number;value:number;weighted:number}>>((a,r)=>{const p=a[r.status] ||= {count:0,value:0,weighted:0};const value=num(r.metadata.estimatedValue??r.metadata.value);p.count++;p.value+=value;p.weighted+=value*Math.min(100,Math.max(0,num(r.metadata.probability)))/100;return a;},{})).map(([stage,v])=>({stage,...v}));
 const expiries=['competencyExpiry','licenceExpiry','inductionExpiry','insuranceExpiry','registrationExpiry','inspectionExpiry','serviceDue'];
 const expired=(r:ReportRow)=>expiries.some(k=>/^\d{4}-\d{2}-\d{2}/.test(String(r.metadata[k]||''))&&String(r.metadata[k]).slice(0,10)<today);
 return {counts,pipeline,openOpportunities:open.length,pipelineValue:pipeline.reduce((s,r)=>s+r.value,0),forecastRevenue:pipeline.reduce((s,r)=>s+r.weighted,0),securedRevenue:jobs.reduce((s,r)=>s+num(r.metadata.contractValue),0),upcomingShifts:shifts.filter(r=>String(r.metadata.date||'')>=today&&!['cancelled','completed','complete','stand-down'].includes(status(r))).length,completedFields:fields.filter(r=>['submitted','completed','complete'].includes(status(r))).length,reviewCount:dockets.filter(r=>['review','needs review'].includes(status(r))).length,docketValue:dockets.filter(r=>!['duplicate','rejected'].includes(status(r))).reduce((s,r)=>s+num(r.metadata.amount),0),unapprovedVariations:unapproved.length,unapprovedVariationValue:unapproved.reduce((s,r)=>s+num(r.metadata.submittedValue??r.metadata.amount),0),unbilledValue:dockets.filter(r=>['approved','matched','ready'].includes(status(r))).reduce((s,r)=>s+num(r.metadata.amount),0),quoteWinRate:reviewed.length?100*reviewed.filter(r=>['awarded','won'].includes(status(r))).length/reviewed.length:0,expiredWorkers:rows('workers').filter(expired).length,unavailablePlant:rows('plant').filter(r=>expired(r)||['out of service','unavailable','maintenance','inactive'].includes(status(r))).length,openQA:rows('qa_safety_records').filter(r=>!['closed','complete','completed','cancelled'].includes(status(r))).length,actualTonnes:fields.reduce((s,r)=>s+num(r.metadata.tonnes),0),actualArea:fields.reduce((s,r)=>s+num(r.metadata.area),0)};
}
export type ReportSummary = ReturnType<typeof summarise>;
