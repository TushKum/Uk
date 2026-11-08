'use client';
import {useCallback,useEffect,useState} from 'react';
import {KeyRound,Laptop,LogOut,RefreshCw,ShieldCheck} from 'lucide-react';
import {api,when} from './api';
import type {Actor} from '@/lib/types';

type Session={id:string;createdAt:string;lastSeenAt:string;expiresAt:string;method:string;userAgent:string|null;current:boolean};

/** Personal account settings: password change and active session management. */
export default function AccountPanel({actor,onSignedOut}:{actor:Actor;onSignedOut:()=>void}){
 const [sessions,setSessions]=useState<Session[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState('');
 const load=useCallback(async()=>{try{setSessions((await api<{data:Session[]}>('/api/account/sessions')).data);}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 async function run(fn:()=>Promise<string|void>){setBusy(true);setError('');setNotice('');try{const m=await fn();if(m)setNotice(m);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function change(e:React.FormEvent){e.preventDefault();if(next!==confirm){setError('New passwords do not match.');return;}
  await run(async()=>{const r=await api<{otherSessionsRevoked:number}>('/api/auth/password/change',{method:'POST',body:{currentPassword:current,newPassword:next}});setCurrent('');setNext('');setConfirm('');return `Password changed. ${r.otherSessionsRevoked} other session(s) signed out.`;});}
 async function revoke(s:Session){await run(async()=>{await api(`/api/account/sessions/${s.id}`,{method:'DELETE'});if(s.current){onSignedOut();return;}return 'Session signed out.';});}
 return <>
  <div className="section-title"><div><div className="breadcrumb">WORKSPACE / ACCOUNT</div><h1>Account<span className="title-dot"/></h1><p>{actor.name} · {actor.role}. Your role is assigned by a manager and enforced by the server.</p></div><div className="title-actions"><button className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={14}/>Refresh</button></div></div>
  {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
  <div className="split-grid">
   <section className="panel padded"><div className="panel-heading"><h2><KeyRound size={14}/> Change password</h2></div>
    <form onSubmit={change} className="stack-form">
     <label className="field">Current password<input type="password" autoComplete="current-password" required maxLength={256} value={current} onChange={e=>setCurrent(e.target.value)}/></label>
     <label className="field">New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={next} onChange={e=>setNext(e.target.value)}/></label>
     <label className="field">Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
     <p className="control-hint">At least 12 characters. Changing your password signs out your other sessions.</p>
     <button className="primary" disabled={busy}><ShieldCheck size={14}/>Update password</button>
    </form>
    <p className="control-hint">Single sign-on accounts without a local password cannot use this form.</p>
   </section>
   <section className="panel padded"><div className="panel-heading"><h2><Laptop size={14}/> Active sessions<span className="counter">{sessions.length.toString().padStart(2,'0')}</span></h2><button className="text-button" disabled={busy||sessions.length<2} onClick={()=>void run(async()=>{const r=await api<{revoked:number}>('/api/account/sessions/revoke-others',{method:'POST'});return `${r.revoked} other session(s) signed out.`;})}>Sign out all others</button></div>
    <div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>METHOD</th><th>LAST ACTIVE</th><th>EXPIRES</th><th/></tr></thead><tbody>
     {sessions.map(s=><tr key={s.id}><td><strong>{s.current?'This browser':'Other session'}</strong><small className="mono">{s.userAgent?.slice(0,60)??'Unknown client'}</small></td><td className="mono">{s.method}</td><td className="mono">{when(s.lastSeenAt)}</td><td className="mono">{when(s.expiresAt)}</td><td><button className="text-button" disabled={busy} onClick={()=>void revoke(s)}><LogOut size={12}/>{s.current?'Sign out':'Revoke'}</button></td></tr>)}
    </tbody></table></div>
   </section>
  </div>
 </>;
}
