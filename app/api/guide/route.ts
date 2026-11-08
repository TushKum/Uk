import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {NextRequest} from 'next/server';
export async function GET(req:NextRequest){try{const text=req.nextUrl.searchParams.get('doc')==='evaluation'?await readFile(join(process.cwd(),'docs','EVALUATION.md'),'utf8'):await readFile(join(process.cwd(),'README.md'),'utf8');return new Response(text,{headers:{'Content-Type':'text/plain; charset=utf-8'}});}catch{return new Response('Guide unavailable.',{status:503});}}
