import {NextRequest} from 'next/server';
import {rateLimit,clientKey} from '@/lib/auth';
import {jsonBody,failure,ok,requireOrigin} from '@/lib/http';
import {tokenSchema} from '@/lib/validation';
import {previewInvitation} from '@/lib/accounts';
export async function POST(req:NextRequest){try{requireOrigin(req);await rateLimit(`invite:client:${clientKey(req)}`,30);const {token}=await jsonBody(req,tokenSchema,600);return ok({invitation:await previewInvitation(token)});}catch(e){return failure(e);}}
