import {NextRequest} from 'next/server';
import {z} from 'zod';
import {failure,ok,requireActor,requireOrigin} from '@/lib/http';
import {appOrigin,issueResetLink} from '@/lib/accounts';
import {rateLimit} from '@/lib/auth';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{requireOrigin(req);const actor=await requireActor();await rateLimit(`admin:${actor.id}`,30);return ok(await issueResetLink(actor,z.string().min(1).max(100).parse((await params).id),appOrigin(req)),201);}catch(e){return failure(e);}}
