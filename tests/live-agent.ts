// Live-provider integration checks against a LOCAL MOCK of the Responses API.
// This verifies LeakLoop's request construction, parsing, usage/cost recording, timeouts and
// failure handling. It does not verify behaviour, quality, latency or pricing of a real model.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import type {AddressInfo} from 'node:net';
import {pool,readState,transaction} from '../lib/db';
import {CAMPUS,storeState} from '../lib/repository';
import {seed} from '../lib/seed';
import {nextTool,tools} from '../lib/engine';
import {claimJob,enqueueAgent,executeJob,getJob} from '../lib/jobs';
import {LiveProvider} from '../lib/provider';
import type {Actor} from '../lib/types';

const manager:Actor={id:'manager-ava',role:'manager',name:'Ava Morgan',campusId:CAMPUS};
const checks:string[]=[],original=await readState(),generations:string[]=[];
async function check(name:string,fn:()=>Promise<void>){await fn();checks.push(name);console.log(`PASS ${name}`);}
type Mode='policy'|'dispatch'|'slow'|'401'|'429'|'disallowed'|'multiple'|'refusal'|'incomplete';
let mode:Mode='policy';const requests:{auth:string;body:Record<string,unknown>}[]=[];
const call=(name:string)=>({type:'function_call',name,call_id:randomUUID(),arguments:'{}'});
const mock=createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push({auth:req.headers.authorization??'',body});
 const send=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.setHeader('x-request-id',`req_${requests.length}`);res.end(JSON.stringify(data));};
 const usage={input_tokens:1000,output_tokens:20};
 if(mode==='slow'){await new Promise(r=>setTimeout(r,2500));if(!res.destroyed)send(200,{status:'completed',output:[],usage});return;}
 if(mode==='401')return send(401,{error:{message:'invalid key'}});
 if(mode==='429')return send(429,{error:{message:'rate limited'}});
 if(mode==='disallowed')return send(200,{status:'completed',model:'mock-model-2026',output:[call('approve_and_close_incident')],usage});
 if(mode==='multiple')return send(200,{status:'completed',output:[call('get_meter_readings'),call('get_usage_schedule')],usage});
 if(mode==='refusal')return send(200,{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}],usage});
 if(mode==='incomplete')return send(200,{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],usage});
 if(mode==='dispatch')return send(200,{status:'completed',output:[call('create_work_order')],usage});
 // 'policy': behave like a well-behaved model by following the deterministic policy.
 const s=await readState();const tool=nextTool(s,s.incidents[0]);return send(200,{status:'completed',model:'mock-model-2026',output:tool?[call(tool)]:[{type:'message',content:[{type:'output_text',text:'Waiting for human approval.'}]}],usage});
});
await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));
Object.assign(process.env,{AGENT_MODE:'live',OPENAI_API_KEY:'test-key-not-a-real-credential',OPENAI_MODEL:'mock-model',OPENAI_BASE_URL:`http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`,AGENT_MODEL_TIMEOUT_MS:'1000',MODEL_INPUT_USD_PER_MILLION:'2',MODEL_OUTPUT_USD_PER_MILLION:'8'});
async function fresh(){const s=seed('A');s.generation=randomUUID();s.revision=(await readState()).revision+1;generations.push(s.generation);await transaction(db=>storeState(db,s));return s;}
async function runJob(m:Mode,signal?:AbortSignal){mode=m;const s=await fresh();const q=await enqueueAgent({action:'run_agent',incidentId:s.incidents[0].id,commandId:randomUUID(),revision:s.revision},manager);const job=await claimJob();assert.equal(job?.id,q.job.id);await executeJob(job!,new LiveProvider(),signal);return {job:await getJob(q.job.id),state:await readState()};}
const usageFor=async(jobId:string)=>(await pool.query('SELECT * FROM ll_model_usage WHERE job_id=$1 ORDER BY created_at',[jobId])).rows;

