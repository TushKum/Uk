import {NextRequest,NextResponse} from 'next/server';
import {rateLimit,clientKey} from '@/lib/auth';
import {startSso,OIDC_COOKIE} from '@/lib/sso';
import {failure} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{await rateLimit(`sso:client:${clientKey(req)}`,30);const {url,state}=await startSso();const res=NextResponse.redirect(url,302);
 // Lax is required: the identity provider returns via a cross-site top-level navigation.
 res.cookies.set(OIDC_COOKIE,state,{httpOnly:true,sameSite:'lax',secure:req.nextUrl.protocol==='https:'||process.env.COOKIE_SECURE==='true',path:'/api/auth/sso',maxAge:600});res.headers.set('Cache-Control','no-store');return res;}catch(e){return failure(e);}}
