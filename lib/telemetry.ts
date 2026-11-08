import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool} from './pool';
import {transaction} from './db';
import {AppError,requireRole} from './errors';
import {config} from './config';
import {accountEvent,digest} from './auth';
import {CAMPUS} from './repository';
import {logger} from './log';
import type {Actor} from './types';

// ---------- Device registry ----------
export const deviceSchema=z.object({name:z.string().trim().min(1).max(120),buildingId:z.string().trim().min(1).max(100),meter:z.string().trim().max(60).optional(),minValue:z.number().min(0).max(100000).optional(),maxValue:z.number().positive().max(100000).optional()}).strict().refine(v=>(v.maxValue??2000)>(v.minValue??0),{message:'maxValue must exceed minValue',path:['maxValue']});
const newKey=()=>{const prefix=`llk_${randomBytes(4).toString('hex')}`;return {prefix,key:`${prefix}_${randomBytes(24).toString('base64url')}`};};
const publicDevice=(d:Record<string,unknown>)=>({id:d.id,name:d.name,buildingId:d.building_id,meter:d.meter,unit:d.unit,minValue:d.min_value,maxValue:d.max_value,keyPrefix:d.key_prefix,status:d.status,createdAt:d.created_at,rotatedAt:d.rotated_at,revokedAt:d.revoked_at,lastSeenAt:d.last_seen_at,readings:d.readings!==undefined?Number(d.readings):undefined,source:'device'});
const requireManager=(a:Actor)=>requireRole(a.role==='manager','Manager role required');

