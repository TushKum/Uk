import {failure,ok,requireActor} from '@/lib/http';
import {listSessions} from '@/lib/accounts';
export const dynamic='force-dynamic';
export async function GET(){try{const actor=await requireActor();return ok({data:await listSessions(actor)});}catch(e){return failure(e);}}
