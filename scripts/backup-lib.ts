import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync} from 'node:fs';
import {mkdir,readFile,readdir,writeFile,stat} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {promisify} from 'node:util';
import pg from 'pg';

const run=promisify(execFile);
export type Manifest={format:'leakloop-backup/1';createdAt:string;database:{file:string;sha256:string;bytes:number;pgDumpVersion:string};attachments:{file:string;sha256:string;bytes:number}|null;migrations:string[];rowCounts:Record<string,number>;notes:string[]};

/** Connection settings passed to pg tools through PG* variables so passwords never appear in process arguments. */
export function pgEnv(url:string){
 const u=new URL(url);const env:NodeJS.ProcessEnv={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGDATABASE:decodeURIComponent(u.pathname.slice(1)||'postgres')};
 if(u.password)env.PGPASSWORD=decodeURIComponent(u.password);
 const ssl=u.searchParams.get('sslmode');if(ssl)env.PGSSLMODE=ssl;
 return env;
}
export const sameDatabase=(a:string,b:string)=>{const x=new URL(a),y=new URL(b);return x.hostname===y.hostname&&(x.port||'5432')===(y.port||'5432')&&(x.pathname||'/postgres')===(y.pathname||'/postgres');};
async function sha256(path:string){const h=createHash('sha256');for await(const c of createReadStream(path))h.update(c);return h.digest('hex');}
async function rowCounts(url:string){
 const client=new pg.Client({connectionString:url});await client.connect();
 try{
  const {rows:tables}=await client.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND (tablename LIKE 'll\\_%' OR tablename IN ('schema_migrations','leakloop_state','leakloop_commands')) ORDER BY 1");
  const counts:Record<string,number>={};for(const t of tables)counts[t.tablename]=(await client.query(`SELECT count(*)::int n FROM ${client.escapeIdentifier(t.tablename)}`)).rows[0].n;
  const migrations=counts.schema_migrations!==undefined?(await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version):[];
  return {counts,migrations};
 }finally{await client.end();}
}

export async function createBackup({databaseUrl,outDir,attachmentsDir}:{databaseUrl:string;outDir:string;attachmentsDir?:string|null}){
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');const dir=resolve(outDir,`leakloop-${stamp}`);await mkdir(dir,{recursive:true,mode:0o700});
 const env=pgEnv(databaseUrl);
 const dump=join(dir,'database.dump');
 // Custom format: compressed, restorable selectively with pg_restore. Taken from a consistent snapshot.
 await run('pg_dump',['--format=custom','--no-owner','--no-privileges','--file',dump],{env});
 const {stdout:version}=await run('pg_dump',['--version']);
 let attachments:Manifest['attachments']=null;
 if(attachmentsDir&&existsSync(attachmentsDir)&&(await readdir(attachmentsDir)).length){const file=join(dir,'attachments.tar.gz');await run('tar',['-czf',file,'-C',resolve(attachmentsDir),'.']);attachments={file:basename(file),sha256:await sha256(file),bytes:(await stat(file)).size};}
 const {counts,migrations}=await rowCounts(databaseUrl);
 const manifest:Manifest={format:'leakloop-backup/1',createdAt:new Date().toISOString(),database:{file:'database.dump',sha256:await sha256(dump),bytes:(await stat(dump)).size,pgDumpVersion:version.trim()},attachments,migrations,rowCounts:counts,
  notes:['Row counts are taken just after the dump and may differ slightly if writes continued.','Object-storage (S3) attachments are not included; use the provider’s versioning or replication.','Contains password hashes, session hashes and operational records: store encrypted with restricted access.']};
 await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 return {dir,manifest};
}

export async function restoreBackup({manifestPath,targetUrl,currentUrl,attachmentsTarget}:{manifestPath:string;targetUrl:string;currentUrl?:string;attachmentsTarget?:string|null}){
 if(currentUrl&&sameDatabase(targetUrl,currentUrl))throw new Error('Refusing to restore into the database in DATABASE_URL. Restore into a new database, verify it, then switch DATABASE_URL (see docs/OPERATIONS.md).');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as Manifest;if(manifest.format!=='leakloop-backup/1')throw new Error('Unrecognised backup format');
 const dir=dirname(resolve(manifestPath));const dump=join(dir,manifest.database.file);
 if(await sha256(dump)!==manifest.database.sha256)throw new Error('Backup checksum mismatch: database.dump is corrupt or was modified. Nothing was restored.');
 const client=new pg.Client({connectionString:targetUrl});await client.connect();
 try{const {rows:[t]}=await client.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");if(t.n)throw new Error('Target database is not empty. Restore only into a newly created, empty database. Nothing was restored.');}finally{await client.end();}
 await run('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--single-transaction','--dbname',pgEnv(targetUrl).PGDATABASE!,dump],{env:pgEnv(targetUrl)});
 const {counts,migrations}=await rowCounts(targetUrl);
 const mismatches=Object.entries(manifest.rowCounts).filter(([k,v])=>counts[k]!==v).map(([k,v])=>`${k}: expected ${v}, restored ${counts[k]??'missing'}`);
 let attachmentsRestored=false;
 if(manifest.attachments&&attachmentsTarget){
  const file=join(dir,manifest.attachments.file);if(await sha256(file)!==manifest.attachments.sha256)throw new Error('Attachment archive checksum mismatch.');
  if(existsSync(attachmentsTarget)&&(await readdir(attachmentsTarget)).length)throw new Error('Attachment target directory is not empty.');
  await mkdir(attachmentsTarget,{recursive:true,mode:0o700});await run('tar',['-xzf',file,'-C',resolve(attachmentsTarget)]);attachmentsRestored=true;
 }
 return {restoredTables:Object.keys(counts).length,migrations,mismatches,attachmentsRestored,manifestCreatedAt:manifest.createdAt};
}
