import {NextRequest} from 'next/server';
import {rateLimit} from '@/lib/auth';
import {jsonBody,failure,ok,requireActor,requireOrigin} from '@/lib/http';
import {changePasswordSchema} from '@/lib/validation';
import {changePassword} from '@/lib/accounts';
export async function POST(req:NextRequest){try{requireOrigin(req);const actor=await requireActor();await rateLimit(`password-change:${actor.id}`,10);const body=await jsonBody(req,changePasswordSchema,1500);return ok(await changePassword(actor,body.currentPassword,body.newPassword));}catch(e){return failure(e);}}
