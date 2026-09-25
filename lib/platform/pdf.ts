// Shared document renderer for controlled documents (SWMS, invoices...).
// Every page carries the organisation's name, the document number, revision and
// status in the header, and "Page X of Y", generation date and control note in the footer.
import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';
import {one} from './sql';

export type DocBlock={heading?:string;text?:string;rows?:Array<[string,string]>;table?:{columns:string[];rows:string[][];widths:number[];align?:Array<'left'|'right'>}};
export type DocSpec={
 company:{name:string;abn?:string|null;address?:string|null};
 title:string;number:string;revision?:string|number|null;status:string;
 approval?:{label:string;by?:string|null;at?:string|null}|null;date:string;
 blocks:DocBlock[];control?:string;
};

const W=595,H=842,M=40,CONTENT=W-M*2;
const safe=(t:unknown)=>String(t??'').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,'-').replace(/[^\x20-\x7E\n]/g,'-');

export async function organisationBranding(organisationId:string){
 const p=await one<{legal_name:string|null;trading_name:string|null;abn:string|null;registered_address:string|null;name:string}>('SELECT p.legal_name,p.trading_name,p.abn,p.registered_address,o.name FROM organisations o LEFT JOIN organisation_profiles p ON p.organisation_id=o.id WHERE o.id=?',[organisationId]);
 const abn=p?.abn&&p.abn.length===11?`${p.abn.slice(0,2)} ${p.abn.slice(2,5)} ${p.abn.slice(5,8)} ${p.abn.slice(8)}`:null;
 return {name:p?.trading_name||p?.legal_name||p?.name||'Organisation',legalName:p?.legal_name||null,abn,address:p?.registered_address||null};
}

export async function renderDocument(spec:DocSpec){
 const pdf=await PDFDocument.create();
 pdf.setTitle(`${spec.number} ${spec.title}`);pdf.setAuthor(spec.company.name);pdf.setCreator('Infrastruct');
 const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const pages:PDFPage[]=[];let page!:PDFPage,y=0;
 const header=()=>{
  page=pdf.addPage([W,H]);pages.push(page);
  page.drawText(safe(spec.company.name),{x:M,y:H-M,size:12,font:bold});
  if(spec.company.abn)page.drawText(`ABN ${safe(spec.company.abn)}`,{x:M,y:H-M-13,size:8,font});
  const right=`${safe(spec.number)}${spec.revision!=null&&spec.revision!==''?` · Rev ${safe(spec.revision)}`:''} · ${safe(spec.status)}`;
  page.drawText(right,{x:W-M-font.widthOfTextAtSize(right,9),y:H-M,size:9,font});
  page.drawText(safe(spec.title),{x:W-M-font.widthOfTextAtSize(safe(spec.title),8),y:H-M-13,size:8,font});
  page.drawLine({start:{x:M,y:H-M-20},end:{x:W-M,y:H-M-20},thickness:0.5,color:rgb(0.6,0.6,0.6)});
  y=H-M-38;
 };
 const ensure=(h:number)=>{if(y-h<M+30)header();};
 const lines=(t:string,size:number,f:PDFFont,width:number)=>{const out:string[]=[];for(const para of safe(t).split('\n')){let line='';for(const w of para.split(' ')){const next=line?`${line} ${w}`:w;if(f.widthOfTextAtSize(next,size)>width&&line){out.push(line);line=w;}else line=next;}out.push(line);}return out;};
 const write=(t:string,size=10,f:PDFFont=font,x=M,width=CONTENT)=>{for(const l of lines(t,size,f,width)){ensure(size+4);page.drawText(l,{x,y,size,font:f});y-=size+4;}};
 header();
 write(spec.title,16,bold);y-=2;
 write(`Date: ${spec.date}${spec.approval?` · ${spec.approval.label}: ${spec.approval.by||'—'}${spec.approval.at?` on ${spec.approval.at}`:''}`:''}`,9);
 y-=6;
 for(const b of spec.blocks){
  if(b.heading){y-=4;ensure(30);write(b.heading,11,bold);}
  if(b.text!==undefined)write(b.text||'Not recorded',10);
  if(b.rows)for(const [k,v] of b.rows){const vl=lines(v||'—',10,font,CONTENT-150);ensure(vl.length*14);page.drawText(safe(k),{x:M,y,size:10,font:bold});for(const l of vl){page.drawText(l,{x:M+150,y,size:10,font});y-=14;}}
  if(b.table){
   const t=b.table,xs=t.widths.map((_,i)=>M+t.widths.slice(0,i).reduce((a,w)=>a+w,0));
   const row=(cells:string[],f:PDFFont)=>{const wrapped=cells.map((c,i)=>lines(c,9,f,t.widths[i]-6));const h=Math.max(...wrapped.map(w=>w.length))*12+4;ensure(h);wrapped.forEach((w,i)=>w.forEach((l,j)=>{const right=t.align?.[i]==='right';page.drawText(l,{x:right?xs[i]+t.widths[i]-6-f.widthOfTextAtSize(l,9):xs[i],y:y-j*12,size:9,font:f});}));y-=h;};
   row(t.columns,bold);page.drawLine({start:{x:M,y:y+8},end:{x:W-M,y:y+8},thickness:0.5,color:rgb(0.7,0.7,0.7)});
   for(const r of t.rows)row(r,font);
  }
 }
 const generated=new Date().toISOString().slice(0,10);
 pages.forEach((p,i)=>{
  const left=safe(spec.control||'Controlled document. Printed copies are uncontrolled.').slice(0,110);
  p.drawLine({start:{x:M,y:M+14},end:{x:W-M,y:M+14},thickness:0.5,color:rgb(0.6,0.6,0.6)});
  p.drawText(left,{x:M,y:M,size:7,font});
  const r=`Generated ${generated} · Page ${i+1} of ${pages.length}`;
  p.drawText(r,{x:W-M-font.widthOfTextAtSize(r,7),y:M,size:7,font});
 });
 return pdf.save();
}
