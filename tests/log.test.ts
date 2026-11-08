import {test} from 'node:test';
import assert from 'node:assert/strict';
import {redact} from '../lib/log';
test('structured logs redact secrets but keep numeric counters',()=>{
 const out=redact({password:'hunter2',apiKey:'sk-123',headers:{authorization:'Bearer x',cookie:'s=1'},oldPasswordResets:3,tokenCount:0,message:'ok'}) as Record<string,unknown>;
 assert.equal(out.password,'[redacted]');assert.equal(out.apiKey,'[redacted]');assert.deepEqual(out.headers,{authorization:'[redacted]',cookie:'[redacted]'});assert.equal(out.oldPasswordResets,3);assert.equal(out.tokenCount,0);assert.equal(out.message,'ok');
 assert.equal((redact({note:'x'.repeat(900)}) as {note:string}).note.length,501);
});
