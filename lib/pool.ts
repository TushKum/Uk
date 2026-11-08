import pg from 'pg';
const shared=globalThis as unknown as {leakloopPool?:pg.Pool};
export const pool=shared.leakloopPool??new pg.Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:15000,application_name:'leakloop-backend'});
if(!shared.leakloopPool)pool.on('error',(error:Error&{code?:string})=>console.error(JSON.stringify({event:'database_pool_error',code:error.code??'UNKNOWN'})));
shared.leakloopPool=pool;
export type Client=pg.PoolClient;
