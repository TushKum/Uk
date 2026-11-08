import {NextRequest} from 'next/server';
import {failure,ok,requireActor,requireOrigin} from '@/lib/http';
import {revokeInvitation} from '@/lib/accounts';
import {uuid} from '@/lib/validation';
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{requireOrigin(req);const actor=await requireActor();return ok(await revokeInvitation(actor,uuid.parse((await params).id)));}catch(e){return failure(e);}}
