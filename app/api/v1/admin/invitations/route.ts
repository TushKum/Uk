import {NextRequest} from 'next/server';
import {failure,ok,requireActor,requireOrigin,jsonBody} from '@/lib/http';
import {appOrigin,createInvitation,listInvitations} from '@/lib/accounts';
import {invitationSchema} from '@/lib/validation';
import {rateLimit} from '@/lib/auth';
export const dynamic='force-dynamic';
export async function GET(){try{const actor=await requireActor();return ok({data:await listInvitations(actor)});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{requireOrigin(req);const actor=await requireActor();await rateLimit(`admin:${actor.id}`,30);const body=await jsonBody(req,invitationSchema,2000);return ok(await createInvitation(actor,body,appOrigin(req)),201);}catch(e){return failure(e);}}
