'use client';
// One address + map component for every business location (client sites, projects, shift work
// points, depots, company addresses, incidents). Type an address → choose → the map appears →
// drag the pin to the exact work location. Google Maps loads only when this component needs it;
// without a provider the same component is a structured manual address with optional coordinates.
/* eslint-disable @typescript-eslint/no-explicit-any -- the Google Maps JS API is loaded at runtime without bundled types */
import {useEffect,useMemo,useRef,useState} from 'react';
import {Crosshair,MapPin,Navigation,RotateCcw} from 'lucide-react';
import {api,field,Field,useSession} from './kit';
import {Lookup,type LookupItem} from './lookup';
import {directionsUrl,pinState,precisionLabel,samePoint,validPoint,roundPoint,placeResultKind,EMPTY_PARTS,APPROXIMATE,type LatLng,type LocationInput,type LocationView,type ResolvedPlace,type Suggestion} from '@/lib/v1/location';

type Config={provider:'google'|'fake'|'none';mode:'browser'|'server'|'none';browserKey:string|null;mapId:string|null;region:string};
let configPromise:Promise<Config>|null=null;
const loadConfig=()=>configPromise??=api<Config>('/api/platform/locations?op=config').catch(()=>{configPromise=null;return {provider:'none',mode:'none',browserKey:null,mapId:null,region:'au'} as Config;});
export function useLocationConfig(){const [c,setC]=useState<Config|null>(null);useEffect(()=>{let live=true;void loadConfig().then(x=>{if(live)setC(x);});return()=>{live=false;};},[]);return c;}

