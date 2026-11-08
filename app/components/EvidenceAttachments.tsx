'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Camera,FileText,Paperclip,Trash2,Upload} from 'lucide-react';
import {api,bytes,when} from './api';
import type {Actor} from '@/lib/types';

type Attachment={id:string;kind:'photo'|'document';contentType:string;name:string;sizeBytes:number;sha256:string;description:string|null;uploadedBy:string;uploadedByName:string;uploadedRole:string;uploadedAt:string;incidentState:string;storage:string};

/** Inspection photos and documents attached to an incident. Files are evidence for people; the agent does not analyse them. */
export default function EvidenceAttachments({incidentId,actor,canUpload,onChanged}:{incidentId:string;actor:Actor;canUpload:boolean;onChanged:()=>void}){
 const [items,setItems]=useState<Attachment[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[description,setDescription]=useState(''),[limit,setLimit]=useState(10*1048576);
 const input=useRef<HTMLInputElement>(null);
 const load=useCallback(async()=>{try{setItems((await api<{data:Attachment[]}>(`/api/v1/incidents/${encodeURIComponent(incidentId)}/attachments`)).data);}catch(e){setError((e as Error).message);}},[incidentId]);
 useEffect(()=>{void load();fetch('/api/auth/config').then(r=>r.json()).then(d=>{if(d.attachmentMaxBytes)setLimit(d.attachmentMaxBytes);}).catch(()=>{});},[load]);
 async function upload(e:React.FormEvent){
  e.preventDefault();const file=input.current?.files?.[0];if(!file){setError('Choose a file first.');return;}
  if(file.size>limit){setError(`Files must be at most ${bytes(limit)}.`);return;}
  setBusy(true);setError('');
  try{const form=new FormData();form.set('file',file);if(description.trim())form.set('description',description.trim());
   const res=await fetch(`/api/v1/incidents/${encodeURIComponent(incidentId)}/attachments`,{method:'POST',body:form});const d=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(d.error??`Upload failed (${res.status})`);
   setDescription('');if(input.current)input.current.value='';await load();onChanged();}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 async function remove(a:Attachment){const reason=prompt(`Why delete “${a.name}”? This is recorded in the audit log.`);if(!reason||reason.trim().length<3)return;setBusy(true);setError('');try{await api(`/api/v1/attachments/${a.id}`,{method:'DELETE',body:{reason:reason.trim()}});await load();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel"><div className="panel-heading"><h2><Paperclip size={14}/> Inspection attachments<span className="counter">{items.length.toString().padStart(2,'0')}</span></h2><p>Photos and documents · stored privately · SHA-256 recorded at upload</p></div>
  {error&&<div className="notice error" role="alert">{error}</div>}
  <div className="attachment-list">{items.length?items.map(a=><div className="attachment-item" key={a.id}><div>{a.kind==='photo'?<Camera size={13}/>:<FileText size={13}/>} <a href={`/api/v1/attachments/${a.id}/content`} target="_blank" rel="noreferrer">{a.name}</a> · {bytes(a.sizeBytes)}{a.description&&<p>{a.description}</p>}<small>Uploaded by {a.uploadedByName} ({a.uploadedRole}) · {when(a.uploadedAt)} · incident was “{a.incidentState}” · sha256 {a.sha256.slice(0,16)}… · {a.storage} storage</small></div>
   <div className="row"><a className="text-button" href={`/api/v1/attachments/${a.id}/content?download=1`}>Download</a>{(actor.role==='manager'||a.uploadedBy===actor.id)&&<button className="text-button" disabled={busy} onClick={()=>void remove(a)}><Trash2 size={12}/>Delete</button>}</div></div>):<p className="muted">No attachments yet.</p>}</div>
  {canUpload?<form className="upload-form" onSubmit={upload}><input ref={input} type="file" aria-label="Attachment file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.txt,.csv,.log"/><input type="text" aria-label="Attachment description" maxLength={500} value={description} onChange={e=>setDescription(e.target.value)} placeholder="What does this show? (optional)"/><button className="secondary" disabled={busy}><Upload size={13}/>{busy?'Uploading…':'Attach'}</button><p className="control-hint">JPEG, PNG, WebP, PDF or plain text · up to {bytes(limit)}. Photos keep their embedded metadata (which may include location). Attachments are not analysed by the agent and do not change verification results.</p></form>:<p className="control-hint padded">Uploading is available to managers and to the assigned technician while work is active.</p>}
 </section>;
}
