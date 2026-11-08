import {NextRequest} from 'next/server';
import {requireActor,ok,failure} from '@/lib/http';
import {pool} from '@/lib/pool';
import {CAMPUS} from '@/lib/repository';
import {telemetryQuery} from '@/lib/validation';
export async function GET(req:NextRequest){try{await requireActor();const q=telemetryQuery.parse(Object.fromEntries(req.nextUrl.searchParams));const {rows}=await pool.query(`SELECT id,building_id AS "buildingId",observed_at AS at,value,quality FROM ll_readings WHERE campus_id=$1 AND generation=(SELECT generation FROM ll_runtime WHERE campus_id=$1) AND building_id=$2 AND observed_at BETWEEN $3 AND $4 ORDER BY observed_at DESC,ordinal DESC LIMIT $5`,[CAMPUS,q.buildingId,q.from,q.to,q.limit]);return ok({data:rows.map(r=>({...r,at:Number(r.at)})),limit:q.limit});}catch(e){return failure(e);}}
