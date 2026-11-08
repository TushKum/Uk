import {NextRequest} from 'next/server';
import {requireActor,ok,failure} from '@/lib/http';
import {requireRole} from '@/lib/errors';
import {pool} from '@/lib/pool';
import {CAMPUS} from '@/lib/repository';
import {z} from 'zod';
export async function GET(req:NextRequest){try{const actor=await requireActor();requireRole(actor.role==='manager','Manager role required');const limit=z.coerce.number().int().min(1).max(200).parse(req.nextUrl.searchParams.get('limit')??50);const {rows}=await pool.query('SELECT id,generation,actor,simulated_at AS "simulatedAt",body,recorded_at AS "recordedAt" FROM ll_audit_events WHERE campus_id=$1 ORDER BY recorded_at DESC,id LIMIT $2',[CAMPUS,limit]);return ok({data:rows});}catch(e){return failure(e);}}
