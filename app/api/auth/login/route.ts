import {NextRequest} from 'next/server';
import {login,SESSION_COOKIE,rateLimit} from '@/lib/auth';
import {jsonBody,failure,ok,requireOrigin} from '@/lib/http';
import {loginSchema} from '@/lib/validation';
export async function POST(req:NextRequest){try{requireOrigin(req);await rateLimit('login:global',100);const body=await jsonBody(req,loginSchema,1500);const result=await login(body.email,body.password);if(result.error)throw result.error;const res=ok({actor:result.actor});res.cookies.set(SESSION_COOKIE,result.token!,{httpOnly:true,sameSite:'strict',secure:req.nextUrl.protocol==='https:',path:'/',maxAge:43200});return res;}catch(e){return failure(e);}}
