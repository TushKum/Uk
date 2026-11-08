import {pool} from '@/lib/pool';
import {ok} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(){try{const {rows:[row]}=await pool.query("SELECT (SELECT count(*)::int FROM schema_migrations) migrations, EXISTS(SELECT 1 FROM ll_worker_heartbeats WHERE seen_at>now()-interval '45 seconds') worker_ready");return ok({status:row.worker_ready?'ready':'degraded',database:'connected',worker:row.worker_ready?'online':'offline',migrations:row.migrations},row.worker_ready?200:503);}catch{return ok({status:'unavailable',database:'disconnected',worker:'unknown'},503);}}
