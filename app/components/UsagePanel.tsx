'use client';
import {useCallback,useEffect,useState} from 'react';
import {Gauge,RefreshCw} from 'lucide-react';
import {api,when} from './api';

type Summary={mode:string;model:string|null;pricingConfigured:boolean;timeoutMs:number;days:number;
 total:{requests:number;errors:number;input_tokens:number;output_tokens:number;cost_usd:number|null;unpriced:number;mean_latency_ms:number|null;p95_latency_ms:number|null};
 recent:{id:string;model:string;status:string;errorClass:string|null;inputTokens:number;outputTokens:number;latencyMs:number;costUsd:number|null;tool:string|null;createdAt:string;providerRequestId:string|null}[]};

/** Manager view of external model usage recorded by the live provider. */
export default function UsagePanel(){
 const [d,setD]=useState<Summary|null>(null),[error,setError]=useState('');
 const load=useCallback(async()=>{try{setD(await api<Summary>('/api/v1/admin/model-usage'));}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 if(error)return <div className="notice error">{error}</div>;
 if(!d)return <p className="muted">Loading…</p>;
 const t=d.total;
 const tiles:[string,string|number][]=[['Requests',t.requests],['Errors',t.errors],['Input tokens',t.input_tokens],['Output tokens',t.output_tokens],['Cost (USD)',t.cost_usd===null?'unavailable':t.cost_usd.toFixed(4)],['p95 latency',t.p95_latency_ms===null?'—':`${Math.round(t.p95_latency_ms)} ms`]];
 return <>
  <div className="notice"><Gauge size={15}/><div><strong>Agent mode: {d.mode==='live'?`live · ${d.model}`:'deterministic demo (no model calls)'}</strong> · timeout {d.timeoutMs} ms · {d.pricingConfigured?'pricing configured':'pricing not configured: costs are shown as unavailable, not zero'}. Human approval remains required for dispatch, reassignment and closure in every mode.</div></div>
  <div className="metrics">{tiles.map(([k,v])=><div className="metric" key={k}><span className="metric-label">{k}</span><strong className="metric-value">{v}</strong><span className="metric-foot">last {d.days} days</span></div>)}</div>
  <section className="panel"><div className="panel-heading"><h2>Recent model requests</h2><button className="text-button" onClick={()=>void load()}><RefreshCw size={12}/>Refresh</button></div>
   <div className="table-wrap"><table><thead><tr><th>WHEN</th><th>MODEL</th><th>RESULT</th><th>TOKENS IN/OUT</th><th>LATENCY</th><th>COST</th></tr></thead><tbody>
    {d.recent.length?d.recent.map(r=><tr key={r.id}><td className="mono">{when(r.createdAt)}</td><td className="mono">{r.model}<small>{r.providerRequestId??''}</small></td><td><span className={`badge ${r.status==='success'?'green':'amber'}`}><span className="status-dot"/>{r.status==='success'?(r.tool??'no tool'):r.errorClass}</span></td><td className="mono">{r.inputTokens}/{r.outputTokens}</td><td className="mono">{Math.round(r.latencyMs)} ms</td><td className="mono">{r.costUsd===null?'—':`$${r.costUsd.toFixed(5)}`}</td></tr>):<tr><td colSpan={6} className="muted">No external model requests recorded.</td></tr>}
   </tbody></table></div>
  </section>
 </>;
}
