import {z} from 'zod';
import {failure,ok,requireActor} from '@/lib/http';
import {listSessions} from '@/lib/accounts';
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor();return ok({data:await listSessions(actor,z.string().min(1).max(100).parse((await params).id))});}catch(e){return failure(e);}}
