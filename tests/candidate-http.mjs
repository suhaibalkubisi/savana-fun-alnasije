// Explicitly isolated: real Next handlers; synthetic SQL/Auth/Storage adapter.
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {jsPDF} from 'jspdf';
import {ids,employee} from './evening-db-fixture.mjs';
import {stripJpegMetadata} from '../lib/server/document-security.mjs';

if(process.argv[2]!=='--synthetic-only')throw Error('The synthetic-only flag is required');
const base=process.argv.find(x=>x.startsWith('--base='))?.slice(7)||'http://localhost:56494';
assert.ok(['http://localhost:56494','http://localhost:56495','http://localhost:56496'].includes(base),'Only the bounded loopback candidate servers are allowed');
const runtime=base.endsWith('56496')?'Actual built Vinext Worker artifact via official Vinext Node production preview with bounded Windows static-asset adapter and cloudflare workers env stub':base.endsWith('56495')?'Actual built Vinext Worker artifact via official Vinext Node production preview with cloudflare workers env stub':'Actual local Next development handlers';
const gateway='https://localhost:56490',password='Candidate-Isolated-2026!';
const run=Number(process.argv.find(x=>x.startsWith('--run='))?.slice(6)||1);assert.ok([1,2,3].includes(run));
const workloadDates=({1:['2026-10-06','2026-10-07','2026-10-05'],2:['2026-10-03','2026-10-04','2026-10-02'],3:['2026-10-08','2026-10-09','2026-10-11']})[run];
const ca=await fs.readFile('work/candidate-cert/localhost-cert.pem');
const out=path.resolve('../evidence');await fs.mkdir(out,{recursive:true});
const checks=[],samples=[];const started=performance.now();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
class Client {
 constructor(email){this.email=email;this.cookies=new Map();}
 cookie(){return [...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ');}
 async request(route,{method='GET',body,headers={},phase,expectedFailure=false}={}){
  const requestHeaders={...(this.cookies.size?{Cookie:this.cookie()}:{}),...(body!==undefined?{'Content-Type':'application/json','x-hr-request':'1',Origin:base}:{}),...headers};
  for(const [key,value]of Object.entries(requestHeaders))if(value===null)delete requestHeaders[key];
  const start=performance.now();const response=await fetch(base+route,{method,headers:requestHeaders,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],i=first.indexOf('=');if(i>0)this.cookies.set(first.slice(0,i),first.slice(i+1));}
  const bytes=new Uint8Array(await response.arrayBuffer());let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{data=null;}
  if(phase)samples.push({phase,ms:performance.now()-start,status:response.status,ok:response.ok,expectedFailure:expectedFailure&&response.status===409});
  return {status:response.status,data,bytes,headers:response.headers};
 }
 async read(kind,filters={},phase){const r=await this.request('/api/followup?'+new URLSearchParams({kind,...filters}),{phase});assert.equal(r.status,200,`read ${kind}: ${r.data?.error}`);return r.data;}
 async write(kind,data,request=crypto.randomUUID(),phase){const r=await this.request('/api/followup',{method:'POST',body:{kind,data,request_id:request},phase});assert.equal(r.status,200,`write ${kind}: ${r.data?.error}`);return r.data;}
 async login(phase){const r=await this.request('/api/auth',{method:'POST',body:{email:this.email,password},phase});assert.equal(r.status,200,`synthetic login ${this.email}: ${r.data?.error}`);return r;}
}
async function direct(client,route,{method='POST',data,bytes,mime}={}){
 return new Promise((resolve,reject)=>{
  const payload=bytes??Buffer.from(JSON.stringify(data??{}));
  const request=https.request(gateway+route,{method,ca,headers:{apikey:'sb_publishable_candidate_fixture',Authorization:'Bearer '+client.cookies.get('hr-access'),'Content-Type':mime??'application/json','Content-Length':payload.length}},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{const body=Buffer.concat(chunks);let parsed;try{parsed=JSON.parse(body);}catch{}resolve({status:response.statusCode,data:parsed,bytes:body});});});
  request.on('error',reject);request.end(payload);
 });
}
async function check(name,run){await run();checks.push({name,status:'PASS'});console.log('PASS '+name);}
const admin=new Client('admin@candidate.invalid'),follow=new Client('followup@candidate.invalid'),supervisor=new Client('supervisor@candidate.invalid'),viewer=new Client('viewer@candidate.invalid');
const operators=Array.from({length:20},(_,i)=>new Client(`operator${i+1}@candidate.invalid`));
const pdf=new jsPDF();pdf.text('Synthetic isolated attachment',20,20);const pdfBytes=new Uint8Array(pdf.output('arraybuffer'));
const uploadBody=(name,bytes=pdfBytes)=>({operation:'upload',request_id:crypto.randomUUID(),employee_id:employee(2),title:name,kind:'general',file_name:'synthetic.pdf',mime_type:'application/pdf',content_base64:Buffer.from(bytes).toString('base64')});
async function upload(client,p){const r=await client.request('/api/followup/documents',{method:'POST',body:p});assert.equal(r.status,200,`upload: ${r.data?.error}`);return r.data;}
async function content(client,id,thumbnail=false){const grant=await client.request('/api/followup/documents?'+new URLSearchParams({id,...(thumbnail?{thumbnail:'1'}:{})}));assert.equal(grant.status,200,`grant: ${grant.data?.error}`);assert.equal(typeof grant.data?.url,'string',`Grant response is not JSON: status=${grant.status} mime=${grant.headers.get('content-type')} bytes=${grant.bytes.length}`);return client.request(grant.data.url);}
const manualMetadata=(p,bytes=pdfBytes)=>({employee_id:p.employee_id,title:p.title,kind:p.kind,file_name:p.file_name,mime_type:p.mime_type,byte_size:bytes.length,description:'',issued_on:null,expires_on:null,previous_document_id:null,photo_crop:null,original_sha256:hash(bytes)});
let commonDoc,photoDoc,bootstrap;
async function capability(user_id,capability,granted,reason){const existing=(await admin.read('capabilities',{user_id})).find(c=>c.capability===capability);return admin.write('capability',{user_id,capability,granted,version:existing?.version??0,reason});}
try{
 await check('Actual HTTP auth, CSRF and HttpOnly strict cookies',async()=>{
  assert.equal((await admin.request('/api/followup')).status,401);
  assert.equal((await admin.request('/api/auth',{method:'POST',body:{email:admin.email,password},headers:{'x-hr-request':null}})).status,403);
  assert.equal((await admin.request('/api/auth',{method:'POST',body:{email:admin.email,password},headers:{Origin:'https://cross-site.invalid'}})).status,403);
  assert.equal((await admin.request('/api/auth',{method:'POST',body:{email:admin.email,password},headers:{'Content-Type':'text/plain'}})).status,415);
  const login=await admin.login();for(const cookie of login.headers.getSetCookie()){assert.ok(/HttpOnly/i.test(cookie));assert.ok(/SameSite=Strict/i.test(cookie));assert.ok(/Path=\//i.test(cookie));}
  await Promise.all([follow.login(),supervisor.login(),viewer.login()]);bootstrap=await admin.read('bootstrap');assert.equal(bootstrap.shifts.length,1);assert.equal(bootstrap.evening_shift_id,ids.evening);
  assert.equal((await admin.request('/api/data')).status,410);
  assert.equal((await supervisor.request('/api/followup?'+new URLSearchParams({kind:'roster',department_id:ids.d2,start:'2026-10-07'}))).status,403);
  assert.equal((await follow.request('/api/followup?'+new URLSearchParams({kind:'roster',department_id:ids.d1,start:'2026-10-07',shift_id:ids.morning}))).status,400);
 });
 await check('Scoped profile edits, privacy, search and explicit permission revocation',async()=>{
  const before=(await follow.read('profile',{employee_id:employee(2)})).employee;
  const updated=await follow.write('profile',{employee_id:before.id,version:before.version,phone:'07001231234',emergency_name:'Synthetic emergency contact',emergency_phone:'07004564567',reason:'Synthetic HTTP enrichment'});
  assert.equal(updated.internal_code,before.internal_code);assert.equal(updated.phone,'07001231234');
  const hidden=await supervisor.read('profile',{employee_id:before.id});for(const field of ['phone','emergency_name','emergency_phone'])assert.equal(field in hidden.employee,false);
  for(const event of hidden.history)for(const value of [event.old_value,event.new_value])if(value)for(const field of ['phone','emergency_name','emergency_phone'])assert.equal(field in value,false);
  assert.equal((await supervisor.read('search',{query:'07001231234'})).employees.length,0);
  assert.equal((await follow.read('search',{query:'07001231234'})).employees[0].id,before.id);
  assert.equal((await viewer.request('/api/followup',{method:'POST',body:{kind:'profile',data:{employee_id:before.id,version:updated.version,phone:'changed',reason:'Must be denied'},request_id:crypto.randomUUID()}})).status,403);
  const cap=await capability(ids.admin,'documents_sensitive_write',true,'Isolated reference/document verification');
  await admin.write('profile',{employee_id:before.id,version:updated.version,reference_number:'HTTP-PRIVATE-REF-01',reason:'Synthetic reference'});
  const oldRead=(await admin.read('capabilities',{user_id:ids.admin})).find(c=>c.capability==='documents_sensitive_read');
  if(!oldRead?.granted)assert.equal((await admin.read('search',{query:'HTTP-PRIVATE-REF-01'})).employees.length,0);
  const readCap=await capability(ids.admin,'documents_sensitive_read',true,'Isolated restricted read verification');
  assert.equal((await admin.read('search',{query:'HTTP-PRIVATE-REF-01'})).employees[0].id,before.id);
  assert.equal((await supervisor.read('search',{query:'HTTP-PRIVATE-REF-01'})).employees.length,0);
  assert.ok(cap.version>=1);assert.ok(readCap.version>=1);
 });
 await check('Private upload, exact retry, sign/proxy expiry, viewer/storage denial',async()=>{
  const p=uploadBody('HTTP private synthetic PDF');commonDoc=await upload(follow,p);assert.equal(commonDoc.state,'active');assert.equal((await upload(follow,p)).id,commonDoc.id);
  const r=await content(follow,commonDoc.id);assert.equal(r.status,200);assert.equal(hash(r.bytes),hash(pdfBytes));assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.ok(r.headers.get('cache-control').includes('no-store'));
  const grant=await follow.request('/api/followup/documents?id='+commonDoc.id);assert.equal(typeof grant.data?.url,'string',`Grant response is not JSON: status=${grant.status} mime=${grant.headers.get('content-type')} bytes=${grant.bytes.length}`);const expired=new URL(grant.data.url,base);expired.searchParams.set('expires',String(Math.floor(Date.now()/1000)-1));assert.equal((await follow.request(expired.pathname+expired.search)).status,410);
  assert.equal((await viewer.request('/api/followup/documents?id='+commonDoc.id)).status,403);
  assert.equal((await viewer.request(grant.data.url)).status,410);
  assert.equal((await viewer.request('/api/followup/documents',{method:'POST',body:uploadBody('Viewer denied upload')})).status,403);
  const guessed=await direct(follow,'/storage/v1/object/fu-private/guessed/path.pdf',{bytes:pdfBytes,mime:'application/pdf'});assert.equal(guessed.status,403);
  await direct(viewer,'/storage/v1/object/fu-private',{method:'DELETE',data:{prefixes:[commonDoc.object_path]}});
  assert.equal((await content(follow,commonDoc.id)).status,200);
  const identity=await upload(admin,{...uploadBody('Synthetic identity file'),kind:'identity'});
  const c=await capability(ids.viewer,'documents_read',true,'Isolated read-only file verification');
  assert.equal((await viewer.request('/api/followup/documents?id='+commonDoc.id)).status,200);
  assert.equal((await viewer.request('/api/followup/documents?id='+identity.id)).status,403);
  await admin.write('capability',{user_id:ids.viewer,capability:'documents_read',granted:false,version:c.version,reason:'Revoke isolated file read'});
  assert.equal((await viewer.request('/api/followup/documents?id='+commonDoc.id)).status,403);
 });
 await check('Interrupted upload resumption, incompatible metadata, abandonment and cleanup',async()=>{
  const p=uploadBody('Interrupted general synthetic PDF');const pending=await follow.write('document',manualMetadata(p),p.request_id);assert.equal(pending.upload_request_id,p.request_id);
  assert.ok((await follow.read('pending_documents',{employee_id:employee(2)})).some(d=>d.id===pending.id));
  const wrong=await follow.request('/api/followup/documents',{method:'POST',body:{...p,title:'Different metadata',resume_document_id:pending.id,request_id:crypto.randomUUID()}});assert.equal(wrong.status,409);
  assert.equal((await direct(follow,'/storage/v1/object/fu-private/'+pending.object_path,{bytes:pdfBytes,mime:'application/pdf'})).status,200);
  const resumed=await upload(follow,{...p,resume_document_id:pending.id,request_id:crypto.randomUUID()});assert.equal(resumed.id,pending.id);assert.equal(resumed.state,'active');
  const p2=uploadBody('Cancelled partial synthetic PDF');const abandonedPending=await follow.write('document',manualMetadata(p2),p2.request_id);
  await direct(follow,'/storage/v1/object/fu-private/'+abandonedPending.object_path,{bytes:pdfBytes,mime:'application/pdf'});
  const request=crypto.randomUUID(),data={operation:'abandon',request_id:request,id:abandonedPending.id,version:abandonedPending.version,reason:'Synthetic interrupted upload cancellation'};
  const gone=await follow.request('/api/followup/documents',{method:'POST',body:data});assert.equal(gone.status,200);assert.equal(gone.data.cleanup_complete,true);assert.equal(gone.data.state,'abandoned');
  assert.equal((await follow.request('/api/followup/documents',{method:'POST',body:data})).status,200);
  assert.equal((await follow.request('/api/followup/documents',{method:'POST',body:{operation:'cleanup',request_id:crypto.randomUUID(),id:abandonedPending.id}})).status,200);
  assert.equal((await admin.request('/api/followup/documents',{method:'POST',body:{operation:'cleanup',request_id:crypto.randomUUID(),id:abandonedPending.id}})).status,403);
  const abandonedRows=await follow.read('pending_documents',{employee_id:employee(2),include_abandoned:'true'});assert.equal(abandonedRows.find(d=>d.id===abandonedPending.id).state,'abandoned');
  const profile=await follow.read('profile',{employee_id:employee(2)});assert.equal(profile.history.filter(e=>e.kind==='document_abandon'&&e.entity_id===abandonedPending.id).length,1);
 });
 await check('Photo original, metadata-free thumbnail, resume, replacement and archived evidence',async()=>{
  const jpeg=new Uint8Array(await sharp({create:{width:100,height:100,channels:3,background:'#2456d8'}}).jpeg().toBuffer());
  const marker=new TextEncoder().encode('Exif\u0000\u0000synthetic private GPS'),segment=new Uint8Array([255,225,0,marker.length+2,...marker]);
  const original=new Uint8Array([...jpeg.slice(0,2),...segment,...jpeg.slice(2)]),thumbnail=stripJpegMetadata(original);
  const p={...uploadBody('Interrupted synthetic photo',original),employee_id:employee(3),kind:'photo',file_name:'synthetic.jpg',mime_type:'image/jpeg',thumbnail_base64:Buffer.from(original).toString('base64'),photo_crop:{x:0,y:0,width:1,height:1}};
  const metadata={...manualMetadata(p,original),photo_crop:p.photo_crop,thumbnail_byte_size:thumbnail.length,thumbnail_sha256:hash(thumbnail)};
  const pending=await follow.write('document',metadata,p.request_id);await direct(follow,'/storage/v1/object/fu-private/'+pending.object_path,{bytes:original,mime:'image/jpeg'});
  photoDoc=await upload(follow,{...p,resume_document_id:pending.id,request_id:crypto.randomUUID()});
  const old=await content(follow,photoDoc.id),thumb=await content(follow,photoDoc.id,true);assert.equal(hash(old.bytes),hash(original));assert.equal(hash(thumb.bytes),hash(thumbnail));assert.equal(new TextDecoder().decode(thumb.bytes).includes('synthetic private GPS'),false);
  const replacement=await upload(follow,{...p,title:'Replacement synthetic photo',request_id:crypto.randomUUID(),previous_document_id:photoDoc.id});assert.equal((await follow.read('document',{id:photoDoc.id})).state,'archived');assert.equal(hash((await content(follow,photoDoc.id)).bytes),hash(original));
  const profile=(await follow.read('profile',{employee_id:employee(3)})).employee;await follow.write('profile',{employee_id:profile.id,version:profile.version,photo_document_id:replacement.id,reason:'Choose isolated active photo'});assert.equal((await follow.read('profile',{employee_id:employee(3)})).employee.photo_document_id,replacement.id);
  await direct(follow,'/storage/v1/object/fu-private',{method:'DELETE',data:{prefixes:[photoDoc.object_path,photoDoc.thumbnail_object_path]}});assert.equal((await content(follow,photoDoc.id)).status,200);
 });
 await check('Proxy denies forged direct Storage content and incorrect digests',async()=>{
  for(const [title,bytes,digest]of [['Forged HTML',new TextEncoder().encode('<html>synthetic active content</html>'),null],['Forged digest',pdfBytes,'0'.repeat(64)]]){
   const p=uploadBody(title,bytes),metadata={...manualMetadata(p,bytes),original_sha256:digest??hash(bytes)};
   const doc=await follow.write('document',metadata);assert.equal((await direct(follow,'/storage/v1/object/fu-private/'+doc.object_path,{bytes,mime:'application/pdf'})).status,200);
   await follow.write('document_activate',{id:doc.id,version:doc.version});assert.equal((await content(follow,doc.id)).status,422);
  }
 });
 await check('Typed reporter metadata edits and supervisor denial for offline reports',async()=>{
  const reporter=await follow.write('reporter',{department_id:ids.d1,name:'Synthetic HTTP actual phone reporter',channel:'phone',active:true});
  const roster=await follow.read('roster',{department_id:ids.d1,start:'2026-10-12'});
  const data={department_id:ids.d1,work_date:'2026-10-12',reporter_registry_id:reporter.id,channel:'phone',entries:roster.map(e=>({employee_id:e.id,status:'present'}))};
  const draft=await follow.write('save',data);assert.equal(draft.reported_at,null);
  const edited=await follow.write('save',{...data,id:draft.id,version:draft.version,reported_at:'2026-10-13T00:10:00+03:00',evidence_reference:'Synthetic actual callback'});
  assert.equal(new Date(edited.reported_at).toISOString(),'2026-10-12T21:10:00.000Z');assert.equal(edited.evidence_reference,'Synthetic actual callback');
  assert.equal((await supervisor.request('/api/followup',{method:'POST',body:{kind:'reconcile',data:{...data,id:edited.id,version:edited.version,reason:'Offline ownership must deny'},request_id:crypto.randomUUID()}})).status,403);
  const submitted=await follow.write('submit',{...data,id:edited.id,version:edited.version});assert.equal(submitted.reported_at,edited.reported_at);
  assert.equal((await supervisor.request('/api/followup',{method:'POST',body:{kind:'revise',data:{...data,id:submitted.id,version:submitted.version,reason:'Offline ownership must deny'},request_id:crypto.randomUUID()}})).status,403);
 });
 await check('A write-only uploader can recover own partials but cannot read active evidence',async()=>{
  await capability(ids.supervisor,'documents_write',true,'Isolated write-only recovery');
  const p=uploadBody('Write-only resumed PDF'),pending=await supervisor.write('document',manualMetadata(p),p.request_id);
  await direct(supervisor,'/storage/v1/object/fu-private/'+pending.object_path,{bytes:pdfBytes,mime:'application/pdf'});
  const active=await upload(supervisor,{...p,resume_document_id:pending.id,request_id:crypto.randomUUID()});assert.equal(active.state,'active');
  assert.equal((await supervisor.request('/api/followup/documents?id='+active.id)).status,403);
  const p2=uploadBody('Write-only cancelled PDF'),cancel=await supervisor.write('document',manualMetadata(p2),p2.request_id);await direct(supervisor,'/storage/v1/object/fu-private/'+cancel.object_path,{bytes:pdfBytes,mime:'application/pdf'});
  const abandoned=await supervisor.request('/api/followup/documents',{method:'POST',body:{operation:'abandon',request_id:crypto.randomUUID(),id:cancel.id,version:cancel.version,reason:'Own write-only partial cleanup'}});assert.equal(abandoned.status,200);assert.equal(abandoned.data.cleanup_complete,true);
 });
 await check('20 concurrent synthetic HTTP users: login, reads, drafts, submit, review, retry, conflicts, reporting',async()=>{
  const workloadStart=performance.now();await Promise.all(operators.map(c=>c.login('login')));
  const depts=bootstrap.departments;assert.equal(depts.length,12);
  const reporters=await Promise.all(depts.map(d=>admin.write('reporter',{department_id:d.id,name:'Synthetic HTTP reporter '+d.id,channel:'phone',active:true})));
  await Promise.all(operators.map(c=>c.read('bootstrap',{},'bootstrap')));
  const rosters=await Promise.all(operators.map((c,i)=>c.read('roster',{department_id:depts[i%12].id,start:i<12?workloadDates[0]:workloadDates[1]},'roster_read')));
  const payloads=rosters.map((rows,i)=>({department_id:depts[i%12].id,work_date:i<12?workloadDates[0]:workloadDates[1],reporter_registry_id:reporters[i%12].id,channel:'phone',entries:rows.map((e,j)=>({employee_id:e.id,status:j===0?'absent3':j===rows.length-1?'unresolved':'present'}))}));
  const drafts=await Promise.all(operators.map((c,i)=>c.write('save',payloads[i],crypto.randomUUID(),'draft_save')));assert.ok(drafts.every(x=>x.reporter_id===null&&x.reported_at===null));
  const submitted=await Promise.all(operators.map((c,i)=>c.write('submit',{...payloads[i],id:drafts[i].id,version:drafts[i].version},crypto.randomUUID(),'submit')));assert.ok(submitted.every(x=>x.state==='submitted'));
  const reviewed=await Promise.all(operators.map((c,i)=>c.write('review',{...payloads[i],id:submitted[i].id,version:submitted[i].version},crypto.randomUUID(),'review')));assert.ok(reviewed.every(x=>x.state==='reviewed'&&x.review_scope==='partial'&&x.reviewed_unresolved_count===1));
  const sharedRequest=crypto.randomUUID(),sharedPayload={...payloads[0],work_date:workloadDates[2]};
  const repeated=await Promise.all(operators.map(()=>operators[0].write('save',sharedPayload,sharedRequest,'idempotent_retry')));assert.equal(new Set(repeated.map(x=>x.id)).size,1);assert.equal(new Set(repeated.map(x=>x.version)).size,1);
  const stale={...sharedPayload,id:repeated[0].id,version:repeated[0].version};const conflicts=await Promise.all(operators.map(c=>c.request('/api/followup',{method:'POST',body:{kind:'save',data:stale,request_id:crypto.randomUUID()},phase:'stale_conflict',expectedFailure:true})));
  assert.equal(conflicts.filter(r=>r.status===200).length,1);assert.equal(conflicts.filter(r=>r.status===409).length,19);
  const individual=await Promise.all(operators.map((c,i)=>c.read('position',{start:'2026-10-01',end:'2026-10-31',employee_id:rosters[i][0].id},'individual_month_read')));assert.ok(individual.every(rows=>new Set(rows.map(r=>r.employee_id)).size===1));
  const reports=await Promise.all(operators.map((c,i)=>c.request('/api/followup/export',{method:'POST',body:{kind:'department-monthly',start:'2026-10-01',end:'2026-10-31',department_id:depts[i%12].id},phase:'department_monthly_export_model'})));
  assert.ok(reports.every(r=>r.status===200&&r.data?.scope_kind==='evening'),JSON.stringify(reports.map(r=>({status:r.status,error:r.data?.error,mime:r.headers.get('content-type'),bytes:r.bytes.length}))));
  const authorizedEmployees=await operators[0].read('employees');assert.ok(authorizedEmployees.length>=229);
  for(let i=0;i<reports.length;i++)assert.equal(reports[i].data.rows.length,authorizedEmployees.filter(e=>e.department_id===depts[i%12].id).length);
  const global=await operators[0].request('/api/followup/export',{method:'POST',body:{kind:'monthly',start:'2026-10-01',end:'2026-10-31'}});assert.equal(global.status,200);assert.equal(global.data.rows.length,authorizedEmployees.length);
  const personal=await operators[0].request('/api/followup/export',{method:'POST',body:{kind:'employee',start:'2026-10-01',end:'2026-10-31',employee_id:rosters[0][0].id}});assert.equal(personal.status,200);assert.equal(new Set(personal.data.row_ids).size,1);
  const revision=await operators[0].write('revise',{...payloads[0],id:reviewed[0].id,version:reviewed[0].version,reason:'Synthetic traceable correction'});assert.equal(revision.state,'draft');assert.ok((await operators[0].read('revisions',{id:revision.id})).length>=3);
  const users=await admin.read('bootstrap');const actor=users.users.find(u=>u.email==='operator1@candidate.invalid');
  await admin.write('account',{user_id:actor.id,role:'VIEWER',active:true,version:actor.version,departments:depts.map(d=>d.id)});
  assert.equal((await operators[0].request('/api/followup',{method:'POST',body:{kind:'save',data:sharedPayload,request_id:sharedRequest}})).status,403);
  // The applied account contract returns {ok:true}; obtain the new version from
  // authoritative state, as an actual account administration client does.
  const downgraded=(await admin.read('bootstrap')).users.find(u=>u.id===actor.id);
  assert.equal(downgraded.role,'VIEWER');assert.ok(downgraded.version>actor.version);
  await admin.write('account',{user_id:actor.id,role:'FOLLOWUP',active:true,version:downgraded.version,departments:depts.map(d=>d.id)});
  const elapsed=performance.now()-workloadStart;const ok=samples.filter(x=>x.ok),times=ok.map(x=>x.ms).sort((a,b)=>a-b);const percentile=(a,p)=>Math.round(a[Math.min(a.length-1,Math.floor(a.length*p))]);const perPhase={};for(const phase of new Set(samples.map(x=>x.phase))){const list=samples.filter(x=>x.phase===phase),t=list.filter(x=>x.ok).map(x=>x.ms).sort((a,b)=>a-b);perPhase[phase]={operations:list.length,successes:t.length,expected_conflicts:list.filter(x=>x.expectedFailure).length,p50_ms:percentile(t,.5),p95_ms:percentile(t,.95)};}
  const metrics={status:'PASS',environment:runtime+'; synthetic PGlite SQL/Auth/Storage adapter (SQL serialized by adapter), not native or hosted Supabase',concurrent_users:20,synthetic_employees:231,departments:12,operations:samples.length,successes:ok.length,expected_stale_conflicts:samples.filter(x=>x.expectedFailure).length,unexpected_failures:samples.filter(x=>!x.ok&&!x.expectedFailure).length,elapsed_ms:Math.round(elapsed),throughput_ops_per_second:Number((samples.length/(elapsed/1000)).toFixed(2)),p50_ms:percentile(times,.5),p95_ms:percentile(times,.95),per_phase:perPhase,report_workload:'20 parallel full selected-department monthly models; separate single global and individual full-scope checks',production_or_hosted_test:false,pdf_xlsx_rendering_load:'NOT TESTED; this workload exercises the canonical export model HTTP endpoint',retained_global_peak_limit:'See candidate-http-global-export-limit.json: 20 parallel global models returned14success/6HTTP503 in the single-process adapter',run_timestamp:new Date().toISOString()};
  await fs.writeFile(path.join(out,'candidate-http-20-user-workload.json'),JSON.stringify(metrics,null,2));
 });
 await check('Refresh and revoked session deny live and cached requests',async()=>{
  const actor=operators[19];actor.cookies.delete('hr-access');assert.equal((await actor.request('/api/auth')).status,200);assert.ok(actor.cookies.get('hr-access'));
  const staleJar=new Map(actor.cookies);assert.equal((await actor.request('/api/auth',{method:'POST',body:{action:'logout'}})).status,200);actor.cookies=staleJar;
  assert.equal((await actor.request('/api/followup?kind=bootstrap')).status,403);
 });
 const result={status:'PASS',environment:runtime+'; synthetic PGlite/Auth/Storage adapter; no production mutations; no native or hosted Supabase Auth/Storage claim',checks,elapsed_ms:Math.round(performance.now()-started),run_timestamp:new Date().toISOString()};await fs.writeFile(path.join(out,'candidate-http-functional.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){const result={status:'FAIL',environment:runtime+'; synthetic adapter',checks,error:error.message,samples,run_timestamp:new Date().toISOString()};await fs.writeFile(path.join(out,'candidate-http-functional.json'),JSON.stringify(result,null,2));console.error(error.message);process.exitCode=1;}
