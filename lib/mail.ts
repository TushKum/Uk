import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {config} from './config';
import {logger} from './log';

export type Mail = {to:string;subject:string;text:string};

/**
 * Account email delivery.
 * - file (default): writes each message to an owner-only local outbox directory. Nothing leaves the machine.
 * - smtp: sends through SMTP_URL. Only enable once the operator has authorised outbound email.
 * - disabled: self-service recovery is turned off; managers can still issue one-time links.
 */
export function outboxDir(){return resolve(config().MAIL_OUTBOX_DIR??join(process.cwd(),'.data','outbox'));}

export async function sendMail(mail:Mail):Promise<{transport:string;id:string}>{
 const c=config();const id=randomUUID();
 if(c.MAIL_TRANSPORT==='disabled')throw new Error('Mail transport disabled');
 if(c.MAIL_TRANSPORT==='smtp'){
  const transport=nodemailer.createTransport(c.SMTP_URL!,{disableFileAccess:true,disableUrlAccess:true} as never);
  await transport.sendMail({from:c.MAIL_FROM??'LeakLoop <no-reply@localhost>',to:mail.to,subject:mail.subject,text:mail.text,messageId:`<${id}@leakloop>`,disableFileAccess:true,disableUrlAccess:true});
  logger.info('mail_sent',{transport:'smtp',messageId:id});
  return {transport:'smtp',id};
 }
 const dir=outboxDir();await mkdir(dir,{recursive:true,mode:0o700});
 const path=join(dir,`${new Date().toISOString().replace(/[:.]/g,'-')}-${id}.eml`);
 await writeFile(path,`To: ${mail.to}\nSubject: ${mail.subject}\nMessage-ID: <${id}@leakloop>\n\n${mail.text}\n`,{mode:0o600});await chmod(path,0o600);
 logger.info('mail_written_to_outbox',{transport:'file',messageId:id});
 return {transport:'file',id};
}
