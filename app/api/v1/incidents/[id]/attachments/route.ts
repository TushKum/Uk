import {NextRequest} from 'next/server';
import {z} from 'zod';
import {failure,multipartBody,ok,requireActor,requireOrigin,userAgent} from '@/lib/http';
import {listAttachments,uploadAttachment} from '@/lib/attachments';
import {rateLimit} from '@/lib/auth';
import {config} from '@/lib/config';
import {AppError} from '@/lib/errors';
export const dynamic='force-dynamic';
const incidentId=z.string().min(1).max(100);
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor();return ok({data:await listAttachments(actor,incidentId.parse((await params).id),req.nextUrl.searchParams.get('includeDeleted')==='true')});}catch(e){return failure(e);}}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 requireOrigin(req);const actor=await requireActor();await rateLimit(`upload:${actor.id}`,20);
 const form=await multipartBody(req,config().ATTACHMENT_MAX_BYTES+64*1024);
 const file=form.get('file');if(!(file instanceof File))throw new AppError(400,'FILE_REQUIRED','Attach one file in the "file" field.');
 if(form.getAll('file').length>1)throw new AppError(400,'ONE_FILE','Upload one file per request.');
 const description=z.string().trim().max(500).optional().parse(form.get('description')??undefined)||null;
 const row=await uploadAttachment(actor,incidentId.parse((await params).id),{name:file.name,type:file.type,bytes:Buffer.from(await file.arrayBuffer())},description,{userAgent:userAgent(req)});
 return ok({attachment:row},201);}catch(e){return failure(e);}}
