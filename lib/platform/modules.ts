// Isomorphic module catalogue for entitlements. One list; no scattered flags.
export const MODULES=['core','pipeline','estimating','projects','ims','operations','field','dockets','commercial','reports','ai'] as const;
export type ModuleKey=typeof MODULES[number];
export type EntitlementStatus='active'|'read_only'|'disabled';
export type Entitlements=Record<ModuleKey,EntitlementStatus>;

export const MODULE_LABELS:Record<ModuleKey,string>={
 core:'Core platform',pipeline:'Pipeline & tendering',estimating:'Estimating',projects:'Projects',
 ims:'IMS & HSEQ',operations:'Operations & scheduling',field:'Field',dockets:'Dockets',
 commercial:'Commercial',reports:'Reports',ai:'AI assistance',
};

// Beta signups receive a full-access trial. Paid plans replace this set via
// setEntitlement(...) — never by deleting data.
export const TRIAL_PLAN='beta-trial';
export const FULL_ACCESS:Entitlements=Object.fromEntries(MODULES.map(m=>[m,'active'])) as Entitlements;

export const usable=(e:Entitlements|undefined,m:ModuleKey)=>m==='core'||(e?e[m]!=='disabled':false);
export const writable=(e:Entitlements|undefined,m:ModuleKey)=>m==='core'||(e?e[m]==='active':false);
