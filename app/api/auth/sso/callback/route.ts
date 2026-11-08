import {NextRequest,NextResponse} from 'next/server';
import {SESSION_COOKIE,cookieOptions} from '@/lib/auth';
import {completeSso,OIDC_COOKIE} from '@/lib/sso';
import {AppError} from '@/lib/errors';
import {appOrigin} from '@/lib/accounts';
import {userAgent} from '@/lib/http';
import {logger} from '@/lib/log';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 const origin=appOrigin(req);const q=req.nextUrl.searchParams;
 try{const {token}=await completeSso({code:q.get('code'),state:q.get('state'),error:q.get('error')},req.cookies.get(OIDC_COOKIE)?.value,userAgent(req));
  const res=NextResponse.redirect(`${origin}/?view=overview`,303);res.cookies.set(SESSION_COOKIE,token,cookieOptions(req));res.cookies.set(OIDC_COOKIE,'',{path:'/api/auth/sso',maxAge:0});res.headers.set('Cache-Control','no-store');return res;}
 catch(e){const code=e instanceof AppError?e.code:'SSO_FAILED';if(!(e instanceof AppError))logger.error('sso_callback_error',{message:(e as Error).message});const res=NextResponse.redirect(`${origin}/account?flow=sso-error&code=${encodeURIComponent(code)}`,303);res.cookies.set(OIDC_COOKIE,'',{path:'/api/auth/sso',maxAge:0});return res;}
}
