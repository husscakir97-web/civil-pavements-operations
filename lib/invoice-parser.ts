export type InvoicePage={ref:string;text:string;confidence:number;method:string;error?:string};
export type InvoiceLine={description:string;quantity:string;unitPrice:string;amount:string;source:string};
export type InvoiceDraft={invoiceNumber:string;supplier:string;customer:string;abn:string;invoiceDate:string;dueDate:string;poNumber:string;subtotal:string;gst:string;total:string;currency:string;direction:string;lines:InvoiceLine[];pages:InvoicePage[];warnings:string[]};
export function parseInvoice(pages:InvoicePage[]):InvoiceDraft {
 const text=pages.map(p=>p.text).join('\n');
 const get=(pattern:RegExp)=>text.match(pattern)?.[1]?.trim()||'';
 const amount=(labels:string)=>get(new RegExp('(?:^|\\n)\\s*(?:'+labels+')\\s*[:|]?\\s*(?:AUD\\s*)?\\$?\\s*([\\d,]+\\.\\d{2})\\s*(?:AUD)?\\s*(?:$|\\n)','im')).replaceAll(',','');
 const date=(label:string)=>{const s=get(new RegExp('(?:^|\\n)\\s*'+label+'\\s*[:|]?\\s*([^\\n]+)','im')); const m=s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/); if(m){const v=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return validDate(v)?v:'';}const iso=s.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]||'';return validDate(iso)?iso:'';};
 const refs=[...text.matchAll(/(?:^|\n)\s*(?:tax\s+)?invoice\s*(?:number|no\.?|#)\s*[:|]?\s*([A-Z0-9][A-Z0-9/\-]*)/gim)].map(m=>m[1]);
 const lines:InvoiceLine[]=[];
 for(const p of pages) for(const row of p.text.split('\n')){
  const m=row.match(/^(.+?)\s*(?:\||\s{2,})\s*(\d+(?:\.\d+)?)\s*(?:\||\s{2,})\s*\$?([\d,]+\.\d{2})\s*(?:\||\s{2,})\s*\$?([\d,]+\.\d{2})\s*$/);
  if(m&&!/subtotal|total|gst|amount|quantity/i.test(m[1]))lines.push({description:m[1].trim(),quantity:m[2],unitPrice:m[3].replaceAll(',',''),amount:m[4].replaceAll(',',''),source:p.ref});
 }
 return {invoiceNumber:refs[0]||'',supplier:get(/(?:^|\n)\s*(?:supplier|from|issued by)\s*:\s*([^\n]+)/im),customer:get(/(?:^|\n)\s*(?:bill to|customer|invoice to)\s*:\s*([^\n]+)/im),abn:get(/\bABN\s*:?\s*([\d ]{11,18})/i).replaceAll(' ',''),invoiceDate:date('(?:invoice date|date)'),dueDate:date('(?:due date|payment due)'),poNumber:get(/(?:^|\n)\s*(?:PO|purchase order|order no\.?)\s*[:#]?\s*([A-Z0-9/\-]+)/im),subtotal:amount('subtotal|sub total|total ex(?:cluding)?\\.? GST|net total'),gst:amount('GST(?: 10%)?|total GST|tax'),total:amount('grand total|invoice total|total inc(?:luding)?\\.? GST|total'),currency:'AUD',direction:'Supplier invoice',lines,pages,warnings:[...pages.filter(p=>p.error).map(p=>`${p.ref}: ${p.error}`),...(new Set(refs).size>1?['Multiple invoice numbers detected. Upload each invoice separately before confirming.']:[]),...(!lines.length?['Line items were not reliably extracted. Add or verify them against the original.']:[])]};
}
export function validDate(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function invoiceIssues(d:InvoiceDraft){
 const issues:string[]=[];
 for(const key of ['invoiceNumber','supplier','customer'] as const)if(!d[key]?.trim())issues.push(`${key} is required`);
 if(!validDate(d.invoiceDate))issues.push('Valid invoice date required');
 if(d.dueDate&&!validDate(d.dueDate))issues.push('Invalid due date');
 for(const key of ['subtotal','gst','total'] as const)if(d[key]===''||!Number.isFinite(Number(d[key]))||Number(d[key])<0)issues.push(`${key} must be a non-negative amount`);
 if(Math.abs(Number(d.subtotal)+Number(d.gst)-Number(d.total))>0.02)issues.push('Subtotal plus GST does not equal total');
 if(d.warnings.some(w=>w.startsWith('Multiple invoice')))issues.push('Separate invoices before confirming');
 if(d.pages.some(p=>p.error))issues.push('Resolve unreadable pages before confirming');
 if(!d.lines.length)issues.push('Add invoice line items before confirming');
 for(const l of d.lines){if(!l.description.trim()||[l.quantity,l.unitPrice,l.amount].some(v=>v===''||!Number.isFinite(Number(v))||Number(v)<0))issues.push('Complete line descriptions, quantities, rates and amounts');else if(Math.abs(Number(l.quantity)*Number(l.unitPrice)-Number(l.amount))>0.02)issues.push('Line quantity × rate does not equal line amount');}
 if(d.lines.length&&Math.abs(d.lines.reduce((n,l)=>n+Number(l.amount),0)-Number(d.subtotal))>0.02)issues.push('Line amounts do not equal subtotal (use ex-GST lines)');
 return [...new Set(issues)];
}
