import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {shiftWorkAreas,setShiftWorkAreas} from '@/lib/seams/shift-work-areas';
export const dynamic='force-dynamic';
// Shift -> shared project work areas (seam 'shift.workarea'). Reads need schedule.view (and project.view to see anything); writes need
// schedule.edit and both Operations and Projects writable. References ids only: geometry is read from the project's Work map.
export const GET=api({permission:'read',module:'operations',capability:'schedule.view'},async({params})=>shiftWorkAreas(String(params.get('shiftId')||'')));
export const POST=api({permission:'write',module:'operations',capability:'schedule.edit'},async({request})=>{const b=await body(request,z.object({shiftId:z.string().min(1).max(191),workAreaIds:z.array(z.string().min(1).max(191)).max(50)}).strict());return setShiftWorkAreas(b.shiftId,b.workAreaIds);});
