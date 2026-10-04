'use client';
// Site location and confirmed work point for the Work map. Reuses the existing address search / pin picker and the project's own
// location save (a project-owned override: the client site is never changed). Saved work areas never follow an address or pin
// change; if the location moves away from the confirmed work point the map says so and asks for a review.
import {useState} from 'react';
import {MapPin} from 'lucide-react';
import {api,useAction,Btn,Pill,Section} from './kit';
import {AddressLocationPicker,LocationSummary} from './location';
import {EMPTY_PARTS,validPoint,type LocationInput} from '@/lib/v1/location';
import type {WorkMapView} from '@/lib/v1/work-areas';

const TONE={none:'neutral',unconfirmed:'warning',confirmed:'success',moved:'danger'} as const;
const LABEL={none:'No location',unconfirmed:'Not confirmed',confirmed:'Work point confirmed',moved:'Moved: review'} as const;

export function WorkPointPanel({data,onChanged}:{data:WorkMapView;onChanged:()=>void}){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState<LocationInput|null>(null),[note,setNote]=useState('');
 const act=useAction(),wp=data.workPoint,hasAreas=data.areas.length>0;
 const drawn=Boolean(draft?.pin&&validPoint(draft.pin));
 const patch=(body:Record<string,unknown>,done:string)=>void act.run(()=>api('/api/projects/workspace',{method:'PATCH',body:{id:data.projectId,revision:data.projectRevision,...body}}),()=>{setEditing(false);setDraft(null);setNote(done);onChanged();});
 const confirm=()=>void act.run(()=>api('/api/projects/work-point',{method:'POST',body:{projectId:data.projectId}}),()=>{setNote('Work point confirmed.');onChanged();});
 return <Section title="Site location and work point" description="Search an address, check the pin, then confirm it as the work point. The map and the areas read from this saved location." actions={<Pill tone={TONE[wp.status]}>{LABEL[wp.status]}</Pill>}>
  <div className="grid gap-3" data-testid="work-point" data-status={wp.status}>
   {wp.current?<LocationSummary label={wp.source==='project'?'Project location (set for this project; the client site is unchanged)':wp.source==='site'?'Client site location':'Location'} location={{...EMPTY_PARTS,pin:wp.current,formattedAddress:wp.label}}/>:<p className="text-sm text-slate-600">No location is saved for this project yet. Search the site address or enter coordinates, then confirm the work point.</p>}
   {wp.status==='moved'&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="work-point-moved"><strong>The project location moved {wp.distanceM?.toLocaleString('en-AU')} m</strong> from the confirmed work point. Saved work areas have <strong>not</strong> moved: they stay where they were drawn. Review them against the new location, then confirm the new work point.</p>}
   {wp.status==='unconfirmed'&&hasAreas&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="work-point-unconfirmed">The work point has not been confirmed. Check the pin and confirm it so later address changes can be flagged.</p>}
   {wp.confirmed&&<p className="text-xs text-slate-500" data-testid="work-point-confirmed">Confirmed {wp.confirmed.confirmedAt.slice(0,10)}{wp.confirmed.confirmedBy?` by ${wp.confirmed.confirmedBy}`:''} at {wp.confirmed.point.lat.toFixed(6)}, {wp.confirmed.point.lng.toFixed(6)} ({wp.confirmed.source} location).</p>}
   {note&&<p role="status" className="text-xs text-emerald-800">{note}</p>}
   {act.error&&<p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800" data-testid="work-point-error">{act.error}</p>}
   {data.canEdit&&!editing&&<div className="flex flex-wrap gap-2">
    {wp.current&&wp.status!=='confirmed'&&<Btn onClick={confirm} busy={act.busy} data-testid="confirm-work-point"><MapPin aria-hidden className="size-4"/>Confirm this work point</Btn>}
    <Btn variant="secondary" onClick={()=>{setEditing(true);setNote('');act.setError('');}} data-testid="change-location">{wp.current?'Change project location':'Set project location'}</Btn>
    {wp.source==='project'&&<Btn variant="secondary" onClick={()=>patch({useSiteLocation:true},'Using the client site location again. Work areas did not move.')} busy={act.busy} data-testid="use-site-location">Use the client site location</Btn>}
   </div>}
   {data.canEdit&&editing&&<div className="grid gap-3 rounded-lg border p-3" data-testid="location-editor">
    <AddressLocationPicker label="Project work location" mode="compact" value={draft} onChange={setDraft} hint="Saved for this project only. The client site keeps its own location." initialQuery=""/>
    <div className="flex flex-wrap gap-2"><Btn onClick={()=>patch({location:draft},hasAreas?'Location saved. Work areas did not move: review them, then confirm the work point.':'Location saved. Confirm it as the work point.')} disabled={!drawn} busy={act.busy} data-testid="save-location">Save location</Btn><Btn variant="secondary" onClick={()=>{setEditing(false);setDraft(null);}} disabled={act.busy} data-testid="cancel-location">Cancel</Btn></div>
   </div>}
  </div>
 </Section>;
}
