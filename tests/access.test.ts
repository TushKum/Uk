import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../lib/seed';
import {scopeState} from '../lib/access';
test('an unassigned technician cannot read incident evidence or manager audit records',()=>{const s=seed();const view=scopeState(s,{id:'tech-maya',name:'Maya',role:'technician'});assert.equal(view.incidents.length,0);assert.equal(view.evidence.length,0);assert.equal(view.audit.length,0);assert.equal(view.readings.length,s.readings.length);});
test('technicians receive evidence only for their assignments',()=>{const s=seed();s.workOrders.push({id:'WO-TEST',incidentId:'INC-1042',buildingId:'north',techId:'tech-ravi',status:'Assigned',createdAt:s.now,dueAt:s.now+3600000,history:[],observations:[],checklist:[]});const view=scopeState(s,{id:'tech-ravi',name:'Ravi',role:'technician'});assert.equal(view.incidents.length,1);assert.equal(view.workOrders.length,1);assert.equal(view.evidence.length,3);assert.equal(scopeState(s,{id:'tech-maya',name:'Maya',role:'technician'}).workOrders.length,0);});
