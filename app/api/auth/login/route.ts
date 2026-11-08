import {NextRequest} from 'next/server';
import {login,rateLimit,clientKey} from '@/lib/auth';
import {jsonBody,failure,requireOrigin,signedInResponse,userAgent} from '@/lib/http';
import {loginSchema} from '@/lib/validation';
import {config} from '@/lib/config';
import {AppError} from '@/lib/errors';
export async function POST(req:NextRequest){try{requireOrigin(req);if(!config().PASSWORD_LOGIN)throw new AppError(403,'PASSWORD_LOGIN_DISABLED','Password sign-in is disabled. Use single sign-on.');await rateLimit('login:global',100);if(process.env.TRUST_PROXY==='true')await rateLimit(`login:client:${clientKey(req)}`,30);const body=await jsonBody(req,loginSchema,1500);const result=await login(body.email,body.password,userAgent(req));if(result.error)throw result.error;return signedInResponse(req,result.token!,{actor:result.actor});}catch(e){return failure(e);}}
