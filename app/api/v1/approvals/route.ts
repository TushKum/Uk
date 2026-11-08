import {requireActor,ok,failure} from '@/lib/http';
import {readState} from '@/lib/db';
import {requireRole} from '@/lib/errors';
export async function GET(){try{const actor=await requireActor();requireRole(actor.role==='manager','Manager role required');const s=await readState();return ok({data:s.incidents.flatMap(i=>i.proposal?.status==='pending'?[{incidentId:i.id,...i.proposal}]:[]),revision:s.revision});}catch(e){return failure(e);}}
