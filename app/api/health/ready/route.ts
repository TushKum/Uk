import {ok} from '@/lib/http';
import {readiness} from '@/lib/health';
export const dynamic='force-dynamic';
export async function GET(){const r=await readiness();return ok(r,r.status==='unavailable'?503:200);}
