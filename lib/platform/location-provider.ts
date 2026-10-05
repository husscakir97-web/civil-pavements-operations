import {assertNotMaintenance} from './maintenance';
// Location provider abstraction. Business modules never call a mapping vendor directly: they
// use lib/platform/locations.ts and the AddressLocationPicker, which talk to a LocationProvider.
//  - google: Google Maps Platform. Autocomplete, place details and reverse geocoding run in the
//    browser with the referrer-restricted browser key (Maps JavaScript API + Places API (New)).
//    If only a server key is configured, the same operations run through the server using
//    Places API (New) and the Geocoding API.
//  - fake:   deterministic fixtures for CI and local tests (no network, no billing).
//  - none:   no provider — manual structured address and optional coordinates.
import type {LatLng,ResolvedPlace,Suggestion} from '@/lib/v1/location';
import {mapAddressComponents,roundPoint,placeResultKind} from '@/lib/v1/location';

export interface LocationProvider{
 readonly name:string;
 autocomplete(input:string,sessionToken:string|null,region:string):Promise<Suggestion[]>;
 place(placeId:string,sessionToken:string|null):Promise<ResolvedPlace|null>;
 geocode(address:string,region:string):Promise<ResolvedPlace|null>;
 reverse(point:LatLng):Promise<ResolvedPlace|null>;
}
export class ProviderUnavailable extends Error{constructor(message='The address provider is unavailable.'){super(message);}}

export type LocationConfig={provider:'google'|'fake'|'none';mode:'browser'|'server'|'none';browserKey:string|null;mapId:string|null;region:string};
/**
 * Runtime configuration (read per request, so keys can change without a rebuild):
 *  LOCATION_PROVIDER      google | fake | none (default: google when a Google key is present)
 *  GOOGLE_MAPS_BROWSER_KEY browser key — HTTP-referrer and API restricted; not a secret
 *  GOOGLE_MAPS_MAP_ID     map ID for advanced markers (Google's DEMO_MAP_ID when unset)
 *  GOOGLE_MAPS_SERVER_KEY optional server-only key (never sent to the browser)
 *  LOCATION_DEFAULT_REGION two-letter region bias (default "au")
 */