// ---------------------------------------------------------------- Google Maps JS (lazy, once)
let googlePromise:Promise<any>|null=null;
function loadGoogle(key:string,region:string):Promise<any>{
 const w=window as any;
 if(w.google?.maps?.importLibrary)return Promise.resolve(w.google);
 return googlePromise??=new Promise((resolve,reject)=>{
  w.__infrastructMapsReady=()=>resolve(w.google);
  const s=document.createElement('script');
  s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&region=${region.toUpperCase()}&callback=__infrastructMapsReady`;
  s.async=true;s.onerror=()=>{googlePromise=null;reject(new Error('Maps could not be loaded.'));};
  document.head.appendChild(s);
 });
}

type Client={autocomplete(q:string):Promise<Suggestion[]>;place(id:string):Promise<ResolvedPlace|null>;reverse(p:LatLng):Promise<ResolvedPlace|null>;endSession():void};
const newToken=()=>typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():String(Math.random()).slice(2);
/** Server-mediated provider (fake in tests, Google with a server key): one session token per search. */
function serverClient():Client{
 let session=newToken();
 return {
  autocomplete:q=>api<{suggestions:Suggestion[]}>(`/api/platform/locations?op=autocomplete&q=${encodeURIComponent(q)}&session=${session}`).then(r=>r.suggestions),
  place:id=>api<{place:ResolvedPlace}>(`/api/platform/locations?op=place&id=${encodeURIComponent(id)}&session=${session}`).then(r=>{session=newToken();return r.place;}),
  reverse:p=>api<{place:ResolvedPlace|null}>(`/api/platform/locations?op=reverse&lat=${p.lat}&lng=${p.lng}`).then(r=>r.place),
  endSession:()=>{session=newToken();},
 };
}
/** Browser Google client: Places API (New) autocomplete data API with session tokens; only the fields we keep. */
function googleClient(g:any,region:string):Client{
 let places:any=null,geocoding:any=null,token:any=null;const predictions=new Map<string,any>();
 const lib=async()=>{places??=await g.maps.importLibrary('places');token??=new places.AutocompleteSessionToken();return places;};
 return {
  async autocomplete(q){const p=await lib();const {suggestions}=await p.AutocompleteSuggestion.fetchAutocompleteSuggestions({input:q,sessionToken:token,includedRegionCodes:[region]});predictions.clear();return (suggestions||[]).flatMap((s:any)=>s.placePrediction?[(predictions.set(s.placePrediction.placeId,s.placePrediction),{placeId:s.placePrediction.placeId,primary:s.placePrediction.mainText?.text||s.placePrediction.text?.text||'',secondary:s.placePrediction.secondaryText?.text||null})]:[]);},
  async place(id){
   const p=await lib();const pred=predictions.get(id);
   const place=pred?pred.toPlace():new p.Place({id});
   await place.fetchFields({fields:['formattedAddress','location','addressComponents','types']});
   token=null;// the selection ends the billing session; the next search starts a new one
   const {mapAddressComponents}=await import('@/lib/v1/location');
   const loc=place.location;const types:string[]=place.types||[];
   return {provider:'google',placeId:place.id,formattedAddress:place.formattedAddress||'',...mapAddressComponents(place.addressComponents),point:loc?roundPoint({lat:loc.lat(),lng:loc.lng()}):null,precision:placeResultKind(types)};
  },
  async reverse(pt){
   geocoding??=await g.maps.importLibrary('geocoding');
   const {results}=await new geocoding.Geocoder().geocode({location:pt});
   const r=results?.[0];if(!r)return null;
   const {mapAddressComponents}=await import('@/lib/v1/location');
   return {provider:'google',placeId:r.place_id,formattedAddress:r.formatted_address,...mapAddressComponents(r.address_components),point:roundPoint(pt),precision:r.geometry?.location_type||null};
  },
  endSession(){token=null;},
 };
}

function useProviderClient(c:Config|null){
 const [client,setClient]=useState<Client|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let live=true;
  if(!c||c.mode==='none')return;
  if(c.mode==='server'){Promise.resolve(serverClient()).then(x=>{if(live)setClient(x);});return()=>{live=false;};}
  loadGoogle(c.browserKey!,c.region).then(g=>{if(live)setClient(googleClient(g,c.region));}).catch(()=>{if(live)setFailed(true);});
  return()=>{live=false;};
 },[c]);
 return {client,failed};
}

// ---------------------------------------------------------------- map (Google only, lazily initialised)
function PinMap({config,pin,precision,onPin,readOnly,height}:{config:Config;pin:LatLng;precision:string|null;onPin:(p:LatLng)=>void;readOnly?:boolean;height:number}){
 const box=useRef<HTMLDivElement>(null),state=useRef<{map:any;marker:any}|null>(null),[error,setError]=useState('');
 const onPinRef=useRef(onPin);useEffect(()=>{onPinRef.current=onPin;},[onPin]);
 useEffect(()=>{
  let live=true;
  const el=box.current;if(!el)return;
  // Only build the map once it is actually visible.
  const io=new IntersectionObserver(async entries=>{
   if(!entries.some(e=>e.isIntersecting)||state.current)return;
   io.disconnect();
   try{
    const g=await loadGoogle(config.browserKey!,config.region);
    const [{Map},{AdvancedMarkerElement}]=await Promise.all([g.maps.importLibrary('maps'),g.maps.importLibrary('marker')]);
    if(!live)return;
    const map=new Map(el,{center:pin,zoom:precision&&APPROXIMATE.has(precision)?16:19,mapId:config.mapId,mapTypeId:'hybrid',gestureHandling:'cooperative',streetViewControl:false,fullscreenControl:true,mapTypeControl:true,clickableIcons:false});
    const marker=new AdvancedMarkerElement({map,position:pin,gmpDraggable:!readOnly,title:readOnly?'Exact work point':'Exact work point. Drag to move, or use the arrow keys after selecting it.'});
    if(!readOnly){
     marker.addListener('dragend',()=>{const p=marker.position;if(p)onPinRef.current(roundPoint({lat:typeof p.lat==='function'?p.lat():p.lat,lng:typeof p.lng==='function'?p.lng():p.lng}));});
     map.addListener('click',(e:any)=>{if(e.latLng){marker.position=e.latLng;onPinRef.current(roundPoint({lat:e.latLng.lat(),lng:e.latLng.lng()}));}});
    }
    state.current={map,marker};
   }catch{if(live)setError('The map could not be loaded. Coordinates and address can still be entered below.');}
  },{rootMargin:'100px'});
  io.observe(el);
  return()=>{live=false;io.disconnect();};
 },[config]);// eslint-disable-line react-hooks/exhaustive-deps
 // Follow external pin changes (new search, reset, typed coordinates).
 useEffect(()=>{const s=state.current;if(!s)return;const cur=s.marker.position;const curPt=cur?{lat:typeof cur.lat==='function'?cur.lat():cur.lat,lng:typeof cur.lng==='function'?cur.lng():cur.lng}:null;if(!samePoint(curPt,pin)){s.marker.position=pin;s.map.panTo(pin);}},[pin]);
 return error?<p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{error}</p>:<div ref={box} role="region" aria-label="Map of the exact work point" className="w-full overflow-hidden rounded-lg border bg-slate-100" style={{height}}/>;
}

// ---------------------------------------------------------------- picker
export type PickerMode='address'|'map'|'compact';
const fromView=(v:LocationView):LocationInput=>({label:v.label,formattedAddress:v.formattedAddress,addressLine1:v.addressLine1,addressLine2:v.addressLine2,locality:v.locality,state:v.state,postcode:v.postcode,country:v.country,provider:v.provider,placeId:v.placeId,precision:v.precision,geocoded:v.geocoded,pin:v.pin,pinAddress:v.pinAddress,source:(v.source as LocationInput['source'])||'manual'});
export const locationInputFrom=(v:LocationView|null|undefined)=>v?fromView(v):null;

/**
 * Address search + structured address + exact pin.
 *  mode "address": autocomplete and structured fields only (company addresses).
 *  mode "map":     adds the aerial map with a draggable pin (sites, projects, work points).
 *  mode "compact": like "map" but the map opens on request.
 * `legacyText` shows an old free-text address that has not been structured yet.
 */
export function AddressLocationPicker({label='Address',value,onChange,mode='map',readOnly,legacyText,hint}:{label?:string;value:LocationInput|null;onChange:(v:LocationInput|null)=>void;mode?:PickerMode;readOnly?:boolean;legacyText?:string|null;hint?:string}){
 const config=useLocationConfig(),session=useSession(),{client,failed}=useProviderClient(config);
 const [items,setItems]=useState<Suggestion[]>([]),[loading,setLoading]=useState(false),[query,setQuery]=useState(''),[notice,setNotice]=useState(''),[showMap,setShowMap]=useState(mode==='map'),[manual,setManual]=useState(false);
 const searching=Boolean(client)&&!failed;
 // Debounced search: one provider request per pause in typing, never per keystroke.
 useEffect(()=>{
  if(!client||query.trim().length<3)return;
  let live=true;
  const t=setTimeout(()=>{setLoading(true);client.autocomplete(query).then(r=>{if(live){setItems(r);setNotice('');}}).catch(()=>{if(live){setItems([]);setNotice('Address search is unavailable right now. Enter the address by hand below — nothing you typed is lost.');setManual(true);}}).finally(()=>{if(live)setLoading(false);});},300);
  return()=>{live=false;clearTimeout(t);};
 },[query,client]);
 const lookupItems=useMemo<LookupItem[]>(()=>query.trim().length<3?[]:items.map(s=>({id:s.placeId,label:s.primary,detail:s.secondary})),[items,query]);
 const choose=async(i:LookupItem|null)=>{
  if(!i||!client)return;
  try{
   const p=await client.place(i.id);
   if(!p){setNotice('That address could not be found. Enter it by hand below.');setManual(true);return;}
   onChange({...EMPTY_PARTS,label:value?.label??null,formattedAddress:p.formattedAddress,addressLine1:p.addressLine1,addressLine2:p.addressLine2,locality:p.locality,state:p.state,postcode:p.postcode,country:p.country,provider:p.provider,placeId:p.placeId,precision:p.precision,geocoded:p.point,pin:p.point,pinAddress:null,source:'autocomplete',geocodedAt:new Date().toISOString()});
   setNotice('');if(mode==='map')setShowMap(true);
  }catch{setNotice('Address details are unavailable right now. Enter the address by hand below.');setManual(true);}
 };
 /** Moving the pin: coordinates update at once; the address is looked up once, after the move ends. */
 const movePin=async(p:LatLng)=>{
  if(!value)return;
  const next:LocationInput={...value,pin:p,pinAddress:null,reverseGeocodedAt:null};
  onChange(next);
  if(!client||!value.geocoded||samePoint(value.geocoded,p))return;
  try{const r=await client.reverse(p);if(r?.formattedAddress){onChange({...next,pinAddress:r.formattedAddress,reverseGeocodedAt:new Date().toISOString()});setNotice('');}else setNotice('No street address at that point — the exact coordinates are kept.');}
  catch{setNotice('The address for that point could not be looked up. The exact coordinates are kept and can be saved.');}
 };
 const setPart=(k:'addressLine1'|'locality'|'state'|'postcode'|'formattedAddress',v:string)=>{
  // A hand-typed address is no longer the provider's place: drop the stale place id and points.
  const base:LocationInput=value||{...EMPTY_PARTS,source:'manual'};
  const changedPlace=base.source==='autocomplete';
  const next:LocationInput={...base,[k]:v||null,source:'manual',provider:null,placeId:null,geocoded:null,precision:null,pin:changedPlace?null:base.pin,pinAddress:null};
  if(k!=='formattedAddress')next.formattedAddress=null;
  onChange(next);
  if(changedPlace&&base.pin)setNotice('The address was changed by hand, so the map point was cleared. Search again or enter coordinates.');
 };
 const setCoord=(k:'lat'|'lng',v:string)=>{
  const n=Number(v),base:LocationInput=value||{...EMPTY_PARTS,source:'manual'};
  const pin={lat:k==='lat'?n:base.pin?.lat??NaN,lng:k==='lng'?n:base.pin?.lng??NaN};
  if(v===''){onChange({...base,pin:null,pinAddress:null});return;}
  const typed:LatLng={lat:pin.lat,lng:pin.lng};
  onChange({...base,pin:validPoint(typed)?roundPoint(typed):typed,pinAddress:null});
 };
 const state=value?pinState({geocoded:value.geocoded??null,pin:value.pin&&validPoint(value.pin)?value.pin:null}):'none';
 const canMap=config?.mode==='browser'&&!failed&&mode!=='address';
 const pinOk=value?.pin&&validPoint(value.pin)?value.pin:null;
 const admin=session.can('org.admin');
 if(readOnly)return <LocationSummary label={label} location={value} legacyText={legacyText}/>;
 return <div className="grid gap-2 text-sm">
  {searching?<Lookup label={label} items={lookupItems} value={null} loading={loading} onQueryChange={setQuery} onChange={i=>void choose(i)} placeholder="Start typing an address…" emptyText={query.trim().length<3?'Type at least 3 characters.':'No matching addresses. Enter it by hand below.'} hint={hint}/>
   :<span className="font-medium text-slate-700">{label}</span>}
  {config&&config.mode==='none'&&admin&&<p className="text-xs text-slate-500">Address search and maps are not configured for this organisation. Addresses can be entered by hand.</p>}
  {failed&&<p className="text-xs text-amber-800">Maps could not be loaded. Enter the address by hand; coordinates are optional.</p>}
  {notice&&<p role="status" className="text-xs text-amber-800">{notice}</p>}
  {legacyText&&!value&&<p className="text-xs text-slate-600">Recorded as “{legacyText}”. Search the address to place it on the map.</p>}
  {value&&(value.formattedAddress||value.addressLine1)&&!manual&&<div className="flex flex-wrap items-start gap-2 rounded-lg border bg-slate-50 p-2">
   <MapPin aria-hidden className="mt-0.5 size-4 text-slate-500"/>
   <span className="min-w-0 flex-1"><span className="block font-medium">{value.formattedAddress||value.addressLine1}</span>
    <span className="block text-xs text-slate-500">{[state==='adjusted'?'Exact work point adjusted':state==='address'?'Address point':state==='manual'?'Coordinates entered by hand':null,precisionLabel(value.precision)].filter(Boolean).join(' · ')}{value.pinAddress?` · Pin at: ${value.pinAddress}`:''}</span></span>
   <button type="button" className="text-xs font-medium text-sky-800 underline" onClick={()=>setManual(true)}>Edit by hand</button>
  </div>}
  {canMap&&pinOk&&mode==='compact'&&!showMap&&<button type="button" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-sky-800 underline" onClick={()=>setShowMap(true)}><Crosshair aria-hidden className="size-3.5"/>Set the exact work point on the map</button>}
  {canMap&&pinOk&&showMap&&<>
   <PinMap config={config!} pin={pinOk} precision={value?.precision??null} onPin={p=>void movePin(p)} height={typeof window!=='undefined'&&window.innerWidth<640?260:340}/>
   <p className="text-xs text-slate-500">Drag the pin (or tap the map) to the exact work location.</p>
  </>}
  {pinOk&&state==='adjusted'&&value?.geocoded&&<button type="button" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-sky-800 underline" onClick={()=>onChange({...value,pin:value.geocoded!,pinAddress:null,reverseGeocodedAt:null})}><RotateCcw aria-hidden className="size-3.5"/>Reset pin to address</button>}
  {(manual||!searching||!value)&&<details open={manual||!searching} className="rounded-lg border p-2" onToggle={e=>setManual((e.target as HTMLDetailsElement).open)}>
   <summary className="cursor-pointer text-xs font-medium text-slate-600">{searching?'Enter the address by hand':'Address details'}</summary>
   <div className="mt-2 grid gap-2 sm:grid-cols-2">
    <Field label="Street address"><input className={field} value={value?.addressLine1||''} onChange={e=>setPart('addressLine1',e.target.value)} autoComplete="street-address"/></Field>
    <Field label="Suburb / locality"><input className={field} value={value?.locality||''} onChange={e=>setPart('locality',e.target.value)}/></Field>
    <Field label="State"><input className={field} value={value?.state||''} onChange={e=>setPart('state',e.target.value)}/></Field>
    <Field label="Postcode"><input className={field} inputMode="numeric" value={value?.postcode||''} onChange={e=>setPart('postcode',e.target.value)}/></Field>
   </div>
  </details>}
  {mode!=='address'&&<details className="rounded-lg border p-2">
   <summary className="cursor-pointer text-xs font-medium text-slate-600">Exact coordinates {pinOk?`(${pinOk.lat.toFixed(6)}, ${pinOk.lng.toFixed(6)})`:'(optional)'}</summary>
   <div className="mt-2 grid grid-cols-2 gap-2">
    <Field label="Latitude"><input className={field} inputMode="decimal" value={value?.pin?.lat??''} onChange={e=>setCoord('lat',e.target.value)} placeholder="-33.8688"/></Field>
    <Field label="Longitude"><input className={field} inputMode="decimal" value={value?.pin?.lng??''} onChange={e=>setCoord('lng',e.target.value)} placeholder="151.2093"/></Field>
   </div>
   <p className="mt-1 text-xs text-slate-500">A moved pin is the exact point you chose; it does not make the underlying map or survey more accurate.</p>
  </details>}
 </div>;
}

/** Read-only location: address, pin status, coordinates and a Directions link (no CRM access needed). */
export function LocationSummary({label,location,legacyText,compact}:{label?:string;location:LocationInput|LocationView|null;legacyText?:string|null;compact?:boolean}){
 const pin=location?.pin&&validPoint(location.pin)?location.pin:null;
 const text=location?.formattedAddress||location?.addressLine1||legacyText||null;
 const link=directionsUrl(location?{pin,geocoded:location.geocoded??null,formattedAddress:text}:legacyText?{formattedAddress:legacyText}:null);
 const state=location?pinState({geocoded:location.geocoded??null,pin}):'none';
 if(!text&&!pin)return compact?null:<p className="text-sm text-slate-500">{label?`${label}: `:''}No location recorded.</p>;
 return <div className={`flex flex-wrap items-start gap-2 ${compact?'text-xs':'text-sm'}`}>
  <MapPin aria-hidden className={`${compact?'size-3.5':'size-4'} mt-0.5 shrink-0 text-slate-500`}/>
  <span className="min-w-0 flex-1">{label&&!compact&&<span className="block text-xs text-slate-500">{label}</span>}<span className="block">{text||'Exact point only'}</span>
   {pin&&<span className="block text-xs text-slate-500">{state==='adjusted'?'Exact work point adjusted':state==='address'?'Address point':'Exact point'} · {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</span>}</span>
  {link&&<a className="inline-flex min-h-9 items-center gap-1 rounded-lg border bg-white px-2.5 text-xs font-medium text-sky-800 hover:bg-sky-50" href={link} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden className="size-3.5"/>Directions</a>}
 </div>;
}
