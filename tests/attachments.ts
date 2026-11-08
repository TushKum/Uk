// Evidence attachment integration checks: storage, access control, provenance and integrity.
// Uses a temporary local storage directory and a local fake S3 endpoint; no cloud services.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import type {AddressInfo} from 'node:net';
import {pool,readState,transaction} from '../lib/db';
import {CAMPUS,storeState} from '../lib/repository';
import {seed} from '../lib/seed';
import {deleteAttachment,listAttachments,readAttachment,uploadAttachment} from '../lib/attachments';
import type {Actor} from '../lib/types';

const root=await mkdtemp(join(tmpdir(),'leakloop-attach-'));process.env.STORAGE_DRIVER='local';process.env.STORAGE_LOCAL_DIR=root;
const checks:string[]=[];const original=await readState();const generations:string[]=[];
async function check(name:string,fn:()=>Promise<void>){await fn();checks.push(name);console.log(`PASS ${name}`);}
const code=(c:string)=>(e:unknown)=>{assert.equal((e as {code?:string}).code,c,(e as Error).message);return true;};
const manager:Actor={id:'manager-ava',role:'manager',name:'Ava Morgan',campusId:CAMPUS},ravi:Actor={id:'tech-ravi',role:'technician',name:'Ravi Shah',campusId:CAMPUS},maya:Actor={id:'tech-maya',role:'technician',name:'Maya Iyer',campusId:CAMPUS},operator:Actor={id:'operator-demo',role:'operator',name:'Demo operator',campusId:CAMPUS};
const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.from(randomUUID())]);
const photo=(name='meter.jpg',bytes=jpeg)=>({name,type:'image/jpeg',bytes});
async function files(dir=root):Promise<string[]>{const out:string[]=[];for(const e of await readdir(dir,{withFileTypes:true}))out.push(...(e.isDirectory()?await files(join(dir,e.name)):[join(dir,e.name)]));return out;}
async function fresh(status:'Assigned'|'Verified'='Assigned',closed=false){const s=seed('A');s.generation=randomUUID();s.revision=(await readState()).revision+1;generations.push(s.generation);
 s.workOrders.push({id:'WO-ATT',incidentId:'INC-1042',buildingId:'north',techId:'tech-ravi',status,createdAt:s.now,dueAt:s.now+3600000,history:[{at:s.now,text:'Assigned for attachment test'}],observations:[],checklist:[]});
 if(closed)s.incidents[0].state='Closed';await transaction(db=>storeState(db,s));return s;}
