// HTTP checks for production features against a running app + worker (npm run local).
// Uses local accounts from .local-accounts.json. Creates and cleans up its own test records.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pool,readState,transaction} from '../lib/db';
import {storeState} from '../lib/repository';
import {digest} from '../lib/auth';

const origin=process.env.APP_URL??'http://127.0.0.1:3001';const accounts=JSON.parse(readFileSync('.local-accounts.json','utf8'));
const checks:string[]=[];const run=randomUUID().slice(0,8);const original=await readState();
const cleanup={emails:[] as string[],devices:[] as string[],attachments:[] as string[]};
async function check(name:string,fn:()=>Promise<void>){await fn();checks.push(name);console.log(`PASS ${name}`);}
type Opts={method?:string;body?:unknown;cookie?:string;headers?:Record<string,string>;raw?:BodyInit;origin?:string|null};
async function http(path:string,o:Opts={}){const headers:Record<string,string>={...(o.cookie?{Cookie:o.cookie}:{}),...(o.origin===null?{}:{Origin:o.origin??origin}),...o.headers};if(o.body!==undefined)headers['Content-Type']='application/json';const r=await fetch(`${origin}${path}`,{method:o.method??'GET',headers,body:o.raw??(o.body!==undefined?JSON.stringify(o.body):undefined),redirect:'manual'});let data:Record<string,any>={};const text=await r.text();try{data=JSON.parse(text);}catch{data={text};}return {status:r.status,data,headers:r.headers};}
async function login(who:string){const r=await http('/api/auth/login',{method:'POST',body:{email:accounts[who].email,password:accounts[who].password}});assert.equal(r.status,200,JSON.stringify(r.data));return r.headers.get('set-cookie')!.split(';')[0];}
const manager=await login('manager'),ravi=await login('ravi'),maya=await login('maya'),operator=await login('operator');
try{
 await check('health endpoints separate liveness from readiness',async()=>{assert.equal((await http('/api/health/live')).data.status,'alive');const r=await http('/api/health/ready');assert.equal(r.status,200);assert.equal(r.data.status,'ready');assert.equal(r.data.checks.migrations.status,'ok');});
 await check('security headers are set on pages and APIs',async()=>{for(const p of ['/','/api/health/live']){const r=await http(p);assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('x-powered-by'),null);}});
 await check('public auth config exposes no secrets',async()=>{const r=await http('/api/auth/config');assert.equal(r.status,200);assert.ok(!/secret|key|smtp|database/i.test(JSON.stringify(r.data).replace('attachmentMaxBytes','')));});
 await check('password recovery responds identically for known and unknown emails',async()=>{const a=await http('/api/auth/password/forgot',{method:'POST',body:{email:`nobody-${run}@test.local`}});const b=await http('/api/auth/password/forgot',{method:'POST',body:{email:accounts.operator.email}});assert.equal(a.status,202);assert.deepEqual(a.data,b.data);await pool.query('UPDATE ll_password_resets SET invalidated_at=now() WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',['operator-demo']);});
 await check('account mutations require same origin',async()=>{for(const [p,body] of [['/api/auth/password/forgot',{email:'a@b.co'}],['/api/v1/admin/invitations',{email:'a@b.co',name:'x',role:'operator'}],['/api/v1/devices',{name:'x',buildingId:'north'}]] as const)assert.equal((await http(p,{method:'POST',body,cookie:manager,origin:'https://evil.example'})).status,403);});
 await check('administration endpoints are manager-only',async()=>{for(const c of [ravi,operator]){for(const p of ['/api/v1/admin/users','/api/v1/admin/invitations','/api/v1/admin/account-events','/api/v1/admin/model-usage','/api/v1/devices'])assert.equal((await http(p,{cookie:c})).status,403,p);assert.equal((await http('/api/v1/admin/invitations',{method:'POST',cookie:c,body:{email:`x-${run}@test.local`,name:'X',role:'manager'}})).status,403);}});
 let inviteeCookie='';const invitee=`http-invitee-${run}@test.local`;cleanup.emails.push(invitee);
 await check('invitation → acceptance over HTTP sets a hardened session cookie with the invited role',async()=>{
  const r=await http('/api/v1/admin/invitations',{method:'POST',cookie:manager,body:{email:invitee,name:'HTTP Invitee',role:'operator'}});assert.equal(r.status,201);const token=new URL(r.data.link).hash.split('token=')[1];
  assert.equal((await http('/api/auth/invitations/preview',{method:'POST',body:{token}})).data.invitation.role,'operator');
  assert.equal((await http('/api/auth/invitations/accept',{method:'POST',body:{token,password:'short'}})).status,400);
  const a=await http('/api/auth/invitations/accept',{method:'POST',body:{token,password:'a long http passphrase'}});assert.equal(a.status,200);const cookie=a.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=strict/i);inviteeCookie=cookie.split(';')[0];
  assert.equal((await http('/api/session',{cookie:inviteeCookie})).data.actor.role,'operator');
  assert.equal((await http('/api/auth/invitations/accept',{method:'POST',body:{token,password:'a long http passphrase'}})).status,404);
 });
 await check('users list and revoke their own sessions; revoking another user’s session is 404',async()=>{
  const list=await http('/api/account/sessions',{cookie:inviteeCookie});assert.equal(list.status,200);assert.equal(list.data.data.filter((s:{current:boolean})=>s.current).length,1);
  const mine=(await http('/api/account/sessions',{cookie:ravi})).data.data[0].id;
  assert.equal((await http(`/api/account/sessions/${mine}`,{method:'DELETE',cookie:inviteeCookie})).status,404);
  assert.equal((await http('/api/account/sessions/not-a-uuid',{method:'DELETE',cookie:inviteeCookie})).status,400);
  const own=list.data.data[0].id;const r=await http(`/api/account/sessions/${own}`,{method:'DELETE',cookie:inviteeCookie});assert.equal(r.status,200);assert.equal((await http('/api/state',{cookie:inviteeCookie})).status,401);
 });
 let deviceKey='',deviceId='';
 await check('device registration returns a one-time key; ingestion uses bearer keys, not cookies',async()=>{
  const r=await http('/api/v1/devices',{method:'POST',cookie:manager,body:{name:`HTTP gateway ${run}`,buildingId:'north'}});assert.equal(r.status,201);deviceKey=r.data.key;deviceId=r.data.device.id;cleanup.devices.push(deviceId);
  assert.ok(!JSON.stringify((await http('/api/v1/devices',{cookie:manager})).data).includes(deviceKey));
  const body={readings:[{observedAt:new Date(Date.now()-60000).toISOString(),value:24.5,messageId:`http-${run}`}]};
  assert.equal((await http('/api/v1/ingest/readings',{method:'POST',body,cookie:manager,origin:null})).status,401,'a browser session cannot ingest');
  assert.equal((await http('/api/v1/ingest/readings',{method:'POST',body,origin:null,headers:{Authorization:'Bearer llk_00000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}})).status,401);
  const ok=await http('/api/v1/ingest/readings',{method:'POST',body,origin:null,headers:{Authorization:`Bearer ${deviceKey}`}});assert.equal(ok.status,200);assert.equal(ok.data.accepted,1);
  const dup=await http('/api/v1/ingest/readings',{method:'POST',body,origin:null,headers:{Authorization:`Bearer ${deviceKey}`}});assert.equal(dup.data.duplicates,1);
  const bad=await http('/api/v1/ingest/readings',{method:'POST',origin:null,body:{readings:[{observedAt:'2099-01-01T00:00:00Z',value:1}]},headers:{Authorization:`Bearer ${deviceKey}`}});assert.equal(bad.status,422);
  assert.equal((await http('/api/v1/ingest/readings',{method:'POST',origin:null,raw:'{',headers:{Authorization:`Bearer ${deviceKey}`,'Content-Type':'application/json'}})).status,400);
 });
 await check('telemetry queries label real and simulated data and never mix them',async()=>{
  const real=await http(`/api/v1/telemetry?source=device&deviceId=${deviceId}`,{cookie:ravi});assert.equal(real.status,200);assert.equal(real.data.source,'device');assert.ok(real.data.data.every((r:{source:string})=>r.source==='device'));assert.equal(real.data.data.length,1);
  const sim=await http('/api/v1/telemetry?buildingId=north&limit=5',{cookie:ravi});assert.equal(sim.data.source,'simulated');assert.ok(sim.data.data.every((r:{source:string})=>r.source==='simulated'));
  assert.equal((await http('/api/v1/telemetry?source=both&buildingId=north',{cookie:ravi})).status,400);
  assert.equal((await http(`/api/v1/telemetry?source=device&deviceId=${deviceId}`)).status,401);
 });
 let attachmentId='';
 await check('managers upload evidence over multipart; downloads are private, typed and non-sniffable',async()=>{
  const jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,...Buffer.from(`photo-${run}`)]);const form=new FormData();form.set('file',new Blob([jpeg],{type:'image/jpeg'}),'site photo.jpg');form.set('description','Meter dial');
  const r=await http('/api/v1/incidents/INC-1042/attachments',{method:'POST',cookie:manager,raw:form});assert.equal(r.status,201,JSON.stringify(r.data));attachmentId=r.data.attachment.id;cleanup.attachments.push(attachmentId);
  const d=await fetch(`${origin}/api/v1/attachments/${attachmentId}/content`,{headers:{Cookie:manager}});assert.equal(d.status,200);assert.equal(d.headers.get('content-type'),'image/jpeg');assert.equal(d.headers.get('x-content-type-options'),'nosniff');assert.match(d.headers.get('content-security-policy')!,/sandbox/);assert.match(d.headers.get('cache-control')!,/no-store/);assert.deepEqual(new Uint8Array(await d.arrayBuffer()),jpeg);
  assert.match((await fetch(`${origin}/api/v1/attachments/${attachmentId}/content?download=1`,{headers:{Cookie:manager}})).headers.get('content-disposition')!,/^attachment;/);
  assert.equal((await fetch(`${origin}/api/v1/attachments/${attachmentId}/content`)).status,401);
 });
 await check('unassigned technicians and operators cannot list, read or upload evidence',async()=>{for(const c of [maya,ravi,operator]){assert.equal((await http('/api/v1/incidents/INC-1042/attachments',{cookie:c})).status,404);assert.equal((await http(`/api/v1/attachments/${attachmentId}/content`,{cookie:c})).status,404);}});
 await check('uploads reject cross-origin, oversized, mismatched and non-multipart requests',async()=>{
  const form=()=>{const f=new FormData();f.set('file',new Blob([new Uint8Array([0xff,0xd8,0xff,0xe0,1])],{type:'image/jpeg'}),'a.jpg');return f;};
  assert.equal((await http('/api/v1/incidents/INC-1042/attachments',{method:'POST',cookie:manager,raw:form(),origin:'https://evil.example'})).status,403);
  const big=new FormData();big.set('file',new Blob([new Uint8Array(11*1048576)]),'big.jpg');assert.equal((await http('/api/v1/incidents/INC-1042/attachments',{method:'POST',cookie:manager,raw:big})).status,413);
  const html=new FormData();html.set('file',new Blob(['<html><script>alert(1)</script>'],{type:'image/jpeg'}),'x.jpg');assert.equal((await http('/api/v1/incidents/INC-1042/attachments',{method:'POST',cookie:manager,raw:html})).status,415);
  assert.equal((await http('/api/v1/incidents/INC-1042/attachments',{method:'POST',cookie:manager,body:{file:'x'}})).status,415);
 });
 await check('deletion requires a reason and is reflected in the campus audit log',async()=>{assert.equal((await http(`/api/v1/attachments/${attachmentId}`,{method:'DELETE',cookie:manager,body:{}})).status,400);assert.equal((await http(`/api/v1/attachments/${attachmentId}`,{method:'DELETE',cookie:manager,body:{reason:'HTTP test cleanup'}})).status,200);assert.equal((await http(`/api/v1/attachments/${attachmentId}/content`,{cookie:manager})).status,410);const audit=(await http('/api/v1/audit?limit=20',{cookie:manager})).data.data;assert.ok(audit.some((a:{body:string})=>a.body.includes('Deleted attachment')));});
 await check('model usage summary reports demo mode honestly',async()=>{const r=await http('/api/v1/admin/model-usage',{cookie:manager});assert.equal(r.status,200);assert.equal(r.data.mode,'demo');assert.equal(r.data.model,null);});
 writeFileSync('evaluation/http-production-results.json',JSON.stringify({passed_checks:checks.length,checks,generatedAt:new Date().toISOString(),target:origin},null,2)+'\n');
 console.log(`${checks.length} production HTTP checks passed.`);
}finally{
 const {rows:users}=await pool.query('SELECT id FROM ll_users WHERE email=ANY($1)',[cleanup.emails]);const ids=users.map(u=>u.id);
 await pool.query('DELETE FROM ll_sessions WHERE user_id=ANY($1)',[ids]);await pool.query('DELETE FROM ll_invitations WHERE email=ANY($1)',[cleanup.emails]);await pool.query('DELETE FROM ll_login_limits WHERE key=ANY($1)',[cleanup.emails.map(e=>digest(e))]);await pool.query('DELETE FROM ll_users WHERE id=ANY($1)',[ids]);
 await pool.query('DELETE FROM ll_device_readings WHERE device_id=ANY($1)',[cleanup.devices]);await pool.query('DELETE FROM ll_ingest_batches WHERE device_id=ANY($1)',[cleanup.devices]);await pool.query('DELETE FROM ll_devices WHERE id=ANY($1)',[cleanup.devices]);
 // The test attachment was soft-deleted above; its metadata is retained like any other record. Stored bytes are purged by maintenance after the retention window.
 const s=await readState();if(s.revision!==original.revision)await transaction(db=>storeState(db,{...s}));
 await pool.end();
}
