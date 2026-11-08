import {NextRequest} from 'next/server';
import {z} from 'zod';
import {failure,ok,requireActor} from '@/lib/http';
import {requireRole} from '@/lib/errors';
import {usageSummary} from '@/lib/jobs';
import {config} from '@/lib/config';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{
 const actor=await requireActor();requireRole(actor.role==='manager','Manager role required');
 const days=z.coerce.number().int().min(1).max(365).parse(req.nextUrl.searchParams.get('days')??30);const c=config();
 return ok({...await usageSummary(days),mode:c.AGENT_MODE,model:c.AGENT_MODE==='live'?c.OPENAI_MODEL:null,pricingConfigured:c.MODEL_INPUT_USD_PER_MILLION!==null&&c.MODEL_OUTPUT_USD_PER_MILLION!==null,timeoutMs:c.AGENT_MODEL_TIMEOUT_MS});
}catch(e){return failure(e);}}
