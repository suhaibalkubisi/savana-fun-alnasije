import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import ts from 'typescript';
const file=new URL('./.transport-check.mjs',import.meta.url);
let source=await readFile(new URL('../lib/server/supabase.ts',import.meta.url),'utf8');
source=source.replace('import "server-only";','').replace('import { cookies } from "next/headers";','const cookies=async()=>globalThis.transportJar;').replace('import { env } from "cloudflare:workers";','const env={NEXT_PUBLIC_SUPABASE_URL:"https://synthetic.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_synthetic"};').replace('./supabase-connection.mjs','../lib/server/supabase-connection.mjs');
await writeFile(file,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {body,session,errorResponse,protectMutation}=await import(file.href);
after(()=>rm(file,{force:true}));
test('chunked requests enforce UTF-8 byte limits and preserve split Arabic characters',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({name:'اسم عربي'}));
 const request=()=>new Request('https://synthetic.invalid',{method:'POST',duplex:'half',body:new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}})});
 assert.deepEqual(await body(request(),bytes.length),{name:'اسم عربي'});
 await assert.rejects(body(request(),bytes.length-1),e=>e.status===413);
 await assert.rejects(body(new Request('https://synthetic.invalid',{method:'POST',body:'not JSON'})),e=>e.status===400);
});
test('concurrent expired sessions share refresh and check the live profile for each request',async()=>{
 const original=globalThis.fetch;const values=new Map([['hr-access','expired.synthetic.token'],['hr-refresh','synthetic-refresh']]);
 const attributes=[];globalThis.transportJar={get:key=>values.has(key)?{value:values.get(key)}:undefined,set:(k,v,opts)=>{values.set(k,v);attributes.push(opts);},delete:k=>values.delete(k)};
 let refreshes=0,profiles=0;let release;const barrier=new Promise(r=>release=r);
 globalThis.fetch=async(url,options)=>{
  if(url.includes('grant_type=refresh_token')){refreshes++;await barrier;return Response.json({access_token:'fresh.synthetic.token',refresh_token:'rotated',expires_in:3600});}
  if(url.endsWith('/user'))return new Headers(options.headers).get('authorization')==='Bearer expired.synthetic.token'?Response.json({}, {status:401}):Response.json({id:'synthetic'});
  if(url.includes('/rpc/hr_read')){profiles++;return Response.json({role:'VIEWER',is_active:true});}
  throw new Error('Unexpected transport request');
 };
 try {const calls=Promise.all([session(),session(),session()]);await new Promise(r=>setImmediate(r));release();const result=await calls;assert.equal(refreshes,1);assert.equal(profiles,3);assert.ok(result.every(r=>r.profile.role==='VIEWER'));assert.ok(attributes.every(a=>a.httpOnly&&a.secure&&a.sameSite==='strict'));}
 finally{globalThis.fetch=original;delete globalThis.transportJar;}
});
test('cross-origin mutation is denied and internal errors cannot echo payloads',async()=>{
 assert.throws(()=>protectMutation(new Request('https://synthetic.invalid/api',{headers:{origin:'https://other.invalid','x-hr-request':'1','content-type':'application/json'}})),e=>e.status===403);
 const original=console.error;const logs=[];console.error=(...parts)=>logs.push(parts.join(' '));
 try{const response=errorResponse(new Error('SECRET synthetic sensitive payload'));assert.equal(response.status,500);assert.ok(!(await response.text()).includes('SECRET'));assert.ok(!logs.join('').includes('SECRET'));}finally{console.error=original;}
});