try{
 await check('live requests carry server-side credentials, the tool allowlist and no account data',async()=>{
  requests.length=0;const {job,state}=await runJob('policy');assert.equal(job.status,'completed',job.error??'');
  assert.ok(requests.length>=2);for(const r of requests){assert.equal(r.auth,'Bearer test-key-not-a-real-credential');assert.equal(r.body.store,false);assert.equal(r.body.parallel_tool_calls,false);assert.deepEqual((r.body.tools as {name:string;strict:boolean}[]).map(t=>t.name),[...tools]);assert.ok((r.body.tools as {strict:boolean}[]).every(t=>t.strict));const text=JSON.stringify(r.body);assert.ok(!/@evergreen\.local|password|scrypt\$|token_hash/.test(text),'no account data sent');}
  assert.equal(state.runs.at(-1)?.mode,'live');
 });
 await check('a model following policy can propose dispatch but cannot approve it',async()=>{const s=await readState();const i=s.incidents[0];assert.equal(i.proposal?.status,'pending');assert.equal(i.proposal?.kind,'dispatch');assert.equal(s.workOrders.length,0);assert.equal(i.state,'Awaiting evidence/approval');});
 await check('every model request is recorded with tokens, latency, request id and cost',async()=>{
  const {rows:[j]}=await pool.query("SELECT id FROM ll_jobs WHERE generation=$1",[generations.at(-1)]);const rows=await usageFor(j.id);
  assert.equal(rows.length,requests.length);assert.ok(rows.every(r=>r.status==='success'&&r.input_tokens===1000&&r.output_tokens===20&&r.provider_request_id?.startsWith('req_')&&r.model==='mock-model-2026'));
  assert.ok(rows.every(r=>Math.abs(Number(r.cost_usd)-(1000*2+20*8)/1e6)<1e-9));
  const run=(await readState()).runs.at(-1)!;assert.equal(run.inputTokens,1000*rows.length);assert.ok(Math.abs(run.costUsd!-rows.length*(1000*2+20*8)/1e6)<1e-9);
 });
 await check('a model calling create_work_order without approval fails visibly and dispatches nothing',async()=>{const {job,state}=await runJob('dispatch');assert.equal(job.status,'failed');assert.match(job.error!,/approval/i);assert.equal(state.workOrders.length,0);});
 await check('timeouts are transient: the job is requeued, the error recorded, and no demo result substituted',async()=>{
  const {job,state}=await runJob('slow');assert.equal(job.status,'queued');assert.match(job.error!,/timeout/);assert.equal(state.traces.length,0);
  const rows=await usageFor(job.id);assert.equal(rows.at(-1).error_class,'timeout');assert.ok(rows.at(-1).latency_ms>=900);
 });
 await check('authentication failures fail the job without retry',async()=>{const {job}=await runJob('401');assert.equal(job.status,'failed');assert.match(job.error!,/HTTP 401.*No demo fallback/);assert.equal((await usageFor(job.id))[0].error_class,'auth');});
 await check('rate limiting is retried by requeueing',async()=>{const {job}=await runJob('429');assert.equal(job.status,'queued');});
 for(const [m,pattern] of [['disallowed',/disallowed tool/],['multiple',/more than one tool/],['refusal',/refused/],['incomplete',/incomplete/]] as const)
  await check(`${m} model output fails explicitly with no tools executed`,async()=>{const {job,state}=await runJob(m);assert.equal(job.status,'failed');assert.match(job.error!,pattern);assert.equal(state.traces.length,0);});
 await check('graceful shutdown aborts the model call and requeues without consuming an attempt',async()=>{const ac=new AbortController();setTimeout(()=>ac.abort(),150);const {job}=await runJob('slow',ac.signal);assert.equal(job.status,'queued');assert.equal(job.attempts,0);assert.match(job.error!,/shutting down/);});
 await check('live mode without credentials is rejected at enqueue, before any job is created',async()=>{
  delete process.env.OPENAI_API_KEY;try{const s=await fresh();await assert.rejects(()=>enqueueAgent({action:'run_agent',incidentId:s.incidents[0].id,commandId:randomUUID(),revision:s.revision},manager),(e:unknown)=>(e as {code?:string}).code==='AGENT_NOT_CONFIGURED');assert.equal((await pool.query('SELECT count(*)::int n FROM ll_jobs WHERE generation=$1',[s.generation])).rows[0].n,0);}finally{process.env.OPENAI_API_KEY='test-key-not-a-real-credential';}
 });
 writeFileSync('evaluation/live-agent-results.json',JSON.stringify({passed_checks:checks.length,checks,generatedAt:new Date().toISOString(),provider:'local mock Responses API — no real model was called; quality, latency and cost of a real model remain unmeasured'},null,2)+'\n');
 console.log(`${checks.length} live-provider checks passed (mock endpoint).`);
}finally{
 await pool.query("UPDATE ll_jobs SET status='cancelled',error='Live agent test cleanup',lease_token=NULL,lease_until=NULL WHERE generation=ANY($1::uuid[]) AND status IN('queued','running')",[generations]);
 await transaction(db=>storeState(db,original));mock.close();await pool.end();
}
