import {NextRequest} from 'next/server';
import {requireActor,ok,failure} from '@/lib/http';
import {pool} from '@/lib/pool';
import {CAMPUS} from '@/lib/repository';
import {telemetryQuery} from '@/lib/validation';
import {deviceQuery,queryDeviceReadings} from '@/lib/telemetry';
// source=simulated (default) returns the fictional scenario readings on the simulated clock.
// source=device returns real readings received from registered devices, on wall-clock time.
// The two are never merged in one response.
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{await requireActor();const params=Object.fromEntries(req.nextUrl.searchParams);
 if(params.source==='device')return ok(await queryDeviceReadings(deviceQuery.parse(params)));
 const {source:_source,...rest}=params;if(_source!==undefined&&_source!=='simulated')return ok({error:'source must be simulated or device',code:'VALIDATION_ERROR'},400);
 const q=telemetryQuery.parse(rest);const {rows}=await pool.query(`SELECT id,building_id AS "buildingId",observed_at AS at,value,quality FROM ll_readings WHERE campus_id=$1 AND generation=(SELECT generation FROM ll_runtime WHERE campus_id=$1) AND building_id=$2 AND observed_at BETWEEN $3 AND $4 ORDER BY observed_at DESC,ordinal DESC LIMIT $5`,[CAMPUS,q.buildingId,q.from,q.to,q.limit]);return ok({source:'simulated',data:rows.map(r=>({...r,at:Number(r.at),source:'simulated'})),limit:q.limit});}catch(e){return failure(e);}}
