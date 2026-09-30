// Division helpers for code that runs on the D1-compatible `database` wrapper (legacy estimate routes, the
// award seam), which the SQLite regression suites also exercise. MySQL services use business-units.ts.
// NULL business_unit_id means "the organisation's default division", so a missing default is never an error here.
import type {Database} from './database';
import {HttpError} from './http';

export async function defaultDivisionIdD1(db:Database,organisationId:string):Promise<string|null>{
 const r=await db.prepare('SELECT id FROM business_units WHERE organisation_id=? AND is_default=1').bind(organisationId).first<{id:string}>();
 return r?.id??null;
}
/** undefined = not supplied; null/'' = default; otherwise an ACTIVE division of this organisation (another tenant's id is "not found"). */
export async function resolveDivisionD1(db:Database,organisationId:string,input:unknown):Promise<string|null|undefined>{
 if(input===undefined)return undefined;
 if(input===null||input==='')return defaultDivisionIdD1(db,organisationId);
 const r=await db.prepare('SELECT id,status FROM business_units WHERE organisation_id=? AND id=?').bind(organisationId,String(input)).first<{id:string;status:string}>();
 if(!r)throw new HttpError(404,'Division not found.');
 if(r.status!=='active')throw new HttpError(422,'This division is archived. Choose an active division.');
 return r.id;
}
/** Keeping the record's own (possibly archived) division is allowed; moving into an archived one is not. */
export async function resolveDivisionChangeD1(db:Database,organisationId:string,input:unknown,current:string|null|undefined):Promise<string|null|undefined>{
 if(input!=null&&input!==''&&String(input)===String(current??''))return String(current);
 return resolveDivisionD1(db,organisationId,input);
}
