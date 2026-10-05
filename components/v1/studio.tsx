'use client';
// Graphite Studio building blocks shared by the redesigned screens (docs/DESIGN-GRAPHITE-STUDIO.md). Presentation only: no data, no behaviour.
// Work areas are told apart by PATTERN + word (solid, dots, hatch), never by colour alone, so the map reads in greyscale and for colour-blind users.
import type {ReactNode} from 'react';
import type {WorkAreaDiscipline} from '@/lib/v1/work-areas';

export const DISCIPLINE_PATTERN:Record<WorkAreaDiscipline,{id:string;base:string;ink:string}>={
 asphalt:{id:'gs-solid',base:'#2d2f31',ink:'#2d2f31'},
 stabilisation:{id:'gs-dots',base:'#e6e2d7',ink:'#3d4043'},
 traffic_management:{id:'gs-hatch',base:'#f1eee6',ink:'#2d2f31'},
 other:{id:'gs-plain',base:'#d9d5ca',ink:'#55524b'},
};
/** SVG <defs> for the map canvas (user-space patterns, so they keep their scale while zooming). */
export function PatternDefs(){
 return <defs>
  <pattern id="gs-dots" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#e6e2d7"/><circle cx="2" cy="2" r="1.1" fill="#3d4043"/><circle cx="6" cy="6" r="1.1" fill="#3d4043"/></pattern>
  <pattern id="gs-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f1eee6"/><line x1="0" y1="0" x2="0" y2="8" stroke="#2d2f31" strokeWidth="1.6"/></pattern>
 </defs>;
}
export const fillFor=(d:WorkAreaDiscipline)=>d==='asphalt'?'#3a3c3f':d==='stabilisation'?'url(#gs-dots)':d==='traffic_management'?'url(#gs-hatch)':'#d9d5ca';
/** Small legend/list swatch with its own pattern definitions. */
export function DisciplineSwatch({discipline,className='size-4'}:{discipline:WorkAreaDiscipline;className?:string}){
 const f=discipline==='asphalt'?'#3a3c3f':discipline==='stabilisation'?'url(#gs-sw-dots)':discipline==='traffic_management'?'url(#gs-sw-hatch)':'#d9d5ca';
 return <svg aria-hidden viewBox="0 0 16 16" className={`${className} shrink-0`}><defs>
  <pattern id="gs-sw-dots" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#e6e2d7"/><circle cx="1.5" cy="1.5" r=".9" fill="#3d4043"/><circle cx="4" cy="4" r=".9" fill="#3d4043"/></pattern>
  <pattern id="gs-sw-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#f1eee6"/><line x1="0" y1="0" x2="0" y2="5" stroke="#2d2f31" strokeWidth="1.3"/></pattern>
 </defs><rect x=".5" y=".5" width="15" height="15" fill={f} stroke="#2d2f31" strokeWidth="1"/></svg>;
}
/** A hairline label/value row list (the reference's detail panel). */
export function DefRows({rows}:{rows:Array<[string,ReactNode]>}){
 return <dl className="gs-rows">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
/** Eyebrow + large title block used above a canvas or panel. */
export function Heading({eyebrow,title,className=''}:{eyebrow?:ReactNode;title:ReactNode;className?:string}){
 return <div className={className}>{eyebrow&&<p className="gs-eyebrow">{eyebrow}</p>}<h3 className="mt-1.5 text-[1.7rem] font-medium leading-[1.12] tracking-[-0.03em] text-[var(--gs-ink)] [overflow-wrap:anywhere]">{title}</h3></div>;
}
