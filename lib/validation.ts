import {z} from 'zod';
export const loginSchema=z.object({email:z.string().trim().toLowerCase().email().max(254),password:z.string().min(1).max(256)}).strict();
export const commandSchema=z.object({
 action:z.enum(['reset','advance','clock','inject','run_agent','approve','reject','close','request_evidence','accept','decline','observe','complete']),
 commandId:z.string().min(8).max(100).regex(/^[a-zA-Z0-9:_-]+$/),revision:z.number().int().positive(),
 incidentId:z.string().min(1).max(100).optional(),workOrderId:z.string().min(1).max(100).optional(),proposalId:z.string().min(1).max(100).optional(),
 version:z.number().int().positive().optional(),techId:z.string().max(100).optional(),text:z.string().trim().max(2000).optional(),
 scenario:z.enum(['A','B','C','D','E','F']).optional(),minutes:z.number().int().min(1).max(240).optional(),event:z.enum(['start','pause','duplicate_report','manual_reading','tool_failure','stale_telemetry','meter_fault']).optional(),
 checklist:z.array(z.enum(['location','meter','findings'])).max(3).optional()
}).strict().superRefine((c,ctx)=>{
 const need=(ok:unknown,path:string,message:string)=>{if(!ok)ctx.addIssue({code:'custom',path:[path],message});};
 if(['run_agent','approve','reject','close','request_evidence'].includes(c.action))need(c.incidentId,'incidentId','Incident is required');
 if(['approve','reject','close'].includes(c.action)){need(c.proposalId,'proposalId','Proposal is required');need(c.version,'version','Proposal version is required');}
 if(['accept','decline','observe','complete'].includes(c.action))need(c.workOrderId,'workOrderId','Work order is required');
 if(['reject','request_evidence','decline','observe','complete'].includes(c.action))need(c.text,'text','A note is required');
 if(c.action==='reset')need(c.scenario,'scenario','Scenario is required');
 if(c.action==='advance')need(c.minutes,'minutes','Minutes are required');
 if(c.action==='clock')need(['start','pause'].includes(c.event??''),'event','Choose start or pause');
 if(c.action==='inject')need(['duplicate_report','manual_reading','tool_failure','stale_telemetry'].includes(c.event??''),'event','Choose a simulation event');
 if(c.action==='complete')need(c.checklist?.length===3&&new Set(c.checklist).size===3,'checklist','All three inspection checks are required');
});
export const telemetryQuery=z.object({buildingId:z.string().min(1).max(100),from:z.coerce.number().int().nonnegative().default(0),to:z.coerce.number().int().nonnegative().default(Number.MAX_SAFE_INTEGER),limit:z.coerce.number().int().min(1).max(500).default(100)}).strict().refine(v=>v.to>=v.from,{message:'Invalid time window'});
