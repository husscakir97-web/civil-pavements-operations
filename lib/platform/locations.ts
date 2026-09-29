// Core location service. Every location belongs to an owner record (client site, project,
// shift, depot, company, incident) and is only ever read or written through that owner's
// organisation-scoped, permission-checked service — there is no global location lookup.
import {z} from 'zod';
import {actorContext} from './context';
import {fail} from './http';
import {query,one,exec,nowIso,uuid,type Conn,type Row} from './sql';
import {validPoint,samePoint,roundPoint,formatParts,type LocationInput,type LocationView,type LatLng} from '@/lib/v1/location';

const actor=()=>actorContext.getStore()!;
const point=z.object({lat:z.coerce.number(),lng:z.coerce.number()}).refine(validPoint,'Enter valid coordinates (latitude −90 to 90, longitude −180 to 180).');
const t=(n:number)=>z.string().trim().max(n).nullish();
export const locationInput=z.object({
 label:t(255),formattedAddress:t(500),addressLine1:t(255),addressLine2:t(255),locality:t(120),state:t(60),postcode:t(20),country:z.string().trim().max(2).nullish(),
 provider:t(20),placeId:t(255),precision:t(30),geocoded:point.nullish(),pin:point.nullish(),pinAddress:t(500),
 source:z.enum(['autocomplete','manual','reverse','legacy','inherited']).optional(),geocodedAt:t(40),reverseGeocodedAt:t(40),
}).refine(l=>Boolean(l.formattedAddress||l.addressLine1||l.locality||l.pin),'Enter an address or coordinates.');
export type OwnerType='client_site'|'project'|'shift'|'depot'|'company'|'incident'|'form_submission';

const num=(v:unknown)=>v==null?null:Number(v);
const pt=(lat:unknown,lng:unknown):LatLng|null=>lat==null||lng==null?null:{lat:Number(lat),lng:Number(lng)};
export function presentLocation(r:Row):LocationView{
 return {id:r.id,label:r.label??null,formattedAddress:r.formatted_address??null,addressLine1:r.address_line1??null,addressLine2:r.address_line2??null,locality:r.locality??null,state:r.state??null,postcode:r.postcode??null,country:r.country??null,provider:r.provider??null,placeId:r.provider_place_id??null,precision:r.precision??null,geocoded:pt(r.geocoded_lat,r.geocoded_lng),pin:pt(r.pin_lat,r.pin_lng),pinAdjusted:Boolean(Number(r.pin_adjusted)),pinAddress:r.pin_address??null,source:r.source||'manual',revision:num(r.revision)||1};
}

/**
 * Normalises a submitted location into stored columns.
 *  - A provider point (geocoded) is only kept with a provider place; hand-typed addresses carry no
 *    geocoded point or place id, so stale provider data never survives a manual edit.
 *  - The pin defaults to the geocoded point; pin_adjusted is true only when it differs.
 */
export function locationColumns(raw:LocationInput){
 const v=locationInput.parse(raw);
 const fromProvider=Boolean(v.placeId&&v.provider)&&v.source!=='manual';
 const geocoded=fromProvider&&v.geocoded?roundPoint(v.geocoded):null;
 const pin=v.pin?roundPoint(v.pin):geocoded;
 const formatted=(v.formattedAddress||formatParts(v)||null)?.slice(0,500)??null;
 return {
  label:v.label||null,formatted_address:formatted,address_line1:v.addressLine1||null,address_line2:v.addressLine2||null,locality:v.locality||null,state:v.state||null,postcode:v.postcode||null,country:v.country?v.country.toUpperCase():null,
  provider:fromProvider?v.provider!:null,provider_place_id:fromProvider?v.placeId!:null,precision:fromProvider?(v.precision||null):(pin?'manual':null),
  geocoded_lat:geocoded?.lat??null,geocoded_lng:geocoded?.lng??null,pin_lat:pin?.lat??null,pin_lng:pin?.lng??null,
  pin_adjusted:geocoded&&pin&&!samePoint(geocoded,pin)?1:0,pin_address:pin&&geocoded&&!samePoint(geocoded,pin)?(v.pinAddress||null):null,
  source:fromProvider?'autocomplete':v.source==='inherited'?'inherited':'manual',
  geocoded_at:fromProvider?(v.geocodedAt||nowIso()):null,reverse_geocoded_at:v.pinAddress&&geocoded&&pin&&!samePoint(geocoded,pin)?(v.reverseGeocodedAt||nowIso()):null,
 };
}

/**
 * Creates or updates the location owned by one record. `existingId` must already belong to the
 * same owner in this organisation (otherwise a new location is created, never re-pointed).
 */
export async function saveLocation(conn:Conn,owner:{type:OwnerType;id:string;locationType?:string},input:LocationInput,existingId?:string|null){
 const a=actor(),org=a.organisationId,cols=locationColumns(input),now=nowIso();
 const current=existingId?await one('SELECT id,revision FROM locations WHERE organisation_id=? AND id=? AND owner_type=? AND owner_id=?',[org,existingId,owner.type,owner.id],conn):null;
 if(current){
  const keys=Object.keys(cols) as Array<keyof typeof cols>;
  await exec(`UPDATE locations SET ${keys.map(k=>`\`${k}\`=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...keys.map(k=>cols[k]),now,org,current.id],conn);
  return current.id as string;
 }
 const id=uuid(),row:Row={id,organisation_id:org,owner_type:owner.type,owner_id:owner.id,location_type:owner.locationType||owner.type,...cols,revision:1,created_by:a.userId,created_at:now,updated_at:now};
 const keys=Object.keys(row);
 await exec(`INSERT INTO locations (${keys.map(k=>`\`${k}\``).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]),conn);
 return id;
}

/** Locations by id for records the caller has already authorised (always organisation-scoped). */
export async function loadLocations(ids:Array<string|null|undefined>,conn?:Conn):Promise<Map<string,LocationView>>{
 const list=[...new Set(ids.filter((x):x is string=>Boolean(x)))];
 if(!list.length)return new Map();
 const rows=await query('SELECT * FROM locations WHERE organisation_id=? AND id IN (?)',[actor().organisationId,list],conn);
 return new Map(rows.map(r=>[r.id as string,presentLocation(r)]));
}
export async function loadLocation(id:string|null|undefined,conn?:Conn){return id?(await loadLocations([id],conn)).get(id)??null:null;}

/** The address text a record keeps as its snapshot (history is not rewritten when the location changes later). */
export const locationSnapshot=(l:{formattedAddress?:string|null}|null|undefined)=>l?.formattedAddress||null;
export const assertLocationInput=(v:unknown)=>{const r=locationInput.safeParse(v);if(!r.success)fail(400,r.error.issues[0]?.message||'Check the location.');return r.data as LocationInput;};
