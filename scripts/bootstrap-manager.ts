// Create a real manager account without using the fictional seeded accounts.
// Usage: npm run auth:bootstrap -- --email you@example.org --name "Your Name"
// The account has no password; a one-time set-password link is printed (valid PASSWORD_RESET_MINUTES).
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction} from '../lib/db';
import {accountEvent,digest,newToken} from '../lib/auth';
import {config} from '../lib/config';
import {CAMPUS} from '../lib/repository';
const arg=(n:string)=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:undefined;};
try{
 const email=z.string().trim().toLowerCase().email().parse(arg('--email'));const name=z.string().trim().min(1).max(120).parse(arg('--name'));
 const origin=config().APP_ORIGIN??'http://127.0.0.1:3001';
 const link=await transaction(async db=>{
  const {rows:[campus]}=await db.query('SELECT 1 FROM ll_campuses WHERE id=$1',[CAMPUS]);if(!campus)throw new Error('Run npm run setup (or db:migrate and db:seed) first.');
  const {rows:[existing]}=await db.query('SELECT 1 FROM ll_users WHERE email=$1',[email]);if(existing)throw new Error('An account already uses this email. Ask a manager for a reset link instead.');
  const id=`user-${randomUUID()}`;await db.query("INSERT INTO ll_users(id,campus_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,'manager',NULL)",[id,CAMPUS,email,name]);
  const token=newToken();await db.query('INSERT INTO ll_password_resets(id,token_hash,user_id,expires_at) VALUES($1,$2,$3,now()+make_interval(mins=>$4))',[randomUUID(),digest(token),id,config().PASSWORD_RESET_MINUTES]);
  await accountEvent(db,'manager_bootstrapped',{subjectId:id,detail:{via:'cli'}});
  return `${origin}/account?flow=reset#token=${token}`;
 });
 console.log(`Manager ${email} created. Open this one-time link within ${config().PASSWORD_RESET_MINUTES} minutes to set the password:\n${link}`);
}catch(e){console.error((e as Error).message);process.exitCode=1;}finally{await pool.end();}
