import {scopeState} from '@/lib/access';
import {NextRequest} from 'next/server';
import {requireActor,requireOrigin,jsonBody,ok,failure} from '@/lib/http';
import {commandSchema} from '@/lib/validation';
import {dispatchCommand} from '@/lib/commands';
import {rateLimit} from '@/lib/auth';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{requireOrigin(req);const actor=await requireActor();await rateLimit(`commands:${actor.id}`);const body=await jsonBody(req,commandSchema),{id}=await params;if(body.workOrderId!==id||!['accept','decline','observe','complete'].includes(body.action))return ok({error:'Work order path and action must match the request'},400);const result=await dispatchCommand(body,actor);return ok({...result,state:scopeState(result.state,actor)});}catch(e){return failure(e);}}
