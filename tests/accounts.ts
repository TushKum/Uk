// Account lifecycle integration checks against the configured Postgres database.
// Uses a local mock OpenID provider and a local SMTP sink; nothing leaves this machine.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import type {AddressInfo} from 'node:net';
import {SignJWT,exportJWK,generateKeyPair} from 'jose';
import {SMTPServer} from 'smtp-server';
import {pool} from '../lib/db';
import {CAMPUS} from '../lib/repository';
import {authenticate,createSession,digest,hashPassword,login,passwordProblem} from '../lib/auth';
import * as accounts from '../lib/accounts';
import {completeSso,resetSsoCache,startSso} from '../lib/sso';
import {sendMail} from '../lib/mail';
import {loadConfig} from '../lib/config';
import type {Actor} from '../lib/types';

const run=randomUUID().slice(0,8),origin='http://127.0.0.1:3001',outbox=await mkdtemp(join(tmpdir(),'leakloop-outbox-'));
process.env.MAIL_TRANSPORT='file';process.env.MAIL_OUTBOX_DIR=outbox;
const checks:string[]=[],created:string[]=[];
async function check(name:string,fn:()=>Promise<void>){await fn();checks.push(name);console.log(`PASS ${name}`);}
const code=(c:string)=>(e:unknown)=>{assert.equal((e as {code?:string}).code,c,(e as Error).message);return true;};
const tokenFrom=(link:string)=>new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
async function makeUser(role:Actor['role'],password='correct horse battery 9'){const id=`acct-${run}-${created.length}`;const email=`${id}@test.local`;await pool.query('INSERT INTO ll_users(id,campus_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,CAMPUS,email,`Test ${role} ${created.length}`,role,await hashPassword(password)]);created.push(id);return {id,email,password,actor:{id,role,name:`Test ${role}`,campusId:CAMPUS} as Actor};}
async function actorFor(token:string){const a=await authenticate(token);assert.ok(a);return a;}

// ---------- mock OpenID provider ----------
const {publicKey,privateKey}=await generateKeyPair('RS256');const {privateKey:rogueKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'k1',alg:'RS256',use:'sig'};
const codes=new Map<string,{challenge:string;claims:Record<string,unknown>;key:CryptoKey}>();
let nextClaims:Record<string,unknown>={},nextKey:CryptoKey=privateKey;
const idp=createServer(async(req,res)=>{
 const url=new URL(req.url!,`http://${req.headers.host}`);const base=`http://${req.headers.host}`;
 if(url.pathname==='/.well-known/openid-configuration'){res.setHeader('content-type','application/json');res.end(JSON.stringify({issuer:base,authorization_endpoint:`${base}/authorize`,token_endpoint:`${base}/token`,jwks_uri:`${base}/jwks`,token_endpoint_auth_methods_supported:['client_secret_basic']}));return;}
 if(url.pathname==='/jwks'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));return;}
 if(url.pathname==='/token'){let body='';for await(const c of req)body+=c;const form=new URLSearchParams(body);const auth=Buffer.from((req.headers.authorization??'').replace('Basic ',''),'base64').toString();
  const entry=codes.get(form.get('code')??'');codes.delete(form.get('code')??'');
  const pkce=createHash('sha256').update(form.get('code_verifier')??'').digest('base64url');
  if(auth!=='leakloop-test:test-secret'||!entry||pkce!==entry.challenge){res.statusCode=400;res.end('{"error":"invalid_grant"}');return;}
  const idToken=await new SignJWT(entry.claims).setProtectedHeader({alg:'RS256',kid:'k1'}).setIssuer(base).setAudience('leakloop-test').setIssuedAt().setExpirationTime('5m').sign(entry.key);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({id_token:idToken,token_type:'Bearer'}));return;}
 res.statusCode=404;res.end();
});
await new Promise<void>(r=>idp.listen(0,'127.0.0.1',r));const issuer=`http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
Object.assign(process.env,{OIDC_ISSUER:issuer,OIDC_CLIENT_ID:'leakloop-test',OIDC_CLIENT_SECRET:'test-secret',OIDC_ALLOW_HTTP_ISSUER:'true',APP_ORIGIN:origin});resetSsoCache();
/** Simulates the browser visiting the IdP: returns callback params. */
async function ssoRound(claims:Record<string,unknown>,{key=privateKey,tamperNonce=false}={}){const {url,state}=await startSso();const q=new URL(url).searchParams;const c=randomUUID();codes.set(c,{challenge:q.get('code_challenge')!,claims:{...claims,nonce:tamperNonce?'wrong':q.get('nonce')},key});nextClaims=claims;nextKey=key;return {code:c,state};}

try{
 const manager=await makeUser('manager'),manager2=await makeUser('manager'),tech=await makeUser('technician'),operator=await makeUser('operator');

 await check('password policy rejects short, repetitive and email-derived passwords',async()=>{assert.ok(passwordProblem('short'));assert.ok(passwordProblem('aaaaaaaaaaaaaaaa'));assert.ok(passwordProblem(`${tech.email.split('@')[0]}-xyz`,tech.email));assert.equal(passwordProblem('a sufficiently long phrase'),null);});

 await check('configuration validation reports unsafe or incomplete settings',async()=>{
  assert.ok(loadConfig({AGENT_MODE:'live'}).issues.some(i=>i.includes('OPENAI_API_KEY')));
  assert.ok(loadConfig({OIDC_ISSUER:'https://idp.example'}).issues.some(i=>i.includes('together')));
  assert.ok(loadConfig({DEPLOYMENT_PROFILE:'hosted',APP_ORIGIN:'http://example.com'}).issues.some(i=>i.includes('https')));assert.ok(loadConfig({DEPLOYMENT_PROFILE:'hosted'}).issues.some(i=>i.includes('APP_ORIGIN')));assert.ok(loadConfig({DEPLOYMENT_PROFILE:'hosted',APP_ORIGIN:'https://x.example',ALLOW_DEMO_LOGIN:'true'}).issues.some(i=>i.includes('Demo')));assert.deepEqual(loadConfig({NODE_ENV:'production',APP_ORIGIN:'http://127.0.0.1:3001'}).issues,[]);assert.ok(loadConfig({APP_ORIGIN:'http://10.0.0.5:3001'}).issues.length>0);
  assert.ok(loadConfig({SESSION_HOURS:'0'}).issues.length>0);
  assert.deepEqual(loadConfig({}).issues,[]);
 });

 const invitee=`invitee-${run}@test.local`;let inviteLink='';
 await check('only managers can invite; roles come from the invitation',async()=>{
  for(const a of [tech.actor,operator.actor])await assert.rejects(()=>accounts.createInvitation(a,{email:invitee,name:'Invitee',role:'manager'},origin),code('FORBIDDEN'));
  const r=await accounts.createInvitation(manager.actor,{email:invitee,name:'Invitee',role:'technician',send:true},origin);inviteLink=r.link;assert.equal(r.delivery,'file');
  assert.ok(inviteLink.includes('#token='),'token travels in the URL fragment');
  const {rows:[row]}=await pool.query('SELECT token_hash FROM ll_invitations WHERE email=$1',[invitee]);assert.equal(row.token_hash,digest(tokenFrom(inviteLink)));
  const mail=await readFile(join(outbox,(await readdir(outbox))[0]),'utf8');assert.ok(mail.includes(tokenFrom(inviteLink)));
 });
 await check('duplicate open invitations and existing-account invitations are rejected',async()=>{
  await assert.rejects(()=>accounts.createInvitation(manager.actor,{email:invitee,name:'Again',role:'technician'},origin),code('INVITATION_EXISTS'));
  await assert.rejects(()=>accounts.createInvitation(manager.actor,{email:tech.email,name:'Again',role:'technician'},origin),code('ACCOUNT_EXISTS'));
  await assert.rejects(()=>accounts.createInvitation(manager.actor,{email:`x-${run}@test.local`,name:'Ghost',role:'technician',technicianId:'tech-nobody'},origin),code('UNKNOWN_TECHNICIAN'));
  await assert.rejects(()=>accounts.createInvitation(manager.actor,{email:`y-${run}@test.local`,name:'Ravi 2',role:'technician',technicianId:'tech-ravi'},origin),code('TECHNICIAN_LINKED'));
 });
 await check('invitation acceptance enforces password policy and is single use',async()=>{
  const token=tokenFrom(inviteLink);assert.equal((await accounts.previewInvitation(token)).role,'technician');
  await assert.rejects(()=>accounts.acceptInvitation(token,'short'),code('WEAK_PASSWORD'));
  const r=await accounts.acceptInvitation(token,'a sufficiently long phrase');created.push(r.actor.id);assert.equal(r.actor.role,'technician');assert.equal((await actorFor(r.token)).id,r.actor.id);
  await assert.rejects(()=>accounts.acceptInvitation(token,'a sufficiently long phrase'),code('INVITATION_INVALID'));
  assert.ok(!(await login(invitee,'a sufficiently long phrase')).error);
 });
 await check('expired and revoked invitations cannot be used',async()=>{
  const a=await accounts.createInvitation(manager.actor,{email:`exp-${run}@test.local`,name:'Expired',role:'operator'},origin);
  await pool.query("UPDATE ll_invitations SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(tokenFrom(a.link))]);
  await assert.rejects(()=>accounts.acceptInvitation(tokenFrom(a.link),'a sufficiently long phrase'),code('INVITATION_INVALID'));
  const b=await accounts.createInvitation(manager.actor,{email:`exp-${run}@test.local`,name:'Reissued',role:'operator'},origin);
  await accounts.revokeInvitation(manager.actor,b.invitation.id);
  await assert.rejects(()=>accounts.acceptInvitation(tokenFrom(b.link),'a sufficiently long phrase'),code('INVITATION_INVALID'));
 });

 await check('password recovery is generic, single use, and revokes existing sessions',async()=>{
  for(const f of await readdir(outbox))await rm(join(outbox,f));
  assert.deepEqual(await accounts.requestPasswordReset(`nobody-${run}@test.local`,origin),{accepted:true});
  const before=await createSession(tech.id);
  assert.deepEqual(await accounts.requestPasswordReset(tech.email,origin),{accepted:true});
  await new Promise(r=>setTimeout(r,200));const files=await readdir(outbox);assert.equal(files.length,1,'only the real account receives mail');
  const mail=await readFile(join(outbox,files[0]),'utf8');const token=mail.match(/#token=([a-f0-9]{64})/)![1];
  const second=await accounts.issueResetLink(manager.actor,tech.id,origin);
  await assert.rejects(()=>accounts.completePasswordReset(token,'another long passphrase'),code('RESET_INVALID'));// superseded by a newer link
  const r=await accounts.completePasswordReset(tokenFrom(second.link),'another long passphrase');
  assert.equal(await authenticate(before),null,'old sessions revoked');assert.ok(await authenticate(r.token));
  await assert.rejects(()=>accounts.completePasswordReset(tokenFrom(second.link),'yet another passphrase'),code('RESET_INVALID'));
  assert.ok((await login(tech.email,tech.password)).error);assert.ok(!(await login(tech.email,'another long passphrase')).error);
  tech.password='another long passphrase';
 });
 await check('expired reset links fail and non-managers cannot issue links',async()=>{
  const l=await accounts.issueResetLink(manager.actor,operator.id,origin);await pool.query("UPDATE ll_password_resets SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(tokenFrom(l.link))]);
  await assert.rejects(()=>accounts.completePasswordReset(tokenFrom(l.link),'another long passphrase'),code('RESET_INVALID'));
  await assert.rejects(()=>accounts.issueResetLink(tech.actor,operator.id,origin),code('FORBIDDEN'));
 });

 await check('password change requires the current password and signs out other sessions',async()=>{
  const a=await createSession(operator.id),b=await createSession(operator.id);const actor=await actorFor(a);
  await assert.rejects(()=>accounts.changePassword(actor,'wrong password','brand new passphrase'),code('INVALID_CREDENTIALS'));
  const r=await accounts.changePassword(actor,operator.password,'brand new passphrase');assert.ok((r.otherSessionsRevoked??0)>=1);
  assert.ok(await authenticate(a));assert.equal(await authenticate(b),null);
 });
 await check('users can list and revoke only their own sessions; managers can revoke any',async()=>{
  const mine=await actorFor(await createSession(tech.id)),theirs=await actorFor(await createSession(operator.id));
  const list=await accounts.listSessions(mine);assert.ok(list.some(s=>s.current));
  await assert.rejects(()=>accounts.revokeSessionById(mine,theirs.sessionId!),code('NOT_FOUND'));
  await assert.rejects(()=>accounts.listSessions(mine,operator.id),code('FORBIDDEN'));
  assert.ok((await accounts.revokeSessionById(await actorFor(await createSession(manager.id)),theirs.sessionId!)).revoked);
 });
 await check('idle sessions expire even before their absolute expiry',async()=>{const t=await createSession(tech.id);await pool.query("UPDATE ll_sessions SET last_seen_at=now()-interval '1 day' WHERE token_hash=$1",[digest(t)]);assert.equal(await authenticate(t),null);});
 await check('user administration blocks self-changes, protects the last manager and revokes sessions',async()=>{
  await assert.rejects(()=>accounts.updateUser(manager.actor,manager.id,{active:false}),code('SELF_CHANGE'));
  await assert.rejects(()=>accounts.updateUser(tech.actor,operator.id,{role:'manager'}),code('FORBIDDEN'));
  const s=await createSession(tech.id);await accounts.updateUser(manager.actor,tech.id,{active:false});assert.equal(await authenticate(s),null);assert.ok((await login(tech.email,tech.password)).error);
  await accounts.updateUser(manager.actor,tech.id,{active:true});
  const {rows}=await pool.query("SELECT id FROM ll_users WHERE campus_id=$1 AND role='manager' AND active AND id<>ALL($2)",[CAMPUS,[manager.id,manager2.id]]);
  await pool.query("UPDATE ll_users SET active=false WHERE id=ANY($1)",[rows.map(r=>r.id)]);
  try{await accounts.updateUser(manager.actor,manager2.id,{active:false});await assert.rejects(()=>accounts.updateUser(manager2.actor,manager.id,{role:'operator'}),code('LAST_MANAGER'));}
  finally{await pool.query("UPDATE ll_users SET active=true WHERE id=ANY($1)",[[...rows.map(r=>r.id),manager2.id]]);}
 });

 await check('SSO links a pre-provisioned account by verified email and ignores IdP role claims',async()=>{
  const p=await ssoRound({sub:`sub-${run}`,email:operator.email,email_verified:true,role:'manager',groups:['admins']});
  const r=await completeSso(p,p.state);assert.equal(r.actor.id,operator.id);assert.equal(r.actor.role,'operator');
  const again=await ssoRound({sub:`sub-${run}`,email:'changed@elsewhere.test',email_verified:false});assert.equal((await completeSso(again,again.state)).actor.id,operator.id,'subsequent logins match issuer+subject');
 });
 await check('SSO rejects state mismatch, replayed state, wrong nonce, foreign signatures and unverified emails',async()=>{
  const a=await ssoRound({sub:`x-${run}`,email:tech.email,email_verified:true});await assert.rejects(()=>completeSso(a,'f'.repeat(64)),code('SSO_FAILED'));
  const ok=await ssoRound({sub:`sub-${run}`});await completeSso(ok,ok.state);await assert.rejects(()=>completeSso(ok,ok.state),code('SSO_FAILED'));// state and code are single use
  const b=await ssoRound({sub:`x-${run}`,email:tech.email,email_verified:true},{tamperNonce:true});await assert.rejects(()=>completeSso(b,b.state),code('SSO_FAILED'));
  const c=await ssoRound({sub:`x-${run}`,email:tech.email,email_verified:true},{key:rogueKey});await assert.rejects(()=>completeSso(c,c.state),code('SSO_FAILED'));
  const d=await ssoRound({sub:`x-${run}`,email:tech.email,email_verified:false});await assert.rejects(()=>completeSso(d,d.state),code('SSO_FAILED'));
  const e=await ssoRound({sub:`x-${run}`,email:`stranger-${run}@test.local`,email_verified:true});await assert.rejects(()=>completeSso(e,e.state),code('SSO_FAILED'));
  const {rows:[u]}=await pool.query('SELECT sso_subject FROM ll_users WHERE id=$1',[tech.id]);assert.equal(u.sso_subject,null);
 });
 await check('SSO can accept an open invitation and creates a password-less account',async()=>{
  const email=`sso-invite-${run}@test.local`;await accounts.createInvitation(manager.actor,{email,name:'SSO Invitee',role:'operator'},origin);
  const p=await ssoRound({sub:`inv-${run}`,email,email_verified:true});const r=await completeSso(p,p.state);created.push(r.actor.id);assert.equal(r.actor.role,'operator');
  assert.ok((await login(email,'anything at all here')).error,'SSO-only account has no password');
  process.env.OIDC_ALLOWED_DOMAINS='corp.example';const q=await ssoRound({sub:`dom-${run}`,email:`other-${run}@test.local`,email_verified:true});await assert.rejects(()=>completeSso(q,q.state),code('SSO_FAILED'));delete process.env.OIDC_ALLOWED_DOMAINS;
 });

 await check('SMTP transport delivers through a configured server',async()=>{
  const received:string[]=[];const smtp=new SMTPServer({authOptional:true,disabledCommands:['STARTTLS'],onData(stream,_s,cb){let d='';stream.on('data',c=>d+=c);stream.on('end',()=>{received.push(d);cb();});}});
  await new Promise<void>(r=>smtp.listen(0,'127.0.0.1',r));const port=(smtp.server.address() as AddressInfo).port;
  Object.assign(process.env,{MAIL_TRANSPORT:'smtp',SMTP_URL:`smtp://127.0.0.1:${port}?ignoreTLS=true`,MAIL_FROM:'LeakLoop <noreply@test.local>'});
  try{await sendMail({to:'person@test.local',subject:'Check',text:'Hello'});assert.equal(received.length,1);assert.match(received[0],/Subject: Check/);}finally{process.env.MAIL_TRANSPORT='file';delete process.env.SMTP_URL;await new Promise<void>(r=>smtp.close(()=>r()));}
 });

 const report={passed_checks:checks.length,checks,generatedAt:new Date().toISOString(),external_services:'none (local mock OIDC provider and SMTP sink)'};
 writeFileSync('evaluation/accounts-results.json',JSON.stringify(report,null,2)+'\n');console.log(`${checks.length} account checks passed.`);
 void nextClaims;void nextKey;
}finally{
 const ids=created;
 await pool.query('DELETE FROM ll_sessions WHERE user_id=ANY($1)',[ids]);
 await pool.query('DELETE FROM ll_password_resets WHERE user_id=ANY($1) OR requested_by=ANY($1)',[ids]);
 await pool.query("DELETE FROM ll_invitations WHERE invited_by=ANY($1) OR accepted_user_id=ANY($1)",[ids]);
 await pool.query("DELETE FROM ll_login_limits WHERE key=ANY($1)",[(await pool.query('SELECT email FROM ll_users WHERE id=ANY($1)',[ids])).rows.map(r=>digest(r.email))]);
 await pool.query('UPDATE ll_users SET created_by=NULL WHERE created_by=ANY($1)',[ids]);
 await pool.query('DELETE FROM ll_users WHERE id=ANY($1)',[ids]);
 await rm(outbox,{recursive:true,force:true});idp.close();await pool.end();
}
