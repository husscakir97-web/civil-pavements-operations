// Turns rows copied from a spreadsheet into estimate items. Deterministic:
// columns are Description, Quantity, Unit, Rate, then optional Category and
// Section. A header row (non-numeric quantity) is skipped; bad rows are reported.
import {COST_CATEGORIES,type EstimateItem} from '@/lib/estimate-calculations';

const num=(s:string|undefined)=>{const t=String(s??'').replace(/[$,\s]/g,'');return t===''?NaN:Number(t);};

export function parsePastedItems(text:string,section='General',makeId:(i:number)=>string=i=>`item-${Date.now()}-${i}`){
 const items:EstimateItem[]=[],skipped:number[]=[];
 const lines=text.replace(/\r/g,'').split('\n').filter(l=>l.trim());
 lines.forEach((line,index)=>{
  const cells=(line.includes('\t')?line.split('\t'):line.split(',')).map(c=>c.trim());
  const [description,qty,unit,rate,category,sec]=cells;
  const quantity=num(qty),price=num(rate);
  if(!description||!Number.isFinite(quantity)||!Number.isFinite(price)){if(!(index===0&&!Number.isFinite(quantity)))skipped.push(index+1);return;}
  const cat=String(category||'').toLowerCase();
  items.push({id:makeId(index),section:sec||section,costCode:'',category:(COST_CATEGORIES as readonly string[]).includes(cat)?cat as EstimateItem['category']:'other',description:description.slice(0,500),quantity,unit:unit||'item',productivity:0,rateBasis:'unit',rate:price});
 });
 return {items,skipped};
}
