'use client';
import {useCallback,useEffect,useState} from 'react';
import {Copy,KeyRound,MailPlus,RefreshCw,ShieldAlert,UserX,UserCheck,X} from 'lucide-react';
import {api,when} from './api';
import type {Actor,Role} from '@/lib/types';

type User={id:string;email:string;name:string;role:Role;active:boolean;hasPassword:boolean;ssoLinked:boolean;activeSessions:number};
type Invitation={id:string;email:string;name:string;role:Role;technicianId:string|null;status:string;expiresAt:string;createdAt:string};
type Event={id:string;actorId:string|null;subjectId:string|null;event:string;detail:Record<string,unknown>;createdAt:string};

/** Manager-only people administration. The server re-checks every action. */
export function PeopleAdmin({actor,technicians}:{actor:Actor;technicians:{id:string;name:string}[]}){
 const [users,setUsers]=useState<User[]>([]),[invites,setInvites]=useState<Invitation[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [link,setLink]=useState<{label:string;url:string}|null>(null);
 const [form,setForm]=useState({email:'',name:'',role:'technician' as Role,technicianId:'',send:false});
 const load=useCallback(async()=>{try{const [u,i]=await Promise.all([api<{data:User[]}>('/api/v1/admin/users'),api<{data:Invitation[]}>('/api/v1/admin/invitations')]);setUsers(u.data);setInvites(i.data);}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const linked=new Set([...users.map(u=>u.id),...invites.filter(i=>i.status==='open').map(i=>i.technicianId)]);
 async function invite(e:React.FormEvent){e.preventDefault();await run(async()=>{const r=await api<{link:string;delivery:string|null}>('/api/v1/admin/invitations',{method:'POST',body:{email:form.email,name:form.name,role:form.role,...(form.role==='technician'&&form.technicianId?{technicianId:form.technicianId}:{}),send:form.send}});setLink({label:`Invitation for ${form.email}${r.delivery?` · email ${r.delivery==='file'?'written to local outbox':r.delivery}`:''}`,url:r.link});setForm({email:'',name:'',role:'technician',technicianId:'',send:false});});}
 return <>
  {error&&<div className="notice error" role="alert">{error}</div>}
  {link&&<div className="notice" role="status"><KeyRound size={15}/><div><strong>{link.label}</strong><p className="mono one-time-link">{link.url}</p><small>Shown once. Share it privately; it expires and works only once.</small></div><button aria-label="Copy link" onClick={()=>void navigator.clipboard?.writeText(link.url)}><Copy size={14}/></button><button aria-label="Dismiss" onClick={()=>setLink(null)}><X size={14}/></button></div>}
  <div className="split-grid">
   <section className="panel padded"><div className="panel-heading"><h2><MailPlus size={14}/> Invite a person</h2></div>
    <form className="stack-form" onSubmit={invite}>
     <label className="field">Name<input required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
     <label className="field">Email<input type="email" required maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
     <label className="field">Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value as Role})}><option value="technician">Technician</option><option value="manager">Manager</option><option value="operator">Simulation operator</option></select></label>
     {form.role==='technician'&&<label className="field">Link to roster entry (optional)<select value={form.technicianId} onChange={e=>setForm({...form,technicianId:e.target.value})}><option value="">No roster link (cannot receive assignments)</option>{technicians.filter(t=>!linked.has(t.id)).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
     <label className="checkbox-field"><input type="checkbox" checked={form.send} onChange={e=>setForm({...form,send:e.target.checked})}/>Also deliver by configured mail transport</label>
     <button className="primary" disabled={busy}><MailPlus size={14}/>Create invitation</button>
    </form>
   </section>
   <section className="panel padded"><div className="panel-heading"><h2>Invitations<span className="counter">{invites.filter(i=>i.status==='open').length.toString().padStart(2,'0')}</span></h2><button className="text-button" onClick={()=>void load()}><RefreshCw size={12}/>Refresh</button></div>
    <div className="table-wrap"><table><thead><tr><th>PERSON</th><th>ROLE</th><th>STATUS</th><th>EXPIRES</th><th/></tr></thead><tbody>
     {invites.length?invites.map(i=><tr key={i.id}><td><strong>{i.name}</strong><small>{i.email}</small></td><td className="mono">{i.role}{i.technicianId?` · ${i.technicianId}`:''}</td><td><span className={`badge ${i.status==='open'?'amber':i.status==='accepted'?'green':'muted'}`}><span className="status-dot"/>{i.status}</span></td><td className="mono">{when(i.expiresAt)}</td><td>{i.status==='open'&&<button className="text-button" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/v1/admin/invitations/${i.id}`,{method:'DELETE'});})}>Revoke</button>}</td></tr>):<tr><td colSpan={5} className="muted">No invitations yet.</td></tr>}
    </tbody></table></div>
   </section>
  </div>
  <section className="panel"><div className="panel-heading"><h2>People<span className="counter">{users.length.toString().padStart(2,'0')}</span></h2><p>Role and access changes sign the person out everywhere. You cannot change your own access.</p></div>
   <div className="table-wrap"><table><thead><tr><th>PERSON</th><th>ROLE</th><th>SIGN-IN</th><th>SESSIONS</th><th>ACCESS</th><th/></tr></thead><tbody>
    {users.map(u=><tr key={u.id}><td><strong>{u.name}</strong><small>{u.email} · {u.id}</small></td>
     <td><select aria-label={`Role for ${u.name}`} value={u.role} disabled={busy||u.id===actor.id} onChange={e=>{const role=e.target.value;if(confirm(`Change ${u.name} to ${role}? They will be signed out.`))void run(async()=>{await api(`/api/v1/admin/users/${u.id}`,{method:'PATCH',body:{role}});});}}><option value="manager">manager</option><option value="technician">technician</option><option value="operator">operator</option></select></td>
     <td className="mono">{[u.hasPassword&&'password',u.ssoLinked&&'sso'].filter(Boolean).join(' + ')||'none'}</td><td className="mono">{u.activeSessions}</td>
     <td><span className={`badge ${u.active?'green':'muted'}`}><span className="status-dot"/>{u.active?'active':'disabled'}</span></td>
     <td><div className="row cell-actions">{u.id!==actor.id&&<><button className="text-button" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/v1/admin/users/${u.id}`,{method:'PATCH',body:{active:!u.active}});})}>{u.active?<><UserX size={12}/>Disable</>:<><UserCheck size={12}/>Enable</>}</button>{u.active&&<button className="text-button" disabled={busy} onClick={()=>void run(async()=>{const r=await api<{link:string;expiresInMinutes:number}>(`/api/v1/admin/users/${u.id}/reset-link`,{method:'POST'});setLink({label:`Password reset link for ${u.name} · valid ${r.expiresInMinutes} min`,url:r.link});})}><KeyRound size={12}/>Reset link</button>}</>}</div></td></tr>)}
   </tbody></table></div>
  </section>
 </>;
}

export function SecurityLog(){
 const [events,setEvents]=useState<Event[]>([]),[error,setError]=useState('');
 const load=useCallback(async()=>{try{setEvents((await api<{data:Event[]}>('/api/v1/admin/account-events')).data);}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 return <section className="panel"><div className="panel-heading"><h2><ShieldAlert size={14}/> Account security log</h2><button className="text-button" onClick={()=>void load()}><RefreshCw size={12}/>Refresh</button></div>
  {error&&<div className="notice error">{error}</div>}
  <div className="table-wrap"><table><thead><tr><th>WHEN</th><th>EVENT</th><th>ACTOR</th><th>SUBJECT</th></tr></thead><tbody>
   {events.map(e=><tr key={e.id}><td className="mono">{when(e.createdAt)}</td><td className="mono">{e.event}</td><td className="mono">{e.actorId??'—'}</td><td className="mono">{e.subjectId??'—'}</td></tr>)}
  </tbody></table></div><p className="control-hint padded">Append-only. Retained across simulation resets.</p></section>;
}
