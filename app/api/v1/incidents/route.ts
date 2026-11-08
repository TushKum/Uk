import {scopeState} from '@/lib/access';
import {requireActor,ok,failure} from '@/lib/http';
import {readState} from '@/lib/db';
export async function GET(){try{const actor=await requireActor();const s=scopeState(await readState(),actor);return ok({data:s.incidents,revision:s.revision});}catch(e){return failure(e);}}
