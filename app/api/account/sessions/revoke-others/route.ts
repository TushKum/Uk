import {NextRequest} from 'next/server';
import {failure,ok,requireActor,requireOrigin} from '@/lib/http';
import {revokeOtherSessions} from '@/lib/accounts';
export async function POST(req:NextRequest){try{requireOrigin(req);const actor=await requireActor();return ok(await revokeOtherSessions(actor));}catch(e){return failure(e);}}
