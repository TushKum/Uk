import {NextRequest} from 'next/server';
import {z} from 'zod';
import {failure,ok,requireActor,requireOrigin,jsonBody} from '@/lib/http';
import {updateUser} from '@/lib/accounts';
import {userUpdateSchema} from '@/lib/validation';
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{requireOrigin(req);const actor=await requireActor();const id=z.string().min(1).max(100).parse((await params).id);return ok(await updateUser(actor,id,await jsonBody(req,userUpdateSchema,500)));}catch(e){return failure(e);}}
