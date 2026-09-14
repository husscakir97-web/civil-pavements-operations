export function belongsToJob(docket:Record<string,unknown>, job:Record<string,unknown>) {
 let links:Record<string,unknown>={};
 try { links=typeof docket.links==='string'?JSON.parse(docket.links):docket.links as Record<string,unknown>||{}; } catch { return false; }
 if (links.jobId) return links.jobId===job.id;
 const project=String(docket.project||'').trim().toLowerCase();
 return Boolean(project && project===String(job.name||'').trim().toLowerCase());
}
export function periodBounds(period:string) {
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
 const [y,m]=period.split('-').map(Number);
 return {start:`${period}-01`,end:new Date(Date.UTC(y,m,1)).toISOString().slice(0,10)};
}
