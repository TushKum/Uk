import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {pool} from '../lib/pool';
import {heartbeat,workOnce} from '../lib/jobs';
import {configIssues} from '../lib/config';
import {logger} from '../lib/log';
process.env.LEAKLOOP_SERVICE??='leakloop-worker';
const workerId=`worker-${randomUUID()}`;const controller=new AbortController();let stopping=false;
// Graceful shutdown: stop claiming, abort any in-flight model request (the job is requeued
// without consuming a delivery attempt), then remove this worker's heartbeat so readiness drops at once.
function stop(signal:string){if(stopping)return;stopping=true;logger.info('worker_stopping',{workerId,signal});controller.abort();}
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));
const issues=configIssues();
if(issues.length){logger.error('worker_config_invalid',{issues});process.exitCode=1;await pool.end();process.exit(1);}
try{
 if(process.argv.includes('--once')){await heartbeat(workerId);console.log(await workOnce(undefined,controller.signal)?'Job processed.':'No eligible jobs.');}
 else{logger.info('worker_ready',{workerId,agentMode:process.env.AGENT_MODE||'demo'});console.log('LeakLoop durable worker ready.');
  while(!stopping){try{await heartbeat(workerId);if(!await workOnce(undefined,controller.signal))await delay(750,undefined,{signal:controller.signal}).catch(()=>{});}catch(e){if(stopping)break;logger.error('worker_error',{workerId,code:(e as {code?:string}).code??'UNKNOWN',message:(e as Error).message});await delay(2000,undefined,{signal:controller.signal}).catch(()=>{});}}}
}finally{await pool.query('DELETE FROM ll_worker_heartbeats WHERE id=$1',[workerId]).catch(()=>{});logger.info('worker_stopped',{workerId});await pool.end();}