try{
 await fresh();let managerFile='',raviFile='';
 await check('managers attach photos; bytes are stored privately with a matching SHA-256',async()=>{
  const a=await uploadAttachment(manager,'INC-1042',photo(),'Meter dial at 02:10',{userAgent:'test'});managerFile=a.id as string;
  assert.equal(a.sha256,createHash('sha256').update(jpeg).digest('hex'));assert.equal(a.kind,'photo');assert.equal(a.uploadedRole,'manager');
  const stored=await files();assert.equal(stored.length,1);assert.ok(!stored[0].includes('meter.jpg'),'storage keys never use client filenames');assert.deepEqual(await readFile(stored[0]),jpeg);
  const p=a.provenance as Record<string,unknown>;assert.equal(p.source,'authenticated-upload');assert.equal(p.workOrderStatus,'Assigned');
 });
 await check('the upload is recorded in the campus audit log',async()=>{const s=await readState();assert.ok(s.audit.some(a=>a.text.includes('Attached photo “meter.jpg”')));});
 await check('assigned technicians can attach and read; others cannot see the incident',async()=>{
  raviFile=(await uploadAttachment(ravi,'INC-1042',{name:'notes.txt',type:'text/plain',bytes:Buffer.from('Valve under sink dripping.')},null)).id as string;
  assert.equal((await listAttachments(ravi,'INC-1042')).length,2);assert.equal((await readAttachment(ravi,managerFile)).contentType,'image/jpeg');
  for(const a of [maya,operator]){await assert.rejects(()=>listAttachments(a,'INC-1042'),code('NOT_FOUND'));await assert.rejects(()=>readAttachment(a,managerFile),code('NOT_FOUND'));await assert.rejects(()=>uploadAttachment(a,'INC-1042',photo(),null),code('NOT_FOUND'));}
  await assert.rejects(()=>readAttachment(manager,randomUUID()),code('NOT_FOUND'));
 });
 await check('only the uploader or a manager can delete; deletion is soft and audited',async()=>{
  await assert.rejects(()=>deleteAttachment(ravi,managerFile,'not mine'),code('FORBIDDEN'));
  await deleteAttachment(ravi,raviFile,'Uploaded to the wrong incident');
  await assert.rejects(()=>readAttachment(manager,raviFile),code('ATTACHMENT_DELETED'));await assert.rejects(()=>deleteAttachment(manager,raviFile,'again'),code('ATTACHMENT_DELETED'));
  assert.equal((await listAttachments(manager,'INC-1042')).length,1);assert.equal((await listAttachments(manager,'INC-1042',true)).length,2);
  const {rows:[r]}=await pool.query('SELECT deleted_by,delete_reason FROM ll_attachments WHERE id=$1',[raviFile]);assert.deepEqual(r,{deleted_by:'tech-ravi',delete_reason:'Uploaded to the wrong incident'});
 });
 await check('provenance is immutable and records cannot be hard-deleted or restored',async()=>{
  await assert.rejects(()=>pool.query("UPDATE ll_attachments SET sha256=repeat('0',64) WHERE id=$1",[managerFile]),/immutable/);
  await assert.rejects(()=>pool.query("UPDATE ll_attachments SET uploaded_by='tech-maya' WHERE id=$1",[managerFile]),/immutable/);
  await assert.rejects(()=>pool.query('DELETE FROM ll_attachments WHERE id=$1',[managerFile]),/retained/);
  await assert.rejects(()=>pool.query('UPDATE ll_attachments SET deleted_at=NULL,deleted_by=NULL WHERE id=$1',[raviFile]),/restored/);
 });
 await check('tampered stored bytes fail the integrity check and are not served',async()=>{const {rows:[r]}=await pool.query('SELECT storage_key FROM ll_attachments WHERE id=$1',[managerFile]);const path=join(root,r.storage_key);const good=await readFile(path);await writeFile(path,Buffer.concat([good,Buffer.from('x')]));await assert.rejects(()=>readAttachment(manager,managerFile),code('INTEGRITY_FAILURE'));await writeFile(path,good);assert.ok(await readAttachment(manager,managerFile));});
 await check('invalid files are rejected before anything is stored',async()=>{const before=(await files()).length;await assert.rejects(()=>uploadAttachment(manager,'INC-1042',{name:'x.html',type:'text/html',bytes:Buffer.from('<html><script>alert(1)</script>')},null),code('UNSUPPORTED_FILE'));await assert.rejects(()=>uploadAttachment(manager,'INC-1042',{name:'x.png',type:'image/png',bytes:jpeg},null),code('TYPE_MISMATCH'));assert.equal((await files()).length,before);});
 await check('per-incident limits are enforced and the rejected upload leaves no orphaned file',async()=>{process.env.ATTACHMENTS_PER_INCIDENT='1';try{const before=(await files()).length;await assert.rejects(()=>uploadAttachment(manager,'INC-1042',photo('second.jpg'),null),code('ATTACHMENT_LIMIT'));assert.equal((await files()).length,before);}finally{delete process.env.ATTACHMENTS_PER_INCIDENT;}});
 await check('closed incidents and completed work orders do not accept new evidence',async()=>{await fresh('Verified');await assert.rejects(()=>uploadAttachment(ravi,'INC-1042',photo(),null),code('WORK_NOT_ACTIVE'));await fresh('Assigned',true);await assert.rejects(()=>uploadAttachment(manager,'INC-1042',photo(),null),code('INCIDENT_CLOSED'));});
 await check('attachments from earlier scenario generations stay readable by managers only',async()=>{assert.ok(await readAttachment(manager,managerFile));await assert.rejects(()=>readAttachment(ravi,managerFile),code('NOT_FOUND'));});

 await check('S3-compatible storage driver stores, reads and deletes signed objects',async()=>{
  const objects=new Map<string,Buffer>();const auth:string[]=[];
  const s3=createServer(async(req,res)=>{auth.push(req.headers.authorization??'');const key=decodeURIComponent(new URL(req.url!,'http://x').pathname);const chunks:Buffer[]=[];for await(const c of req)chunks.push(c as Buffer);
   if(req.method==='PUT'){objects.set(key,Buffer.concat(chunks));res.setHeader('ETag','"x"');res.end();}else if(req.method==='GET'&&objects.has(key)){res.setHeader('Content-Type','application/octet-stream');res.end(objects.get(key));}else if(req.method==='DELETE'){objects.delete(key);res.statusCode=204;res.end();}else if(req.method==='HEAD'){res.end();}else{res.statusCode=404;res.end('<Error><Code>NoSuchKey</Code></Error>');}});
  await new Promise<void>(r=>s3.listen(0,'127.0.0.1',r));
  Object.assign(process.env,{STORAGE_DRIVER:'s3',S3_BUCKET:'evidence',S3_REGION:'us-east-1',S3_ENDPOINT:`http://127.0.0.1:${(s3.address() as AddressInfo).port}`,S3_FORCE_PATH_STYLE:'true',S3_PREFIX:'leakloop',AWS_ACCESS_KEY_ID:'test-access-key',AWS_SECRET_ACCESS_KEY:'test-secret-key'});
  try{await fresh();const a=await uploadAttachment(manager,'INC-1042',photo('s3.jpg'),null);assert.equal(a.storage,'s3');
   const key=[...objects.keys()][0];assert.match(key,/^\/evidence\/leakloop\/incidents\//);assert.ok(auth.every(h=>h.startsWith('AWS4-HMAC-SHA256')),'requests are SigV4 signed');
   assert.deepEqual((await readAttachment(manager,a.id as string)).bytes,jpeg);
   process.env.ATTACHMENTS_PER_INCIDENT='1';try{await assert.rejects(()=>uploadAttachment(manager,'INC-1042',photo('extra.jpg'),null),code('ATTACHMENT_LIMIT'));assert.equal(objects.size,1,'compensating delete removed the orphan object');}finally{delete process.env.ATTACHMENTS_PER_INCIDENT;}
  }finally{s3.close();for(const k of ['S3_BUCKET','S3_REGION','S3_ENDPOINT','S3_FORCE_PATH_STYLE','S3_PREFIX','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'])delete process.env[k];process.env.STORAGE_DRIVER='local';}
 });
 writeFileSync('evaluation/attachments-results.json',JSON.stringify({passed_checks:checks.length,checks,generatedAt:new Date().toISOString(),storage:'temporary local directory and local fake S3 endpoint; no cloud object store contacted'},null,2)+'\n');
 console.log(`${checks.length} attachment checks passed.`);
}finally{
 await transaction(db=>storeState(db,original));
 // Test generations only: remove their attachment rows (guard trigger disabled briefly for cleanup), keep everything else.
 await transaction(async db=>{await db.query('ALTER TABLE ll_attachments DISABLE TRIGGER ll_attachments_guard');await db.query('DELETE FROM ll_attachments WHERE generation=ANY($1::uuid[])',[generations]);await db.query('ALTER TABLE ll_attachments ENABLE TRIGGER ll_attachments_guard');});
 await rm(root,{recursive:true,force:true});await pool.end();
}
