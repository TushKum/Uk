import {scopeState} from '@/lib/access';
import {NextRequest} from 'next/server';
import {requireActor,requireOrigin,jsonBody,ok,failure} from '@/lib/http';
import {readState} from '@/lib/db';
import {enqueueAgent,recentJobs} from '@/lib/jobs';
import {commandSchema} from '@/lib/validation';
import {rateLimit} from '@/lib/auth';
export async function GET(){try{const actor=await requireActor(),state=scopeState(await readState(),actor),ids=new Set(state.incidents.map(i=>i.id));return ok({data:state.runs,jobs:(await recentJobs()).filter(j=>actor.role!=='technician'||ids.has(j.incidentId))});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{requireOrigin(req);const actor=await requireActor();await rateLimit(`commands:${actor.id}`);const body=await jsonBody(req,commandSchema);if(body.action!=='run_agent')return ok({error:'Use action run_agent'},400);return ok(await enqueueAgent(body,actor),202);}catch(e){return failure(e);}}
