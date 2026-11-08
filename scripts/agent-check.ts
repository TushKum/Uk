// Live model integration check. Makes ONE real request to the configured provider using a
// fictional seeded incident. Writes nothing to the database. Requires explicit opt-in (--yes).
import {seed} from '../lib/seed';
import {tools} from '../lib/engine';
import {LiveProvider,ProviderError,priceUsd} from '../lib/provider';
import {config,configIssues} from '../lib/config';

const c=config();const issues=configIssues();
if(c.AGENT_MODE!=='live'||!c.OPENAI_API_KEY||!c.OPENAI_MODEL){
 console.log(JSON.stringify({status:'not_configured',message:'Set AGENT_MODE=live, OPENAI_API_KEY and OPENAI_MODEL in the server environment. The live integration remains UNVERIFIED.'},null,2));
 process.exit(2);
}
if(issues.length){console.log(JSON.stringify({status:'invalid_configuration',issues},null,2));process.exit(1);}
if(!process.argv.includes('--yes')){console.log('This makes one billable request to the configured model provider. Re-run with --yes to proceed.');process.exit(2);}
const s=seed('A');const started=Date.now();
try{
 const d=await new LiveProvider().choose(s,s.incidents[0],[]);
 const ok=d.tool===null||(tools as readonly string[]).includes(d.tool);
 console.log(JSON.stringify({status:ok?'passed':'failed',endpoint:c.OPENAI_BASE_URL??'https://api.openai.com/v1',model:d.usage?.model,providerRequestId:d.usage?.requestId,tool:d.tool,expectedFirstToolFamily:'evidence gathering (e.g. get_meter_readings)',inputTokens:d.inputTokens,outputTokens:d.outputTokens,latencyMs:Math.round(d.modelMs),costUsd:priceUsd(d.inputTokens,d.outputTokens),wallMs:Date.now()-started,note:'One request only; this does not measure model quality.'},null,2));
 process.exit(ok?0:1);
}catch(e){
 console.log(JSON.stringify({status:'failed',errorClass:e instanceof ProviderError?e.errorClass:'internal',message:(e as Error).message},null,2));
 process.exit(1);
}
