import {ok} from '@/lib/http';
export const dynamic='force-dynamic';
// Liveness: the process is running and can answer. Deliberately does not touch the database,
// so a database outage does not cause orchestrators to restart healthy app processes.
export function GET(){return ok({status:'alive',uptimeSeconds:Math.round(process.uptime())});}
