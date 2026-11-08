import {NextRequest} from 'next/server';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {demoEnabled,identities,createSession,revokeSession,SESSION_COOKIE} from '@/lib/auth';
import {failure,jsonBody,ok,requireActor,requireOrigin} from '@/lib/http';
import {AppError} from '@/lib/errors';
function options(req:NextRequest){return {httpOnly:true,sameSite:'strict' as const,secure:req.nextUrl.protocol==='https:',path:'/',maxAge:43200};}
export async function GET(){try{return ok({actor:await requireActor(),demoEnabled:demoEnabled()});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{requireOrigin(req);if(!demoEnabled())throw new AppError(403,'DEMO_LOGIN_DISABLED','Identity switching is disabled. Sign in with your account.');const {identity}=await jsonBody(req,z.object({identity:z.enum(['manager','ravi','maya','operator'])}).strict(),1000);const actor=identities[identity];const res=ok({actor});res.cookies.set(SESSION_COOKIE,await createSession(actor.id),options(req));return res;}catch(e){return failure(e);}}
export async function DELETE(req:NextRequest){try{requireOrigin(req);await revokeSession((await cookies()).get(SESSION_COOKIE)?.value);const res=ok({signedOut:true});res.cookies.set(SESSION_COOKIE,'',{...options(req),maxAge:0});return res;}catch(e){return failure(e);}}
