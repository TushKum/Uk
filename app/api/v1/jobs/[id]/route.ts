import {scopeState} from '@/lib/access';
import {readState} from '@/lib/db';
import {AppError} from '@/lib/errors';
import {requireActor,ok,failure} from '@/lib/http';
import {getJob} from '@/lib/jobs';
import {z} from 'zod';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor();const {id}=await params;const job=await getJob(z.string().uuid().parse(id));const view=scopeState(await readState(),actor);if(actor.role==='technician'&&(view.generation!==job.generation||!view.incidents.some(i=>i.id===job.incidentId)))throw new AppError(404,'NOT_FOUND','Job not found');return ok({job});}catch(e){return failure(e);}}
