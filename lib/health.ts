import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pool} from './pool';
import {configIssues,config} from './config';
import {objectStore} from './storage';

type Check={status:'ok'|'degraded'|'fail';detail?:string};
async function timed<T>(fn:()=>Promise<T>,ms=3000):Promise<T>{return Promise.race([fn(),new Promise<never>((_,r)=>setTimeout(()=>r(new Error('timeout')),ms))]);}

/**
 * Readiness: can this instance serve traffic correctly right now?
 * fail → 503 (remove from load balancer). degraded → 200 with details (e.g. worker offline:
 * reads and approvals still work, investigations queue until a worker returns).
 */
export async function readiness(){
 const checks:Record<string,Check>={};
 const issues=configIssues();checks.config=issues.length?{status:'fail',detail:issues.join('; ')}:{status:'ok'};
 try{
  const files=(await readdir(join(process.cwd(),'migrations'))).filter(f=>f.endsWith('.sql'));
  const {rows}=await timed(()=>pool.query('SELECT version FROM schema_migrations'));
  const applied=new Set(rows.map(r=>r.version));const pending=files.filter(f=>!applied.has(f));
  checks.database={status:'ok'};
  checks.migrations=pending.length?{status:'fail',detail:`pending: ${pending.join(', ')}`}:{status:'ok',detail:`${applied.size} applied`};
  const {rows:[w]}=await pool.query("SELECT count(*)::int n FROM ll_worker_heartbeats WHERE seen_at>now()-interval '45 seconds'");
  checks.worker=w.n?{status:'ok',detail:`${w.n} online`}:{status:'degraded',detail:'no worker heartbeat in 45 seconds; investigations will wait in the queue'};
 }catch(e){checks.database={status:'fail',detail:(e as {code?:string}).code??(e as Error).message};}
 if(!issues.length){try{await timed(()=>objectStore().check());checks.storage={status:'ok',detail:config().STORAGE_DRIVER};}catch(e){checks.storage={status:'degraded',detail:`attachment storage unavailable (${(e as Error).name})`};}}
 const values=Object.values(checks).map(c=>c.status);
 const status=values.includes('fail')?'unavailable':values.includes('degraded')?'degraded':'ready';
 return {status,checks,agentMode:issues.length?'unknown':config().AGENT_MODE,checkedAt:new Date().toISOString()};
}
