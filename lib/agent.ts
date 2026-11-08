import { id, executeTool, tools } from './engine';
import { configuredProvider, type Provider } from './provider';
import type { State,Incident,AgentRun } from './types';
export async function runAgent(s:State,i:Incident,provider:Provider=configuredProvider()){
 const start=performance.now();const run:AgentRun={id:id('RUN'),incidentId:i.id,mode:provider.mode,startedAt:s.now,status:'bounded',steps:0,latencyMs:0,modelMs:0,inputTokens:0,outputTokens:0,costUsd:null};s.runs.push(run);
 const history:unknown[]=[];
 for(let step=0;step<8;step++){
  if(performance.now()-start>30000){run.error='30-second run budget reached; continue with a new run.';break;}
  try {
   const choice=await provider.choose(s,i,history);run.modelMs+=choice.modelMs;run.inputTokens+=choice.inputTokens;run.outputTokens+=choice.outputTokens;
   if(!choice.tool){run.status='completed';break;}if(!tools.includes(choice.tool))throw new Error('Disallowed tool');
   const tool=choice.tool;let ok=false;
   for(let attempt=0;attempt<2;attempt++){
    const toolStart=performance.now();
    try{const out=executeTool(s,i,tool);const result=JSON.stringify(out.result);s.traces.push({id:id('TRACE'),runId:run.id,incidentId:i.id,at:s.now,tool,status:'success',result:result.slice(0,20000),summary:out.summary,citations:out.citations,elapsedMs:performance.now()-toolStart});history.push({tool,result:out.result});run.steps++;ok=true;break;}
    catch(e){const message=e instanceof Error?e.message:'Tool failed';s.traces.push({id:id('TRACE'),runId:run.id,incidentId:i.id,at:s.now,tool,status:'error',result:message,summary:attempt===0?'Tool failed; one bounded retry.':'Tool failed again. Run stopped for review.',citations:[],elapsedMs:performance.now()-toolStart});run.steps++;history.push({tool,error:message});if(attempt===1)throw e;}
   }
   if(!ok)break;
  }catch(e){run.status='failed';run.error=e instanceof Error?e.message:'Agent failed';break;}
 }
 run.latencyMs=performance.now()-start;
 if(provider.mode==='demo')run.costUsd=0;
 else if(process.env.MODEL_INPUT_USD_PER_MILLION&&process.env.MODEL_OUTPUT_USD_PER_MILLION)run.costUsd=(run.inputTokens*Number(process.env.MODEL_INPUT_USD_PER_MILLION)+run.outputTokens*Number(process.env.MODEL_OUTPUT_USD_PER_MILLION))/1e6;
 return run;
}
