import {NextRequest} from 'next/server';
import {rateLimit,clientKey} from '@/lib/auth';
import {jsonBody,failure,requireOrigin,signedInResponse,userAgent} from '@/lib/http';
import {tokenPasswordSchema} from '@/lib/validation';
import {completePasswordReset} from '@/lib/accounts';
export async function POST(req:NextRequest){try{requireOrigin(req);await rateLimit(`reset:client:${clientKey(req)}`,20);const {token,password}=await jsonBody(req,tokenPasswordSchema,1500);const result=await completePasswordReset(token,password,userAgent(req));return signedInResponse(req,result.token,{actor:result.actor,reset:true});}catch(e){return failure(e);}}
