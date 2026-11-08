import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {pool,readState,transaction} from '../lib/db';
import {storeState} from '../lib/repository';
import type {State,Command} from '../lib/types';
const origin=process.env.APP_URL??'http://127.0.0.1:3001';const accounts=JSON.parse(readFileSync('.local-accounts.json','utf8'));let cookie='',s:State=await readState();let commands=0,requests=0;const checks:string[]=[];const original=await readState();const generations:string[]=[];
async function request(path:string,init:RequestInit={}){requests++;return fetch(`${origin}${path}`,{...init,headers:{Cookie:cookie,...init.headers}});}
async function login(identity:string){const r=await request('/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:accounts[identity].email,password:accounts[identity].password})});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.match(r.headers.get('set-cookie')!,/HttpOnly/i);assert.match(r.headers.get('set-cookie')!,/SameSite=strict/i);cookie=r.headers.get('set-cookie')!.split(';')[0];}
async function state(){const r=await request('/api/state');assert.equal(r.status,200);s=(await r.json()).state;return s;}
async function send(c:Command,status=c.action==='run_agent'?202:200){const r=await request('/api/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({...c,revision:s.revision,commandId:c.commandId??randomUUID()})});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));commands++;if(status===200||status===202)s=d.state;
 if(status===202){const deadline=Date.now()+15000;for(;;){const q=await request(`/api/v1/jobs/${d.job.id}`);const {job}=await q.json();if(['completed','failed','cancelled'].includes(job.status)){assert.equal(job.status,'completed',job.error);break;}assert.ok(Date.now()<deadline,'Worker did not process the job within 15 seconds');await delay(50);}await state();}
 if(c.action==='reset'&&status===200)generations.push(s.generation!);return d;
}
try{
 let r=await request('/api/v1/incidents');assert.equal(r.status,401);checks.push('unauthenticated read rejected');
 r=await request('/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({identity:'manager'})});assert.equal(r.status,403);checks.push('demo role switching disabled');
 r=await request('/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:accounts.manager.email,password:'incorrect'})});assert.equal(r.status,401);checks.push('wrong password rejected');
 await login('manager');await state();
 r=await request('/api/command',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(r.status,403);checks.push('cross-origin mutation rejected');
 r=await request('/api/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'run_agent',incidentId:'INC-1042',revision:s.revision,commandId:randomUUID(),role:'manager'})});assert.equal(r.status,400);checks.push('unknown or forged role field rejected');
 r=await request('/api/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);checks.push('malformed JSON rejected');
 r=await request('/api/v1/telemetry?buildingId=north&limit=999');assert.equal(r.status,400);checks.push('telemetry query limits validated');
 r=await request('/api/v1/telemetry?buildingId=north&limit=5');assert.equal(r.status,200);assert.equal((await r.json()).data.length,5);checks.push('indexed telemetry endpoint responds');
 r=await request('/api/v1/incidents/INC-1042');assert.equal(r.status,200);checks.push('versioned incident endpoint responds');
 await login('ravi');r=await request('/api/state');assert.equal((await r.json()).state.incidents.length,0);checks.push('unassigned technician receives no incident evidence');r=await request('/api/v1/audit');assert.equal(r.status,403);checks.push('manager-only audit access enforced');
 await login('manager');const oldCookie=cookie;r=await request('/api/session',{method:'DELETE',headers:{Origin:origin}});assert.equal(r.status,200);cookie=oldCookie;r=await request('/api/state');assert.equal(r.status,401);checks.push('logout revokes the server-side session');
 for(const scenario of ['A','C','D'] as const){
  await login('operator');await state();await send({action:'reset',scenario});await login('manager');await send({action:'run_agent',incidentId:'INC-1042'});const p=s.incidents[0].proposal!;
  await login('ravi');await send({action:'approve',incidentId:'INC-1042',proposalId:p.id,version:p.version},403);
  await login('manager');const key=randomUUID();await send({action:'approve',incidentId:'INC-1042',proposalId:p.id,version:p.version,commandId:key});await send({action:'approve',incidentId:'INC-1042',proposalId:p.id,version:p.version,commandId:key});assert.equal(s.workOrders.length,1);
  await send({action:'approve',incidentId:'INC-1042',proposalId:p.id,version:p.version,commandId:key,text:'changed'},409);
  if(scenario==='C'){await login('ravi');await send({action:'decline',workOrderId:s.workOrders[0].id,text:'Unavailable for this shift'});await login('manager');await send({action:'run_agent',incidentId:'INC-1042'});const reassignment=s.incidents[0].proposal!;assert.equal(reassignment.techId,'tech-maya');await send({action:'approve',incidentId:'INC-1042',proposalId:reassignment.id,version:reassignment.version});assert.equal(s.workOrders.length,1);assert.equal(s.workOrders[0].techId,'tech-maya');assert.ok(s.workOrders[0].history.some(h=>h.text.includes('declined')));checks.push('decline triggers approved reassignment without a duplicate work order');}
  await login(scenario==='C'?'ravi':'maya');r=await request('/api/v1/work-orders');assert.equal((await r.json()).data.length,0);
  await login(scenario==='C'?'maya':'ravi');const workOrderId=s.workOrders[0].id;await send({action:'accept',workOrderId});await send({action:'observe',workOrderId,text:'Simulated inspection confirms sustained visible meter flow.'});await send({action:'complete',workOrderId,text:'Work reported complete; independent verification needed.',checklist:['location','meter','findings']});assert.equal(s.incidents[0].state,'Awaiting verification');
  await login('manager');await send({action:'close',incidentId:'INC-1042'},400);await send({action:'run_agent',incidentId:'INC-1042'});assert.equal(s.incidents[0].verification?.outcome,'insufficient evidence');
  await login('operator');await send({action:'advance',minutes:60});await login('manager');await send({action:'run_agent',incidentId:'INC-1042'});
  if(scenario!=='D'){assert.equal(s.incidents[0].state,'Ready for closure');const p=s.incidents[0].proposal!;await send({action:'close',incidentId:'INC-1042',proposalId:p.id,version:p.version});assert.equal(s.incidents[0].state,'Closed');checks.push(scenario==='C'?'reassigned technician completes independently verified closure':'normal workflow reaches human-confirmed closure');}
  else{assert.equal(s.incidents[0].verification?.outcome,'anomaly persists');assert.notEqual(s.incidents[0].state,'Closed');checks.push('failed repair stays open after durable verification job');}
  const before:State=structuredClone(s);await state();assert.deepEqual(s,before);
 }
 checks.push('job polling, work ownership, idempotency, and reload persistence verified');
 const report={passed_checks:checks.length,commands_verified:commands,http_requests:requests,checks,generatedAt:new Date().toISOString()};writeFileSync('evaluation/api-results.json',JSON.stringify(report,null,2)+'\n');console.log(report);
}finally{await pool.query("UPDATE ll_jobs SET status='cancelled',error='API test cleanup' WHERE generation=ANY($1::uuid[]) AND status IN('queued','running')",[generations]);await transaction(db=>storeState(db,original));await pool.end();}
