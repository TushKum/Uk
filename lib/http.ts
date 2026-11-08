import {randomUUID} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {ZodError,type ZodType} from 'zod';
import {authenticate,SESSION_COOKIE,sameOrigin} from './auth';
import {AppError} from './errors';
import {CAMPUS} from './repository';
export async function requireActor(){const actor=await authenticate((await cookies()).get(SESSION_COOKIE)?.value);if(!actor)throw new AppError(401,'UNAUTHENTICATED','Sign in to continue.');if(actor.campusId!==CAMPUS)throw new AppError(403,'CAMPUS_FORBIDDEN','Campus access denied');return actor;}
export function requireOrigin(req:NextRequest){if(!sameOrigin(req))throw new AppError(403,'ORIGIN_REJECTED','Invalid request origin');}
export async function jsonBody<T>(req:NextRequest,schema:ZodType<T>,max=12000){if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError(415,'CONTENT_TYPE','Use application/json');const declared=Number(req.headers.get('content-length'));if(declared>max)throw new AppError(413,'BODY_TOO_LARGE','Request is too large');let size=0;const chunks:Uint8Array[]=[];const reader=req.body?.getReader();if(!reader)throw new AppError(400,'INVALID_JSON','JSON body required');for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new AppError(413,'BODY_TOO_LARGE','Request is too large');}chunks.push(value);}let data:unknown;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(400,'INVALID_JSON','Malformed JSON');}return schema.parse(data);}
export function failure(error:unknown){const requestId=randomUUID();let status=500,code='INTERNAL_ERROR',message='The request could not be completed.';let fields:unknown;
 if(error instanceof AppError){({status,code}=error);message=error.message;}
 else if(error instanceof ZodError){status=400;code='VALIDATION_ERROR';message='Check the request fields.';fields=error.issues.map(i=>({path:i.path.join('.'),message:i.message}));}
 else if(error instanceof Error){const pg=error as Error&{code?:string};if(['23505','23503','23514'].includes(pg.code??'')){status=409;code='DATA_CONFLICT';message='The operation conflicts with the current database state.';}else if(['ECONNREFUSED','ETIMEDOUT','57P01','53300','08006','08001'].includes(pg.code??'')){status=503;code='DATABASE_UNAVAILABLE';message='Database unavailable. Retry shortly.';}else if(['55P03','40001','40P01'].includes(pg.code??'')){status=409;code='CONCURRENT_UPDATE';message='Another update is in progress. Refresh and retry.';}else if(/role required|Only the assigned/.test(error.message)){status=403;code='FORBIDDEN';message=error.message;}else if(/not found/.test(error.message)){status=404;code='NOT_FOUND';message=error.message;}else if(!pg.code&&/required|Cannot|Cannot|must |Invalid transition|Proposal changed|Evidence changed|not support closure|already |Accept |Work must|No technician|assignment|Incident is/.test(error.message)){status=409;code='WORKFLOW_CONFLICT';message=error.message;}}
 if(status===500)console.error(JSON.stringify({requestId,event:'api_failure',code:(error as {code?:string})?.code??'UNKNOWN'}));
 return NextResponse.json({error:message,code,requestId,...(fields?{fields}:{})},{status,headers:{'Cache-Control':'no-store','X-Request-Id':requestId,...(status===429?{'Retry-After':'60'}:{})}});
}
export const ok=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
