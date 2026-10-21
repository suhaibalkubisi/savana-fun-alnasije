import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {z} from 'zod';
import sharp from 'sharp';
import * as security from '../lib/server/document-security.mjs';
const serverSource=await readFile(new URL('../lib/server/supabase.ts',import.meta.url),'utf8');
const serverTree=ts.createSourceFile('supabase.ts',serverSource,ts.ScriptTarget.Latest,true);
const serverNames=new Set(['AppError','body','errorResponse','json','protectMutation']);
const serverNodes=serverTree.statements.filter(n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&serverNames.has(n.name?.text));
assert.equal(serverNodes.length,serverNames.size);
const routeSource=await readFile(new URL('../app/api/followup/documents/route.ts',import.meta.url),'utf8');
const routeTree=ts.createSourceFile('route.ts',routeSource,ts.ScriptTarget.Latest,true);
const routeNodes=routeTree.statements.filter(n=>!ts.isImportDeclaration(n));
globalThis.__documentUploadDeps={z,...security};
const binding='const {z,createDocumentGrant,decodeFile,DOCUMENT_LIMIT,fileDigest,PHOTO_LIMIT,safeFileName,stripJpegMetadata,THUMBNAIL_LIMIT,validateFile}=globalThis.__documentUploadDeps;\n'+
['requireConfig','rpc','session','supabaseHeaders'].map(n=>'const '+n+'=(...args)=>globalThis.__documentUploadHarness.'+n+'(...args);').join('\n')+
'\nconst fetch=(...args)=>globalThis.__documentUploadHarness.fetch(...args);\n';
const compiled=ts.transpileModule(binding+'\n'+serverNodes.map(n=>n.getText(serverTree)).join('\n')+'\n'+routeNodes.map(n=>n.getText(routeTree)).join('\n'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {POST,AppError}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
delete globalThis.__documentUploadDeps;
const uid='11111111-1111-4111-8111-111111111111',employee='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const pdf=new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
async function scenario(options={}){
 const bytes=options.bytes||pdf,payload={operation:'upload',request_id:requestId,employee_id:employee,title:'QA immutable original',kind:'general',file_name:'proof.pdf',mime_type:'application/pdf',content_base64:Buffer.from(bytes).toString('base64'),description:'Retain original',issued_on:'2026-10-14',expires_on:'2027-10-14',...options.payload};
 const thumbnail=payload.thumbnail_base64?security.stripJpegMetadata(Buffer.from(payload.thumbnail_base64,'base64')):null;
 const metadata={employee_id:employee,title:payload.title,kind:payload.kind,file_name:security.safeFileName(payload.file_name,payload.mime_type),mime_type:payload.mime_type,byte_size:bytes.length,description:payload.description||'',issued_on:payload.issued_on||null,expires_on:payload.expires_on||null,previous_document_id:payload.previous_document_id||null,original_sha256:await security.fileDigest(bytes),...(thumbnail?{thumbnail_sha256:await security.fileDigest(thumbnail),thumbnail_byte_size:thumbnail.length}:{}),...(payload.photo_crop?{crop_x:payload.photo_crop.x,crop_y:payload.photo_crop.y,crop_width:payload.photo_crop.width,crop_height:payload.photo_crop.height}:{crop_x:null,crop_y:null,crop_width:null,crop_height:null})};
 const doc={...metadata,id,version:2,state:'active',bucket:'private-documents',object_path:'employee/proof.pdf',uploaded_by:uid,...(thumbnail?{thumbnail_object_path:'employee/thumb.jpg'}:{}),...options.doc};
 const events=[],h={requireConfig:()=>({url:'https://storage.invalid'}),session:async()=>({profile:{id:uid},token:'managed-actor'}),supabaseHeaders:(_c,{token})=>new Headers({authorization:'Bearer '+token}),rpc:async(name,args)=>{events.push(['rpc',name,args.p_kind,args]);if(args.p_kind==='document'&&name==='followup_write'){if(options.writeDenied)throw new AppError('write revoked',403);return {...doc,state:'pending',version:1};}if(args.p_kind==='document'&&name==='followup_read'){if(options.readDenied)throw new AppError('read denied',403);return doc;}if(args.p_kind==='document_activate')return {...doc,state:'active',version:2};throw Error('Unexpected RPC '+args.p_kind);},fetch:async(url,init={})=>{events.push(['fetch',String(url),init.method||'GET']);assert.equal(init.headers.get('authorization'),'Bearer managed-actor');if(init.method==='POST'){assert.equal(init.headers.get('x-upsert'),'false');if(options.postThrows)throw Error('lost response');return new Response(JSON.stringify({error:'Unauthorized',message:'new row violates row-level security policy',statusCode:'403'}),{status:options.postStatus||400});}if(options.getStatus)return new Response(null,{status:options.getStatus});const content=String(url).endsWith('thumb.jpg')?thumbnail:bytes;return new Response(options.corrupt||(options.corruptThumbnail&&String(url).endsWith('thumb.jpg'))?new Uint8Array([1,2,3]):content);}};
 return {payload,doc,events,h};
}
async function run(s){
 globalThis.__documentUploadHarness=s.h;
 try{return await POST(new Request('https://qa.invalid/api/followup/documents',{method:'POST',headers:{origin:'https://qa.invalid','content-type':'application/json','x-hr-request':'1'},body:JSON.stringify(s.payload)}));}
 finally{delete globalThis.__documentUploadHarness;}
}
const storagePosts=s=>s.events.filter(e=>e[0]==='fetch'&&e[2]==='POST');
test('cached pending receipt is reconciled against active current metadata and bounded exact original bytes',async()=>{
 const s=await scenario(),r=await run(s);assert.equal(r.status,200);const result=await r.json();assert.equal(result.version,2);assert.equal(result.state,'active');assert.equal(storagePosts(s).length,0);assert.equal(s.events.filter(e=>e[0]==='rpc'&&e[2]==='document_activate').length,0);assert.ok(s.events.some(e=>e[0]==='fetch'&&e[1].includes('/object/authenticated/')));
});
test('fresh retry and explicit resume reject changed immutable metadata, ownership, archived state and corrupt originals',async()=>{
 for(const change of[{title:'changed'},{employee_id:'55555555-5555-4555-8555-555555555555'},{description:'changed'},{issued_on:null},{expires_on:null},{file_name:'changed.pdf'},{mime_type:'image/png'},{byte_size:pdf.length+1},{original_sha256:'0'.repeat(64)},{previous_document_id:'55555555-5555-4555-8555-555555555555'},{crop_x:0,crop_y:0,crop_width:1,crop_height:1}]){
  for(const resume of[false,true]){const s=await scenario({doc:change,payload:resume?{resume_document_id:id}:{}});assert.equal((await run(s)).status,409,JSON.stringify(change));assert.equal(s.events.filter(e=>e[0]==='fetch').length,0);}
 }
 for(const state of['archived','abandoned']){const s=await scenario({doc:{state}});assert.equal((await run(s)).status,409);assert.equal(storagePosts(s).length,0);}
 const foreign=await scenario({doc:{uploaded_by:'55555555-5555-4555-8555-555555555555'}});assert.equal((await run(foreign)).status,403);assert.equal(storagePosts(foreign).length,0);
 const corrupt=await scenario({corrupt:true});assert.equal((await run(corrupt)).status,409);assert.equal(storagePosts(corrupt).length,0);
});
test('pending race accepts an exact authenticated existing object after Storage RLS400 or lost POST response and activates once',async()=>{
 for(const options of[{postStatus:400},{postStatus:409},{postThrows:true}]){const s=await scenario({...options,doc:{state:'pending',version:1}});const r=await run(s);assert.equal(r.status,200);assert.equal(storagePosts(s).length,1);assert.equal(s.events.filter(e=>e[0]==='rpc'&&e[2]==='document_activate').length,1);}
});
test('pending race never activates mismatching, inaccessible or missing storage objects',async()=>{
 for(const [options,status]of[[{corrupt:true},409],[{getStatus:403},403],[{getStatus:404},503],[{postStatus:403,getStatus:404},403]]){const s=await scenario({...options,doc:{state:'pending',version:1}});assert.equal((await run(s)).status,status);assert.equal(s.events.filter(e=>e[0]==='rpc'&&e[2]==='document_activate').length,0);}
});
test('active photo retry verifies the immutable crop and thumbnail bytes before success',async()=>{
 const bytes=new Uint8Array(await sharp({create:{width:32,height:32,channels:3,background:'#2456D8'}}).jpeg().toBuffer());
 const payload={kind:'photo',mime_type:'image/jpeg',file_name:'photo.jpg',thumbnail_base64:Buffer.from(bytes).toString('base64'),photo_crop:{x:0,y:0,width:1,height:1}};
 const s=await scenario({bytes,payload});assert.equal((await run(s)).status,200);assert.equal(s.events.filter(e=>e[0]==='fetch').length,2);assert.equal(storagePosts(s).length,0);
 const corrupt=await scenario({bytes,payload,corruptThumbnail:true});assert.equal((await run(corrupt)).status,409);assert.equal(storagePosts(corrupt).length,0);
 const wrong=await scenario({bytes,payload,doc:{thumbnail_sha256:'0'.repeat(64)}});assert.equal((await run(wrong)).status,409);assert.equal(wrong.events.filter(e=>e[0]==='fetch').length,0);
});
test('revoked write or document read capability fails closed without Storage mutation, including write-only active retries',async()=>{
 for(const options of[{writeDenied:true},{readDenied:true}]){const s=await scenario(options);assert.equal((await run(s)).status,403);assert.equal(s.events.filter(e=>e[0]==='fetch').length,0);assert.equal(s.events.filter(e=>e[0]==='rpc'&&e[2]==='document_activate').length,0);}
});
