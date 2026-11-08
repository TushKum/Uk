import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {pool} from './pool';
import {transaction} from './db';
import {AppError} from './errors';
import {config} from './config';
import type {Actor} from './types';
import type {Client} from './pool';
const derive=promisify(scrypt);
export const SESSION_COOKIE='leakloop_session';
export const identities:Record<string,Actor>={manager:{role:'manager',id:'manager-ava',name:'Ava Morgan'},ravi:{role:'technician',id:'tech-ravi',name:'Ravi Shah'},maya:{role:'technician',id:'tech-maya',name:'Maya Iyer'},operator:{role:'operator',id:'operator-demo',name:'Demo operator'}};
export type AuthMethod='password'|'sso'|'demo'|'invitation'|'reset';
export const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export const newToken=()=>randomBytes(32).toString('hex');
export async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,64) as Buffer;return `scrypt$${salt}$${key.toString('hex')}`;}
export async function verifyPassword(password:string,encoded:string){const [method,salt,hex]=encoded.split('$');if(method!=='scrypt'||!salt||!/^[a-f0-9]{128}$/.test(hex??''))return false;const expected=Buffer.from(hex,'hex');const actual=await derive(password,salt,64) as Buffer;return timingSafeEqual(actual,expected);}
/** Password policy shared by invitation acceptance, recovery and password change. */
export function passwordProblem(password:string,email?:string):string|null{
 if(password.length<12)return 'Use at least 12 characters.';
 if(password.length>256)return 'Use at most 256 characters.';
 if(new Set(password).size<5)return 'Use a less repetitive password.';
 const local=email?.split('@')[0]?.toLowerCase();
 if(local&&local.length>=3&&password.toLowerCase().includes(local))return 'The password must not contain your email name.';
 return null;
}
export function sameOrigin(req:{headers:Headers}){try{const origin=new URL(req.headers.get('origin')??'');if(!['http:','https:'].includes(origin.protocol))return false;const configured=config().APP_ORIGIN;if(configured)return origin.origin===new URL(configured).origin;return origin.host===req.headers.get('host');}catch{return false;}}
export function demoEnabled(){return process.env.AUTH_MODE==='demo'&&process.env.ALLOW_DEMO_LOGIN==='true'&&process.env.NODE_ENV!=='production';}
export function cookieOptions(req:{nextUrl:{protocol:string}},maxAge=config().SESSION_HOURS*3600){const mode=config().COOKIE_SECURE;const secure=mode==='true'||(mode==='auto'&&(req.nextUrl.protocol==='https:'||!!config().APP_ORIGIN?.startsWith('https:')));return {httpOnly:true,sameSite:'strict' as const,secure,path:'/',maxAge};}
export async function authenticate(token?:string):Promise<Actor|null>{
 if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 const idle=config().SESSION_IDLE_MINUTES;
 const {rows:[u]}=await pool.query(`SELECT u.id,u.name,u.role,u.campus_id,s.id AS session_id,s.last_seen_at<now()-interval '1 minute' AS stale FROM ll_sessions s JOIN ll_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-make_interval(mins=>$2) AND u.active`,[digest(token),idle]);
 if(!u)return null;
 if(u.stale)await pool.query('UPDATE ll_sessions SET last_seen_at=now() WHERE id=$1',[u.session_id]);
 return {id:u.id,name:u.name,role:u.role,campusId:u.campus_id,sessionId:u.session_id};
}
export async function insertSession(db:Client|typeof pool,userId:string,method:AuthMethod='password',userAgent?:string|null){const token=newToken();await db.query("INSERT INTO ll_sessions(token_hash,user_id,expires_at,auth_method,user_agent) VALUES($1,$2,now()+make_interval(hours=>$3),$4,$5)",[digest(token),userId,config().SESSION_HOURS,method,userAgent?userAgent.slice(0,200):null]);return token;}
export async function createSession(userId:string,method:AuthMethod='password',userAgent?:string|null){return insertSession(pool,userId,method,userAgent);}
export async function revokeSession(token?:string){if(token)await pool.query("UPDATE ll_sessions SET revoked_at=now(),revoked_reason='signed out' WHERE token_hash=$1 AND revoked_at IS NULL",[digest(token)]);}
export async function accountEvent(db:Client|typeof pool,event:string,{campusId='evergreen',actorId=null,subjectId=null,detail={}}:{campusId?:string;actorId?:string|null;subjectId?:string|null;detail?:Record<string,unknown>}={}){await db.query('INSERT INTO ll_account_events(campus_id,actor_id,subject_user_id,event,detail) VALUES($1,$2,$3,$4,$5)',[campusId,actorId,subjectId,event,detail]);}
const dummyHash='scrypt$11223344556677889900aabbccddeeff$'+'00'.repeat(64);
export async function login(email:string,password:string,userAgent?:string|null){
 return transaction(async db=>{
  const key=digest(email.toLowerCase());await db.query('INSERT INTO ll_login_limits(key) VALUES($1) ON CONFLICT DO NOTHING',[key]);
  const {rows:[limit]}=await db.query('SELECT * FROM ll_login_limits WHERE key=$1 FOR UPDATE',[key]);
  if(limit.locked_until&&new Date(limit.locked_until).getTime()>Date.now())return {error:new AppError(429,'LOGIN_THROTTLED','Too many attempts. Try again in 15 minutes.')};
  const {rows:[user]}=await db.query('SELECT * FROM ll_users WHERE email=$1',[email.toLowerCase()]);
  // SSO-only accounts have no password hash; compare against a dummy hash to keep timing uniform.
  const valid=await verifyPassword(password,user?.password_hash??dummyHash)&&!!user?.password_hash;
  if(!valid||!user?.active){
   await db.query(`UPDATE ll_login_limits SET failures=CASE WHEN window_at<now()-interval '15 minutes' THEN 1 ELSE failures+1 END,window_at=CASE WHEN window_at<now()-interval '15 minutes' THEN now() ELSE window_at END,locked_until=CASE WHEN window_at>=now()-interval '15 minutes' AND failures>=4 THEN now()+interval '15 minutes' ELSE NULL END WHERE key=$1`,[key]);
   if(user)await accountEvent(db,'login_failed',{campusId:user.campus_id,subjectId:user.id});
   return {error:new AppError(401,'INVALID_CREDENTIALS','Email or password is incorrect.')};
  }
  await db.query('UPDATE ll_login_limits SET failures=0,locked_until=NULL,window_at=now() WHERE key=$1',[key]);
  const token=await insertSession(db,user.id,'password',userAgent);
  await accountEvent(db,'login',{campusId:user.campus_id,actorId:user.id,subjectId:user.id,detail:{method:'password'}});
  return {token,actor:{id:user.id,name:user.name,role:user.role,campusId:user.campus_id} as Actor};
 });
}
export async function rateLimit(key:string,maximum=120){const {rows:[row]}=await pool.query(`INSERT INTO ll_rate_limits(key,count) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ll_rate_limits.window_at<now()-interval '1 minute' THEN 1 ELSE ll_rate_limits.count+1 END,window_at=CASE WHEN ll_rate_limits.window_at<now()-interval '1 minute' THEN now() ELSE ll_rate_limits.window_at END RETURNING count`,[key]);if(row.count>maximum)throw new AppError(429,'RATE_LIMITED','Too many requests. Try again in one minute.');}
/** Best-effort client address for rate limiting only (never stored). Trust X-Forwarded-For only behind a configured proxy. */
export function clientKey(req:{headers:Headers}){const forwarded=process.env.TRUST_PROXY==='true'?(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('x-real-ip')):null;return digest(forwarded||'direct').slice(0,24);}
