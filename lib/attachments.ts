import {createHash,randomUUID} from 'node:crypto';
import {basename} from 'node:path';
import {pool} from './pool';
import {readState,transaction} from './db';
import {CAMPUS,loadState,storeState} from './repository';
import {audit} from './engine';
import {AppError} from './errors';
import {config} from './config';
import {objectStore} from './storage';
import {logger} from './log';
import type {Actor,State} from './types';

export type AllowedType='image/jpeg'|'image/png'|'image/webp'|'application/pdf'|'text/plain';
const extensions:Record<AllowedType,string[]>={'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp'],'application/pdf':['pdf'],'text/plain':['txt','log','csv']};

/** Identify a file by its content, never by the client-declared type or extension. */
export function sniff(b:Buffer):AllowedType|null{
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'image/png';
 if(b.length>=12&&b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP')return 'image/webp';
 if(b.length>=5&&b.toString('latin1',0,5)==='%PDF-')return 'application/pdf';
 if(!b.includes(0)){try{new TextDecoder('utf-8',{fatal:true}).decode(b);const head=b.toString('utf8',0,512).trimStart().toLowerCase();if(/^<(!doctype|html|svg|\?xml|script)/.test(head))return null;return 'text/plain';}catch{return null;}}
 return null;
}
export function safeName(name:string){const n=basename(name.replace(/\\/g,'/')).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,'').replace(/[^\w .()+-]/g,'_').replace(/^\.+/,'').trim().slice(0,200);return n||'attachment';}

export function validateFile(bytes:Buffer,name:string,declared:string){
 const c=config();
 if(!bytes.length)throw new AppError(400,'EMPTY_FILE','The file is empty.');
 if(bytes.length>c.ATTACHMENT_MAX_BYTES)throw new AppError(413,'FILE_TOO_LARGE',`Files must be at most ${Math.floor(c.ATTACHMENT_MAX_BYTES/1048576)} MB.`);
 const type=sniff(bytes);if(!type)throw new AppError(415,'UNSUPPORTED_FILE','Upload a JPEG, PNG or WebP photo, a PDF, or a plain-text document.');
 const ext=name.split('.').pop()?.toLowerCase()??'';
 if(!extensions[type].includes(ext))throw new AppError(415,'TYPE_MISMATCH',`The file content is ${type}, which does not match the .${ext||'(none)'} extension.`);
 const declaredType=declared.split(';')[0].trim().toLowerCase();
 if(declaredType&&declaredType!=='application/octet-stream'&&declaredType!==type&&!(type==='text/plain'&&declaredType.startsWith('text/')))throw new AppError(415,'TYPE_MISMATCH','The declared file type does not match its content.');
 if(type==='application/pdf'){const text=bytes.toString('latin1');if(/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/.test(text))throw new AppError(415,'ACTIVE_CONTENT','PDFs with scripts, embedded files or automatic actions are not accepted.');}
 return {type,kind:type.startsWith('image/')?'photo' as const:'document' as const,sha256:createHash('sha256').update(bytes).digest('hex'),declaredType:declaredType||null};
}

/** Managers see all incident evidence; technicians only incidents they are assigned; operators none. */
function access(state:State,actor:Actor,incidentId:string){
 const incident=state.incidents.find(i=>i.id===incidentId);
 const work=state.workOrders.find(w=>w.incidentId===incidentId&&w.techId===actor.id);
 if(actor.role==='manager'&&incident)return {incident,work:state.workOrders.find(w=>w.incidentId===incidentId)};
 if(actor.role==='technician'&&incident&&work)return {incident,work};
 throw new AppError(404,'NOT_FOUND','Incident not found');// identical response whether it exists or is out of scope
}
const publicRow=(r:Record<string,unknown>)=>({id:r.id,incidentId:r.incident_id,workOrderId:r.work_order_id,kind:r.kind,contentType:r.content_type,name:r.original_name,sizeBytes:Number(r.size_bytes),sha256:r.sha256,description:r.description,uploadedBy:r.uploaded_by,uploadedByName:r.uploader_name,uploadedRole:r.uploaded_role,uploadedAt:r.uploaded_at,simulatedAt:Number(r.simulated_at),incidentState:r.incident_state,storage:r.storage_driver,provenance:r.provenance,deletedAt:r.deleted_at,deletedBy:r.deleted_by,deleteReason:r.delete_reason});

export async function listAttachments(actor:Actor,incidentId:string,includeDeleted=false){
 const s=await readState();access(s,actor,incidentId);
 const {rows}=await pool.query(`SELECT a.*,u.name AS uploader_name FROM ll_attachments a JOIN ll_users u ON u.id=a.uploaded_by WHERE a.campus_id=$1 AND a.generation=$2 AND a.incident_id=$3 AND ($4 OR a.deleted_at IS NULL) ORDER BY a.uploaded_at DESC`,[CAMPUS,s.generation,incidentId,includeDeleted&&actor.role==='manager']);
 return rows.map(publicRow);
}

