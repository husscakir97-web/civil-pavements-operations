// Core location rules shared by server and browser. An address identifies the general site;
// the pin identifies exactly where the work is. The provider's geocoded point is kept next to
// the operational pin; moving the pin never overwrites the geocoded reference.

export type LatLng={lat:number;lng:number};
export type AddressParts={addressLine1:string|null;addressLine2:string|null;locality:string|null;state:string|null;postcode:string|null;country:string|null};
/** A resolved provider place (from autocomplete selection or geocoding): only the fields Infrastruct keeps. */
export type ResolvedPlace=AddressParts&{provider:string;placeId:string|null;formattedAddress:string;point:LatLng|null;precision:string|null};
export type Suggestion={placeId:string;primary:string;secondary:string|null};
/** What a form submits for a location. */
export type LocationInput=AddressParts&{
 label?:string|null;formattedAddress?:string|null;
 provider?:string|null;placeId?:string|null;precision?:string|null;
 geocoded?:LatLng|null;pin?:LatLng|null;pinAddress?:string|null;
 source?:'autocomplete'|'manual'|'reverse'|'legacy'|'inherited';
 geocodedAt?:string|null;reverseGeocodedAt?:string|null;
};
/** What the server returns for a location. */
export type LocationView=AddressParts&{id:string;label:string|null;formattedAddress:string|null;provider:string|null;placeId:string|null;precision:string|null;geocoded:LatLng|null;pin:LatLng|null;pinAdjusted:boolean;pinAddress:string|null;source:string;revision:number};

export const EMPTY_PARTS:AddressParts={addressLine1:null,addressLine2:null,locality:null,state:null,postcode:null,country:null};

/** Valid WGS84 coordinates (rejects 0,0 "null island" defaults and out-of-range values). */
export function validPoint(p:unknown):p is LatLng{
 const x=p as LatLng;
 return Boolean(x&&Number.isFinite(x.lat)&&Number.isFinite(x.lng)&&Math.abs(x.lat)<=90&&Math.abs(x.lng)<=180&&!(x.lat===0&&x.lng===0));
}
/** Two points are the same pin when they agree to ~1 cm (7 decimal places). */
export const samePoint=(a:LatLng|null|undefined,b:LatLng|null|undefined)=>Boolean(a&&b&&Math.abs(a.lat-b.lat)<1e-7&&Math.abs(a.lng-b.lng)<1e-7);
export const roundPoint=(p:LatLng):LatLng=>({lat:Math.round(p.lat*1e7)/1e7,lng:Math.round(p.lng*1e7)/1e7});

type Component={longText?:string;shortText?:string;long_name?:string;short_name?:string;types:string[]};
/**
 * Maps provider address components (Places API (New) `longText/shortText` or Geocoding
 * `long_name/short_name`) to structured fields. Nothing is parsed from free text, and a street
 * number is only used when the provider returned one.
 */
export function mapAddressComponents(components:Component[]|null|undefined):AddressParts{
 const pick=(type:string,short=false)=>{const c=(components||[]).find(x=>x.types?.includes(type));if(!c)return null;return (short?(c.shortText??c.short_name):(c.longText??c.long_name))||null;};
 const number=pick('street_number'),route=pick('route'),sub=pick('subpremise'),premise=pick('premise');
 const line1=[sub&&number?`${sub}/${number}`:number,route].filter(Boolean).join(' ')||premise||null;
 return {addressLine1:line1,addressLine2:null,locality:pick('locality')||pick('postal_town')||pick('sublocality')||pick('administrative_area_level_2'),state:pick('administrative_area_level_1',true),postcode:pick('postal_code'),country:pick('country',true)};
}

/** Human single-line address from structured parts (used when a person typed the parts). */
export const formatParts=(p:Partial<AddressParts>)=>[p.addressLine1,p.addressLine2,[p.locality,p.state,p.postcode].filter(Boolean).join(' ')].map(x=>String(x||'').trim()).filter(Boolean).join(', ');

/** Pin state for display: the address point, or an adjusted exact work point. */
export function pinState(l:{geocoded:LatLng|null;pin:LatLng|null}):'none'|'address'|'adjusted'|'manual'{
 if(!l.pin)return 'none';
 if(!l.geocoded)return 'manual';
 return samePoint(l.geocoded,l.pin)?'address':'adjusted';
}

/** Standard directions deep link to the exact work point (no API key involved). */
export function directionsUrl(l:{pin?:LatLng|null;geocoded?:LatLng|null;formattedAddress?:string|null}|null|undefined){
 if(!l)return null;
 const p=l.pin||l.geocoded;
 if(p&&validPoint(p))return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
 if(l.formattedAddress)return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.formattedAddress)}`;
 return null;
}

/** Precision labels that mean the provider point is only approximate (not a street address). */
export const APPROXIMATE=new Set(['APPROXIMATE','GEOMETRIC_CENTER','locality','region']);
export const precisionLabel=(p:string|null|undefined)=>!p?null:p==='ROOFTOP'?'Street address':p==='RANGE_INTERPOLATED'?'Interpolated street address':APPROXIMATE.has(p)?'Approximate area':p==='manual'?'Entered by hand':p;
