import {api,fail} from '@/lib/platform/http';
import {locationConfig,serverProvider,ProviderUnavailable} from '@/lib/platform/location-provider';
import {validPoint} from '@/lib/v1/location';
export const dynamic='force-dynamic';
// Core location provider endpoints (no stored locations are read here — those are only returned
// by their owning record's API). config: what the picker may use (the browser key is a
// referrer-restricted public key; the server key never leaves the server). autocomplete, place and
// reverse run through the server provider when one is configured (fake in CI, Google server key).
export const GET=api({permission:'field-read',module:'core'},async({params})=>{
 const op=params.get('op')||'config';
 const c=locationConfig();
 if(op==='config')return {provider:c.provider,mode:c.mode,browserKey:c.browserKey,mapId:c.mapId,region:c.region};
 const p=serverProvider();
 if(!p)fail(404,'No server-side address provider is configured.');
 try{
  if(op==='autocomplete'){const q=String(params.get('q')||'').slice(0,200);return {suggestions:q.trim().length<3?[]:await p!.autocomplete(q,params.get('session'),c.region)};}
  if(op==='place'){const place=await p!.place(String(params.get('id')||''),params.get('session'));if(!place)fail(404,'Address not found.');return {place};}
  if(op==='reverse'){const point={lat:Number(params.get('lat')),lng:Number(params.get('lng'))};if(!validPoint(point))fail(400,'Invalid coordinates.');return {place:await p!.reverse(point)};}
  if(op==='geocode'){return {place:await p!.geocode(String(params.get('q')||'').slice(0,300),c.region)};}
 }catch(e){if(e instanceof ProviderUnavailable)fail(503,e.message);throw e;}
 fail(400,'Unknown location operation.');
});
