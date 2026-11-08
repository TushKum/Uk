import {mkdir,readFile,rm,writeFile,access,constants,rename} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,HeadBucketCommand} from '@aws-sdk/client-s3';
import {config} from './config';

/** Object storage for evidence files. Objects are private; the API is the only reader. */
export interface ObjectStore{driver:'local'|'s3';put(key:string,body:Buffer,contentType:string):Promise<void>;get(key:string):Promise<Buffer>;remove(key:string):Promise<void>;check():Promise<void>}
const KEY=/^[a-z0-9-]+(\/[A-Za-z0-9._-]+)+$/;
function assertKey(key:string){if(!KEY.test(key)||key.includes('..'))throw new Error('Invalid storage key');}

class LocalStore implements ObjectStore{
 driver='local' as const;
 constructor(private root:string){}
 private path(key:string){assertKey(key);const p=resolve(this.root,key);if(!p.startsWith(resolve(this.root)+sep))throw new Error('Invalid storage key');return p;}
 async put(key:string,body:Buffer){const p=this.path(key);await mkdir(dirname(p),{recursive:true,mode:0o700});const tmp=`${p}.${randomUUID()}.tmp`;await writeFile(tmp,body,{mode:0o600,flag:'wx'});await rename(tmp,p);}
 async get(key:string){return readFile(this.path(key));}
 async remove(key:string){await rm(this.path(key),{force:true});}
 async check(){await mkdir(this.root,{recursive:true,mode:0o700});await access(this.root,constants.W_OK);}
}

class S3Store implements ObjectStore{
 driver='s3' as const;private client:S3Client;
 constructor(private bucket:string,region:string,endpoint:string|null,forcePathStyle:boolean,private prefix:string){
  // Credentials come from the standard AWS provider chain (env vars, profile, instance role); never from this repository.
  this.client=new S3Client({region,...(endpoint?{endpoint}:{}),forcePathStyle,requestHandler:{requestTimeout:15000,connectionTimeout:5000} as never,maxAttempts:3});
 }
 private k(key:string){assertKey(key);return this.prefix?`${this.prefix.replace(/\/$/,'')}/${key}`:key;}
 async put(key:string,body:Buffer,contentType:string){await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:this.k(key),Body:body,ContentType:contentType,ContentLength:body.length}));}
 async get(key:string){const r=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:this.k(key)}));return Buffer.from(await r.Body!.transformToByteArray());}
 async remove(key:string){await this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:this.k(key)}));}
 async check(){await this.client.send(new HeadBucketCommand({Bucket:this.bucket}));}
}

let cached:{signature:string;store:ObjectStore}|null=null;
export function objectStore():ObjectStore{
 const c=config();const signature=JSON.stringify([c.STORAGE_DRIVER,c.STORAGE_LOCAL_DIR,c.S3_BUCKET,c.S3_REGION,c.S3_ENDPOINT,c.S3_FORCE_PATH_STYLE,c.S3_PREFIX]);
 if(cached?.signature===signature)return cached.store;
 const store=c.STORAGE_DRIVER==='s3'?new S3Store(c.S3_BUCKET!,c.S3_REGION!,c.S3_ENDPOINT,c.S3_FORCE_PATH_STYLE,c.S3_PREFIX??''):new LocalStore(resolve(c.STORAGE_LOCAL_DIR??join(process.cwd(),'.data','attachments')));
 cached={signature,store};return store;
}
