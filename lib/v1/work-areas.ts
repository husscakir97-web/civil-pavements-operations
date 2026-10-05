// Project work areas: simple operational polygons (an area or a stage of work) drawn over a project.
// Isomorphic (server + UI). Geometry is stored in WGS84 decimal degrees, separate from the address pin.
// This is an operational overview only — not an approved traffic-management plan, survey or design.
import {validPoint,roundPoint,type LatLng} from './location';

export const WORK_AREA_KINDS=['work_area','stage'] as const;
export const WORK_AREA_DISCIPLINES=['asphalt','stabilisation','traffic_management','other'] as const;
export const WORK_AREA_DELIVERY=['own','subcontracted'] as const;
export type WorkAreaKind=typeof WORK_AREA_KINDS[number];
export type WorkAreaDiscipline=typeof WORK_AREA_DISCIPLINES[number];
export type WorkAreaDelivery=typeof WORK_AREA_DELIVERY[number];
export const KIND_LABEL:Record<WorkAreaKind,string>={work_area:'Work area',stage:'Stage'};
export const DISCIPLINE_LABEL:Record<WorkAreaDiscipline,string>={asphalt:'Asphalt',stabilisation:'Stabilisation',traffic_management:'Traffic management',other:'Other'};
export const DISCIPLINE_COLOUR:Record<WorkAreaDiscipline,string>={asphalt:'#334155',stabilisation:'#b45309',traffic_management:'#0f766e',other:'#6d28d9'};
export const DELIVERY_LABEL:Record<WorkAreaDelivery,string>={own:'Own crew',subcontracted:'Subcontracted'};
export const WORK_MAP_DISCLAIMER='Operational work-area overview. Not an approved traffic management plan, survey or design.';

export const WORK_AREA_LIMITS={minVertices:3,maxVertices:100,maxSpanMetres:10_000,maxAreaM2:25_000_000,minAreaM2:1,maxActivePerProject:200,maxNameLength:160,maxNotesLength:2000};

const MPD=6371008.8*Math.PI/180;// metres per degree of latitude (spherical)
export type Xy={x:number;y:number};
/** Local equirectangular projection around a reference latitude/longitude (metres, y north). Adequate at project scale. */
export const toLocal=(p:LatLng,o:LatLng):Xy=>({x:(p.lng-o.lng)*MPD*Math.cos(o.lat*Math.PI/180),y:(p.lat-o.lat)*MPD});
export const fromLocal=(q:Xy,o:LatLng):LatLng=>({lat:o.lat+q.y/MPD,lng:o.lng+q.x/(MPD*Math.cos(o.lat*Math.PI/180))});

const cross=(a:Xy,b:Xy,c:Xy)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const EPS=1e-6;// metres²-scale tolerance
const onSeg=(a:Xy,b:Xy,p:Xy)=>Math.min(a.x,b.x)-1e-9<=p.x&&p.x<=Math.max(a.x,b.x)+1e-9&&Math.min(a.y,b.y)-1e-9<=p.y&&p.y<=Math.max(a.y,b.y)+1e-9;
function segmentsTouch(a:Xy,b:Xy,c:Xy,d:Xy){
 const d1=cross(a,b,c),d2=cross(a,b,d),d3=cross(c,d,a),d4=cross(c,d,b);
 if(((d1>EPS&&d2<-EPS)||(d1<-EPS&&d2>EPS))&&((d3>EPS&&d4<-EPS)||(d3<-EPS&&d4>EPS)))return true;
 return (Math.abs(d1)<=EPS&&onSeg(a,b,c))||(Math.abs(d2)<=EPS&&onSeg(a,b,d))||(Math.abs(d3)<=EPS&&onSeg(c,d,a))||(Math.abs(d4)<=EPS&&onSeg(c,d,b));
}

export type RingResult={ok:true;ring:LatLng[];areaM2:number;spanM:number;bbox:{minLat:number;maxLat:number;minLng:number;maxLng:number};centroid:LatLng}|{ok:false;error:string};
/**
 * Validates and normalises one polygon ring (open: the closing vertex is implied).
 * Rejects bad coordinates, too few/many vertices, duplicates, self-intersection, tiny or oversized shapes.
 */
