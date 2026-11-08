import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sniff,validateFile,safeName} from '../lib/attachments';
const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(64,1)]);
const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64,2)]);
const pdf=Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const code=(c:string)=>(e:unknown)=>(e as {code?:string}).code===c;
test('file types are identified from content, not names',()=>{assert.equal(sniff(jpeg),'image/jpeg');assert.equal(sniff(png),'image/png');assert.equal(sniff(pdf),'application/pdf');assert.equal(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')),'image/webp');assert.equal(sniff(Buffer.from('meter reading notes')),'text/plain');});
test('active or unsupported content is rejected',()=>{
 for(const b of ['<!DOCTYPE html><script>x</script>','<svg onload=alert(1)>','<?xml version="1.0"?>'])assert.equal(sniff(Buffer.from(b)),null);
 assert.equal(sniff(Buffer.from([0x4d,0x5a,0x90,0x00])),null);
 assert.throws(()=>validateFile(Buffer.from('%PDF-1.4 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>'),'a.pdf','application/pdf'),code('ACTIVE_CONTENT'));
});
test('extension and declared type must match the detected content',()=>{
 assert.equal(validateFile(jpeg,'site.jpg','image/jpeg').kind,'photo');assert.equal(validateFile(pdf,'report.pdf','').kind,'document');
 assert.throws(()=>validateFile(pdf,'photo.jpg','image/jpeg'),code('TYPE_MISMATCH'));
 assert.throws(()=>validateFile(png,'photo.png','image/jpeg'),code('TYPE_MISMATCH'));
 assert.equal(validateFile(png,'photo.png','application/octet-stream').kind,'photo');
});
test('size limits are enforced and empty files rejected',()=>{
 process.env.ATTACHMENT_MAX_BYTES='2048';try{assert.throws(()=>validateFile(Buffer.concat([jpeg,Buffer.alloc(4096)]),'a.jpg','image/jpeg'),code('FILE_TOO_LARGE'));}finally{delete process.env.ATTACHMENT_MAX_BYTES;}
 assert.throws(()=>validateFile(Buffer.alloc(0),'a.txt','text/plain'),code('EMPTY_FILE'));
});
test('stored filenames are sanitised',()=>{assert.equal(safeName('../../etc/passwd'),'passwd');assert.equal(safeName('C:\\Users\\x\\leak "photo".jpg'),'leak _photo_.jpg');assert.equal(safeName('\u0000\u0007.hidden'),'hidden');assert.equal(safeName(''),'attachment');});
test('sha256 provenance hash covers the exact bytes',()=>{assert.equal(validateFile(jpeg,'a.jpg','image/jpeg').sha256,createHash('sha256').update(jpeg).digest('hex'));const changed=Buffer.from(jpeg);changed[10]^=1;assert.notEqual(validateFile(changed,'a.jpg','').sha256,validateFile(jpeg,'a.jpg','').sha256);});
