import {NextRequest} from 'next/server';
import {rateLimit,clientKey,digest} from '@/lib/auth';
import {jsonBody,failure,ok,requireOrigin} from '@/lib/http';
import {emailSchema} from '@/lib/validation';
import {appOrigin,requestPasswordReset} from '@/lib/accounts';
export async function POST(req:NextRequest){try{requireOrigin(req);await rateLimit(`forgot:client:${clientKey(req)}`,10);const {email}=await jsonBody(req,emailSchema,600);await rateLimit(`forgot:email:${digest(email)}`,5);await requestPasswordReset(email,appOrigin(req));return ok({accepted:true,message:'If an active account uses that email, a reset link has been sent.'},202);}catch(e){return failure(e);}}
