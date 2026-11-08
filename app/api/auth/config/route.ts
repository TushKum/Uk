import {ok,failure} from '@/lib/http';
import {publicConfig} from '@/lib/config';
import {demoEnabled} from '@/lib/auth';
export const dynamic='force-dynamic';
export async function GET(){try{return ok({...publicConfig(),demoEnabled:demoEnabled()});}catch(e){return failure(e);}}
