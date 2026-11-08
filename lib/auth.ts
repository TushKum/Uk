import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {pool} from './pool';
import {transaction} from './db';
import {AppError} from './errors';
import type {Actor} from './types';
const derive=promisify(scrypt);
export const SESSION_COOKIE='leakloop_session';
export const identities:Record<string,Actor>={manager:{role:'manager',id:'manager-ava',name:'Ava Morgan'},ravi:{role:'technician',id:'tech-ravi',name:'Ravi Shah'},maya:{role:'technician',id:'tech-maya',name:'Maya Iyer'},operator:{role:'operator',id:'operator-demo',name:'Demo operator'}};
export const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,64) as Buffer;return `scrypt$${salt}$${key.toString('hex')}`;}
export async function verifyPassword(password:string,encoded:string){const [method,salt,hex]=encoded.split('$');if(method!=='scrypt'||!salt||!/^[a-f0-9]{128}$/.test(hex??''))return false;const expected=Buffer.from(hex,'hex');const actual=await derive(password,salt,64) as Buffer;return timingSafeEqual(actual,expected);}
export function sameOrigin(req:{headers:Headers}){try{const origin=new URL(req.headers.get('origin')??'');return ['http:','https:'].includes(origin.protocol)&&origin.host===req.headers.get('host');}catch{return false;}}
export function demoEnabled(){return process.env.AUTH_MODE==='demo'&&process.env.ALLOW_DEMO_LOGIN==='true'&&process.env.NODE_ENV!=='production';}
export async function authenticate(token?:string):Promise<Actor|null>{if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const {rows:[u]}=await pool.query(`SELECT u.id,u.name,u.role,u.campus_id FROM ll_sessions s JOIN ll_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active`,[digest(token)]);return u?{id:u.id,name:u.name,role:u.role,campusId:u.campus_id}:null;}
export async function createSession(userId:string){const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO ll_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[digest(token),userId]);return token;}
export async function revokeSession(token?:string){if(token)await pool.query('UPDATE ll_sessions SET revoked_at=now() WHERE token_hash=$1',[digest(token)]);}
const dummyHash='scrypt$11223344556677889900aabbccddeeff$'+'00'.repeat(64);
export async function login(email:string,password:string){
 return transaction(async db=>{
  const key=digest(email.toLowerCase());await db.query('INSERT INTO ll_login_limits(key) VALUES($1) ON CONFLICT DO NOTHING',[key]);
  const {rows:[limit]}=await db.query('SELECT * FROM ll_login_limits WHERE key=$1 FOR UPDATE',[key]);
  if(limit.locked_until&&new Date(limit.locked_until).getTime()>Date.now())return {error:new AppError(429,'LOGIN_THROTTLED','Too many attempts. Try again in 15 minutes.')};
  const {rows:[user]}=await db.query('SELECT * FROM ll_users WHERE email=$1',[email.toLowerCase()]);
  const valid=await verifyPassword(password,user?.password_hash??dummyHash);
  if(!valid||!user?.active){
   await db.query(`UPDATE ll_login_limits SET failures=CASE WHEN window_at<now()-interval '15 minutes' THEN 1 ELSE failures+1 END,window_at=CASE WHEN window_at<now()-interval '15 minutes' THEN now() ELSE window_at END,locked_until=CASE WHEN window_at>=now()-interval '15 minutes' AND failures>=4 THEN now()+interval '15 minutes' ELSE NULL END WHERE key=$1`,[key]);
   return {error:new AppError(401,'INVALID_CREDENTIALS','Email or password is incorrect.')};
  }
  await db.query('UPDATE ll_login_limits SET failures=0,locked_until=NULL,window_at=now() WHERE key=$1',[key]);
  const token=randomBytes(32).toString('hex');await db.query("INSERT INTO ll_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[digest(token),user.id]);
  return {token,actor:{id:user.id,name:user.name,role:user.role,campusId:user.campus_id} as Actor};
 });
}
export async function rateLimit(key:string,maximum=120){const {rows:[row]}=await pool.query(`INSERT INTO ll_rate_limits(key,count) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ll_rate_limits.window_at<now()-interval '1 minute' THEN 1 ELSE ll_rate_limits.count+1 END,window_at=CASE WHEN ll_rate_limits.window_at<now()-interval '1 minute' THEN now() ELSE ll_rate_limits.window_at END RETURNING count`,[key]);if(row.count>maximum)throw new AppError(429,'RATE_LIMITED','Too many requests. Try again in one minute.');}
