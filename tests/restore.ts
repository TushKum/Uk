// Backup → restore drill. Restores into a temporary database on the same server, verifies
// checksums, row counts and table contents, then drops ONLY that temporary database.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import pg from 'pg';
import {createBackup,restoreBackup} from '../scripts/backup-lib';

const url=process.env.DATABASE_URL!;assert.ok(url,'DATABASE_URL required');
const work=await mkdtemp(join(tmpdir(),'leakloop-restore-'));const scratch=`leakloop_restore_drill_${Date.now()}`;
const admin=new pg.Client({connectionString:url});await admin.connect();
const target=(()=>{const u=new URL(url);u.pathname=`/${scratch}`;return u.toString();})();
const checks:string[]=[];const check=async(n:string,f:()=>Promise<void>)=>{await f();checks.push(n);console.log(`PASS ${n}`);};
const digestOf=async(conn:string,table:string)=>{const c=new pg.Client({connectionString:conn});await c.connect();try{return (await c.query(`SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) h FROM ${table} t`)).rows[0].h;}finally{await c.end();}};
let created=false;
try{
 const attachments=join(work,'attachments');await mkdir(join(attachments,'incidents'),{recursive:true});await writeFile(join(attachments,'incidents','sample.bin'),'evidence bytes');
 const {dir,manifest}=await createBackup({databaseUrl:url,outDir:join(work,'backups'),attachmentsDir:attachments});
 await check('backup writes a checksummed dump, attachment archive and manifest',async()=>{assert.ok(manifest.database.bytes>0);assert.match(manifest.database.sha256,/^[a-f0-9]{64}$/);assert.ok(manifest.attachments);assert.ok(manifest.migrations.length>=6);assert.ok(manifest.rowCounts.ll_users>0);});
 await check('restore refuses the live DATABASE_URL',async()=>{await assert.rejects(()=>restoreBackup({manifestPath:join(dir,'manifest.json'),targetUrl:url,currentUrl:url}),/Refusing/);});
 await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(scratch)}`);created=true;
 await check('restore refuses a corrupted dump before touching the target',async()=>{const p=join(dir,'database.dump');const good=await readFile(p);await writeFile(p,Buffer.concat([good,Buffer.from('x')]));await assert.rejects(()=>restoreBackup({manifestPath:join(dir,'manifest.json'),targetUrl:target,currentUrl:url}),/checksum/);await writeFile(p,good);});
 const restoredAttachments=join(work,'restored-attachments');
 const r=await restoreBackup({manifestPath:join(dir,'manifest.json'),targetUrl:target,currentUrl:url,attachmentsTarget:restoredAttachments});
 await check('restored database matches every table row count and migration',async()=>{assert.deepEqual(r.mismatches,[]);assert.deepEqual(r.migrations,manifest.migrations);});
 await check('restored security-relevant tables are byte-identical',async()=>{for(const t of ['ll_users','ll_audit_events','ll_account_events','schema_migrations'])assert.equal(await digestOf(target,t),await digestOf(url,t),t);});
 await check('append-only triggers survive restore',async()=>{const c=new pg.Client({connectionString:target});await c.connect();try{await assert.rejects(()=>c.query("UPDATE ll_audit_events SET body='x' WHERE id IN (SELECT id FROM ll_audit_events LIMIT 1)"),/append-only/);}finally{await c.end();}});
 await check('attachment files are restored intact',async()=>{assert.equal(await readFile(join(restoredAttachments,'incidents','sample.bin'),'utf8'),'evidence bytes');});
 await check('restore refuses a non-empty target database',async()=>{await assert.rejects(()=>restoreBackup({manifestPath:join(dir,'manifest.json'),targetUrl:target,currentUrl:url}),/not empty/);});
 writeFileSync('evaluation/restore-results.json',JSON.stringify({passed_checks:checks.length,checks,tables:Object.keys(manifest.rowCounts).length,databaseBytes:manifest.database.bytes,pgDump:manifest.database.pgDumpVersion,generatedAt:new Date().toISOString(),scope:'same-server scratch database; cross-host and point-in-time recovery not tested'},null,2)+'\n');
 console.log(`${checks.length} backup/restore checks passed.`);
}finally{if(created)await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(scratch)}`);await admin.end();await rm(work,{recursive:true,force:true});}