export function validateRing(input:unknown):RingResult{
 const L=WORK_AREA_LIMITS;
 if(!Array.isArray(input))return {ok:false,error:'The shape must be a list of points.'};
 if(input.length>L.maxVertices+1)return {ok:false,error:`The shape has too many points (maximum ${L.maxVertices}).`};
 const pts:LatLng[]=[];
 for(const raw of input){
  const r=raw as LatLng;
  if(!r||typeof r!=='object'||typeof r.lat!=='number'||typeof r.lng!=='number'||!validPoint(r))return {ok:false,error:'Every point needs a valid latitude (−90 to 90) and longitude (−180 to 180).'};
  pts.push(roundPoint({lat:r.lat,lng:r.lng}));
 }
 // A client may repeat the first point to close the ring; storage is always open.
 if(pts.length>1&&pts[0].lat===pts[pts.length-1].lat&&pts[0].lng===pts[pts.length-1].lng)pts.pop();
 if(pts.length<L.minVertices)return {ok:false,error:`A shape needs at least ${L.minVertices} points.`};
 if(pts.length>L.maxVertices)return {ok:false,error:`The shape has too many points (maximum ${L.maxVertices}).`};
 const seen=new Set<string>();
 for(const p of pts){const k=`${p.lat},${p.lng}`;if(seen.has(k))return {ok:false,error:'The shape repeats a point. Remove the duplicate.'};seen.add(k);}
 const o=pts[0],xy=pts.map(p=>toLocal(p,o));
 const xs=xy.map(p=>p.x),ys=xy.map(p=>p.y),span=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
 if(span>L.maxSpanMetres)return {ok:false,error:`The shape is too large (over ${L.maxSpanMetres/1000} km across). Draw smaller areas or stages.`};
 let a2=0,cx=0,cy=0;
 for(let i=0;i<xy.length;i++){const p=xy[i],q=xy[(i+1)%xy.length],f=p.x*q.y-q.x*p.y;a2+=f;cx+=(p.x+q.x)*f;cy+=(p.y+q.y)*f;}
 const area=Math.abs(a2)/2;
 const n=xy.length;
 for(let i=0;i<n;i++){
  const a=xy[i],b=xy[(i+1)%n];
  // Adjacent edges must not fold back on themselves.
  const c=xy[(i+2)%n];
  if(Math.abs(cross(a,b,c))<=EPS&&((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))<0)return {ok:false,error:'The shape folds back on itself.'};
  for(let j=i+2;j<n;j++){
   if(i===0&&j===n-1)continue;// adjacent via the closing edge
   if(segmentsTouch(a,b,xy[j],xy[(j+1)%n]))return {ok:false,error:'The shape crosses itself. Move a point so the outline does not cross.'};
  }
 }
 if(area<L.minAreaM2)return {ok:false,error:'The shape is too small or has no area (points in a line).'};
 if(area>L.maxAreaM2)return {ok:false,error:`The shape is too large (over ${L.maxAreaM2/1e6} km²).`};
 const lats=pts.map(p=>p.lat),lngs=pts.map(p=>p.lng);
 const c=a2===0?o:fromLocal({x:cx/(3*a2),y:cy/(3*a2)},o);
 return {ok:true,ring:pts,areaM2:Math.round(area*10)/10,spanM:Math.round(span),bbox:{minLat:Math.min(...lats),maxLat:Math.max(...lats),minLng:Math.min(...lngs),maxLng:Math.max(...lngs)},centroid:roundPoint(c)};
}

// ---------------------------------------------------------------- work point
// The work point is the saved site/project location a person has explicitly confirmed as where the work happens. Polygons are stored in
// absolute coordinates and never follow the address or pin; if the effective location later moves away from the confirmed point the
// work map flags it for review instead of silently shifting (or trusting) the saved shapes.
export const WORK_POINT_TOLERANCE_M=5;
export type WorkPointStatus='none'|'unconfirmed'|'confirmed'|'moved';
export type WorkPointView={status:WorkPointStatus;/** where the project's location comes from */source:'project'|'site'|null;label:string|null;current:LatLng|null;confirmed:{point:LatLng;source:string;confirmedAt:string;confirmedBy:string|null}|null;distanceM:number|null;toleranceM:number};
export const distanceMetres=(a:LatLng,b:LatLng)=>{const q=toLocal(b,a);return Math.round(Math.hypot(q.x,q.y)*10)/10;};
/** Pure status rule: no location → none; a location nobody confirmed → unconfirmed; within tolerance of the confirmed point → confirmed; otherwise moved (review). */
export function workPointStatus(current:LatLng|null,confirmed:LatLng|null,toleranceM=WORK_POINT_TOLERANCE_M):{status:WorkPointStatus;distanceM:number|null}{
 if(!current)return {status:'none',distanceM:null};
 if(!confirmed)return {status:'unconfirmed',distanceM:null};
 const d=distanceMetres(confirmed,current);
 return {status:d<=toleranceM?'confirmed':'moved',distanceM:d};
}

export type WorkAreaView={id:string;projectId:string;name:string;kind:WorkAreaKind;discipline:WorkAreaDiscipline;delivery:WorkAreaDelivery;contractorLabel:string|null;sequence:number|null;notes:string|null;ring:LatLng[];areaM2:number;status:'active'|'archived';revision:number;createdAt:string;updatedAt:string;archivedAt:string|null;demo:boolean};
export type WorkMapView={projectId:string;projectName:string;projectNumber:string|null;projectRevision:number;stage:string;closed:boolean;canEdit:boolean;pin:LatLng|null;address:string|null;workPoint:WorkPointView;areas:WorkAreaView[];limits:typeof WORK_AREA_LIMITS;disclaimer:string};

/** Rows are marked DEMO by name only; nothing else in the product keys off it. */
export const isDemoName=(name:string)=>/^DEMO\b/i.test(name.trim());
