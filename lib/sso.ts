import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify,type JWTPayload} from 'jose';
import {transaction} from './db';
import {AppError} from './errors';
import {config,ssoEnabled} from './config';
import {accountEvent,digest,insertSession,newToken} from './auth';
import {logger} from './log';
import type {Actor} from './types';

// OpenID Connect authorization-code flow with PKCE, state and nonce.
// Roles are NEVER taken from identity-provider claims: a LeakLoop account must
// already exist (or be invited) and its role stays server-managed.
export const OIDC_COOKIE='leakloop_oidc';
type Discovery={issuer:string;authorization_endpoint:string;token_endpoint:string;jwks_uri:string;token_endpoint_auth_methods_supported?:string[];id_token_signing_alg_values_supported?:string[]};
let cached:{issuer:string;at:number;doc:Discovery;jwks:ReturnType<typeof createRemoteJWKSet>}|null=null;
const b64url=(b:Buffer)=>b.toString('base64url');

export function redirectUri(){const c=config();return c.OIDC_REDIRECT_URI??`${c.APP_ORIGIN}/api/auth/sso/callback`;}
async function discover(){
 const c=config();if(!ssoEnabled(c))throw new AppError(404,'SSO_DISABLED','Single sign-on is not configured.');
 const issuer=c.OIDC_ISSUER!;
 if(cached&&cached.issuer===issuer&&Date.now()-cached.at<600000)return cached;
 const res=await fetch(`${issuer}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(5000)});
 if(!res.ok)throw new AppError(502,'SSO_UNAVAILABLE','The identity provider is unavailable.');
 const doc=await res.json() as Discovery;
 if(doc.issuer?.replace(/\/$/,'')!==issuer)throw new AppError(502,'SSO_MISCONFIGURED','Identity provider issuer does not match OIDC_ISSUER.');
 for(const key of ['authorization_endpoint','token_endpoint','jwks_uri'] as const)if(typeof doc[key]!=='string')throw new AppError(502,'SSO_MISCONFIGURED',`Identity provider discovery is missing ${key}.`);
 cached={issuer,at:Date.now(),doc,jwks:createRemoteJWKSet(new URL(doc.jwks_uri))};return cached;
}
export function resetSsoCache(){cached=null;}

export async function startSso(){
 const {doc}=await discover();const c=config();
 const state=newToken(),nonce=newToken(),verifier=b64url(randomBytes(32));
 const challenge=b64url(createHash('sha256').update(verifier).digest());
 await transaction(async db=>{await db.query("DELETE FROM ll_oidc_states WHERE expires_at<now()");await db.query("INSERT INTO ll_oidc_states(state_hash,nonce,code_verifier,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",[digest(state),nonce,verifier]);});
 const url=new URL(doc.authorization_endpoint);
 url.search=new URLSearchParams({response_type:'code',client_id:c.OIDC_CLIENT_ID!,redirect_uri:redirectUri(),scope:c.OIDC_SCOPES??'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return {url:url.toString(),state};
}

function sameToken(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
const fail=(message='Single sign-on could not be completed. Try again.')=>new AppError(401,'SSO_FAILED',message);

export async function completeSso(params:{code?:string|null;state?:string|null;error?:string|null},cookieState:string|undefined,userAgent?:string|null):Promise<{token:string;actor:Actor}>{
 if(params.error)throw fail('Sign-in was cancelled or refused by the identity provider.');
 if(!params.code||!params.state||!cookieState||!/^[a-f0-9]{64}$/.test(params.state)||!sameToken(params.state,cookieState))throw fail();
 const {doc,jwks}=await discover();const c=config();
 const flow=await transaction(async db=>(await db.query('DELETE FROM ll_oidc_states WHERE state_hash=$1 AND expires_at>now() RETURNING nonce,code_verifier',[digest(params.state!)])).rows[0]);
 if(!flow)throw fail('Sign-in link expired. Start again.');
 const body=new URLSearchParams({grant_type:'authorization_code',code:params.code,redirect_uri:redirectUri(),code_verifier:flow.code_verifier});
 const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'};
 const methods=doc.token_endpoint_auth_methods_supported??['client_secret_basic'];
 if(methods.includes('client_secret_basic'))headers.Authorization=`Basic ${Buffer.from(`${encodeURIComponent(c.OIDC_CLIENT_ID!)}:${encodeURIComponent(c.OIDC_CLIENT_SECRET!)}`).toString('base64')}`;
 else{body.set('client_id',c.OIDC_CLIENT_ID!);body.set('client_secret',c.OIDC_CLIENT_SECRET!);}
 const res=await fetch(doc.token_endpoint,{method:'POST',headers,body,signal:AbortSignal.timeout(8000)});
 if(!res.ok){logger.warn('sso_token_exchange_failed',{status:res.status});throw fail();}
 const tokens=await res.json() as {id_token?:string};if(!tokens.id_token)throw fail();
 let claims:JWTPayload&{email?:string;email_verified?:boolean;nonce?:string;name?:string};
 try{({payload:claims}=await jwtVerify(tokens.id_token,jwks,{issuer:doc.issuer,audience:c.OIDC_CLIENT_ID!,algorithms:['RS256','PS256','ES256','EdDSA'],clockTolerance:60}));}
 catch(e){logger.warn('sso_id_token_rejected',{reason:(e as Error).name});throw fail();}
 if(!claims.nonce||!sameToken(String(claims.nonce),flow.nonce)||!claims.sub)throw fail();
 const issuer=doc.issuer,subject=claims.sub;
 const email=typeof claims.email==='string'?claims.email.toLowerCase():null;
 const verifiedEmail=email&&claims.email_verified===true?email:null;
 const domains=(c.OIDC_ALLOWED_DOMAINS??'').split(',').map(d=>d.trim().toLowerCase()).filter(Boolean);
 const domainOk=!verifiedEmail||!domains.length||domains.includes(verifiedEmail.split('@')[1]);
 return transaction(async db=>{
  let {rows:[user]}=await db.query('SELECT * FROM ll_users WHERE sso_issuer=$1 AND sso_subject=$2',[issuer,subject]);
  if(!user&&verifiedEmail&&domainOk){
   ({rows:[user]}=await db.query('SELECT * FROM ll_users WHERE email=$1 AND sso_subject IS NULL FOR UPDATE',[verifiedEmail]));
   if(user){await db.query('UPDATE ll_users SET sso_issuer=$2,sso_subject=$3,updated_at=now() WHERE id=$1',[user.id,issuer,subject]);await accountEvent(db,'sso_identity_linked',{campusId:user.campus_id,actorId:user.id,subjectId:user.id,detail:{issuer}});}
   else{
    const {rows:[inv]}=await db.query('SELECT * FROM ll_invitations WHERE email=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[verifiedEmail]);
    if(inv){const id=inv.technician_id??`user-${randomUUID()}`;({rows:[user]}=await db.query('INSERT INTO ll_users(id,campus_id,email,name,role,password_hash,sso_issuer,sso_subject,created_by) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8) RETURNING *',[id,inv.campus_id,verifiedEmail,inv.name,inv.role,issuer,subject,inv.invited_by]));await db.query('UPDATE ll_invitations SET accepted_at=now(),accepted_user_id=$2 WHERE id=$1',[inv.id,id]);await accountEvent(db,'invitation_accepted',{campusId:inv.campus_id,actorId:id,subjectId:id,detail:{invitationId:inv.id,method:'sso'}});}
   }
  }
  if(!user||!user.active){logger.info('sso_no_account',{issuer});throw fail('No active LeakLoop account matches this identity. Ask a manager for an invitation.');}
  const token=await insertSession(db,user.id,'sso',userAgent);
  await accountEvent(db,'login',{campusId:user.campus_id,actorId:user.id,subjectId:user.id,detail:{method:'sso'}});
  return {token,actor:{id:user.id,name:user.name,role:user.role,campusId:user.campus_id}};
 });
}
