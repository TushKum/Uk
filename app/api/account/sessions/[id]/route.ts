import {NextRequest} from 'next/server';
import {failure,ok,requireActor,requireOrigin} from '@/lib/http';
import {revokeSessionById} from '@/lib/accounts';
import {uuid} from '@/lib/validation';
import {SESSION_COOKIE} from '@/lib/auth';
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{requireOrigin(req);const actor=await requireActor();const id=uuid.parse((await params).id);const result=await revokeSessionById(actor,id);const res=ok(result);if(result.current)res.cookies.set(SESSION_COOKIE,'',{path:'/',maxAge:0});return res;}catch(e){return failure(e);}}
