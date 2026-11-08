// Usage: npm run db:restore -- --from backups/leakloop-<stamp>/manifest.json --target postgresql://…/new_empty_db [--attachments-dir ./restored-attachments]
// Restores only into an EMPTY database that is not the current DATABASE_URL. Verifies checksums and row counts.
import {restoreBackup} from './backup-lib';
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const from=arg('--from'),target=arg('--target')??process.env.RESTORE_DATABASE_URL;
if(!from||!target){console.error('Usage: npm run db:restore -- --from <manifest.json> --target <empty database URL> [--attachments-dir <empty dir>]');process.exit(1);}
try{const r=await restoreBackup({manifestPath:from,targetUrl:target,currentUrl:process.env.DATABASE_URL,attachmentsTarget:arg('--attachments-dir')??null});
 console.log(JSON.stringify({event:'restore_completed',...r},null,2));
 if(r.mismatches.length){console.error('Row counts differ from the manifest. Investigate before switching traffic to the restored database.');process.exit(3);}
}catch(e){console.error(JSON.stringify({event:'restore_failed',message:(e as Error).message}));process.exit(1);}
