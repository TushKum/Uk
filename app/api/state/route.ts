import {scopeState} from '@/lib/access';
import {readState,tick} from '@/lib/db';
import {demoEnabled} from '@/lib/auth';
import {requireActor,ok,failure} from '@/lib/http';
import {recentJobs} from '@/lib/jobs';
import {pool} from '@/lib/pool';
export const dynamic='force-dynamic';
export async function GET(){try{const actor=await requireActor();await tick();const state=scopeState(await readState(),actor);const ids=new Set(state.incidents.map(i=>i.id));const {rows:[w]}=await pool.query("SELECT EXISTS(SELECT 1 FROM ll_worker_heartbeats WHERE seen_at>now()-interval '45 seconds') online");return ok({workerOnline:w.online,state,actor,jobs:(await recentJobs()).filter(j=>actor.role!=='technician'||ids.has(j.incidentId)),demoEnabled:demoEnabled(),mode:process.env.AGENT_MODE??'demo',liveConfigured:!!process.env.OPENAI_API_KEY&&!!process.env.OPENAI_MODEL});}catch(e){const response=failure(e);if(response.status===401)return ok({error:'Sign in to continue.',code:'UNAUTHENTICATED',demoEnabled:demoEnabled()},401);return response;}}
