import {scopeState} from '@/lib/access';
import {NextRequest} from 'next/server';
import {requireActor,requireOrigin,jsonBody,failure,ok} from '@/lib/http';
import {commandSchema} from '@/lib/validation';
import {dispatchCommand} from '@/lib/commands';
import {rateLimit} from '@/lib/auth';
export async function POST(req:NextRequest){try{requireOrigin(req);const actor=await requireActor();await rateLimit(`commands:${actor.id}`);const result=await dispatchCommand(await jsonBody(req,commandSchema),actor);return ok({...result,state:scopeState(result.state,actor)},result.accepted?202:200);}catch(e){return failure(e);}}
