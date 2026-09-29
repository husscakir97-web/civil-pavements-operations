// Shared spreadsheet reading for bulk imports (employees, plant, CRM): .xlsx or .csv,
// size-limited, headings in row 1, cell values as trimmed text. Nothing here writes data.
import ExcelJS from 'exceljs';
import {Readable} from 'node:stream';
import {fail} from './http';

/** Heading key: case, punctuation and "&" insensitive ("Client Code" ≈ "client-code"). */
export const headingKey=(s:string)=>s.toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
export const cellText=(v:ExcelJS.CellValue)=>{if(v==null)return '';if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')return String(v).trim();if('text' in v)return String(v.text||'').trim();if('result' in v&&v.result!=null)return String(v.result).trim();if('richText' in v)return v.richText.map(x=>x.text).join('').trim();return ''};

/** Reads an uploaded workbook (8 MB limit). A CSV becomes a single worksheet. */
export async function readWorkbook(file:File){
 if(file.size>8*1024*1024)fail(413,'Use a spreadsheet smaller than 8 MB.');
 const n=file.name.toLowerCase();
 if(!n.endsWith('.xlsx')&&!n.endsWith('.csv'))fail(400,'Use .xlsx or .csv. Save older .xls files as .xlsx first.');
 const bytes=Buffer.from(await file.arrayBuffer()),w=new ExcelJS.Workbook();
 if(n.endsWith('.csv')){const s=await w.csv.read(Readable.from([bytes]));return {workbook:w,sheets:[s],csv:true};}
 await w.xlsx.read(Readable.from([bytes]));
 const sheets=w.worksheets.filter(x=>x.state==='visible'&&x.name!=='Instructions');
 if(!sheets.length)fail(400,'Spreadsheet has no worksheet.');
 return {workbook:w,sheets,csv:false};
}

export type FieldDef={key:string;label:string;aliases:string[]};
export type ParsedSheet={name:string;heads:Array<{source:string;key:string|null}>;rows:Array<{rowNumber:number;cells:Record<string,string>;provided:Set<string>}>};
/**
 * Maps row-1 headings to fields (label, known aliases, or a manual choice keyed by heading),
 * then returns non-empty data rows. Two columns mapping to one field is refused.
 */
export function parseSheet(s:ExcelJS.Worksheet,defs:FieldDef[],manual:Record<string,string>={},maxRows=2000):ParsedSheet{
 const map=new Map<string,string>(),valid=new Set(defs.map(d=>d.key));
 for(const d of defs){map.set(headingKey(d.label),d.key);for(const a of d.aliases)map.set(headingKey(a),d.key);}
 const heads:Array<{source:string;key:string|null}>=[];
 s.getRow(1).eachCell({includeEmpty:false},c=>{const source=cellText(c.value),chosen=manual[source];heads[Number(c.col)-1]={source,key:chosen==='__ignore'?null:chosen&&valid.has(chosen)?chosen:(map.get(headingKey(source))||null)};});
 if(!heads.filter(Boolean).length)fail(400,`Row 1 of “${s.name}” must contain headings.`);
 const mapped=heads.filter(x=>x?.key);
 for(const key of new Set(mapped.map(x=>x.key)))if(mapped.filter(x=>x.key===key).length>1)fail(400,`More than one column in “${s.name}” maps to ${defs.find(d=>d.key===key)?.label||key}. Choose only one source column for each field.`);
 if(s.rowCount>maxRows+1)fail(400,`Maximum ${maxRows.toLocaleString('en-AU')} data rows per sheet.`);
 const rows:ParsedSheet['rows']=[];
 for(let r=2;r<=s.rowCount;r++){
  const cells:Record<string,string>={},provided=new Set<string>();let any=false;
  for(let i=0;i<heads.length;i++){const hd=heads[i];if(!hd?.key)continue;const v=cellText(s.getRow(r).getCell(i+1).value);if(v!==''){cells[hd.key]=v;provided.add(hd.key);any=true;}}
  if(any)rows.push({rowNumber:r,cells,provided});
 }
 return {name:s.name,heads,rows};
}
