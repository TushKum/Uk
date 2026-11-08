export type Role = 'manager' | 'technician' | 'operator';
export type Actor = { role: Role; id: string; name: string; campusId?:string };
export type Stage = 'Detected' | 'Investigating' | 'Awaiting evidence/approval' | 'Assigned' | 'In progress' | 'Awaiting verification' | 'Ready for closure' | 'Closed';
export type Scenario = 'A'|'B'|'C'|'D'|'E'|'F';
export type Reading = { id:string; buildingId:string; at:number; value:number|null; quality:'valid'|'faulty'|'missing' };
export type Building = { id:string; name:string; type:string; meter:string; low:number; high:number; location:string };
export type Evidence = { id:string; kind:string; text:string; at:number; buildingId:string; disproves?:boolean };
export type Proposal = { id:string; kind:'dispatch'|'reassign'|'close'; version:number; evidenceVersion:number; status:'pending'|'approved'|'rejected'|'superseded'; techId?:string; summary:string; citations:string[] };
export type Verification = { outcome:'improvement observed'|'anomaly persists'|'insufficient evidence'; coverage:number; expected:number; samples:number; mean:number|null; low:number; high:number; start:number; end:number; evaluatedAt:number; citations:string[]; reason:string };
export type Incident = { id:string; buildingId:string; title:string; state:Stage; detectedAt:number; evidenceVersion:number; collected:string[]; evidenceIds:string[]; plan:string; questions:string[]; hypothesis:string; proposal?:Proposal; verification?:Verification; verificationEvidenceVersion?:number; cycle:number; closedAt?:number; conclusion?:string; lastRejectedVersion?:number; inspectionRequested?:boolean; verificationRequested?:boolean };
export type WorkOrder = { id:string; incidentId:string; buildingId:string; techId:string; status:'Assigned'|'In progress'|'Awaiting verification'|'Verified'|'Needs investigation'; createdAt:number; dueAt:number; completedAt?:number; report?:string; observations:string[]; checklist:string[]; history:{at:number; text:string}[] };
export type Trace = { id:string; runId:string; incidentId:string; at:number; tool:string; status:'success'|'error'; result:string; summary:string; citations:string[]; elapsedMs:number };
export type AgentRun = { id:string; incidentId:string; mode:'demo'|'live'; startedAt:number; status:'queued'|'running'|'cancelled'|'completed'|'failed'|'bounded'; steps:number; latencyMs:number; modelMs:number; inputTokens:number; outputTokens:number; costUsd:number|null; error?:string };
export type State = { generation?:string; revision:number; now:number; scenario:Scenario; running:boolean; lastTick:number; buildings:Building[]; readings:Reading[]; evidence:Evidence[]; incidents:Incident[]; workOrders:WorkOrder[]; technicians:{id:string;name:string;initials:string;specialty:string;available:boolean}[]; traces:Trace[]; runs:AgentRun[]; requests:{id:string;incidentId:string;text:string;status:'open'|'received'}[]; audit:{id:string;at:number;actor:string;text:string}[]; toolFailure?:string; completedCommands:string[] };
export type Command = { action:string; incidentId?:string; workOrderId?:string; proposalId?:string; version?:number; techId?:string; text?:string; scenario?:Scenario; minutes?:number; event?:string; checklist?:string[]; commandId?:string; revision?:number };
export const SCENARIOS:Record<Scenario,{name:string;description:string}> = {
 A:{name:'Persistent overnight flow',description:'Investigate an overnight anomaly, inspect, repair, and verify improvement.'},
 B:{name:'Scheduled demand spike',description:'A scheduled cleaning operation explains increased consumption.'},
 C:{name:'Technician unavailable',description:'The first technician declines; propose a new assignment.'},
 D:{name:'Repair reported, anomaly persists',description:'A completed work order is contradicted by fresh readings.'},
 E:{name:'Missing or faulty telemetry',description:'Request a manual reading; do not assert a leak.'},
 F:{name:'Duplicate resident reports',description:'Link related complaints to one incident and one work order.'}
};