export function locationConfig(env:Record<string,string|undefined>=process.env):LocationConfig{
 const region=(env.LOCATION_DEFAULT_REGION||'au').toLowerCase().slice(0,2);
 const wanted=(env.LOCATION_PROVIDER||'').toLowerCase();
 if(wanted==='fake')return {provider:'fake',mode:'server',browserKey:null,mapId:null,region};
 if(wanted==='none')return {provider:'none',mode:'none',browserKey:null,mapId:null,region};
 if(env.GOOGLE_MAPS_BROWSER_KEY)return {provider:'google',mode:'browser',browserKey:env.GOOGLE_MAPS_BROWSER_KEY,mapId:env.GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID',region};
 if(env.GOOGLE_MAPS_SERVER_KEY)return {provider:'google',mode:'server',browserKey:null,mapId:null,region};
 return {provider:'none',mode:'none',browserKey:null,mapId:null,region};
}

// ---------------------------------------------------------------- fake (deterministic)
const FIXTURES:Array<ResolvedPlace&{match:string}>=[
 {match:'24 york road ingleburn',provider:'fake',placeId:'fake-york-rd-ingleburn',formattedAddress:'24 York Road, Ingleburn NSW 2565, Australia',addressLine1:'24 York Road',addressLine2:null,locality:'Ingleburn',state:'NSW',postcode:'2565',country:'AU',point:{lat:-33.9985,lng:150.8612},precision:'ROOFTOP'},
 {match:'dover road rose bay',provider:'fake',placeId:'fake-dover-rd-rose-bay',formattedAddress:'Dover Road, Rose Bay NSW 2029, Australia',addressLine1:'Dover Road',addressLine2:null,locality:'Rose Bay',state:'NSW',postcode:'2029',country:'AU',point:{lat:-33.8733,lng:151.2694},precision:'GEOMETRIC_CENTER'},
 {match:'100 smith street parramatta',provider:'fake',placeId:'fake-smith-st-parramatta',formattedAddress:'100 Smith Street, Parramatta NSW 2150, Australia',addressLine1:'100 Smith Street',addressLine2:null,locality:'Parramatta',state:'NSW',postcode:'2150',country:'AU',point:{lat:-33.8136,lng:151.0034},precision:'ROOFTOP'},
];
/** Reverse fixtures: points (to 4 dp) with a known address; anything else has no address. */
const REVERSE:Record<string,Omit<ResolvedPlace,'point'>>={
 '-33.9990,150.8620':{provider:'fake',placeId:'fake-york-rd-yard',formattedAddress:'Yard entrance, York Road, Ingleburn NSW 2565, Australia',addressLine1:'York Road',addressLine2:null,locality:'Ingleburn',state:'NSW',postcode:'2565',country:'AU',precision:'RANGE_INTERPOLATED'},
 '-33.8741,151.2702':{provider:'fake',placeId:'fake-dover-rd-120',formattedAddress:'120 Dover Road, Rose Bay NSW 2029, Australia',addressLine1:'120 Dover Road',addressLine2:null,locality:'Rose Bay',state:'NSW',postcode:'2029',country:'AU',precision:'ROOFTOP'},
};
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
export const fakeProvider:LocationProvider={
 name:'fake',
 async autocomplete(input){const q=norm(input);if(q==='offline')throw new ProviderUnavailable();if(q.length<3)return [];return FIXTURES.filter(f=>f.match.includes(q)||q.includes(f.match)).map(f=>({placeId:f.placeId!,primary:f.addressLine1||f.formattedAddress,secondary:[f.locality,f.state,f.postcode].filter(Boolean).join(' ')}));},
 async place(placeId){const f=FIXTURES.find(x=>x.placeId===placeId);if(!f)return null;const {match:_m,...rest}=f;void _m;return rest;},
 async geocode(address){const q=norm(address);const f=FIXTURES.find(x=>q.includes(x.match));if(!f)return null;const {match:_m,...rest}=f;void _m;return rest;},
 async reverse(point){const key=`${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;if(key==='-1.0000,-1.0000')throw new ProviderUnavailable('Reverse geocoding failed.');const r=REVERSE[key];return r?{...r,point:roundPoint(point)}:null;},
};

// ---------------------------------------------------------------- google (server-side)
const FIELD_MASK='id,formattedAddress,addressComponents,location,types';
async function gfetch(url:string,init:RequestInit){
 assertNotMaintenance('the address provider');
 let r:Response;
 try{r=await fetch(url,{...init,signal:AbortSignal.timeout(8000)});}catch{throw new ProviderUnavailable();}
 if(r.status===429)throw new ProviderUnavailable('The address provider quota has been reached. Enter the address by hand.');
 if(!r.ok)throw new ProviderUnavailable();
 return r.json() as Promise<Record<string,unknown>>;
}
export function googleServerProvider(key:string):LocationProvider{
 return {
  name:'google',
  async autocomplete(input,sessionToken,region){
   const j=await gfetch('https://places.googleapis.com/v1/places:autocomplete',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key},body:JSON.stringify({input,sessionToken:sessionToken||undefined,includedRegionCodes:[region]})});
   return ((j.suggestions||[]) as Array<{placePrediction?:{placeId:string;structuredFormat?:{mainText?:{text:string};secondaryText?:{text:string}};text?:{text:string}}}>).flatMap(s=>s.placePrediction?[{placeId:s.placePrediction.placeId,primary:s.placePrediction.structuredFormat?.mainText?.text||s.placePrediction.text?.text||'',secondary:s.placePrediction.structuredFormat?.secondaryText?.text||null}]:[]);
  },
  async place(placeId,sessionToken){
   const j=await gfetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${sessionToken?`?sessionToken=${encodeURIComponent(sessionToken)}`:''}`,{headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':FIELD_MASK}});
   const loc=j.location as {latitude:number;longitude:number}|undefined;
   return {provider:'google',placeId:String(j.id||placeId),formattedAddress:String(j.formattedAddress||''),...mapAddressComponents(j.addressComponents as never),point:loc?roundPoint({lat:loc.latitude,lng:loc.longitude}):null,precision:placeResultKind(j.types as string[])};
  },
  async geocode(address,region){
   const j=await gfetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=${region}&key=${key}`,{});
   const r=(j.results as Array<Record<string,unknown>>)?.[0];if(!r)return null;
   const g=r.geometry as {location:{lat:number;lng:number};location_type:string};
   return {provider:'google',placeId:String(r.place_id||''),formattedAddress:String(r.formatted_address||''),...mapAddressComponents(r.address_components as never),point:roundPoint(g.location),precision:g.location_type};
  },
  async reverse(point){
   const j=await gfetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}&key=${key}`,{});
   if(j.status==='ZERO_RESULTS')return null;
   const r=(j.results as Array<Record<string,unknown>>)?.[0];if(!r)return null;
   const g=r.geometry as {location_type:string};
   return {provider:'google',placeId:String(r.place_id||''),formattedAddress:String(r.formatted_address||''),...mapAddressComponents(r.address_components as never),point:roundPoint(point),precision:g.location_type};
  },
 };
}

/** The server-side provider for the current configuration, or null (browser mode or no provider). */
export function serverProvider(env:Record<string,string|undefined>=process.env):LocationProvider|null{
 const c=locationConfig(env);
 if(c.provider==='fake')return fakeProvider;
 if(c.provider==='google'&&env.GOOGLE_MAPS_SERVER_KEY)return googleServerProvider(env.GOOGLE_MAPS_SERVER_KEY);
 return null;
}
