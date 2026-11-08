// Routine retention. Safe to run repeatedly (e.g. hourly from cron or a scheduler).
// Never deletes audit history, account events, incidents, work orders, attachment metadata or model usage.
import {pool,transaction} from '../lib/db';
import {config} from '../lib/config';
import {purgeDeletedAttachments} from '../lib/attachments';
import {logger} from '../lib/log';
process.env.LEAKLOOP_SERVICE??='leakloop-maintenance';
try{
 const c=config();
 const counts=await transaction(async db=>{
  const n=async(sql:string,params:unknown[]=[])=>(await db.query(sql,params)).rowCount??0;
  return {
   expiredSessions:await n("DELETE FROM ll_sessions WHERE expires_at<now() OR revoked_at<now()-interval '1 day' OR last_seen_at<now()-make_interval(mins=>$1)-interval '1 day'",[c.SESSION_IDLE_MINUTES]),
   oldRateLimits:await n("DELETE FROM ll_rate_limits WHERE window_at<now()-interval '1 day'"),
   oldLoginLimits:await n("DELETE FROM ll_login_limits WHERE window_at<now()-interval '1 day' AND (locked_until IS NULL OR locked_until<now())"),
   staleWorkerHeartbeats:await n("DELETE FROM ll_worker_heartbeats WHERE seen_at<now()-interval '1 day'"),
   expiredSsoStates:await n("DELETE FROM ll_oidc_states WHERE expires_at<now()"),
   oldPasswordResets:await n("DELETE FROM ll_password_resets WHERE created_at<now()-interval '90 days'"),
   deviceReadingsPastRetention:c.TELEMETRY_RETENTION_DAYS>0?await n('DELETE FROM ll_device_readings WHERE observed_at<now()-make_interval(days=>$1)',[c.TELEMETRY_RETENTION_DAYS]):0,
   oldIngestBatches:c.TELEMETRY_RETENTION_DAYS>0?await n('DELETE FROM ll_ingest_batches WHERE received_at<now()-make_interval(days=>$1)',[c.TELEMETRY_RETENTION_DAYS]):0,
  };
 });
 const purgedAttachmentFiles=await purgeDeletedAttachments(c.ATTACHMENT_PURGE_DAYS);
 logger.info('maintenance_completed',{...counts,purgedAttachmentFiles});
 console.log({...counts,purgedAttachmentFiles});
}finally{await pool.end();}
