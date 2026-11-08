import {requireRole} from './errors';
import {mutate} from './db';
import {command} from './engine';
import {enqueueAgent} from './jobs';
import type {Actor,Command} from './types';
export async function dispatchCommand(c:Command,actor:Actor){
 if(c.action==='run_agent')return {...await enqueueAgent(c,actor),accepted:true};
 if(['reset','advance','clock','inject'].includes(c.action))requireRole(actor.role==='operator','Demo operator role required');
 else if(['approve','reject','close','request_evidence'].includes(c.action))requireRole(actor.role==='manager','Manager role required');
 else requireRole(actor.role==='technician','Technician role required');
 return {state:await mutate(c,actor,async s=>command(s,c,actor)),accepted:false};
}
