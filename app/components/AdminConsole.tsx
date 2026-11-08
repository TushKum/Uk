'use client';
import {useState} from 'react';
import {PeopleAdmin,SecurityLog} from './AdminPanel';
import DevicesAdmin from './DevicesAdmin';
import UsagePanel from './UsagePanel';
import type {Actor,State} from '@/lib/types';

const tabs=[{id:'people',label:'People & access'},{id:'devices',label:'Telemetry devices'},{id:'usage',label:'Model usage'},{id:'security',label:'Security log'}] as const;
type Tab=typeof tabs[number]['id'];

/** Manager administration: people, telemetry devices, model usage and security events. */
export default function AdminConsole({actor,state}:{actor:Actor;state:State}){
 const [tab,setTab]=useState<Tab>('people');
 return <>
  <div className="section-title"><div><div className="breadcrumb">SETTINGS / ADMINISTRATION</div><h1>Administration<span className="title-dot"/></h1><p>Manager-only. Every action is re-authorised on the server and recorded.</p></div></div>
  <div className="tab-row" role="tablist">{tabs.map(t=><button key={t.id} role="tab" aria-selected={tab===t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}>{t.label}</button>)}</div>
  {tab==='people'&&<PeopleAdmin actor={actor} technicians={state.technicians}/>}
  {tab==='devices'&&<DevicesAdmin buildings={state.buildings}/>}
  {tab==='usage'&&<UsagePanel/>}
  {tab==='security'&&<SecurityLog/>}
 </>;
}
