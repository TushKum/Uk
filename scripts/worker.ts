import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {pool} from '../lib/pool';
import {heartbeat,workOnce} from '../lib/jobs';
const workerId=`worker-${randomUUID()}`;let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
try{if(process.argv.includes('--once')){await heartbeat(workerId);console.log(await workOnce()?'Job processed.':'No eligible jobs.');}else{console.log('LeakLoop durable worker ready.');while(!stopping){try{await heartbeat(workerId);if(!await workOnce())await delay(750);}catch(e){console.error(JSON.stringify({event:'worker_error',code:(e as {code?:string}).code??'UNKNOWN'}));await delay(2000);}}}}finally{await pool.end();}
