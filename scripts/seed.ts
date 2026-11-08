import {pool,transaction} from '../lib/db';
import {storeState} from '../lib/repository';
import {seed} from '../lib/seed';
try{await transaction(async db=>{if(!(await db.query('SELECT 1 FROM ll_runtime')).rowCount)await storeState(db,seed());});console.log('Fictional campus seeded; existing progress preserved.');}finally{await pool.end();}
