import {requireActor,ok,failure} from '@/lib/http';
import {readState} from '@/lib/db';
export async function GET(){try{const actor=await requireActor();const s=await readState();return ok({data:actor.role==='technician'?s.workOrders.filter(w=>w.techId===actor.id):s.workOrders,revision:s.revision});}catch(e){return failure(e);}}
