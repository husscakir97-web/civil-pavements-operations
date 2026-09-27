// Isomorphic Admin navigation: each item is shown only to roles holding one of its
// capabilities. The server still enforces every action; this keeps the menu honest.
import {can,type Capability} from '@/lib/platform/permissions';

export type NavItem={key:string;anyOf:Capability[];module?:string};
export const ADMIN_SUBS:NavItem[]=[
 {key:'Company',anyOf:['org.admin']},
 {key:'People',anyOf:['resources.edit']},
 {key:'Plant',anyOf:['resources.edit']},
 {key:'Rates',anyOf:['rates.edit','estimate.edit'],module:'estimating'},
 {key:'Company Library',anyOf:['library.edit']},
 {key:'Team & Permissions',anyOf:['team.admin']},
 {key:'Integrations',anyOf:['org.admin']},
 {key:'Settings',anyOf:['org.admin','entitlements.manage']},
];
export const navAllowed=(role:string,item:{anyOf?:Capability[]})=>!item.anyOf?.length||item.anyOf.some(c=>can(role,c));
/** Admin items a role may see (module entitlements are applied separately). Empty = no Admin area. */
export const adminSubsFor=(role:string)=>ADMIN_SUBS.filter(s=>navAllowed(role,s)).map(s=>s.key);
/** Roles that use the mobile field shell instead of the office shell. */
export const FIELD_SHELL_ROLES=['field','supervisor'];
