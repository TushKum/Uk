// Usage: npm run db:backup [-- --out ./backups]
// Writes database.dump (pg_dump custom format), attachments.tar.gz (local storage only) and manifest.json.
import {join} from 'node:path';
import {createBackup} from './backup-lib';
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const url=process.env.DATABASE_URL;if(!url){console.error('DATABASE_URL is required');process.exit(1);}
const attachments=(process.env.STORAGE_DRIVER||'local')==='local'?(process.env.STORAGE_LOCAL_DIR||join(process.cwd(),'.data','attachments')):null;
const {dir,manifest}=await createBackup({databaseUrl:url,outDir:arg('--out')??process.env.BACKUP_DIR??join(process.cwd(),'backups'),attachmentsDir:attachments});
console.log(JSON.stringify({event:'backup_created',dir,databaseBytes:manifest.database.bytes,attachments:manifest.attachments?manifest.attachments.bytes:'none',tables:Object.keys(manifest.rowCounts).length,migrations:manifest.migrations.length},null,2));
