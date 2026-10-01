// Service plan rules shared by Workshop (server and UI) and the scheduling conflict engine. Pure: no I/O.
// A plant item's plan is a next-service meter and/or a next-service date. Both are "plan" values: they change only through the
// explicit audited Workshop actions (initial plan, completed service, administrator plan correction), never through a meter reading
// or a generic asset edit. Service due is a warning for scheduling: it is not an assertion that the asset is safe or unsafe.

export const DEFAULT_TIME_ZONE='Australia/Sydney';
export type ServicePlan={meterType?:string|null;currentMeter?:number|null;nextServiceMeter?:number|null;nextServiceDate?:string|null};
export type ServiceStatus={overdue:boolean;meterReached:boolean;datePassed:boolean};

export const isDateOnly=(v:unknown):v is string=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const t=new Date(v+'T00:00:00Z').getTime();
 // An impossible date (month 13, 30 Feb) parses to NaN or rolls over; toISOString on NaN would throw, so check first.
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;
};
/** Meter readings and thresholds are stored as DECIMAL(15,2): at most two decimal places, so two values that differ can never be stored as equal. */
export const isMeterValue=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Number(v.toFixed(2))===v;
export const METER_PRECISION_MESSAGE='Use at most 2 decimal places.';
export const isTimeZone=(tz:unknown):tz is string=>{if(typeof tz!=='string'||!tz)return false;try{new Intl.DateTimeFormat('en-CA',{timeZone:tz}).format(new Date());return true;}catch{return false;}};
/** The calendar date (YYYY-MM-DD) of an instant in an organisation's time zone. All date-only comparisons use this, never the server's zone. */
export const dateIn=(timeZone:string,when:Date|string|number=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:isTimeZone(timeZone)?timeZone:DEFAULT_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(when));

const num=(v:unknown)=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
/**
 * Whether the plan is due as at `onDate` (the scheduled shift date, or the organisation's today when there is none).
 * Meter: reached when the latest recorded reading is at or above the threshold (a meter cannot be projected forward).
 * Date: passed when `onDate` is after the service date, so a booking after the deadline is flagged in advance.
 * Assets with no recorded plan are never flagged: thresholds are not invented.
 */
export function serviceStatus(plan:ServicePlan,onDate:string|null|undefined):ServiceStatus{
 const next=num(plan.nextServiceMeter),current=num(plan.currentMeter);
 const meterReached=next!=null&&current!=null&&current>=next;
 const due=plan.nextServiceDate&&isDateOnly(plan.nextServiceDate)?plan.nextServiceDate:null;
 const datePassed=Boolean(due&&onDate&&isDateOnly(onDate)&&onDate>due);
 return {overdue:meterReached||datePassed,meterReached,datePassed};
}
export const hasServicePlan=(plan:ServicePlan)=>num(plan.nextServiceMeter)!=null||Boolean(plan.nextServiceDate);