export async function registerDevice(actor:Actor,input:z.infer<typeof deviceSchema>){
 requireManager(actor);
 return transaction(async db=>{
  const {rows:[b]}=await db.query('SELECT 1 FROM ll_buildings WHERE campus_id=$1 AND generation=(SELECT generation FROM ll_runtime WHERE campus_id=$1) AND id=$2',[CAMPUS,input.buildingId]);
  if(!b)throw new AppError(400,'UNKNOWN_BUILDING','That building is not part of this campus.');
  const {prefix,key}=newKey(),id=randomUUID();
  const {rows:[d]}=await db.query('INSERT INTO ll_devices(id,campus_id,name,building_id,meter,min_value,max_value,key_hash,key_prefix,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,CAMPUS,input.name,input.buildingId,input.meter??null,input.minValue??0,input.maxValue??2000,digest(key),prefix,actor.id]);
  await accountEvent(db,'device_registered',{actorId:actor.id,detail:{deviceId:id,buildingId:input.buildingId}});
  return {device:publicDevice(d),key};
 });
}
export async function listDevices(actor:Actor){requireManager(actor);const {rows}=await pool.query('SELECT d.*,(SELECT count(*) FROM ll_device_readings r WHERE r.device_id=d.id) AS readings FROM ll_devices d WHERE campus_id=$1 ORDER BY created_at DESC',[CAMPUS]);return rows.map(publicDevice);}
export async function rotateDeviceKey(actor:Actor,id:string){requireManager(actor);return transaction(async db=>{const {prefix,key}=newKey();const {rows:[d]}=await db.query("UPDATE ll_devices SET key_hash=$3,key_prefix=$4,rotated_at=now() WHERE id=$1 AND campus_id=$2 AND status='active' RETURNING *",[id,CAMPUS,digest(key),prefix]);if(!d)throw new AppError(404,'NOT_FOUND','Active device not found');await accountEvent(db,'device_key_rotated',{actorId:actor.id,detail:{deviceId:id}});return {device:publicDevice(d),key};});}
export async function revokeDevice(actor:Actor,id:string){requireManager(actor);return transaction(async db=>{const {rows:[d]}=await db.query("UPDATE ll_devices SET status='revoked',revoked_at=now() WHERE id=$1 AND campus_id=$2 AND status='active' RETURNING *",[id,CAMPUS]);if(!d)throw new AppError(404,'NOT_FOUND','Active device not found');await accountEvent(db,'device_revoked',{actorId:actor.id,detail:{deviceId:id}});return {device:publicDevice(d)};});}

export async function authenticateDevice(header:string|null){
 const match=header?.match(/^Bearer (llk_[a-f0-9]{8}_[A-Za-z0-9_-]{32})$/);
 if(!match)throw new AppError(401,'DEVICE_UNAUTHENTICATED','A valid device key is required.');
 const {rows:[d]}=await pool.query("SELECT * FROM ll_devices WHERE key_hash=$1 AND status='active'",[digest(match[1])]);
 if(!d)throw new AppError(401,'DEVICE_UNAUTHENTICATED','A valid device key is required.');
 return d as {id:string;campus_id:string;building_id:string;min_value:number;max_value:number;name:string};
}

// ---------- Ingestion ----------
const timestamp=z.union([z.string().max(40),z.number().int().nonnegative()]);
const item=z.object({observedAt:timestamp,value:z.number().nullable(),quality:z.enum(['valid','missing','faulty']).optional(),messageId:z.string().min(1).max(100).regex(/^[A-Za-z0-9:._-]+$/).optional(),unit:z.literal('L/min').optional()}).strict();
export const ingestSchema=z.object({readings:z.array(z.unknown()).min(1)}).strict();
type Outcome={index:number;status:'accepted'|'duplicate'|'conflict'|'rejected';reason?:string;flagged?:string};

export async function ingestReadings(device:Awaited<ReturnType<typeof authenticateDevice>>,body:z.infer<typeof ingestSchema>,now=Date.now()){
 const c=config();
 if(body.readings.length>c.TELEMETRY_BATCH_MAX)throw new AppError(413,'BATCH_TOO_LARGE',`Send at most ${c.TELEMETRY_BATCH_MAX} readings per request.`);
 const outcomes:Outcome[]=[];const rows:{i:number;observed_at:string;value:number|null;quality:string;quality_reason:string|null;message_id:string|null}[]=[];const seen=new Map<number,{index:number;value:number|null;quality:string}>();
 body.readings.forEach((raw,index)=>{
  const parsed=item.safeParse(raw);if(!parsed.success){outcomes[index]={index,status:'rejected',reason:`invalid_fields:${parsed.error.issues.map(i=>i.path.join('.')||i.code).join(',')}`};return;}
  const r=parsed.data;
  const at=typeof r.observedAt==='number'?r.observedAt:(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(r.observedAt)?Date.parse(r.observedAt):NaN);
  if(!Number.isFinite(at)){outcomes[index]={index,status:'rejected',reason:'invalid_timestamp (use ISO 8601 with a timezone, or epoch milliseconds)'};return;}
  if(at>now+c.TELEMETRY_MAX_FUTURE_SECONDS*1000){outcomes[index]={index,status:'rejected',reason:'future_timestamp'};return;}
  if(at<now-c.TELEMETRY_MAX_AGE_DAYS*86400000){outcomes[index]={index,status:'rejected',reason:'too_old'};return;}
  if(r.value!==null&&(!Number.isFinite(r.value)||r.value<0)){outcomes[index]={index,status:'rejected',reason:'negative_or_invalid_value'};return;}
  let quality=r.quality??(r.value===null?'missing':'valid'),reason:string|null=null;
  if(quality==='valid'&&r.value===null){outcomes[index]={index,status:'rejected',reason:'valid_reading_requires_value'};return;}
  // Physically implausible values are kept for diagnosis but never treated as valid flow.
  if(quality==='valid'&&r.value!==null&&(r.value<device.min_value||r.value>device.max_value)){quality='faulty';reason='outside_device_range';}
  const twin=seen.get(at);
  if(twin){outcomes[index]=twin.value===r.value&&twin.quality===quality?{index,status:'duplicate',reason:`repeats_item_${twin.index}`}:{index,status:'conflict',reason:`different_value_than_item_${twin.index}`};return;}
  seen.set(at,{index,value:r.value,quality});
  rows.push({i:index,observed_at:new Date(at).toISOString(),value:r.value,quality,quality_reason:reason,message_id:r.messageId??null});
 });
 const result=await transaction(async db=>{
  if(rows.length){
   const {rows:inserted}=await db.query(`INSERT INTO ll_device_readings(campus_id,device_id,building_id,observed_at,value,quality,quality_reason,message_id) SELECT $1,$2,$3,r.observed_at,r.value,r.quality,r.quality_reason,r.message_id FROM jsonb_to_recordset($4::jsonb) AS r(i int,observed_at timestamptz,value double precision,quality text,quality_reason text,message_id text) ON CONFLICT DO NOTHING RETURNING observed_at`,[device.campus_id,device.id,device.building_id,JSON.stringify(rows)]);
   const insertedAt=new Set(inserted.map(r=>new Date(r.observed_at).getTime()));
   const pending=rows.filter(r=>!insertedAt.has(Date.parse(r.observed_at)));
   const existing=pending.length?(await db.query('SELECT observed_at,value,quality,message_id FROM ll_device_readings WHERE device_id=$1 AND (observed_at=ANY($2::timestamptz[]) OR message_id=ANY($3::text[]))',[device.id,pending.map(r=>r.observed_at),pending.flatMap(r=>r.message_id?[r.message_id]:[])])).rows:[];
   for(const r of rows){
    if(insertedAt.has(Date.parse(r.observed_at))){outcomes[r.i]={index:r.i,status:'accepted',...(r.quality_reason?{flagged:r.quality_reason}:{})};continue;}
    const prior=existing.find(e=>new Date(e.observed_at).getTime()===Date.parse(r.observed_at))??existing.find(e=>r.message_id&&e.message_id===r.message_id);
    const same=prior&&new Date(prior.observed_at).getTime()===Date.parse(r.observed_at)&&prior.value===r.value&&prior.quality===r.quality;
    // Existing readings are never overwritten. Identical resubmissions are idempotent.
    outcomes[r.i]=same?{index:r.i,status:'duplicate'}:{index:r.i,status:'conflict',reason:prior&&r.message_id&&prior.message_id===r.message_id&&new Date(prior.observed_at).getTime()!==Date.parse(r.observed_at)?'message_id_reused_for_different_timestamp':'different_value_already_recorded'};
   }
  }
  const count=(s:Outcome['status'])=>outcomes.filter(o=>o?.status===s).length;
  const summary={submitted:body.readings.length,accepted:count('accepted'),duplicates:count('duplicate'),conflicts:count('conflict'),rejected:count('rejected'),flagged:outcomes.filter(o=>o?.flagged).length};
  const batchId=randomUUID();
  await db.query('INSERT INTO ll_ingest_batches(id,campus_id,device_id,submitted,accepted,duplicates,conflicts,rejected,flagged,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[batchId,device.campus_id,device.id,summary.submitted,summary.accepted,summary.duplicates,summary.conflicts,summary.rejected,summary.flagged,{reasons:outcomes.filter(o=>o?.reason).slice(0,50).map(o=>o.reason)}]);
  await db.query('UPDATE ll_devices SET last_seen_at=now() WHERE id=$1',[device.id]);
  return {batchId,...summary};
 });
 logger.info('telemetry_ingested',{deviceId:device.id,...result});
 return {...result,source:'device',results:outcomes};
}

// ---------- Historical queries ----------
const time=z.union([z.coerce.number().int().nonnegative().max(253402300799000),z.string().datetime({offset:true}).transform(v=>Date.parse(v))]);
export const deviceQuery=z.object({source:z.literal('device'),buildingId:z.string().min(1).max(100).optional(),deviceId:z.string().uuid().optional(),from:time.optional(),to:time.optional(),limit:z.coerce.number().int().min(1).max(1000).default(200),cursor:z.string().max(200).optional(),bucket:z.enum(['15m','1h','1d']).optional()}).strict()
 .refine(v=>v.buildingId||v.deviceId,{message:'buildingId or deviceId is required'}).refine(v=>(v.to??Infinity)>=(v.from??0),{message:'Invalid time window'});
const bucketInterval={'15m':'15 minutes','1h':'1 hour','1d':'1 day'} as const;
export async function queryDeviceReadings(q:z.infer<typeof deviceQuery>){
 const MAX=253402300799000;// 9999-12-31, within Postgres timestamptz range
 const from=new Date(Math.min(q.from??0,MAX)).toISOString(),to=new Date(Math.min(q.to??MAX,MAX)).toISOString();
 const filters='campus_id=$1 AND ($2::text IS NULL OR building_id=$2) AND ($3::uuid IS NULL OR device_id=$3) AND observed_at BETWEEN $4 AND $5';
 const params:unknown[]=[CAMPUS,q.buildingId??null,q.deviceId??null,from,to];
 if(q.bucket){
  // Aggregates use valid readings only; missing/faulty readings are counted, never averaged as zero.
  const {rows}=await pool.query(`SELECT date_bin($6::interval,observed_at,TIMESTAMPTZ '2000-01-01') AS bucket,count(*)::int AS readings,count(*) FILTER (WHERE quality='valid')::int AS valid,avg(value) FILTER (WHERE quality='valid') AS mean,min(value) FILTER (WHERE quality='valid') AS min,max(value) FILTER (WHERE quality='valid') AS max FROM ll_device_readings WHERE ${filters} GROUP BY 1 ORDER BY 1 DESC LIMIT $7`,[...params,bucketInterval[q.bucket],q.limit]);
  return {source:'device',bucket:q.bucket,data:rows.map(r=>({...r,bucket:new Date(r.bucket).toISOString(),source:'device'}))};
 }
 let cursor:[string,number]|null=null;
 if(q.cursor){const m=Buffer.from(q.cursor,'base64url').toString().match(/^(\d+):(\d+)$/);if(!m)throw new AppError(400,'INVALID_CURSOR','Invalid cursor');cursor=[new Date(Number(m[1])).toISOString(),Number(m[2])];}
 const {rows}=await pool.query(`SELECT id,device_id AS "deviceId",building_id AS "buildingId",observed_at AS "observedAt",received_at AS "receivedAt",value,quality,quality_reason AS "qualityReason",message_id AS "messageId",source FROM ll_device_readings WHERE ${filters} AND ($6::timestamptz IS NULL OR (observed_at,id)<($6,$7::bigint)) ORDER BY observed_at DESC,id DESC LIMIT $8`,[...params,cursor?.[0]??null,cursor?.[1]??0,q.limit+1]);
 const page=rows.slice(0,q.limit).map(r=>({...r,id:String(r.id),at:new Date(r.observedAt).getTime()}));
 const last=page.at(-1);
 return {source:'device',data:page,nextCursor:rows.length>q.limit&&last?Buffer.from(`${last.at}:${last.id}`).toString('base64url'):null};
}
