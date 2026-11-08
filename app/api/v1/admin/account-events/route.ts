import {failure,ok,requireActor} from '@/lib/http';
import {accountEvents} from '@/lib/accounts';
export const dynamic='force-dynamic';
export async function GET(){try{const actor=await requireActor();return ok({data:await accountEvents(actor)});}catch(e){return failure(e);}}
