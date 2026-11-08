'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,Loader2,ShieldCheck} from 'lucide-react';
import {api} from '../components/api';

type Flow='invite'|'reset'|'forgot'|'sso-error';
const ssoMessages:Record<string,string>={SSO_FAILED:'Single sign-on could not be completed. If you do not yet have a LeakLoop account, ask a manager for an invitation.',SSO_DISABLED:'Single sign-on is not configured for this workspace.',SSO_UNAVAILABLE:'The identity provider is unavailable. Try again shortly.',SSO_MISCONFIGURED:'Single sign-on is misconfigured. Contact your administrator.'};

/** Public account flows: accept an invitation, reset a password, request recovery. */
export default function AccountFlows(){
 const [flow,setFlow]=useState<Flow|null>(null),[token,setToken]=useState(''),[code,setCode]=useState('');
 const [invite,setInvite]=useState<{email:string;name:string;role:string}|null>(null);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 useEffect(()=>{
  const q=new URLSearchParams(window.location.search);const f=(q.get('flow')??'forgot') as Flow;setFlow(['invite','reset','forgot','sso-error'].includes(f)?f:'forgot');setCode(q.get('code')??'');
  const t=new URLSearchParams(window.location.hash.slice(1)).get('token')??'';
  // Remove the secret from the address bar and history as soon as it has been read.
  if(window.location.hash)window.history.replaceState({},'',`${window.location.pathname}${window.location.search}`);
  setToken(t);
  if(f==='invite'&&t)api<{invitation:{email:string;name:string;role:string}}>('/api/auth/invitations/preview',{method:'POST',body:{token:t}}).then(r=>setInvite(r.invitation)).catch(e=>setError((e as Error).message));
 },[]);
 async function submit(e:React.FormEvent){
  e.preventDefault();setError('');
  if(flow!=='forgot'&&password!==confirm){setError('Passwords do not match.');return;}
  setBusy(true);
  try{
   if(flow==='forgot'){const r=await api<{message:string}>('/api/auth/password/forgot',{method:'POST',body:{email}});setDone(r.message);}
   else{await api(flow==='invite'?'/api/auth/invitations/accept':'/api/auth/password/reset',{method:'POST',body:{token,password}});setPassword('');setConfirm('');window.location.assign('/?view=overview');}
  }catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 const title=flow==='invite'?<>Accept your<br/>invitation.</>:flow==='reset'?<>Choose a new<br/>password.</>:flow==='sso-error'?<>Sign-in<br/>not completed.</>:<>Recover<br/>your access.</>;
 return <main className="login-page"><section className="login-brand"><span className="sim-badge">SIMULATION / FICTIONAL CAMPUS</span><h1>LEAK<br/>LOOP.</h1><p>Campus water operations.<br/>Evidence before action.</p></section>
  <form className="login-form" onSubmit={submit}><span className="eyebrow">EVERGREEN CAMPUS / ACCOUNT</span><h2>{title}</h2>
   {error&&<div className="notice error" role="alert">{error}</div>}
   {done&&<div className="notice" role="status">{done}</div>}
   {flow==='sso-error'&&<p>{ssoMessages[code]??ssoMessages.SSO_FAILED}</p>}
   {flow==='invite'&&invite&&<p>{invite.name} · {invite.email} · role <strong>{invite.role}</strong>. Your role was set by the manager who invited you.</p>}
   {(flow==='invite'||flow==='reset')&&!token&&<p>This link is incomplete. Open the full link you received, or ask a manager for a new one.</p>}
   {flow==='forgot'&&!done&&<><p>Enter your account email. If an active account uses it, a single-use reset link will be delivered through the workspace’s configured mail transport.</p><label className="field">Email<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label></>}
   {(flow==='invite'||flow==='reset')&&token&&(flow==='reset'||invite)&&<><label className="field">New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="field">Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><p className="control-hint">At least 12 characters. Resetting signs out every existing session.</p></>}
   {((flow==='forgot'&&!done)||((flow==='invite'&&invite)||flow==='reset')&&token)&&<button className="primary full" disabled={busy}>{busy?<Loader2 size={15} className="spin"/>:<ShieldCheck size={15}/>}{flow==='forgot'?'Send reset link':flow==='invite'?'Create account':'Set password'}<ArrowRight size={14}/></button>}
   <a className="text-button" href="/">Back to sign in</a>
  </form></main>;
}
