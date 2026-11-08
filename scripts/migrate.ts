import {readdir,readFile} from 'node:fs/promises';
import {pool} from '../lib/pool';
import {storeState} from '../lib/repository';
const db=await pool.connect();try{
 await db.query('SELECT pg_advisory_lock(7359131)');await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
  if((await db.query('SELECT 1 FROM schema_migrations WHERE version=$1',[file])).rowCount)continue;
  await db.query('BEGIN');try{await db.query(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));await db.query('INSERT INTO schema_migrations(version) VALUES($1)',[file]);await db.query('COMMIT');console.log(`Applied ${file}`);}catch(e){await db.query('ROLLBACK');throw e;}
 }
 if(!(await db.query('SELECT 1 FROM ll_runtime')).rowCount){const {rows:[old]}=await db.query('SELECT data FROM leakloop_state WHERE id=1');if(old){await db.query('BEGIN');try{await storeState(db,old.data);await db.query('COMMIT');console.log('Existing campus progress imported into relational tables. Legacy snapshot retained.');}catch(e){await db.query('ROLLBACK');throw e;}}}
}finally{await db.query('SELECT pg_advisory_unlock(7359131)');db.release();await pool.end();}
