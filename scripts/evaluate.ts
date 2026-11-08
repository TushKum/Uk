import {readFileSync,writeFileSync} from 'node:fs';
import {seed} from '../lib/seed';
import {command,advance} from '../lib/engine';
import {runAgent} from '../lib/agent';
import {DemoProvider} from '../lib/provider';
import type {Actor,Scenario,State} from '../lib/types';
const manager:Actor={role:'manager',id:'manager-ava',name:'Ava Morgan'},operator:Actor={role:'operator',id:'operator-demo',name:'Demo operator'};
const fixtures=JSON.parse(readFileSync(new URL('../evaluation/fixtures.json',import.meta.url),'utf8')) as {id:string;scenario:Scenario;split:string;flow:number|null;reviewMinutes:number;labelAnomaly:boolean;variant?:string;duplicates?:number}[];
type Metrics={alert:boolean;false_alarm:boolean;missed_anomaly:boolean;actionable_work_order_sim_minutes:number|null;correct_reassignment:boolean|null;incorrect_closure:boolean;successful_completion:boolean;execution_ms:number;tool_calls:number;model_latency_ms:number;cost_usd:number};
const rows:{id:string;scenario:Scenario;split:string;label_anomaly:boolean;agent:Metrics & {final_state:string;sim_elapsed_minutes:number};baseline:Metrics}[]=[];
for(const f of fixtures){
 const s=seed(f.scenario),i=s.incidents[0],started=s.now,execution=performance.now();
 for(const r of s.readings.filter(r=>r.buildingId==='north'&&r.at>=s.now-6*3600000)){r.value=f.flow;r.quality=f.flow===null?(f.variant==='faulty'?'faulty':'missing'):'valid';}
 if(f.variant==='stale')s.readings=s.readings.filter(r=>r.buildingId!=='north'||r.at<s.now-4*3600000);
 for(let n=2;n<(f.duplicates??2);n++)s.evidence.push({id:`DUP-${n}`,kind:'Resident report',at:s.now,buildingId:'north',text:'Related report at the same washroom and time window.'});
 // Baseline and agent see identical initial observations. Baseline has no context/verification logic.
 const baselineStart=performance.now();
 const baselineAlert=s.readings.some(r=>r.buildingId==='north'&&r.at>=s.now-3*3600000&&r.quality==='valid'&&r.value!==null&&r.value>38);
 const baselineClosed=baselineAlert&&f.scenario!=='C';
 const baseline={alert:baselineAlert,false_alarm:baselineAlert&&!f.labelAnomaly,missed_anomaly:!baselineAlert&&f.labelAnomaly,actionable_work_order_sim_minutes:baselineAlert?0:null,correct_reassignment:f.scenario==='C'?false:null,incorrect_closure:baselineClosed&&f.scenario==='D',successful_completion:baselineAlert&&['A','F'].includes(f.scenario),execution_ms:performance.now()-baselineStart,tool_calls:0,model_latency_ms:0,cost_usd:0};
 i.detectedAt=started;const run=()=>runAgent(s,i,new DemoProvider());await run();
 const agentAlert=i.proposal?.kind==='dispatch';let actionable:number|null=null;let reassigned:boolean|null=null;
 if(i.proposal?.kind==='dispatch'){
  advance(s,f.reviewMinutes);await run();let p=i.proposal!;command(s,{action:'approve',incidentId:i.id,proposalId:p.id,version:p.version},manager);actionable=(s.now-started)/60000;
  if(f.scenario==='C'){const w=s.workOrders[0];command(s,{action:'decline',workOrderId:w.id,text:'Unavailable for shift'}, {role:'technician',id:w.techId,name:'Ravi Shah'});await run();p=i.proposal!;command(s,{action:'approve',incidentId:i.id,proposalId:p.id,version:p.version},manager);reassigned=s.workOrders[0].techId==='tech-maya';}
  const w=s.workOrders[0],tech:Actor={role:'technician',id:w.techId,name:w.techId==='tech-maya'?'Maya Iyer':'Ravi Shah'};
  command(s,{action:'accept',workOrderId:w.id},tech);command(s,{action:'observe',workOrderId:w.id,text:'Simulated on-site observation recorded.'},tech);command(s,{action:'complete',workOrderId:w.id,text:'Work reported complete.',checklist:['location','meter','findings']},tech);advance(s,60);await run();
 }
 if(i.state==='Ready for closure'){const p=i.proposal!;command(s,{action:'close',incidentId:i.id,proposalId:p.id,version:p.version},manager);}
 const success=f.scenario==='E'?s.requests.some(r=>r.status==='open')&&s.workOrders.length===0:f.scenario==='D'?i.state!=='Closed'&&i.verification?.outcome==='anomaly persists':i.state==='Closed'&&(f.scenario!=='C'||reassigned===true)&&s.workOrders.length<=1;
 rows.push({id:f.id,scenario:f.scenario,split:f.split,label_anomaly:f.labelAnomaly,agent:{alert:agentAlert,false_alarm:agentAlert&&!f.labelAnomaly,missed_anomaly:!agentAlert&&f.labelAnomaly,actionable_work_order_sim_minutes:actionable,correct_reassignment:reassigned,incorrect_closure:i.state==='Closed'&&f.scenario==='D',successful_completion:success,final_state:i.state,execution_ms:performance.now()-execution,sim_elapsed_minutes:(s.now-started)/60000,tool_calls:s.runs.reduce((a,r)=>a+r.steps,0),model_latency_ms:0,cost_usd:0},baseline});
}
function aggregate(split?:string){const selected=rows.filter(r=>!split||r.split===split);const out:Record<string,unknown>={cases:selected.length};for(const who of ['agent','baseline'] as const){const vals=selected.map(r=>r[who]);for(const metric of ['false_alarm','missed_anomaly','incorrect_closure','successful_completion'] as const)out[`${who}_${metric}`]=vals.filter(v=>v[metric]).length;const times=vals.map(v=>v.actionable_work_order_sim_minutes).filter(v=>v!==null) as number[];out[`${who}_mean_sim_minutes_to_work_order`]=times.length?times.reduce((a,b)=>a+b,0)/times.length:null;out[`${who}_correct_reassignments`]=`${vals.filter(v=>v.correct_reassignment===true).length}/${vals.filter(v=>v.correct_reassignment!==null).length}`;out[`${who}_tool_calls`]=vals.reduce((a,v)=>a+v.tool_calls,0);out[`${who}_execution_ms`]=Number(vals.reduce((a,v)=>a+v.execution_ms,0).toFixed(3));}return out;}
const result={generatedAt:new Date().toISOString(),provider:'deterministic demo (not live AI)',protocol:'docs/EVALUATION.md',summary:aggregate(),splits:{development:aggregate('development'),'held-out':aggregate('held-out')},rows};
for(const path of ['evaluation/results.json','public/evaluation-results.json'])writeFileSync(path,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.summary,null,2));
