import { randomUUID } from 'node:crypto';
import { seed } from './seed';
import type { State, Incident, Actor, Command, Proposal, Verification, Stage } from './types';
export const id=(prefix:string)=>`${prefix}-${randomUUID().slice(0,8)}`;
export const tools = ['get_meter_readings','get_usage_schedule','get_resident_reports','get_maintenance_history','get_technician_availability','request_inspection','create_work_order','propose_reassignment','evaluate_post_repair_readings'] as const;
export type Tool = typeof tools[number];
export function assert(ok:unknown,message:string):asserts ok {if(!ok) throw new Error(message);}
export const incidentOf=(s:State,id?:string)=>{const i=s.incidents.find(i=>i.id===id);assert(i,'Incident not found');return i;};
export const workOf=(s:State,i:Incident)=>s.workOrders.find(w=>w.incidentId===i.id&&w.status!=='Verified');
const allowed:Record<Stage,Stage[]>={Detected:['Investigating'],Investigating:['Awaiting evidence/approval','Ready for closure'], 'Awaiting evidence/approval':['Investigating','Assigned','Ready for closure'],Assigned:['In progress','Awaiting evidence/approval','Investigating'],'In progress':['Awaiting verification','Investigating'],'Awaiting verification':['Ready for closure','Investigating'],'Ready for closure':['Closed','Investigating','Awaiting verification'],Closed:[]};
export function transition(i:Incident,to:Stage) {if(i.state===to)return;assert(allowed[i.state].includes(to),`Invalid transition ${i.state} → ${to}`);i.state=to;}
export function audit(s:State,actor:string,text:string) {s.audit.push({id:id('AUD'),at:s.now,actor,text});}
export function invalidate(i:Incident){i.evidenceVersion++; if(i.proposal?.status==='pending'||i.proposal?.status==='approved')i.proposal.status='superseded';}
export function readings(s:State,i:Incident){return s.readings.filter(r=>r.buildingId===i.buildingId&&r.at>=s.now-3*3600000&&r.at<=s.now);}
export function current(s:State,i:Incident){const rows=readings(s,i);const valid=rows.filter(r=>r.quality==='valid'&&r.value!==null);const latest=valid.at(-1);return {rows,valid,fresh:!!latest&&s.now-latest.at<=20*60000,latest};}
function collect(s:State,i:Incident,kind:string){const rows=s.evidence.filter(e=>e.buildingId===i.buildingId&&e.kind===kind);for(const e of rows)if(!i.evidenceIds.includes(e.id))i.evidenceIds.push(e.id);return rows;}
function proposal(s:State,i:Incident,kind:Proposal['kind'],summary:string,techId?:string){
 if(i.proposal?.status==='pending'&&i.proposal.kind===kind&&i.proposal.evidenceVersion===i.evidenceVersion)return i.proposal;
 const version=(i.proposal?.version??0)+1;
 i.proposal={id:id('PROP'),kind,version,evidenceVersion:i.evidenceVersion,status:'pending',summary,techId,citations:[...i.evidenceIds].slice(-8)};
 return i.proposal;
}
export function evaluate(s:State,i:Incident):Verification {
 const w=workOf(s,i);assert(w?.completedAt,'A technician completion report is required before verification');
 const b=s.buildings.find(b=>b.id===i.buildingId)!;const start=w.completedAt;const end=start+3600000;
 const rows=s.readings.filter(r=>r.buildingId===i.buildingId&&r.at>start&&r.at<=end&&r.at<=s.now);
 const valid=rows.filter(r=>r.quality==='valid'&&r.value!==null);
 const buckets=new Set(valid.map(r=>Math.ceil((r.at-start)/900000)));
 const coverage=Math.min(1,buckets.size/4);const mean=valid.length?valid.reduce((a,r)=>a+r.value!,0)/valid.length:null;
 const snapshot=current(s,i);const fresh=snapshot.fresh;
 const enough=s.now>=end&&coverage>=.8&&fresh;
 const improved=enough&&mean!==null&&mean>=b.low&&mean<=b.high&&valid.every(r=>r.value!>=b.low&&r.value!<=b.high)&&snapshot.latest!.value!>=b.low&&snapshot.latest!.value!<=b.high;
 return {outcome:!enough?'insufficient evidence':improved?'improvement observed':'anomaly persists',coverage,expected:4,samples:buckets.size,mean,low:b.low,high:b.high,start,end,evaluatedAt:s.now,citations:[...new Set([...valid.map(r=>r.id),...(snapshot.latest?[snapshot.latest.id]:[])])],reason:!enough?'Need a full 60-minute window, at least 80% valid 15-minute samples, and a reading no older than 20 minutes.':improved?'All valid post-report samples are within the expected range. Human closure is required.':'Post-report consumption remains outside the expected range. Completion is not proof of improvement.'};
}
export function nextTool(s:State,i:Incident):Tool|null {
 if(i.state==='Closed')return null;
 if(['Awaiting verification','Ready for closure'].includes(i.state)&&i.verification?.evaluatedAt===s.now&&i.verificationEvidenceVersion===i.evidenceVersion)return null;
 if(i.state==='Awaiting verification'||i.state==='Ready for closure'&&workOf(s,i)?.completedAt)return 'evaluate_post_repair_readings';
 if(i.state==='Assigned'||i.state==='In progress')return null;
 for(const name of tools.slice(0,5))if(!i.collected.includes(name))return name;
 if(i.proposal?.status==='approved'&&i.proposal.kind!=='close')return 'create_work_order';
 if(i.proposal?.status==='pending'||i.proposal?.status==='rejected'&&i.lastRejectedVersion===i.evidenceVersion)return null;
 if(i.hypothesis==='Scheduled usage')return null;
 if(workOf(s,i)?.status==='Assigned'&&s.technicians.find(t=>t.id===workOf(s,i)?.techId)?.available===false)return 'propose_reassignment';
 if(workOf(s,i)?.status==='Needs investigation'&&workOf(s,i)?.history.at(-1)?.text.includes('declined'))return 'propose_reassignment';
 if(i.inspectionRequested&&s.requests.some(r=>r.incidentId===i.id&&r.status==='open'))return null;
 return 'request_inspection';
}
export function executeTool(s:State,i:Incident,name:Tool):{result:unknown;summary:string;citations:string[]} {
 assert(tools.includes(name),'Tool not allowed');assert(i.state!=='Closed','Incident is already closed');
 if(s.toolFailure===name){s.toolFailure=undefined;throw new Error('Simulated temporary tool failure; retry is safe.');}
 if(i.state==='Detected')transition(i,'Investigating');
 const citations:string[]=[];let result:unknown;let summary='';
 if(name==='get_meter_readings'){
  const c=current(s,i);citations.push(...c.rows.slice(-6).map(r=>r.id));
  result={...c,rows:c.rows.slice(-12)};summary=c.fresh?'Fresh meter readings retrieved; elevated flow is an observation, not a confirmed leak.':'Telemetry is missing, faulty, or stale. No consumption value has been imputed.';
  if(!c.fresh)i.hypothesis='Insufficient information';
 } else if(name==='get_usage_schedule'){
  result=collect(s,i,'Schedule');citations.push(...(result as {id:string}[]).map(e=>e.id));summary='Usage schedule checked against the anomaly window.';
 } else if(name==='get_resident_reports'){
  result=collect(s,i,'Resident report');citations.push(...(result as {id:string}[]).map(e=>e.id));summary='Related reports linked to this incident; reports are untrusted observations.';
 } else if(name==='get_maintenance_history'){
  result=collect(s,i,'Maintenance');citations.push(...(result as {id:string}[]).map(e=>e.id));summary='Maintenance history checked; a prior inspection does not guarantee current meter accuracy.';
 } else if(name==='get_technician_availability'){
  result=s.technicians.map(t=>({...t,busy:s.workOrders.some(w=>w.techId===t.id&&['Assigned','In progress'].includes(w.status))}));summary='Availability and assignment conflicts checked.';
 } else if(name==='request_inspection'||name==='propose_reassignment'){
  assert(tools.slice(0,4).every(t=>i.collected.includes(t)),'Investigate meter, schedule, complaints and maintenance first');
  const c=current(s,i);const schedule=s.evidence.find(e=>e.id==='SCH-001');const manual=s.evidence.find(e=>e.buildingId===i.buildingId&&e.kind==='Manual reading');
  const disproved=s.evidence.some(e=>e.buildingId===i.buildingId&&e.disproves&&(!manual||manual.at<e.at));
  const explained=s.scenario==='B'&&c.fresh&&c.valid.slice(-4).every(r=>r.value!>=105&&r.value!<=145)&&s.now<=Date.parse('2026-11-08T10:00:00+05:30');
  if(explained){
   i.hypothesis='Scheduled usage';i.plan='Continue monitoring the cleaning window. Manager may close the explained alert.';i.questions=['Does flow return to its expected range after 10:00?'];
   proposal(s,i,'close','Scheduled cleaning explains the demand spike. Record the explanation and continue monitoring.');transition(i,'Ready for closure');result=i.proposal;summary=i.proposal!.summary;citations.push(schedule!.id,...c.valid.slice(-4).map(r=>r.id));
  } else if(!c.fresh||disproved||(!manual&&i.hypothesis==='Meter fault')){
   i.hypothesis=disproved?'Meter fault':'Insufficient information';i.plan='Obtain a manual reading and meter inspection before dispatching repair work.';i.questions=['What does a manual meter check show?'];
   if(!s.requests.some(r=>r.incidentId===i.id&&r.status==='open'))s.requests.push({id:id('REQ'),incidentId:i.id,text:'Manual reading and meter condition check requested. No leak diagnosis.',status:'open'});
   i.inspectionRequested=true;transition(i,'Awaiting evidence/approval');result=s.requests.filter(r=>r.incidentId===i.id);summary='Missing or contradictory evidence: manual inspection requested. No repair or closure authorized.';
  }else{
   const w=workOf(s,i);const candidates=s.technicians.filter(t=>t.available&&!s.workOrders.some(x=>x.techId===t.id&&['Assigned','In progress'].includes(x.status)&&x.id!==w?.id));
   const tech=candidates.find(t=>t.id!==w?.techId)||candidates[0];assert(tech,'No technician available. Request remains open; try availability again later.');
   i.hypothesis='Possible leak';i.plan='Approve a non-invasive inspection. A leak remains a hypothesis until inspected.';i.questions=['Does on-site evidence support a leak or meter fault?'];
   proposal(s,i,w?'reassign':'dispatch',w?`Assign follow-up inspection to ${tech.name}; prior work remains in history.`:`Request inspection at North Residence; propose ${tech.name}. No spending or water interruption is authorized.`,tech.id);
   i.inspectionRequested=true;if(i.state!=='Awaiting evidence/approval')transition(i,'Awaiting evidence/approval');result=i.proposal;summary=i.proposal!.summary;citations.push(...i.evidenceIds,...c.valid.slice(-3).map(r=>r.id));
  }
 }else if(name==='create_work_order'){
  const p=i.proposal;assert(p&&(p.kind==='dispatch'||p.kind==='reassign')&&p.status==='approved'&&p.evidenceVersion===i.evidenceVersion,'Current manager approval required');
  const existing=workOf(s,i);if(existing&&existing.status==='Assigned'&&existing.techId===p.techId)return {result:existing,summary:'Existing work order returned (idempotent).',citations:[existing.id]};
  const tech=s.technicians.find(t=>t.id===p.techId);assert(tech?.available,'Technician unavailable');assert(!s.workOrders.some(w=>w.techId===tech.id&&['Assigned','In progress'].includes(w.status)&&w.id!==existing?.id),'Conflicting technician assignment');
  if(existing){assert(existing.status==='Needs investigation','Cannot replace active assignment');existing.techId=tech.id;existing.status='Assigned';existing.completedAt=undefined;existing.report=undefined;existing.checklist=[];existing.history.push({at:s.now,text:`Reassigned to ${tech.name} after approved proposal ${p.id}`});result=existing;}
  else {const w={id:`WO-${1042+s.workOrders.length}`,incidentId:i.id,buildingId:i.buildingId,techId:tech.id,status:'Assigned' as const,createdAt:s.now,dueAt:s.now+2*3600000,observations:[],checklist:[],history:[{at:s.now,text:`Assigned to ${tech.name}; manager approval ${p.id}`} ]};s.workOrders.push(w);result=w;}
  transition(i,'Assigned');i.plan='Await technician acceptance and inspection evidence.';summary='Inspection work order assigned under manager approval. No external communication sent.';
 }else if(name==='evaluate_post_repair_readings'){
  const v=evaluate(s,i);i.verification=v;i.verificationEvidenceVersion=i.evidenceVersion;result=v;citations.push(...v.citations);summary=v.reason;
  if(v.outcome==='improvement observed') {transition(i,'Ready for closure');proposal(s,i,'close','Fresh post-report readings are within range. Confirm human closure; improvement does not prove a particular cause.');i.plan='Manager reviews readings and confirms closure.';}
  else if(v.outcome==='anomaly persists') {invalidate(i);transition(i,'Investigating');const w=workOf(s,i)!;w.status='Needs investigation';i.cycle++;i.collected=[];i.inspectionRequested=false;i.hypothesis='Unresolved anomaly';i.plan='Reported repair did not resolve the anomaly. Investigate again and request follow-up inspection.';i.questions=['Was the initial explanation correct?','Could another fixture or meter fault explain the flow?'];}
  else { if(i.state==='Ready for closure')transition(i,'Awaiting verification'); i.plan='Wait for a complete, fresh verification window; request manual evidence if telemetry is unavailable.'; if(!current(s,i).fresh&&!s.requests.some(r=>r.incidentId===i.id&&r.status==='open'))s.requests.push({id:id('REQ'),incidentId:i.id,text:'Telemetry cannot support verification. Obtain a manual reading and meter condition check; keep the incident open.',status:'open'}); }
 }
 if(!i.collected.includes(name))i.collected.push(name);
 for(const c of citations)if(!i.evidenceIds.includes(c))i.evidenceIds.push(c);
 if(i.proposal&&i.proposal.status==='pending')i.proposal.citations=[...new Set([...i.proposal.citations,...citations])].slice(-12);
 return {result,summary,citations};
}
export function advance(s:State,minutes:number){
 assert(Number.isInteger(minutes)&&minutes>0&&minutes<=240,'Advance must be 1–240 minutes');const end=s.now+minutes*60000;
 for(let at=Math.floor(s.now/900000)*900000+900000;at<=end;at+=900000)for(const b of s.buildings){
  const w=s.workOrders.find(w=>w.buildingId===b.id&&w.completedAt);const repaired=!!w&&s.scenario!=='D';
  const missing=s.scenario==='E'&&!s.evidence.some(e=>e.kind==='Manual reading');
  const value=b.id==='north'?repaired?28+Math.round(Math.sin(at/900000)*3):s.scenario==='B'&&at>Date.parse('2026-11-08T10:00:00+05:30')?29:126+Math.round(Math.sin(at/900000)*5):b.low+9+Math.round(Math.sin(at/900000)*3);
  s.readings.push({id:`RD-${b.id}-${at}`,buildingId:b.id,at,value:missing&&b.id==='north'?null:value,quality:missing&&b.id==='north'?'missing':'valid'});
 }
 s.now=end;for(const i of s.incidents){if(i.state==='Closed')continue;invalidate(i);if(i.state==='Ready for closure'&&!workOf(s,i)?.completedAt){transition(i,'Investigating');i.collected=[];i.inspectionRequested=false;i.hypothesis='Insufficient information';}}
}
export function command(s:State,c:Command,a:Actor):State {
 const manager=()=>assert(a.role==='manager','Manager role required');const operator=()=>assert(a.role==='operator','Demo operator role required');
 if(c.action==='reset'){operator();assert(c.scenario&&['A','B','C','D','E','F'].includes(c.scenario),'Unknown scenario');const fresh=seed(c.scenario);fresh.revision=s.revision+1;return fresh;}
 if(c.action==='advance'){operator();advance(s,c.minutes??15);audit(s,a.name,`Advanced simulated clock ${c.minutes??15} minutes`);return s;}
 if(c.action==='clock'){operator();s.running=c.event==='start';s.lastTick=Date.now();return s;}
 if(c.action==='inject'){
  operator();const i=incidentOf(s,c.incidentId??'INC-1042');
  if(c.event==='tool_failure')s.toolFailure='get_usage_schedule';
  else if(c.event==='duplicate_report'){s.evidence.push({id:id('RPT'),kind:'Resident report',buildingId:i.buildingId,at:s.now,text:'Related report: running-water noise at the same location. Linked to existing incident.'});invalidate(i);i.collected=i.collected.filter(t=>t!=='get_resident_reports');}
  else if(c.event==='manual_reading'){
   s.evidence.push({id:id('MAN'),kind:'Manual reading',buildingId:i.buildingId,at:s.now,text:'Simulated manual reading: 126 L/min; display agrees with reference reading.'});
   s.readings.push({id:id('RD-MAN'),buildingId:i.buildingId,at:s.now,value:126,quality:'valid'});s.requests.forEach(r=>{if(r.incidentId===i.id)r.status='received';});invalidate(i);i.collected=[];i.inspectionRequested=false;transition(i,'Investigating');
  } else if(c.event==='stale_telemetry'){s.readings=s.readings.filter(r=>r.buildingId!==i.buildingId||r.at<s.now-3600000);invalidate(i);}
  else throw new Error('Unknown simulation event');audit(s,a.name,`Injected simulation event: ${c.event}`);return s;
 }
 const i=incidentOf(s,c.incidentId??s.workOrders.find(w=>w.id===c.workOrderId)?.incidentId);
 if(c.action==='approve'||c.action==='reject'){
  manager();const p=i.proposal;assert(p&&p.id===c.proposalId&&p.version===c.version&&p.status==='pending','Proposal changed or already decided');assert(p.evidenceVersion===i.evidenceVersion,'Evidence changed; rerun agent before approval');
  if(c.action==='reject'){p.status='rejected';i.lastRejectedVersion=i.evidenceVersion;i.plan='Manager rejected the proposal. Add evidence or request a revised investigation.';audit(s,a.name,`Rejected ${p.id}: ${c.text||'No reason supplied'}`);}
  else {assert(p.kind!=='close','Use explicit human closure confirmation');p.status='approved';audit(s,a.name,`Approved ${p.id} version ${p.version}`);executeTool(s,i,'create_work_order');}return s;
 }
 if(c.action==='close'){
  manager();const p=i.proposal;assert(i.state==='Ready for closure'&&p?.kind==='close'&&p.status==='pending'&&p.id===c.proposalId&&p.version===c.version&&p.evidenceVersion===i.evidenceVersion,'Current closure proposal required');
  const w=workOf(s,i);if(w?.completedAt){const v=evaluate(s,i);assert(v.outcome==='improvement observed','Fresh readings do not support closure');i.verification=v;w.status='Verified';}
  else assert(i.hypothesis==='Scheduled usage'&&current(s,i).fresh,'Cannot close without fresh, corroborating evidence');
  p.status='approved';transition(i,'Closed');i.closedAt=s.now;i.conclusion=c.text||p.summary;i.plan='Closed by manager. Campus telemetry continues monitoring.';audit(s,a.name,`Human-confirmed closure of ${i.id}`);return s;
 }
 if(c.action==='request_evidence'){manager();assert(typeof c.text==='string'&&c.text.trim(),'Describe the evidence needed');s.requests.push({id:id('REQ'),incidentId:i.id,text:c.text.trim().slice(0,2000),status:'open'});invalidate(i);if(i.state==='Detected')transition(i,'Investigating');if(['Investigating','Ready for closure'].includes(i.state)){if(i.state==='Ready for closure')transition(i,'Investigating');transition(i,'Awaiting evidence/approval');}audit(s,a.name,'Requested additional evidence');return s;}
 const w=s.workOrders.find(w=>w.id===c.workOrderId);assert(w,'Work order not found');assert(a.role==='technician'&&a.id===w.techId,'Only the assigned technician can update this work order');
 if(c.action==='accept'){assert(w.status==='Assigned','Assignment already handled');w.status='In progress';transition(i,'In progress');w.history.push({at:s.now,text:`Accepted by ${a.name}`});}
 else if(c.action==='decline') {assert(w.status==='Assigned','Only pending assignments can be declined');assert(typeof c.text==='string'&&c.text.trim(),'A decline reason is required');w.status='Needs investigation';w.history.push({at:s.now,text:`Assignment declined by ${a.name}: ${c.text.slice(0,1000)}`});s.technicians.find(t=>t.id===a.id)!.available=false;invalidate(i);transition(i,'Awaiting evidence/approval');i.collected=i.collected.filter(t=>t!=='get_technician_availability');i.inspectionRequested=false;i.plan='Assignment declined. Check availability and propose reassignment.';}
 else if(c.action==='observe') {assert(w.status==='In progress','Accept the assignment first');assert(typeof c.text==='string'&&c.text.trim(),'Inspection notes are required');w.observations.push(c.text.slice(0,2000));const disproves=c.event==='meter_fault';s.evidence.push({id:id('OBS'),at:s.now,buildingId:i.buildingId,kind:'Inspection',text:c.text.slice(0,2000),disproves});invalidate(i);if(disproves){w.status='Needs investigation';transition(i,'Investigating');i.collected=[];i.inspectionRequested=false;i.hypothesis='Meter fault';i.plan='Inspection contradicts the leak hypothesis. Request a manual meter check.';}}
 else if(c.action==='complete'){assert(w.status==='In progress','Work must be in progress');assert(typeof c.text==='string'&&c.text.trim()&&w.observations.length>0,'Inspection observations and completion report are required');assert(['location','meter','findings'].every(x=>c.checklist?.includes(x)),'Complete the inspection checklist');w.report=c.text.slice(0,2000);w.completedAt=s.now;w.checklist=c.checklist!;w.status='Awaiting verification';w.history.push({at:s.now,text:`Completion reported by ${a.name}; awaiting independent telemetry verification`});invalidate(i);transition(i,'Awaiting verification');i.plan='Collect 60 minutes of fresh post-report readings. Do not close on the report alone.';}
 else throw new Error('Unknown command');audit(s,a.name,`${c.action} · ${w.id}`);return s;
}
