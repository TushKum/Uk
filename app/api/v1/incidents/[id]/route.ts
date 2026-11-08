import {scopeState} from '@/lib/access';
import {requireActor,ok,failure} from '@/lib/http';
import {readState} from '@/lib/db';
import {AppError} from '@/lib/errors';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor();const {id}=await params;const s=scopeState(await readState(),actor),i=s.incidents.find(i=>i.id===id);if(!i)throw new AppError(404,'NOT_FOUND','Incident not found');return ok({data:i,evidence:s.evidence.filter(e=>e.buildingId===i.buildingId),workOrders:s.workOrders.filter(w=>w.incidentId===i.id),revision:s.revision});}catch(e){return failure(e);}}
