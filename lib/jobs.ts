import {randomUUID} from 'node:crypto';
import {transaction,commandHash} from './db';
import {pool} from './pool';
import {CAMPUS,loadState,storeState} from './repository';
import {AppError,requireRole} from './errors';
import {audit,executeTool,id,incidentOf} from './engine';
import {configuredProvider,type Provider} from './provider';
import type {Actor,Command,State,AgentRun} from './types';
export type Job={id:string;campus_id:string;generation:string;incident_id:string;run_id:string;requested_by:string;status:'queued'|'running'|'completed'|'failed'|'cancelled';attempts:number;decisions:number;history:unknown[];lease_token:string;error:string|null};
export async function enqueueAgent(c:Command,actor:Actor){requireRole(actor.role==='manager','Manager role required');return transaction(async db=>{
 const s=await loadState(db,true);const {rows:[receipt]}=await db.query('SELECT * FROM ll_command_receipts WHERE command_id=$1',[c.commandId]);
 if(receipt){if(receipt.actor_id!==actor.id||receipt.campus_id!==CAMPUS||receipt.request_hash!==commandHash(c))throw new AppError(409,'IDEMPOTENCY_CONFLICT','Command key was already used for a different request');const {rows:[job]}=await db.query('SELECT * FROM ll_jobs WHERE id=$1',[receipt.job_id]);return {state:s,job:publicJob(job)};}
 if(c.revision!==s.revision)throw new AppError(409,'REVISION_CONFLICT','State changed in another view. Refresh and retry.');
 const i=incidentOf(s,c.incidentId);if(i.state==='Closed')throw new AppError(409,'INCIDENT_CLOSED','Incident is already closed');
 let {rows:[job]}=await db.query("SELECT * FROM ll_jobs WHERE campus_id=$1 AND generation=$2 AND incident_id=$3 AND status IN('queued','running')",[CAMPUS,s.generation,i.id]);
 if(!job){const jobId=randomUUID(),runId=`RUN-${jobId}`;const mode=configuredProvider().mode;
  s.runs.push({id:runId,incidentId:i.id,mode,startedAt:s.now,status:'queued',steps:0,latencyMs:0,modelMs:0,inputTokens:0,outputTokens:0,costUsd:mode==='demo'?0:null});
  audit(s,actor.name,`Queued agent investigation ${jobId}`);s.revision++;await storeState(db,s);
  ({rows:[job]}=await db.query(`INSERT INTO ll_jobs(id,campus_id,generation,incident_id,run_id,requested_by,status) VALUES($1,$2,$3,$4,$5,$6,'queued') RETURNING *`,[jobId,CAMPUS,s.generation,i.id,runId,actor.id]));
 }
 await db.query('INSERT INTO ll_command_receipts(command_id,campus_id,actor_id,action,request_hash,job_id,revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.commandId,CAMPUS,actor.id,c.action,commandHash(c),job.id,s.revision]);return {state:s,job:publicJob(job)};
});}
export function publicJob(j:Job){return {id:j.id,generation:j.generation,incidentId:j.incident_id,runId:j.run_id,status:j.status,attempts:j.attempts,decisions:j.decisions,error:j.error};}
export async function recentJobs(){return (await pool.query('SELECT * FROM ll_jobs WHERE campus_id=$1 AND generation=(SELECT generation FROM ll_runtime WHERE campus_id=$1) ORDER BY created_at DESC LIMIT 10',[CAMPUS])).rows.map(publicJob);}
export async function getJob(jobId:string){const {rows:[job]}=await pool.query('SELECT * FROM ll_jobs WHERE id=$1 AND campus_id=$2',[jobId,CAMPUS]);if(!job)throw new AppError(404,'NOT_FOUND','Job not found');return publicJob(job);}
export async function heartbeat(workerId:string){await pool.query('INSERT INTO ll_worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET seen_at=now()',[workerId]);}
export async function claimJob():Promise<Job|null>{return transaction(async db=>{
 const exhausted=await db.query("UPDATE ll_jobs SET status='failed',error='Worker recovery attempts exhausted',updated_at=now() WHERE status='running' AND lease_until<now() AND attempts>=3 RETURNING campus_id,generation,run_id");
 for(const j of exhausted.rows)await db.query("UPDATE ll_agent_runs SET status='failed',payload=payload || $4::jsonb WHERE campus_id=$1 AND generation=$2 AND id=$3",[j.campus_id,j.generation,j.run_id,JSON.stringify({status:'failed',error:'Worker recovery attempts exhausted'})]);
 const lease=randomUUID();const {rows:[job]}=await db.query(`WITH candidate AS (SELECT id FROM ll_jobs WHERE attempts<3 AND ((status='queued' AND available_at<=now()) OR (status='running' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ll_jobs j SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '60 seconds',updated_at=now() FROM candidate c WHERE j.id=c.id RETURNING j.*`,[lease]);return job??null;
});}
async function checkpoint<T>(job:Job,change:(s:State,j:Job)=>Promise<T>):Promise<{applied:boolean;value?:T}>{return transaction(async db=>{
 const s=await loadState(db,true);const {rows:[live]}=await db.query('SELECT * FROM ll_jobs WHERE id=$1 FOR UPDATE',[job.id]);
 if(!live||live.status!=='running'||live.lease_token!==job.lease_token||live.generation!==s.generation)return {applied:false};
 const value=await change(s,live);s.revision++;await storeState(db,s);
 await db.query(`UPDATE ll_jobs SET status=$2,decisions=$3,history=$4,error=$5,lease_until=CASE WHEN $2='running' THEN now()+interval '60 seconds' ELSE NULL END,available_at=CASE WHEN $2='queued' THEN now()+interval '3 seconds' ELSE available_at END,updated_at=now() WHERE id=$1`,[live.id,live.status,live.decisions,JSON.stringify(live.history),live.error]);return {applied:true,value};
});}
function price(run:AgentRun){if(run.mode==='demo')run.costUsd=0;else if(process.env.MODEL_INPUT_USD_PER_MILLION&&process.env.MODEL_OUTPUT_USD_PER_MILLION)run.costUsd=(run.inputTokens*Number(process.env.MODEL_INPUT_USD_PER_MILLION)+run.outputTokens*Number(process.env.MODEL_OUTPUT_USD_PER_MILLION))/1e6;}
export async function executeJob(job:Job,provider:Provider=configuredProvider()){
 const started=performance.now();let mark=started;
 const finish=async(status:AgentRun['status'],error?:string)=>checkpoint(job,async(s,j)=>{const run=s.runs.find(r=>r.id===job.run_id)!;run.status=status;run.error=error;run.latencyMs+=performance.now()-mark;price(run);j.status=status==='queued'?'queued':status==='failed'?'failed':'completed';j.error=error??null;audit(s,'Agent worker',`Investigation ${j.id}: ${status}${error?` · ${error}`:''}`);});
 try{
  const ready=await checkpoint(job,async(s)=>{const run=s.runs.find(r=>r.id===job.run_id)!;run.status='running';return true;});if(!ready.applied)return;
  for(;;){
   const snap=await transaction(db=>loadState(db),true);if(snap.generation!==job.generation)return;
   const {rows:[live]}=await pool.query('SELECT * FROM ll_jobs WHERE id=$1',[job.id]);if(live.status!=='running'||live.lease_token!==job.lease_token)return;
   if(live.decisions>=8||performance.now()-started>30000){await finish('bounded','Bounded run limit reached. Start another investigation if more work is needed.');return;}
   const i=incidentOf(snap,job.incident_id);if(snap.runs.find(r=>r.id===job.run_id)?.mode!==provider.mode)throw new Error('Provider mode changed. Start a new investigation.');const choice=await provider.choose(snap,i,live.history);
   if(!choice.tool){await checkpoint(job,async(s,j)=>{const r=s.runs.find(r=>r.id===j.run_id)!;r.modelMs+=choice.modelMs;r.inputTokens+=choice.inputTokens;r.outputTokens+=choice.outputTokens;});await finish('completed');return;}
   let replan=false;
   for(let attempt=0;attempt<2;attempt++){
    const result=await checkpoint(job,async(s,j)=>{
     const run=s.runs.find(r=>r.id===j.run_id)!;
     if(attempt===0&&s.revision!==snap.revision){j.decisions++;return {changed:true};}
     if(attempt===0){run.modelMs+=choice.modelMs;run.inputTokens+=choice.inputTokens;run.outputTokens+=choice.outputTokens;}
     const before=structuredClone(s);const toolStarted=performance.now();let outcome:{result:unknown;summary:string;citations:string[]};let error:string|undefined;
     try{outcome=executeTool(s,incidentOf(s,j.incident_id),choice.tool!);}catch(e){error=e instanceof Error?e.message:'Tool failed';Object.assign(s,before);if(error.startsWith('Simulated temporary'))s.toolFailure=undefined;outcome={result:{error},summary:attempt===0?'Tool failed; one bounded retry.':'Tool failed twice; review the incident.',citations:[]};}
     const active=s.runs.find(r=>r.id===j.run_id)!;active.steps++;active.latencyMs+=performance.now()-mark;price(active);mark=performance.now();
     s.traces.push({id:id('TRACE'),runId:j.run_id,incidentId:j.incident_id,at:s.now,tool:choice.tool!,status:error?'error':'success',result:error??JSON.stringify(outcome.result).slice(0,20000),summary:outcome.summary,citations:outcome.citations,elapsedMs:performance.now()-toolStarted});j.history.push({tool:choice.tool,result:outcome.result});if(!error||attempt===1)j.decisions++;return {error,changed:false};
    });
    if(!result.applied)return;if(result.value?.changed){replan=true;break;}if(!result.value?.error)break;if(attempt===1){await finish('failed',result.value.error);return;}
   }
   if(replan)continue;
  }
 }catch(e){const message=e instanceof Error?e.message:'Agent execution failed';const transient=/fetch failed|timeout|aborted|HTTP (429|5\d\d)/i.test(message);await finish(transient&&job.attempts<3?'queued':'failed',message);}
}
export async function workOnce(provider?:Provider){const job=await claimJob();if(!job)return false;await executeJob(job,provider);return true;}
