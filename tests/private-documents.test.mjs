import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {decodeFile,DOCUMENT_LIMIT,PHOTO_LIMIT,validateFile,stripJpegMetadata,safeFileName,fileDigest,verifiedStoredFile,createDocumentGrant,verifyDocumentGrant} from '../lib/server/document-security.mjs';
test('file allowlist verifies signatures, exact size bounds, static image dimensions and active PDF markers',async()=>{
 const png=new Uint8Array(await sharp({create:{width:16,height:16,channels:3,background:'#2456D8'}}).png().toBuffer());
 assert.equal(validateFile(png,'image/png').width,16);assert.throws(()=>validateFile(png,'application/pdf'),/توقيع/);assert.throws(()=>validateFile(png,'text/html'),/الصيغ/);
 assert.throws(()=>validateFile(new Uint8Array(PHOTO_LIMIT+1),'image/jpeg',{photo:true}),/حجم/);assert.throws(()=>decodeFile('A'.repeat(Math.ceil(DOCUMENT_LIMIT/3)*4+20),DOCUMENT_LIMIT),/المسموح/);assert.throws(()=>decodeFile('data:invalid',1024),/صالح/);
 assert.throws(()=>validateFile(new Uint8Array([...png,1]),'image/png'),/بنية/);
 const pdf=new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');assert.equal(validateFile(pdf,'application/pdf').mime,'application/pdf');assert.throws(()=>validateFile(new TextEncoder().encode('%PDF-1.7 /JavaScript (alert) %%EOF'),'application/pdf'),/نشط/);
 const tooWide=new Uint8Array(await sharp({create:{width:321,height:12,channels:3,background:'#fff'}}).jpeg().toBuffer());assert.throws(()=>validateFile(tooWide,'image/jpeg',{thumbnail:true}),/320/);
});
test('display derivative strips metadata while preserving original bytes and safe generated filenames',async()=>{
 const jpeg=new Uint8Array(await sharp({create:{width:256,height:256,channels:3,background:'#fff'}}).jpeg({quality:82}).toBuffer());
 const marker=new TextEncoder().encode('Exif\u0000\u0000synthetic GPS metadata'),segment=new Uint8Array([255,225,0,marker.length+2,...marker]);
 const original=new Uint8Array([...jpeg.slice(0,2),...segment,...jpeg.slice(2)]),hash=await fileDigest(original),derivative=stripJpegMetadata(original);
 assert.equal(validateFile(derivative,'image/jpeg',{thumbnail:true}).width,256);assert.equal(new TextDecoder().decode(derivative).includes('synthetic GPS'),false);assert.equal(await fileDigest(original),hash);assert.ok(derivative.length<original.length);
 assert.equal(safeFileName('../../private\u202ename.exe','application/pdf').endsWith('.pdf'),true);assert.equal(/[\/\\\u202e]/.test(safeFileName('../../private\u202ename.exe','application/pdf')),false);
});
test('stored content is bounded and revalidated before serving even if upload API was bypassed',async()=>{
 const pdf=new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
 const doc={kind:'general',mime_type:'application/pdf',byte_size:pdf.length,original_sha256:await fileDigest(pdf)};
 assert.deepEqual(await verifiedStoredFile(new Response(pdf),doc),pdf);
 await assert.rejects(verifiedStoredFile(new Response(new Uint8Array(pdf.length+1)),doc));
 await assert.rejects(verifiedStoredFile(new Response(pdf.slice(1)),doc));
 await assert.rejects(verifiedStoredFile(new Response(pdf),{...doc,original_sha256:'0'.repeat(64)}));
 const forged=new TextEncoder().encode('<html>synthetic active content</html>');
 await assert.rejects(verifiedStoredFile(new Response(forged),{...doc,byte_size:forged.length,original_sha256:await fileDigest(forged)}));
});
test('short-lived document grant binds account, immutable document, variant and expiry',async()=>{
 const secret='Isolated-signing-secret-32bytes-2026',user='11111111-1111-4111-8111-111111111111',document='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now=1792000000000;
 const grant=await createDocumentGrant(secret,user,document,'thumbnail',now);
 assert.equal(await verifyDocumentGrant(secret,user,document,'thumbnail',grant.expires,grant.signature,now+1000),true);
 assert.equal(await verifyDocumentGrant(secret,'different',document,'thumbnail',grant.expires,grant.signature,now+1000),false);
 assert.equal(await verifyDocumentGrant(secret,user,'different','thumbnail',grant.expires,grant.signature,now+1000),false);
 assert.equal(await verifyDocumentGrant(secret,user,document,'original',grant.expires,grant.signature,now+1000),false);
 assert.equal(await verifyDocumentGrant(secret,user,document,'thumbnail',grant.expires,grant.signature,now+60000),false);
 assert.equal(await verifyDocumentGrant(secret,user,document,'thumbnail',grant.expires+1,grant.signature,now+1000),false);
});
