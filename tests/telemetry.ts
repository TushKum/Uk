// Real-telemetry ingestion integration checks against the configured Postgres database.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pool,readState,transaction} from '../lib/db';
import {CAMPUS,storeState} from '../lib/repository';
import {hashPassword} from '../lib/auth';
import {authenticateDevice,deviceQuery,ingestReadings,listDevices,queryDeviceReadings,registerDevice,revokeDevice,rotateDeviceKey} from '../lib/telemetry';
import type {Actor} from '../lib/types';

const run=randomUUID().slice(0,8),checks:string[]=[],devices:string[]=[];
async function check(name:string,fn:()=>Promise<void>){await fn();checks.push(name);console.log(`PASS ${name}`);}
const code=(c:string)=>(e:unknown)=>{assert.equal((e as {code?:string}).code,c,(e as Error).message);return true;};
const managerId=`tele-${run}`;const manager:Actor={id:managerId,role:'manager',name:'Telemetry manager',campusId:CAMPUS},tech:Actor={id:'tech-ravi',role:'technician',name:'Ravi',campusId:CAMPUS};
await pool.query('INSERT INTO ll_users(id,campus_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[managerId,CAMPUS,`${managerId}@test.local`,'Telemetry manager','manager',await hashPassword('irrelevant passphrase')]);
const now=Date.now(),iso=(ms:number)=>new Date(ms).toISOString();
try{
 const simulatedBefore=(await pool.query('SELECT count(*)::int n FROM ll_readings')).rows[0].n;
 let key='',deviceId='';
 await check('only managers register devices, for buildings on this campus',async()=>{
  await assert.rejects(()=>registerDevice(tech,{name:'x',buildingId:'north'}),code('FORBIDDEN'));
  await assert.rejects(()=>registerDevice(manager,{name:'x',buildingId:'atlantis'}),code('UNKNOWN_BUILDING'));
  const r=await registerDevice(manager,{name:`Gateway ${run}`,buildingId:'north',maxValue:500});key=r.key;deviceId=r.device.id as string;devices.push(deviceId);
  assert.match(key,/^llk_[a-f0-9]{8}_[A-Za-z0-9_-]{32}$/);
  const {rows:[d]}=await pool.query('SELECT key_hash FROM ll_devices WHERE id=$1',[deviceId]);assert.notEqual(d.key_hash,key);
  assert.ok((await listDevices(manager)).every(d=>!('key_hash' in d)&&!('key' in d)),'listing never exposes key material');
 });
 await check('device authentication rejects missing, malformed and unknown keys',async()=>{
  for(const h of [null,'Bearer nope',`Basic ${key}`,`Bearer ${key.slice(0,-1)}${key.endsWith('x')?'y':'x'}`])await assert.rejects(()=>authenticateDevice(h),code('DEVICE_UNAUTHENTICATED'));
  assert.equal((await authenticateDevice(`Bearer ${key}`)).id,deviceId);
 });
 const device=await authenticateDevice(`Bearer ${key}`);
 await check('valid readings are accepted with device-time timestamps',async()=>{
  const r=await ingestReadings(device,{readings:[{observedAt:iso(now-120000),value:21.5,messageId:'m1'},{observedAt:now-60000,value:22},{observedAt:iso(now-30000),value:null}]},now);
  assert.equal(r.accepted,3);assert.equal(r.source,'device');
  const {rows}=await pool.query('SELECT quality FROM ll_device_readings WHERE device_id=$1 ORDER BY observed_at',[deviceId]);assert.deepEqual(rows.map(r=>r.quality),['valid','valid','missing']);
 });
 await check('identical resubmissions are idempotent duplicates',async()=>{const r=await ingestReadings(device,{readings:[{observedAt:iso(now-120000),value:21.5,messageId:'m1'}]},now);assert.equal(r.duplicates,1);assert.equal(r.accepted,0);});
 await check('conflicting values never overwrite recorded readings',async()=>{
  const r=await ingestReadings(device,{readings:[{observedAt:iso(now-120000),value:99},{observedAt:iso(now-10000),value:5,messageId:'m1'}]},now);
  assert.equal(r.conflicts,2);assert.match(r.results[1].reason!,/message_id_reused/);
  const {rows:[x]}=await pool.query('SELECT value FROM ll_device_readings WHERE device_id=$1 AND observed_at=$2',[deviceId,iso(now-120000)]);assert.equal(x.value,21.5);
 });
 await check('timestamp, value and field validation rejects bad items individually',async()=>{
  const r=await ingestReadings(device,{readings:[
   {observedAt:iso(now+3600000),value:1},{observedAt:iso(now-40*86400000),value:1},{observedAt:'yesterday',value:1},{observedAt:'2026-11-08T10:00:00',value:1},
   {observedAt:iso(now-5000),value:-1},{observedAt:iso(now-6000),value:null,quality:'valid'},{observedAt:iso(now-7000),value:1,extra:true},{observedAt:iso(now-8000),value:1,unit:'gal/min'},
   {observedAt:iso(now-9000),value:30}]},now);
  assert.equal(r.rejected,8);assert.equal(r.accepted,1);
  assert.deepEqual(r.results.slice(0,6).map(o=>o.reason?.split(' ')[0]),['future_timestamp','too_old','invalid_timestamp','invalid_timestamp','negative_or_invalid_value','valid_reading_requires_value']);
 });
 await check('implausible values are stored as faulty, never as valid flow',async()=>{
  const r=await ingestReadings(device,{readings:[{observedAt:iso(now-11000),value:9000}]},now);assert.equal(r.flagged,1);
  const {rows:[x]}=await pool.query('SELECT quality,quality_reason FROM ll_device_readings WHERE device_id=$1 AND observed_at=$2',[deviceId,iso(now-11000)]);assert.deepEqual(x,{quality:'faulty',quality_reason:'outside_device_range'});
 });
 await check('repeated timestamps inside one batch are classified, not double-inserted',async()=>{
  const r=await ingestReadings(device,{readings:[{observedAt:iso(now-12000),value:3},{observedAt:iso(now-12000),value:3},{observedAt:iso(now-12000),value:4}]},now);
  assert.deepEqual([r.accepted,r.duplicates,r.conflicts],[1,1,1]);
 });
 await check('oversized batches are rejected before writing',async()=>{const before=(await pool.query('SELECT count(*)::int n FROM ll_device_readings WHERE device_id=$1',[deviceId])).rows[0].n;await assert.rejects(()=>ingestReadings(device,{readings:Array.from({length:501},(_,i)=>({observedAt:now-i*1000-100000,value:1}))},now),code('BATCH_TOO_LARGE'));assert.equal((await pool.query('SELECT count(*)::int n FROM ll_device_readings WHERE device_id=$1',[deviceId])).rows[0].n,before);});
 await check('accepted readings are immutable in the database',async()=>{await assert.rejects(()=>pool.query('UPDATE ll_device_readings SET value=1 WHERE device_id=$1',[deviceId]),/immutable/);});
 await check('keyset pagination returns every reading exactly once, newest first',async()=>{
  await ingestReadings(device,{readings:Array.from({length:40},(_,i)=>({observedAt:iso(now-3600000-i*60000),value:10+i%5}))},now);
  const ids:string[]=[];let cursor:string|undefined;let last=Infinity;
  for(let page=0;page<20;page++){const r=await queryDeviceReadings(deviceQuery.parse({source:'device',deviceId,limit:'7',...(cursor?{cursor}:{})}));for(const x of r.data){assert.ok(x.at<=last);last=x.at;ids.push(x.id);}if(!r.nextCursor)break;cursor=r.nextCursor;}
  const total=(await pool.query('SELECT count(*)::int n FROM ll_device_readings WHERE device_id=$1',[deviceId])).rows[0].n;assert.equal(ids.length,total);assert.equal(new Set(ids).size,total);
 });
 await check('time-bucketed aggregates exclude missing and faulty readings',async()=>{
  const r=await queryDeviceReadings(deviceQuery.parse({source:'device',deviceId,bucket:'1d',from:String(now-86400000)}));
  const totals=r.data.reduce((a:{readings:number;valid:number},b:{readings:number;valid:number})=>({readings:a.readings+b.readings,valid:a.valid+b.valid}),{readings:0,valid:0});
  const {rows:[q]}=await pool.query("SELECT count(*)::int total,count(*) FILTER (WHERE quality='valid')::int valid,max(value) FILTER (WHERE quality='valid') mx FROM ll_device_readings WHERE device_id=$1",[deviceId]);
  assert.deepEqual(totals,{readings:q.total,valid:q.valid});assert.ok(r.data.every((b:{max:number|null})=>b.max===null||b.max<=q.mx),'faulty 9000 excluded');
  assert.throws(()=>deviceQuery.parse({source:'device'}));assert.throws(()=>deviceQuery.parse({source:'device',deviceId,limit:'5000'}));
 });
 await check('simulated scenario readings are untouched and storing scenario state never deletes device readings',async()=>{
  assert.equal((await pool.query('SELECT count(*)::int n FROM ll_readings')).rows[0].n,simulatedBefore);
  const before=(await pool.query('SELECT count(*)::int n FROM ll_device_readings WHERE device_id=$1',[deviceId])).rows[0].n;
  const s=await readState();await transaction(db=>storeState(db,s));
  assert.equal((await pool.query('SELECT count(*)::int n FROM ll_device_readings WHERE device_id=$1',[deviceId])).rows[0].n,before);
  assert.ok(!s.readings.some(r=>(r as {source?:string}).source==='device'));
 });
 await check('key rotation invalidates the old key; revocation blocks ingestion',async()=>{
  const r=await rotateDeviceKey(manager,deviceId);await assert.rejects(()=>authenticateDevice(`Bearer ${key}`),code('DEVICE_UNAUTHENTICATED'));assert.ok(await authenticateDevice(`Bearer ${r.key}`));
  await revokeDevice(manager,deviceId);await assert.rejects(()=>authenticateDevice(`Bearer ${r.key}`),code('DEVICE_UNAUTHENTICATED'));
  await assert.rejects(()=>rotateDeviceKey(manager,deviceId),code('NOT_FOUND'));await assert.rejects(()=>revokeDevice(tech,deviceId),code('FORBIDDEN'));
 });
 writeFileSync('evaluation/telemetry-results.json',JSON.stringify({passed_checks:checks.length,checks,generatedAt:new Date().toISOString(),data:'synthetic readings from a test device; no hardware involved'},null,2)+'\n');
 console.log(`${checks.length} telemetry checks passed.`);
}finally{
 await pool.query('DELETE FROM ll_device_readings WHERE device_id=ANY($1)',[devices]);await pool.query('DELETE FROM ll_ingest_batches WHERE device_id=ANY($1)',[devices]);await pool.query('DELETE FROM ll_devices WHERE id=ANY($1)',[devices]);
 await pool.query('DELETE FROM ll_users WHERE id=$1',[managerId]);await pool.end();
}
