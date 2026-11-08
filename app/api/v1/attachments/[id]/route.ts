import {NextRequest} from 'next/server';
import {z} from 'zod';
import {failure,jsonBody,ok,requireActor,requireOrigin} from '@/lib/http';
import {deleteAttachment} from '@/lib/attachments';
import {uuid} from '@/lib/validation';
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{requireOrigin(req);const actor=await requireActor();const {reason}=await jsonBody(req,z.object({reason:z.string().trim().min(3).max(300)}).strict(),1000);return ok(await deleteAttachment(actor,uuid.parse((await params).id),reason));}catch(e){return failure(e);}}