export async function uploadAttachment(actor:Actor,incidentId:string,file:{name:string;type:string;bytes:Buffer},description:string|null,context:{userAgent?:string|null}={}){
 const snapshot=await readState();const {incident,work}=access(snapshot,actor,incidentId);
 if(incident.state==='Closed')throw new AppError(409,'INCIDENT_CLOSED','Closed incidents do not accept new evidence. Open a new investigation instead.');
 if(actor.role==='technician'&&!['Assigned','In progress','Awaiting verification'].includes(work!.status))throw new AppError(409,'WORK_NOT_ACTIVE','Evidence can be attached only while your work order is active.');
 const name=safeName(file.name);const v=validateFile(file.bytes,name,file.type);
 const id=randomUUID(),store=objectStore(),key=`incidents/${snapshot.generation}/${incidentId}/${id}`;
 await store.put(key,file.bytes,v.type);
 try{
  return await transaction(async db=>{
   const s=await loadState(db,true);
   if(s.generation!==snapshot.generation)throw new AppError(409,'REVISION_CONFLICT','The simulation was reset during upload. Retry.');
   const {incident:i,work:w}=access(s,actor,incidentId);
   const {rows:[count]}=await db.query('SELECT count(*)::int n FROM ll_attachments WHERE campus_id=$1 AND generation=$2 AND incident_id=$3 AND deleted_at IS NULL',[CAMPUS,s.generation,incidentId]);
   if(count.n>=config().ATTACHMENTS_PER_INCIDENT)throw new AppError(409,'ATTACHMENT_LIMIT',`An incident can hold at most ${config().ATTACHMENTS_PER_INCIDENT} attachments.`);
   const provenance={source:'authenticated-upload',serverReceivedAt:new Date().toISOString(),simulatedClock:s.now,evidenceVersion:i.evidenceVersion,workOrderStatus:w?.status??null,declaredType:v.declaredType,clientFilename:file.name.slice(0,200),userAgent:context.userAgent??null,
    note:'Hash covers the exact bytes received. Capture time, location and device are not verified by LeakLoop; embedded image metadata is retained unmodified.'};
   const {rows:[row]}=await db.query(`INSERT INTO ll_attachments(id,campus_id,generation,incident_id,work_order_id,kind,content_type,declared_type,original_name,size_bytes,sha256,storage_driver,storage_key,description,uploaded_by,uploaded_role,simulated_at,incident_state,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [id,CAMPUS,s.generation,incidentId,w?.id??null,v.kind,v.type,v.declaredType,name,file.bytes.length,v.sha256,store.driver,key,description,actor.id,actor.role,s.now,i.state,provenance]);
   audit(s,actor.name,`Attached ${v.kind} “${name}” (${file.bytes.length} bytes, sha256 ${v.sha256.slice(0,12)}…) to ${incidentId}. Not analysed by the agent.`);
   s.revision++;await storeState(db,s);
   logger.info('attachment_uploaded',{attachmentId:id,incidentId,kind:v.kind,sizeBytes:file.bytes.length,actorId:actor.id});
   return {...publicRow({...row,uploader_name:actor.name}),revision:s.revision};
  });
 }catch(e){await store.remove(key).catch(err=>logger.error('attachment_orphan_cleanup_failed',{key,error:(err as Error).message}));throw e;}
}

async function loadRow(actor:Actor,id:string){
 const s=await readState();
 const {rows:[row]}=await pool.query('SELECT * FROM ll_attachments WHERE id=$1 AND campus_id=$2',[id,CAMPUS]);
 // Attachments from earlier scenario generations remain readable by managers only.
 if(!row)throw new AppError(404,'NOT_FOUND','Attachment not found');
 if(row.generation!==s.generation){if(actor.role!=='manager')throw new AppError(404,'NOT_FOUND','Attachment not found');}
 else access(s,actor,row.incident_id);
 return {row,state:s};
}
export async function readAttachment(actor:Actor,id:string){
 const {row}=await loadRow(actor,id);
 if(row.deleted_at)throw new AppError(410,'ATTACHMENT_DELETED','This attachment was deleted.');
 const bytes=await objectStore().get(row.storage_key);
 const actual=createHash('sha256').update(bytes).digest('hex');
 if(actual!==row.sha256){logger.error('attachment_integrity_failure',{attachmentId:id});throw new AppError(500,'INTEGRITY_FAILURE','The stored file failed its integrity check and was not served.');}
 return {bytes,contentType:row.content_type as AllowedType,name:row.original_name as string,kind:row.kind as string,sha256:row.sha256 as string};
}
export async function deleteAttachment(actor:Actor,id:string,reason:string){
 const {row}=await loadRow(actor,id);
 if(row.deleted_at)throw new AppError(410,'ATTACHMENT_DELETED','This attachment was already deleted.');
 if(actor.role!=='manager'&&row.uploaded_by!==actor.id)throw new AppError(403,'FORBIDDEN','Only a manager or the uploader can delete this attachment.');
 return transaction(async db=>{
  const s=await loadState(db,true);
  const {rowCount}=await db.query('UPDATE ll_attachments SET deleted_at=now(),deleted_by=$2,delete_reason=$3 WHERE id=$1 AND deleted_at IS NULL',[id,actor.id,reason]);
  if(!rowCount)throw new AppError(410,'ATTACHMENT_DELETED','This attachment was already deleted.');
  if(s.generation===row.generation){audit(s,actor.name,`Deleted attachment “${row.original_name}” from ${row.incident_id}: ${reason}`);s.revision++;await storeState(db,s);}
  return {deleted:true,revision:s.revision};
 });
}
/** Removes stored bytes of attachments soft-deleted longer than the purge window. Metadata is kept. */
export async function purgeDeletedAttachments(days=config().ATTACHMENT_PURGE_DAYS){
 const {rows}=await pool.query("SELECT id,storage_key FROM ll_attachments WHERE deleted_at<now()-make_interval(days=>$1) AND purged_at IS NULL LIMIT 500",[days]);
 let purged=0;for(const r of rows){try{await objectStore().remove(r.storage_key);await pool.query('UPDATE ll_attachments SET purged_at=now() WHERE id=$1',[r.id]);purged++;}catch(e){logger.warn('attachment_purge_failed',{attachmentId:r.id,error:(e as Error).message});}}
 return purged;
}
