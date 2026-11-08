import {NextRequest} from 'next/server';
import {failure,jsonBody,ok} from '@/lib/http';
import {rateLimit} from '@/lib/auth';
import {authenticateDevice,ingestReadings,ingestSchema} from '@/lib/telemetry';
// Machine-to-machine endpoint. Authenticated by a per-device bearer key, not browser cookies,
// so no same-origin check applies. Keys are stored only as SHA-256 hashes.
export async function POST(req:NextRequest){try{const device=await authenticateDevice(req.headers.get('authorization'));await rateLimit(`ingest:${device.id}`,120);const body=await jsonBody(req,ingestSchema,512*1024);const result=await ingestReadings(device,body);return ok(result,result.accepted||result.duplicates?200:422);}catch(e){return failure(e);}}
