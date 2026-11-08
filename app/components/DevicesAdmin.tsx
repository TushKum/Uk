'use client';
import {useCallback,useEffect,useState} from 'react';
import {Cpu,KeyRound,RefreshCw,X} from 'lucide-react';
import {api,when} from './api';
import type {Building} from '@/lib/types';

type Device={id:string;name:string;buildingId:string;meter:string|null;minValue:number;maxValue:number;keyPrefix:string;status:string;createdAt:string;lastSeenAt:string|null;readings:number};
type Reading={id:string;observedAt:string;receivedAt:string;value:number|null;quality:string;qualityReason:string|null;messageId:string|null};
type Bucket={bucket:string;readings:number;valid:number;mean:number|null;min:number|null;max:number|null};

export function SourceBadge({real}:{real:boolean}){return <span className={`source-badge ${real?'real':'simulated'}`}>{real?'Real device data':'Simulated data'}</span>;}

/** Manager-only registry of real telemetry devices and their received readings. */
export default function DevicesAdmin({buildings}:{buildings:Building[]}){
 const [devices,setDevices]=useState<Device[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[key,setKey]=useState<{name:string;key:string}|null>(null);
 const [form,setForm]=useState({name:'',buildingId:buildings[0]?.id??'',meter:'',maxValue:'2000'});
 const [selected,setSelected]=useState<string|null>(null),[readings,setReadings]=useState<Reading[]>([]),[buckets,setBuckets]=useState<Bucket[]>([]);
 const load=useCallback(async()=>{try{setDevices((await api<{data:Device[]}>('/api/v1/devices')).data);}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 const loadReadings=useCallback(async(id:string)=>{try{const [r,b]=await Promise.all([api<{data:Reading[]}>(`/api/v1/telemetry?source=device&deviceId=${id}&limit=50`),api<{data:Bucket[]}>(`/api/v1/telemetry?source=device&deviceId=${id}&bucket=1h&limit=24`)]);setReadings(r.data);setBuckets(b.data);}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{if(selected)void loadReadings(selected);},[selected,loadReadings]);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const origin=typeof window==='undefined'?'':window.location.origin;
 return <>
  {error&&<div className="notice error" role="alert">{error}</div>}
  <div className="notice"><Cpu size={15}/><div><strong>Real telemetry is kept separate.</strong> Readings from registered devices are stored and queryable here. The incident investigation, charts and verification on other screens still use the <SourceBadge real={false}/> scenario; real readings are never mixed into them.</div></div>
  {key&&<section className="panel"><div className="panel-heading"><h2><KeyRound size={14}/> Device key for {key.name}</h2><button className="text-button" onClick={()=>setKey(null)}><X size={12}/>I have stored it</button></div><div className="key-reveal">{key.key}</div><p className="control-hint padded">Shown once. Store it in the device’s secret store. Only a hash is kept server-side; rotate if it is exposed.</p>
   <pre className="key-reveal">{`curl -X POST ${origin}/api/v1/ingest/readings \\\n  -H "Authorization: Bearer <device key>" -H "Content-Type: application/json" \\\n  -d '{"readings":[{"observedAt":"${new Date().toISOString()}","value":24.5,"messageId":"m-0001"}]}'`}</pre></section>}
  <div className="split-grid">
   <section className="panel padded"><div className="panel-heading"><h2><Cpu size={14}/> Register a device</h2></div>
    <form className="stack-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await api<{device:Device;key:string}>('/api/v1/devices',{method:'POST',body:{name:form.name,buildingId:form.buildingId,...(form.meter?{meter:form.meter}:{}),maxValue:Number(form.maxValue)}});setKey({name:r.device.name,key:r.key});setForm({...form,name:'',meter:''});});}}>
     <label className="field">Device name<input required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="North residence meter gateway"/></label>
     <label className="field">Building<select value={form.buildingId} onChange={e=>setForm({...form,buildingId:e.target.value})}>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
     <label className="field">Meter reference (optional)<input maxLength={60} value={form.meter} onChange={e=>setForm({...form,meter:e.target.value})}/></label>
     <label className="field">Plausible maximum (L/min)<input type="number" min={1} max={100000} required value={form.maxValue} onChange={e=>setForm({...form,maxValue:e.target.value})}/></label>
     <p className="control-hint">Readings above the plausible maximum are stored as faulty, never as valid flow.</p>
     <button className="primary" disabled={busy||!buildings.length}>Register &amp; issue key</button>
    </form>
   </section>
   <section className="panel"><div className="panel-heading"><h2>Devices<span className="counter">{devices.filter(d=>d.status==='active').length.toString().padStart(2,'0')}</span></h2><button className="text-button" onClick={()=>void load()}><RefreshCw size={12}/>Refresh</button></div>
    <div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>KEY</th><th>READINGS</th><th>LAST SEEN</th><th/></tr></thead><tbody>
     {devices.length?devices.map(d=><tr key={d.id} className={selected===d.id?'selected':''}><td><strong>{d.name}</strong><small>{buildings.find(b=>b.id===d.buildingId)?.name??d.buildingId} · <span className={`badge ${d.status==='active'?'green':'muted'}`}><span className="status-dot"/>{d.status}</span></small></td><td className="mono">{d.keyPrefix}_…</td><td className="mono">{d.readings}</td><td className="mono">{when(d.lastSeenAt)}</td>
      <td><div className="row cell-actions"><button className="text-button" onClick={()=>setSelected(d.id)}>View data</button>{d.status==='active'&&<><button className="text-button" disabled={busy} onClick={()=>{if(confirm('Rotate key? The old key stops working immediately.'))void run(async()=>{const r=await api<{device:Device;key:string}>(`/api/v1/devices/${d.id}/rotate`,{method:'POST'});setKey({name:r.device.name,key:r.key});});}}>Rotate key</button><button className="text-button" disabled={busy} onClick={()=>{if(confirm('Revoke this device? It can no longer send readings.'))void run(async()=>{await api(`/api/v1/devices/${d.id}`,{method:'DELETE'});});}}>Revoke</button></>}</div></td></tr>):<tr><td colSpan={5} className="muted">No real devices registered. All telemetry in this workspace is simulated.</td></tr>}
    </tbody></table></div>
   </section>
  </div>
  {selected&&<section className="panel"><div className="panel-heading"><h2>Received readings <SourceBadge real/></h2><div className="row"><button className="text-button" onClick={()=>void loadReadings(selected)}><RefreshCw size={12}/>Refresh</button><button className="text-button" onClick={()=>setSelected(null)}><X size={12}/>Close</button></div></div>
   <div className="split-grid">
    <div className="table-wrap"><table><thead><tr><th>OBSERVED (DEVICE TIME)</th><th>VALUE</th><th>QUALITY</th><th>RECEIVED</th></tr></thead><tbody>{readings.length?readings.map(r=><tr key={r.id}><td className="mono">{when(r.observedAt)}</td><td className="mono">{r.value===null?'—':`${r.value} L/min`}</td><td><span className={`badge ${r.quality==='valid'?'green':'amber'}`}><span className="status-dot"/>{r.quality}{r.qualityReason?` · ${r.qualityReason}`:''}</span></td><td className="mono">{when(r.receivedAt)}</td></tr>):<tr><td colSpan={4} className="muted">No readings received yet.</td></tr>}</tbody></table></div>
    <div className="table-wrap"><table><thead><tr><th>HOUR</th><th>VALID / TOTAL</th><th>MEAN</th><th>RANGE</th></tr></thead><tbody>{buckets.map(b=><tr key={b.bucket}><td className="mono">{when(b.bucket)}</td><td className="mono">{b.valid}/{b.readings}</td><td className="mono">{b.mean===null?'—':Number(b.mean).toFixed(1)}</td><td className="mono">{b.min===null?'—':`${b.min}–${b.max}`}</td></tr>)}</tbody></table><p className="control-hint padded">Hourly means use valid readings only; missing or faulty readings are never treated as zero.</p></div>
   </div>
  </section>}
 </>;
}
