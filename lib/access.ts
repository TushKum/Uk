import type {Actor,State} from './types';
// Campus telemetry is readable by campus staff; operational evidence follows work ownership.
export function scopeState(s:State,actor:Actor):State{
 if(actor.role!=='technician')return s;
 const workOrders=s.workOrders.filter(w=>w.techId===actor.id),ids=new Set(workOrders.map(w=>w.incidentId)),buildings=new Set(workOrders.map(w=>w.buildingId));
 return {...s,workOrders,incidents:s.incidents.filter(i=>ids.has(i.id)),evidence:s.evidence.filter(e=>buildings.has(e.buildingId)),requests:s.requests.filter(r=>ids.has(r.incidentId)),runs:s.runs.filter(r=>ids.has(r.incidentId)),traces:s.traces.filter(t=>ids.has(t.incidentId)),audit:[]};
}
