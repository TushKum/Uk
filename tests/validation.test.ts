import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commandSchema,loginSchema,telemetryQuery} from '../lib/validation';
const base={commandId:'command-12345',revision:1};
test('action schemas reject unknown actions and forged identity fields',()=>{assert.equal(commandSchema.safeParse({...base,action:'drop_database'}).success,false);assert.equal(commandSchema.safeParse({...base,action:'run_agent',incidentId:'INC-1042',role:'manager'}).success,false);});
test('approvals require a proposal ID and version',()=>{assert.equal(commandSchema.safeParse({...base,action:'approve',incidentId:'INC-1042'}).success,false);assert.equal(commandSchema.safeParse({...base,action:'approve',incidentId:'INC-1042',proposalId:'P-1',version:1}).success,true);});
test('completion requires all three distinct inspection checks',()=>{assert.equal(commandSchema.safeParse({...base,action:'complete',workOrderId:'WO-1',text:'done',checklist:['location','location','findings']}).success,false);});
test('login schemas never accept a role or unbounded password',()=>{assert.equal(loginSchema.safeParse({email:'ava@example.test',password:'pw',role:'manager'}).success,false);assert.equal(loginSchema.safeParse({email:'ava@example.test',password:'a'.repeat(300)}).success,false);});
test('telemetry ranges and limits are bounded',()=>{assert.equal(telemetryQuery.safeParse({buildingId:'north',from:20,to:10}).success,false);assert.equal(telemetryQuery.safeParse({buildingId:'north',limit:1000}).success,false);});
