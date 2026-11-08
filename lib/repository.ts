import type {Client} from './pool';
import {randomUUID} from 'node:crypto';
import type {State} from './types';
export const CAMPUS='evergreen';
type Row=Record<string,unknown>;
async function put(db:Client,table:string,rows:Row[],immutable=false){
 if(!rows.length)return;const fields=Object.keys(rows[0]);if(!/^ll_[a-z_]+$/.test(table)||fields.some(f=>!/^[_a-z]+$/.test(f)))throw new Error('Invalid repository mapping');
 const cols=fields.join(',');const updates=fields.filter(f=>!['campus_id','generation','id'].includes(f)).map(f=>`${f}=EXCLUDED.${f}`).join(',');
 await db.query(`INSERT INTO ${table}(${cols}) SELECT ${fields.map(f=>`r.${f}`).join(',')} FROM jsonb_populate_recordset(NULL::${table},$1::jsonb) r ON CONFLICT(campus_id,generation,id) ${immutable?'DO NOTHING':`DO UPDATE SET ${updates} WHERE ${table}.payload IS DISTINCT FROM EXCLUDED.payload OR ${table}.ordinal IS DISTINCT FROM EXCLUDED.ordinal`}`,[JSON.stringify(rows)]);
}
export async function storeState(db:Client,s:State){
 const generation=s.generation??randomUUID();s.generation=generation;await db.query('INSERT INTO ll_campuses(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',[CAMPUS,'Evergreen Campus']);
 const base=(item:{id:string},ordinal:number)=>({campus_id:CAMPUS,generation,id:item.id,ordinal,payload:item});
 await put(db,'ll_buildings',s.buildings.map((b,n)=>({...base(b,n),name:b.name,meter:b.meter,expected_low:b.low,expected_high:b.high})));
 await put(db,'ll_technicians',s.technicians.map((t,n)=>({...base(t,n),name:t.name,available:t.available})));
 await put(db,'ll_readings',s.readings.map((r,n)=>({...base(r,n),building_id:r.buildingId,observed_at:r.at,value:r.value,quality:r.quality})));
 await db.query('DELETE FROM ll_readings WHERE campus_id=$1 AND generation=$2 AND NOT(id=ANY($3::text[]))',[CAMPUS,generation,s.readings.map(r=>r.id)]);
 await put(db,'ll_evidence',s.evidence.map((e,n)=>({...base(e,n),building_id:e.buildingId,kind:e.kind,observed_at:e.at,body:e.text})));
 await put(db,'ll_incidents',s.incidents.map((i,n)=>{const {proposal,verification,...payload}=i;return {...base(i,n),payload,building_id:i.buildingId,state:i.state,evidence_version:i.evidenceVersion,detected_at:i.detectedAt,proposal_id:proposal?.id??null,verification_id:verification?`${i.id}:${verification.evaluatedAt}:${i.verificationEvidenceVersion??i.evidenceVersion}`:null};}));
 await db.query("UPDATE ll_proposals SET status='superseded',payload=jsonb_set(payload,'{status}','\"superseded\"') WHERE campus_id=$1 AND generation=$2 AND status='pending' AND NOT(id=ANY($3::text[]))",[CAMPUS,generation,s.incidents.flatMap(i=>i.proposal?[i.proposal.id]:[])]);
 await put(db,'ll_proposals',s.incidents.flatMap((i,n)=>i.proposal?[{...base(i.proposal,n),incident_id:i.id,version:i.proposal.version,evidence_version:i.proposal.evidenceVersion,kind:i.proposal.kind,status:i.proposal.status,technician_id:i.proposal.techId??null}]:[]));
 await put(db,'ll_verifications',s.incidents.flatMap((i,n)=>i.verification?[{...base({id:`${i.id}:${i.verification.evaluatedAt}:${i.verificationEvidenceVersion??i.evidenceVersion}`},n),payload:i.verification,incident_id:i.id,outcome:i.verification.outcome,coverage:i.verification.coverage,mean:i.verification.mean,evaluated_at:i.verification.evaluatedAt}]:[]));
 await put(db,'ll_work_orders',s.workOrders.map((w,n)=>{const {history,...payload}=w;return {...base(w,n),payload,incident_id:w.incidentId,building_id:w.buildingId,technician_id:w.techId,status:w.status,due_at:w.dueAt};}));
 await put(db,'ll_work_order_events',s.workOrders.flatMap(w=>w.history.map((h,n)=>({...base({id:`${w.id}:${n}`},n),payload:h,work_order_id:w.id,simulated_at:h.at,body:h.text}))),true);
 await put(db,'ll_evidence_requests',s.requests.map((r,n)=>({...base(r,n),incident_id:r.incidentId,status:r.status})));
 await put(db,'ll_agent_runs',s.runs.map((r,n)=>({...base(r,n),incident_id:r.incidentId,mode:r.mode,status:r.status,steps:r.steps})));
 await put(db,'ll_tool_executions',s.traces.map((t,n)=>({...base(t,n),run_id:t.runId,incident_id:t.incidentId,tool:t.tool,status:t.status,elapsed_ms:t.elapsedMs})));
 await put(db,'ll_audit_events',s.audit.map((a,n)=>({...base(a,n),actor:a.actor,simulated_at:a.at,body:a.text})),true);
 await db.query(`INSERT INTO ll_runtime(campus_id,generation,revision,simulated_at,scenario,running,last_tick,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(campus_id) DO UPDATE SET generation=EXCLUDED.generation,revision=EXCLUDED.revision,simulated_at=EXCLUDED.simulated_at,scenario=EXCLUDED.scenario,running=EXCLUDED.running,last_tick=EXCLUDED.last_tick,metadata=EXCLUDED.metadata`,[CAMPUS,generation,s.revision,s.now,s.scenario,s.running,s.lastTick,{toolFailure:s.toolFailure}]);
}
export async function loadState(db:Client,lock=false):Promise<State>{
 const {rows:[m]}=await db.query(`SELECT * FROM ll_runtime WHERE campus_id=$1 ${lock?'FOR UPDATE':''}`,[CAMPUS]);if(!m)throw new Error('Database is not seeded. Run migrations and db:seed.');
 const names=['buildings','readings','technicians','incidents','evidence','proposals','verifications','work_orders','work_order_events','evidence_requests','agent_runs','tool_executions','audit_events'] as const;
 const data:Record<string,Record<string,any>[]>={};for(const name of names)data[name]=(await db.query(`SELECT * FROM ll_${name} WHERE campus_id=$1 AND generation=$2 ORDER BY ordinal`,[CAMPUS,m.generation])).rows;
 return {generation:m.generation,revision:m.revision,now:Number(m.simulated_at),scenario:m.scenario,running:m.running,lastTick:Number(m.last_tick),toolFailure:m.metadata.toolFailure,completedCommands:[],
 buildings:data.buildings.map(r=>({...r.payload,id:r.id,name:r.name,meter:r.meter,low:r.expected_low,high:r.expected_high})),
 readings:data.readings.map(r=>({...r.payload,id:r.id,buildingId:r.building_id,at:Number(r.observed_at),value:r.value,quality:r.quality})),
 technicians:data.technicians.map(r=>({...r.payload,id:r.id,name:r.name,available:r.available})),
 evidence:data.evidence.map(r=>({...r.payload,id:r.id,buildingId:r.building_id,kind:r.kind,at:Number(r.observed_at),text:r.body})),
 incidents:data.incidents.map(r=>{const p=data.proposals.find(p=>p.id===r.proposal_id);const v=data.verifications.find(v=>v.id===r.verification_id);return {...r.payload,id:r.id,buildingId:r.building_id,state:r.state,evidenceVersion:r.evidence_version,detectedAt:Number(r.detected_at),...(p?{proposal:{...p.payload,status:p.status,version:p.version,evidenceVersion:p.evidence_version}}:{}),...(v?{verification:{...v.payload,outcome:v.outcome,coverage:v.coverage,mean:v.mean}}:{})};}),
 workOrders:data.work_orders.map(r=>({...r.payload,id:r.id,incidentId:r.incident_id,buildingId:r.building_id,techId:r.technician_id,status:r.status,dueAt:Number(r.due_at),history:data.work_order_events.filter(e=>e.work_order_id===r.id).map(e=>e.payload)})),
 requests:data.evidence_requests.map(r=>({...r.payload,status:r.status})),runs:data.agent_runs.map(r=>({...r.payload,status:r.status,steps:r.steps})),traces:data.tool_executions.map(r=>r.payload),audit:data.audit_events.map(r=>r.payload)};
}
