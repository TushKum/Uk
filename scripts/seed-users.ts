import {randomBytes} from 'node:crypto';
import {writeFile,readFile,chmod} from 'node:fs/promises';
import {pool} from '../lib/pool';
import {hashPassword,identities} from '../lib/auth';
const file=process.env.LOCAL_ACCOUNTS_PATH||new URL('../.local-accounts.json',import.meta.url);let accounts:Record<string,{email:string;password:string;name:string;role:string}>={};
try{accounts=JSON.parse(await readFile(file,'utf8'));}catch{}
try{for(const [key,a]of Object.entries(identities)){
 const existing=await pool.query('SELECT 1 FROM ll_users WHERE id=$1',[a.id]);if(existing.rowCount)continue;
 const email=`${key==='manager'?'ava':key}@evergreen.local`,password=accounts[key]?.email===email&&accounts[key]?.password?accounts[key].password:randomBytes(18).toString('base64url');
 await pool.query('INSERT INTO ll_users(id,campus_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[a.id,'evergreen',email,a.name,a.role,await hashPassword(password)]);accounts[key]={email,password,name:a.name,role:a.role};
}await writeFile(file,JSON.stringify(accounts,null,2)+'\n',{mode:0o600});await chmod(file,0o600);console.log('Local accounts initialized. Credentials saved to .local-accounts.json (owner-only); no passwords printed.');}finally{await pool.end();}
