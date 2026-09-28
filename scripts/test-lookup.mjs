// Lookup matcher used by plant/worker/register search and pickers.
import assert from 'node:assert/strict';
import {filterLookup,matchesLookup} from '../lib/v1/lookup.ts';
const plant=[{name:'Truck mounted attenuator',no:'TMA0010',rego:'B1C001',cat:'TMA'},{name:'TMA truck',no:'TMA001',rego:'A3D002',cat:'TMA',make:'Isuzu'},{name:'Roller',no:'RL01',rego:'XY9',cat:'Roller',make:'Hamm'}];
const f=p=>[p.name,p.no,p.rego,p.cat,p.make],ids=p=>[p.no,p.rego];
assert.equal(filterLookup(plant,'TMA001',f,ids,p=>p.name)[0].no,'TMA001','exact plant number ranks first');
assert.deepEqual(filterLookup(plant,'A3D002',f,ids).map(p=>p.no),['TMA001'],'registration');
assert.deepEqual(filterLookup(plant,'tma 001',f,ids,p=>p.name)[0].no,'TMA001','spacing ignored');
assert.equal(filterLookup(plant,'TMA',f,ids).length,2,'partial');
assert.deepEqual(filterLookup(plant,'hamm',f).map(p=>p.no),['RL01'],'make');
assert.ok(matchesLookup(['Public Liability Insurance','Insurance'],'public liability'),'multi-term');
assert.ok(!matchesLookup(['Workers compensation'],'public liability'));
console.log('PASS lookup: plant number, registration, partial, make, spacing, multi-term');
