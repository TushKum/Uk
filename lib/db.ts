import {createHash,randomUUID} from 'node:crypto';
import {pool,type Client} from './pool';
import {CAMPUS,loadState,storeState} from './repository';
import {advance,audit} from './engine';
import {AppError} from './errors';
import type {State,Actor,Command} from './types';
export {pool};
export async function transaction<T>(fn:(db:Client)=>Promise<T>,readOnly=false):Promise<T>{const db=await pool.connect();try{await db.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');await db.query("SET LOCAL lock_timeout='5s'");const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
export function readState(){return transaction(db=>loadState(db),true);}
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return v;}
export function commandHash(c:Command){const {revision,commandId,...body}=c;return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');}
export async function mutate(c:Command,actor:Actor,fn:(s:State,db:Client)=>Promise<State>):Promise<State>{return transaction(async db=>{
 let s=await loadState(db,true);if(!c.commandId)throw new AppError(400,'INVALID_COMMAND','A unique commandId is required');
 const {rows:[prior]}=await db.query('SELECT * FROM ll_command_receipts WHERE command_id=$1',[c.commandId]);const hash=commandHash(c);
 if(prior){if(prior.actor_id!==actor.id||prior.campus_id!==CAMPUS||prior.request_hash!==hash)throw new AppError(409,'IDEMPOTENCY_CONFLICT','Command key was already used for a different request');return s;}
 if(c.revision!==s.revision)throw new AppError(409,'REVISION_CONFLICT','State changed in another view. Refresh and retry.');
 const oldGeneration=s.generation;s=await fn(s,db);if(c.action==='reset'){s.generation=randomUUID();audit(s,actor.name,`Started scenario ${s.scenario}; previous generation ${oldGeneration}`);await db.query("UPDATE ll_jobs SET status='cancelled',error='Simulation reset',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE campus_id=$1 AND status IN('queued','running')",[CAMPUS]);await db.query("UPDATE ll_agent_runs SET status='cancelled',payload=jsonb_set(payload,'{status}','\"cancelled\"') WHERE campus_id=$1 AND generation=$2 AND status IN('queued','running')",[CAMPUS,oldGeneration]);}
 s.revision++;await storeState(db,s);await db.query('INSERT INTO ll_command_receipts(command_id,campus_id,actor_id,action,request_hash,revision) VALUES($1,$2,$3,$4,$5,$6)',[c.commandId,CAMPUS,actor.id,c.action,hash,s.revision]);return s;
});}
export async function tick(){await transaction(async db=>{const s=await loadState(db,true);if(s.running){const minutes=Math.min(240,Math.floor((Date.now()-s.lastTick)/1000));if(minutes>0){advance(s,minutes);s.lastTick=Date.now();s.revision++;await storeState(db,s);}}});}
