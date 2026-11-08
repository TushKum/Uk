import {randomUUID} from 'node:crypto';
import {pool,type Client} from './pool';
import {transaction} from './db';
import {AppError,requireRole} from './errors';
import {config} from './config';
import {accountEvent,digest,hashPassword,insertSession,newToken,passwordProblem,verifyPassword} from './auth';
import {sendMail} from './mail';
import {logger} from './log';
import {CAMPUS} from './repository';
import type {Actor,Role} from './types';

export function appOrigin(req:{nextUrl:{origin:string}}){return config().APP_ORIGIN??req.nextUrl.origin;}
const requireManager=(actor:Actor)=>requireRole(actor.role==='manager','Manager role required');
function assertPassword(password:string,email:string){const problem=passwordProblem(password,email);if(problem)throw new AppError(400,'WEAK_PASSWORD',problem);}
// Tokens travel in the URL fragment so they are not sent to servers in Referer headers or access logs.
const inviteLink=(origin:string,token:string)=>`${origin}/account?flow=invite#token=${token}`;
const resetLink=(origin:string,token:string)=>`${origin}/account?flow=reset#token=${token}`;

// ---------- Invitations ----------
export async function createInvitation(actor:Actor,input:{email:string;name:string;role:Role;technicianId?:string;send?:boolean},origin:string){
 requireManager(actor);
 const token=newToken(),id=randomUUID();
 const result=await transaction(async db=>{
  const {rows:[existing]}=await db.query('SELECT 1 FROM ll_users WHERE email=$1',[input.email]);
  if(existing)throw new AppError(409,'ACCOUNT_EXISTS','An account already uses this email.');
  if(input.technicianId){
   if(input.role!=='technician')throw new AppError(400,'VALIDATION_ERROR','Only technician invitations can link a roster entry.');
   const {rows:[roster]}=await db.query('SELECT 1 FROM ll_technicians WHERE campus_id=$1 AND generation=(SELECT generation FROM ll_runtime WHERE campus_id=$1) AND id=$2',[CAMPUS,input.technicianId]);
   if(!roster)throw new AppError(400,'UNKNOWN_TECHNICIAN','That technician is not on the campus roster.');
   const {rows:[taken]}=await db.query("SELECT 1 FROM ll_users WHERE id=$1 UNION ALL SELECT 1 FROM ll_invitations WHERE technician_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()",[input.technicianId]);
   if(taken)throw new AppError(409,'TECHNICIAN_LINKED','That roster entry already has an account or open invitation.');
  }
  // An expired open invitation would block the unique index; retire it first.
  await db.query("UPDATE ll_invitations SET revoked_at=now() WHERE campus_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()",[CAMPUS,input.email]);
  const {rows:[open]}=await db.query('SELECT 1 FROM ll_invitations WHERE campus_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[CAMPUS,input.email]);
  if(open)throw new AppError(409,'INVITATION_EXISTS','An open invitation already exists for this email. Revoke it to issue a new one.');
  const {rows:[row]}=await db.query("INSERT INTO ll_invitations(id,campus_id,email,name,role,technician_id,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(hours=>$9)) RETURNING id,email,name,role,technician_id AS \"technicianId\",expires_at AS \"expiresAt\",created_at AS \"createdAt\"",[id,CAMPUS,input.email,input.name,input.role,input.technicianId??null,digest(token),actor.id,config().INVITATION_HOURS]);
  await accountEvent(db,'invitation_created',{actorId:actor.id,detail:{invitationId:id,role:input.role}});
  return row;
 });
 const link=inviteLink(origin,token);let delivery:string|null=null;
 if(input.send){try{delivery=(await sendMail({to:input.email,subject:'Your LeakLoop invitation',text:`${actor.name} invited you to LeakLoop as ${input.role}.\n\nSet your password within ${config().INVITATION_HOURS} hours:\n${link}\n\nIf you did not expect this, ignore this message.`})).transport;}catch(e){logger.warn('invitation_mail_failed',{invitationId:id,error:(e as Error).message});delivery='failed';}}
 return {invitation:result,link,delivery};
}
export async function listInvitations(actor:Actor){requireManager(actor);const {rows}=await pool.query(`SELECT id,email,name,role,technician_id AS "technicianId",expires_at AS "expiresAt",accepted_at AS "acceptedAt",revoked_at AS "revokedAt",created_at AS "createdAt",CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at<=now() THEN 'expired' ELSE 'open' END AS status FROM ll_invitations WHERE campus_id=$1 ORDER BY created_at DESC LIMIT 100`,[CAMPUS]);return rows;}
export async function revokeInvitation(actor:Actor,id:string){requireManager(actor);return transaction(async db=>{const {rowCount}=await db.query('UPDATE ll_invitations SET revoked_at=now() WHERE id=$1 AND campus_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[id,CAMPUS]);if(!rowCount)throw new AppError(404,'NOT_FOUND','Open invitation not found');await accountEvent(db,'invitation_revoked',{actorId:actor.id,detail:{invitationId:id}});return {revoked:true};});}
async function openInvitation(db:Client|typeof pool,token:string,lock=false){
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const {rows:[inv]}=await db.query(`SELECT * FROM ll_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ${lock?'FOR UPDATE':''}`,[digest(token)]);
 return inv??null;
}
export async function previewInvitation(token:string){const inv=await openInvitation(pool,token);if(!inv)throw new AppError(404,'INVITATION_INVALID','This invitation is invalid, expired or already used.');return {email:inv.email,name:inv.name,role:inv.role};}
export async function acceptInvitation(token:string,password:string,userAgent?:string|null){
 return transaction(async db=>{
  const inv=await openInvitation(db,token,true);if(!inv)throw new AppError(404,'INVITATION_INVALID','This invitation is invalid, expired or already used.');
  assertPassword(password,inv.email);
  const {rows:[existing]}=await db.query('SELECT 1 FROM ll_users WHERE email=$1',[inv.email]);if(existing)throw new AppError(409,'ACCOUNT_EXISTS','An account already uses this email.');
  const userId=inv.technician_id??`user-${randomUUID()}`;
  await db.query('INSERT INTO ll_users(id,campus_id,email,name,role,password_hash,password_changed_at,created_by) VALUES($1,$2,$3,$4,$5,$6,now(),$7)',[userId,inv.campus_id,inv.email,inv.name,inv.role,await hashPassword(password),inv.invited_by]);
  await db.query('UPDATE ll_invitations SET accepted_at=now(),accepted_user_id=$2 WHERE id=$1',[inv.id,userId]);
  await accountEvent(db,'invitation_accepted',{campusId:inv.campus_id,actorId:userId,subjectId:userId,detail:{invitationId:inv.id}});
  const session=await insertSession(db,userId,'invitation',userAgent);
  return {token:session,actor:{id:userId,name:inv.name,role:inv.role,campusId:inv.campus_id} as Actor};
 });
}

// ---------- Password recovery ----------
async function createReset(db:Client,userId:string,requestedBy:string|null){
 await db.query('UPDATE ll_password_resets SET invalidated_at=now() WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[userId]);
 const token=newToken();
 await db.query('INSERT INTO ll_password_resets(id,token_hash,user_id,requested_by,expires_at) VALUES($1,$2,$3,$4,now()+make_interval(mins=>$5))',[randomUUID(),digest(token),userId,requestedBy,config().PASSWORD_RESET_MINUTES]);
 return token;
}
/** Always resolves the same way whether or not the email exists, to avoid account enumeration. */
export async function requestPasswordReset(email:string,origin:string){
 const c=config();if(!c.PASSWORD_LOGIN||c.MAIL_TRANSPORT==='disabled')throw new AppError(403,'RECOVERY_DISABLED','Self-service recovery is disabled. Ask a manager for a reset link.');
 const issued=await transaction(async db=>{
  const {rows:[user]}=await db.query('SELECT id,campus_id FROM ll_users WHERE email=$1 AND active',[email]);if(!user)return null;
  const {rows:[recent]}=await db.query("SELECT count(*)::int n FROM ll_password_resets WHERE user_id=$1 AND created_at>now()-interval '1 hour' AND requested_by IS NULL",[user.id]);
  if(recent.n>=3)return null;
  const token=await createReset(db,user.id,null);await accountEvent(db,'password_reset_requested',{campusId:user.campus_id,subjectId:user.id});return token;
 });
 if(issued)void sendMail({to:email,subject:'Reset your LeakLoop password',text:`A password reset was requested for your LeakLoop account.\n\nThis link works once and expires in ${c.PASSWORD_RESET_MINUTES} minutes:\n${resetLink(origin,issued)}\n\nIf you did not request this, ignore this message; your password is unchanged.`}).catch(e=>logger.warn('reset_mail_failed',{error:(e as Error).message}));
 return {accepted:true};
}
export async function issueResetLink(actor:Actor,userId:string,origin:string){
 requireManager(actor);
 return transaction(async db=>{
  const {rows:[user]}=await db.query('SELECT id FROM ll_users WHERE id=$1 AND campus_id=$2 AND active',[userId,CAMPUS]);if(!user)throw new AppError(404,'NOT_FOUND','Active user not found');
  const token=await createReset(db,userId,actor.id);await accountEvent(db,'password_reset_issued',{actorId:actor.id,subjectId:userId});
  return {link:resetLink(origin,token),expiresInMinutes:config().PASSWORD_RESET_MINUTES};
 });
}
export async function completePasswordReset(token:string,password:string,userAgent?:string|null){
 if(!/^[a-f0-9]{64}$/.test(token))throw new AppError(400,'RESET_INVALID','This reset link is invalid or expired.');
 return transaction(async db=>{
  const {rows:[reset]}=await db.query('SELECT r.id,r.user_id,u.email,u.name,u.role,u.campus_id FROM ll_password_resets r JOIN ll_users u ON u.id=r.user_id WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.invalidated_at IS NULL AND r.expires_at>now() AND u.active FOR UPDATE OF r',[digest(token)]);
  if(!reset)throw new AppError(400,'RESET_INVALID','This reset link is invalid or expired.');
  assertPassword(password,reset.email);
  await db.query('UPDATE ll_users SET password_hash=$2,password_changed_at=now(),updated_at=now() WHERE id=$1',[reset.user_id,await hashPassword(password)]);
  await db.query('UPDATE ll_password_resets SET used_at=now() WHERE id=$1',[reset.id]);
  await db.query("UPDATE ll_sessions SET revoked_at=now(),revoked_reason='password reset' WHERE user_id=$1 AND revoked_at IS NULL",[reset.user_id]);
  await db.query('DELETE FROM ll_login_limits WHERE key=$1',[digest(reset.email)]);
  await accountEvent(db,'password_reset_completed',{campusId:reset.campus_id,actorId:reset.user_id,subjectId:reset.user_id});
  const session=await insertSession(db,reset.user_id,'reset',userAgent);
  return {token:session,actor:{id:reset.user_id,name:reset.name,role:reset.role,campusId:reset.campus_id} as Actor};
 });
}
export async function changePassword(actor:Actor,current:string,next:string){
 return transaction(async db=>{
  const {rows:[user]}=await db.query('SELECT email,password_hash FROM ll_users WHERE id=$1 FOR UPDATE',[actor.id]);
  if(!user?.password_hash||!await verifyPassword(current,user.password_hash))throw new AppError(400,'INVALID_CREDENTIALS','Current password is incorrect.');
  assertPassword(next,user.email);
  await db.query('UPDATE ll_users SET password_hash=$2,password_changed_at=now(),updated_at=now() WHERE id=$1',[actor.id,await hashPassword(next)]);
  const {rowCount}=await db.query("UPDATE ll_sessions SET revoked_at=now(),revoked_reason='password changed' WHERE user_id=$1 AND revoked_at IS NULL AND id<>$2",[actor.id,actor.sessionId??'00000000-0000-0000-0000-000000000000']);
  await accountEvent(db,'password_changed',{actorId:actor.id,subjectId:actor.id,detail:{otherSessionsRevoked:rowCount}});
  return {changed:true,otherSessionsRevoked:rowCount};
 });
}

// ---------- Sessions ----------
export async function listSessions(actor:Actor,userId=actor.id){
 if(userId!==actor.id)requireManager(actor);
 const {rows}=await pool.query(`SELECT s.id,s.created_at AS "createdAt",s.last_seen_at AS "lastSeenAt",s.expires_at AS "expiresAt",s.auth_method AS method,s.user_agent AS "userAgent" FROM ll_sessions s JOIN ll_users u ON u.id=s.user_id WHERE s.user_id=$1 AND u.campus_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-make_interval(mins=>$3) ORDER BY s.last_seen_at DESC LIMIT 50`,[userId,CAMPUS,config().SESSION_IDLE_MINUTES]);
 return rows.map(r=>({...r,current:r.id===actor.sessionId}));
}
export async function revokeSessionById(actor:Actor,sessionId:string){
 return transaction(async db=>{
  const {rows:[row]}=await db.query('SELECT s.user_id FROM ll_sessions s JOIN ll_users u ON u.id=s.user_id WHERE s.id=$1 AND u.campus_id=$2 AND s.revoked_at IS NULL',[sessionId,CAMPUS]);
  // A non-manager probing another user's session receives the same 404 as a missing session.
  if(!row||(row.user_id!==actor.id&&actor.role!=='manager'))throw new AppError(404,'NOT_FOUND','Session not found');
  await db.query("UPDATE ll_sessions SET revoked_at=now(),revoked_reason=$2 WHERE id=$1",[sessionId,row.user_id===actor.id?'revoked by user':'revoked by manager']);
  await accountEvent(db,'session_revoked',{actorId:actor.id,subjectId:row.user_id,detail:{sessionId}});
  return {revoked:true,current:sessionId===actor.sessionId};
 });
}
export async function revokeOtherSessions(actor:Actor){const {rowCount}=await pool.query("UPDATE ll_sessions SET revoked_at=now(),revoked_reason='signed out elsewhere' WHERE user_id=$1 AND revoked_at IS NULL AND id<>$2",[actor.id,actor.sessionId??'00000000-0000-0000-0000-000000000000']);await accountEvent(pool,'sessions_revoked_others',{actorId:actor.id,subjectId:actor.id,detail:{count:rowCount}});return {revoked:rowCount};}

// ---------- User administration (manager) ----------
export async function listUsers(actor:Actor){requireManager(actor);const {rows}=await pool.query(`SELECT u.id,u.email,u.name,u.role,u.active,u.created_at AS "createdAt",u.password_hash IS NOT NULL AS "hasPassword",u.sso_subject IS NOT NULL AS "ssoLinked",(SELECT count(*)::int FROM ll_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-make_interval(mins=>$2)) AS "activeSessions" FROM ll_users u WHERE u.campus_id=$1 ORDER BY u.role,u.name`,[CAMPUS,config().SESSION_IDLE_MINUTES]);return rows;}
export async function updateUser(actor:Actor,userId:string,change:{role?:Role;active?:boolean}){
 requireManager(actor);
 if(userId===actor.id)throw new AppError(409,'SELF_CHANGE','You cannot change your own role or access. Ask another manager.');
 return transaction(async db=>{
  const {rows:[user]}=await db.query('SELECT id,role,active FROM ll_users WHERE id=$1 AND campus_id=$2 FOR UPDATE',[userId,CAMPUS]);if(!user)throw new AppError(404,'NOT_FOUND','User not found');
  const role=change.role??user.role,active=change.active??user.active;
  if((user.role==='manager'&&role!=='manager')||(user.role==='manager'&&!active)){const {rows:[m]}=await db.query("SELECT count(*)::int n FROM ll_users WHERE campus_id=$1 AND role='manager' AND active AND id<>$2",[CAMPUS,userId]);if(m.n<1)throw new AppError(409,'LAST_MANAGER','At least one active manager is required.');}
  await db.query('UPDATE ll_users SET role=$2,active=$3,updated_at=now() WHERE id=$1',[userId,role,active]);
  if(!active||role!==user.role)await db.query("UPDATE ll_sessions SET revoked_at=now(),revoked_reason='access changed' WHERE user_id=$1 AND revoked_at IS NULL",[userId]);
  await accountEvent(db,'user_updated',{actorId:actor.id,subjectId:userId,detail:{from:{role:user.role,active:user.active},to:{role,active}}});
  return {id:userId,role,active};
 });
}
export async function accountEvents(actor:Actor,limit=100){requireManager(actor);const {rows}=await pool.query('SELECT id,actor_id AS "actorId",subject_user_id AS "subjectId",event,detail,created_at AS "createdAt" FROM ll_account_events WHERE campus_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',[CAMPUS,limit]);return rows.map(r=>({...r,id:String(r.id)}));}
