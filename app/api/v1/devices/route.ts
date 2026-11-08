import {NextRequest} from 'next/server';
import {failure,jsonBody,ok,requireActor,requireOrigin} from '@/lib/http';
import {deviceSchema,listDevices,registerDevice} from '@/lib/telemetry';
export const dynamic='force-dynamic';
export async function GET(){try{return ok({data:await listDevices(await requireActor())});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{requireOrigin(req);const actor=await requireActor();return ok(await registerDevice(actor,await jsonBody(req,deviceSchema,2000)),201);}catch(e){return failure(e);}}
