import {NextRequest} from 'next/server';
import {failure,requireActor} from '@/lib/http';
import {readAttachment} from '@/lib/attachments';
import {uuid} from '@/lib/validation';
export const dynamic='force-dynamic';
// Served only through this authenticated route, never from a public URL.
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const actor=await requireActor();const file=await readAttachment(actor,uuid.parse((await params).id));
 const inline=file.kind==='photo'&&req.nextUrl.searchParams.get('download')!=='1';
 return new Response(new Uint8Array(file.bytes),{headers:{'Content-Type':file.contentType==='text/plain'?'text/plain; charset=utf-8':file.contentType,'Content-Length':String(file.bytes.length),'Content-Disposition':`${inline?'inline':'attachment'}; filename="${file.name.replace(/["\\]/g,'_')}"`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",'Cache-Control':'private, no-store','Digest':`sha-256=${Buffer.from(file.sha256,'hex').toString('base64')}`,'Cross-Origin-Resource-Policy':'same-origin'}});
}catch(e){return failure(e);}}
