import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from '@/lib/authz';
export const actorContext = new AsyncLocalStorage<Actor>();
export function currentOrganisationId():string {const actor=actorContext.getStore();if(!actor)throw new Error('Authenticated organisation context required');return actor.organisationId;}
