import type {Instrumentation} from 'next';
// Runs once per server start. Logs configuration problems loudly instead of failing on first request.
export async function register(){
 if(process.env.NEXT_RUNTIME!=='nodejs')return;
 const {configIssues}=await import('./lib/config');const {logger}=await import('./lib/log');
 const issues=configIssues();
 if(issues.length)logger.error('config_invalid',{issues});
 else logger.info('server_started',{agentMode:process.env.AGENT_MODE||'demo',nodeEnv:process.env.NODE_ENV});
}
export const onRequestError:Instrumentation.onRequestError=async(err,request,context)=>{
 const {logger}=await import('./lib/log');
 logger.error('request_error',{path:request.path.split('?')[0],method:request.method,routeType:context.routeType,routePath:context.routePath,digest:typeof err==='object'&&err&&'digest' in err?String(err.digest):undefined,message:err instanceof Error?err.message.slice(0,200):undefined});
};
