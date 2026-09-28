import ExcelJS from 'exceljs';
import {calculateEstimate,type EstimateData} from './estimate-calculations';

/** XLSX is an editable costing snapshot; the application remains the approval authority. */
export function estimateWorkbook(data:EstimateData,company:string,status:string){
 const book=new ExcelJS.Workbook();book.creator=company;book.created=new Date();
 const sheet=(name:string,headers:string[])=>{const s=book.addWorksheet(name);s.addRow(headers);s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF243447'}};s.views=[{state:'frozen',ySplit:1}];s.columns=headers.map((h,i)=>({width:i===0?34:24}));return s;};
 const summary=sheet('Summary',['Estimate','Value']);
 for(const row of [['Company',company],['Name',data.name],['Status',status],['Client',data.clientName],['Project',data.projectName],['Site',data.site],['Specification',data.specification],['Assumptions',data.assumptions],['Exclusions',data.exclusions],['Use','Editable snapshot. Summary totals reflect the exported application estimate; editing detail sheets does not update application approvals.']])summary.addRow(row);
 const totals=calculateEstimate(data);
 const costs=sheet('Calculated totals',['Measure','Exported value']);
 for(const [key,value] of Object.entries(totals))if(typeof value==='number')costs.addRow([key.replace(/([A-Z])/g,' $1'),value]);
 const inputs=sheet('Inputs',['Input','Value']);
 for(const [key,value] of Object.entries(data))if(typeof value==='number'||typeof value==='boolean')inputs.addRow([key,typeof value==='boolean'?String(value):value]);
 const items=sheet('Work items',['Section','Cost code','Description','Category','Quantity','Unit','Productivity','Rate basis','Rate','Calculated cost']);
 for(const item of data.items||[]){const r=items.rowCount+1;items.addRow([item.section,item.costCode,item.description,item.category,item.quantity,item.unit,item.productivity,item.rateBasis,item.rate,{formula:`IF(H${r}="hour",IF(G${r}>0,E${r}/G${r}*I${r},0),E${r}*I${r})`}]);}
 const labour=sheet('Labour',['Name','People','Hours per shift','Hourly rate','Shifts','Cost']);
 for(const x of data.labour){const r=labour.rowCount+1;labour.addRow([x.name,x.headcount,x.hoursPerShift,x.hourlyRate,totals.estimatedShifts,{formula:`B${r}*C${r}*D${r}*E${r}`}]);}
 const plant=sheet('Plant',['Name','Units','Hours per shift','Hourly rate','Shifts','Cost']);
 for(const x of data.plant){const r=plant.rowCount+1;plant.addRow([x.name,x.units,x.hoursPerShift,x.hourlyRate,totals.estimatedShifts,{formula:`B${r}*C${r}*D${r}*E${r}`}]);}
 const subs=sheet('Subcontractors',['Name','Quantity','Unit','Rate','Cost']);
 for(const x of data.subcontractors){const r=subs.rowCount+1;subs.addRow([x.name,x.quantity,x.unit,x.unitRate,{formula:`B${r}*D${r}`}]);}
 const traffic=sheet('Traffic',['Name','Units','Days','Daily rate','Cost']);
 for(const x of data.traffic){const r=traffic.rowCount+1;traffic.addRow([x.name,x.units,x.days,x.ratePerDay,{formula:`B${r}*C${r}*D${r}`}]);}
 for(const s of book.worksheets){s.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,s.rowCount),column:s.columnCount}};s.eachRow((row,n)=>{if(n>1)row.eachCell(c=>{c.alignment={vertical:'top',wrapText:true};if(typeof c.value==='number'||c.type===ExcelJS.ValueType.Formula)c.numFmt='#,##0.00';});});}
 return book;
}
