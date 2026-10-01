// Durable monolith event journal. The caller MUST include the returned statement
// in the source mutation's batch. No network side effects or automatic replay.
import {database} from './database';
import {actorContext} from './context';
import {can,type Capability} from './permissions';
import {requireModule} from './entitlements';
import type {ModuleKey} from './modules';

export const DOMAIN_EVENTS={
 'workshop.defect.created':{module:'workshop',publish:'workshop.edit',read:'workshop.view',entity:'work_order'},
 // A defect reported through the form → Workshop seam by someone holding workshop.defect.report (e.g. a plant operator).
 'workshop.defect.reported':{module:'workshop',publish:'workshop.defect.report',read:'workshop.view',entity:'work_order'},
 'workshop.repair.recorded':{module:'workshop',publish:'workshop.edit',read:'workshop.view',entity:'work_order'},
 // Service plan changes: a completed service, the initial plan, or an administrator correction (distinct events, never conflated).
 'workshop.service.recorded':{module:'workshop',publish:'workshop.edit',read:'workshop.view',entity:'asset'},
 'workshop.plan.set':{module:'workshop',publish:'workshop.edit',read:'workshop.view',entity:'asset'},
 'workshop.plan.corrected':{module:'workshop',publish:'workshop.plan.correct',read:'workshop.view',entity:'asset'},
 'workshop.verified':{module:'workshop',publish:'workshop.verify',read:'workshop.view',entity:'work_order'},
 'project.awarded':{module:'projects',publish:'tender.award',read:'project.view',entity:'project'},
 'docket.approved':{module:'dockets',publish:'docket.approve',read:'docket.approve',entity:'docket'},
} as const satisfies Record<string,{module:ModuleKey;publish:Capability;read:Capability;entity:string}>;
export type DomainEventType=keyof typeof DOMAIN_EVENTS;
export async function domainEventStatement(type:DomainEventType,entityId:string,occurrenceId:string){
 const actor=actorContext.getStore();
 if(!actor)throw Object.assign(new Error('Sign in required.'),{status:401});
 const contract=DOMAIN_EVENTS[type];
 if(!contract||!can(actor.role,contract.publish))throw Object.assign(new Error('You are not authorised for this action.'),{status:403});
 await requireModule(contract.module,true);
 if(!entityId||entityId.length>191||!occurrenceId||occurrenceId.length>191)throw new Error('Invalid event identity');
 // A unique occurrence is supplied by the source operation, not untrusted input.
 return database.prepare('INSERT INTO domain_events (id,organisation_id,event_type,event_version,module,entity_type,entity_id,occurrence_id,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id')
  .bind(crypto.randomUUID(),actor.organisationId,type,1,contract.module,contract.entity,entityId,occurrenceId,actor.userId,new Date().toISOString());
}
