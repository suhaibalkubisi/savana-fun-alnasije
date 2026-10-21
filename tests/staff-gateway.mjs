// Actual application HTTP handlers use this disposable SQL/storage/auth adapter.
// Native Supabase Auth/Storage and hosted load are not claimed by this harness.
import https from 'node:https';
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setup,ids} from './evening-db-fixture.mjs';
if(process.argv[2]!=='--synthetic-only')throw Error('Synthetic-only fixture required');
const root=path.resolve('..','..'),certRoot=path.resolve('work/candidate-cert');
const db=await setup(),secret=randomBytes(32),password='Candidate-Isolated-2026!',objects=new Map(),refreshes=new Map(),lostReceipts=new Set();
await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/20261014181643_evening_controlled_roster_setup.sql',import.meta.url),'utf8'));
const users=[{id:ids.admin,email:'admin@candidate.invalid'},{id:ids.supervisor,email:'supervisor@candidate.invalid'},{id:ids.follow,email:'followup@candidate.invalid'},{id:ids.viewer,email:'viewer@candidate.invalid'}];
await db.exec('reset role');
for(let i=3;i<=12;i++)await db.query('insert into departments(id,arabic_name,display_order) values($1,$2,$3)',[`dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12,'0')}`,'قسم تجريبي '+i,i]);
const departments=(await db.query('select id from departments order by display_order')).rows;
for(let i=22;i<=231;i++)await db.query('insert into employees(name,department_id,shift_id) values($1,$2,$3)',['موظف تجريبي '+String(i).padStart(3,'0'),departments[(i-22)%12].id,ids.evening]);
await db.exec("update employee_assignment_history set valid_from='2026-10-01',evidence_kind='verified' where employee_id in(select id from employees where internal_code>'FANU-000021')");
for(let i=1;i<=20;i++){
 const actor={id:`77770000-0000-4000-8000-${String(i).padStart(12,'0')}`,email:`operator${i}@candidate.invalid`};users.push(actor);
 await db.query("insert into profiles(id,name,email,role,is_active) values($1,$2,$3,'VIEWER',true)",[actor.id,'متابع اختبار '+i,actor.email]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[actor.id]);
 await db.query("insert into fu_accounts values($1,'FOLLOWUP',true,1)",[actor.id]);
 for(const department of departments)await db.query('insert into fu_departments values($1,$2)',[actor.id,department.id]);
}
await db.exec(`reset role;update public.profiles set name=case id when '${ids.admin}' then 'مدير الاختبار' when '${ids.supervisor}' then 'مشرف تجريبي' when '${ids.follow}' then 'متابع تجريبي' else 'مشاهد تجريبي' end;update public.departments set arabic_name=case id when '${ids.d1}' then 'قسم الالتقاط التجريبي' when 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then 'قسم التجهيز التجريبي' else arabic_name end;`);
await db.exec(await readFile(new URL('../supabase/proposals/staff-repairs.sql',import.meta.url),'utf8'));
await db.exec(`insert into fu_capabilities(user_id,capability,granted,granted_by,reason) values('${ids.admin}','service_manage',true,'${ids.admin}','Synthetic browser QA permission'),('${ids.admin}','identity_edit',true,'${ids.admin}','Synthetic browser QA permission');`);
const jwt=id=>{const prefix=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,session_id:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return prefix+'.'+createHmac('sha256',secret).update(prefix).digest('base64url');};
function subject(token){try{const [head,payload,signature]=token.split('.'),actual=Buffer.from(signature,'base64url'),expected=createHmac('sha256',secret).update(head+'.'+payload).digest();if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;const claims=JSON.parse(Buffer.from(payload,'base64url'));return claims.exp>Date.now()/1000&&users.some(u=>u.id===claims.sub)?claims.sub:null;}catch{return null;}}
let queue=Promise.resolve();const execute=(id,fn)=>{const current=queue.then(async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:id,role:'authenticated'})]);await db.exec('set role authenticated');return fn();});queue=current.catch(()=>{});return current;};
const server=https.createServer({cert:await readFile(certRoot+'/localhost-cert.pem'),key:await readFile(certRoot+'/localhost-key.private.pem')},async(req,res)=>{
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
  const url=new URL(req.url,'https://localhost:56490'),key=req.headers.apikey;if(!['sb_publishable_candidate_fixture','sb_secret_candidate_fixture_signing_key_2026'].includes(key))return reply(401,{});
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),token=(req.headers.authorization||'').replace(/^Bearer /,''),id=subject(token);
  if(url.pathname==='/auth/v1/token'){
   const input=JSON.parse(bytes);const actor=url.searchParams.get('grant_type')==='password'?users.find(u=>u.email===input.email&&input.password===password):users.find(u=>u.id===refreshes.get(input.refresh_token));if(!actor)return reply(400,{error_code:'invalid_credentials'});
   if(url.searchParams.get("grant_type")==="password")await execute(actor.id,async()=>{await db.exec("reset role");await db.query("insert into auth.sessions(id,user_id) values($1,$1) on conflict(id) do nothing",[actor.id]);});const refresh=randomBytes(24).toString('hex');refreshes.set(refresh,actor.id);return reply(200,{access_token:jwt(actor.id),refresh_token:refresh,expires_in:3600});
  }
  // Synthetic browser-only admin provider. Native provider acceptance runs in a separate real GoTrue cluster.
  if(url.pathname.startsWith('/auth/v1/admin/users')){
   if(key!=='sb_secret_candidate_fixture_signing_key_2026')return reply(403,{});
   if(req.method==='POST'){
    const p=JSON.parse(bytes);if(users.some(u=>u.email===p.email))return reply(409,{code:'email_exists'});
    const actor={id:randomUUID(),email:p.email};users.push(actor);
    await execute(ids.admin,async()=>{await db.exec('reset role');await db.query("insert into profiles(id,name,email,role,is_active) values($1,$2,$3,'VIEWER',true)",[actor.id,p.user_metadata.name,p.email]);});
    return p.user_metadata.name.startsWith('QA-R2-LOSS')?reply(503,{message:'Synthetic lost provider reply after creation'}):reply(200,actor);
   }
   const uid=url.pathname.split('/').at(-1);return url.searchParams.has('page')?reply(200,{users}):reply(users.some(u=>u.id===uid)?200:404,users.find(u=>u.id===uid)||{});
  }
  if(!id)return reply(401,{code:'42501',message:'انتهت الجلسة'});
  if(url.pathname==='/auth/v1/user')return reply(200,{id});
  if(url.pathname==='/auth/v1/logout'){await execute(id,()=>db.exec('reset role').then(()=>db.query('delete from auth.sessions where user_id=$1',[id])));for(const [key,user]of refreshes)if(user===id)refreshes.delete(key);return reply(200,{});}
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const fn=url.pathname.split('/').at(-1);if(!['followup_session','followup_read','followup_write'].includes(fn))return reply(404,{});const input=JSON.parse(bytes),keys=Object.keys(input);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))return reply(400,{});
   if(input.p_kind==='search')await new Promise(resolve=>setTimeout(resolve,1200));
   if(input.p_kind==='request_receipt'&&lostReceipts.delete(input.p_filters?.request_id))return reply(503,{message:'Synthetic receipt service outage'});
   const value=await execute(id,async()=>{const sql='select public.'+fn+'('+keys.map((key,i)=>key+'=> $'+(i+1)).join(',')+') value';return(await db.query(sql,keys.map(k=>input[k]))).rows[0].value;});
   if(input.p_kind==='service_state'&&String(input.p_data?.reason).startsWith('QA-R2-LOSS')){lostReceipts.add(input.p_request_id);return reply(503,{message:'Synthetic lost write response after commit'});}
   return reply(200,value);
  }
  if(url.pathname.startsWith('/storage/v1/object/')){
   if(req.method==='DELETE'){
    const bucket=url.pathname.slice('/storage/v1/object/'.length),input=JSON.parse(bytes);if(!Array.isArray(input.prefixes)||input.prefixes.length>2)return reply(400,{});
    for(const name of input.prefixes){const removed=await execute(id,()=>db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id',[bucket,name]));if(removed.rows.length)objects.delete(bucket+'/'+name);}return reply(200,{});
   }
   const authenticated=url.pathname.startsWith('/storage/v1/object/authenticated/'),rest=url.pathname.slice(authenticated?'/storage/v1/object/authenticated/'.length:'/storage/v1/object/'.length),[bucket,...parts]=rest.split('/'),name=parts.map(decodeURIComponent).join('/'),objectKey=bucket+'/'+name;
   if(req.method==='POST'){
    if(objects.has(objectKey))return reply(409,{error:'Duplicate'});
    await execute(id,()=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,name,{size:bytes.length,mimetype:req.headers['content-type']}]));objects.set(objectKey,{bytes,mime:req.headers['content-type']});return reply(200,{key:objectKey});
   }
   const rows=await execute(id,()=>db.query('select id from storage.objects where bucket_id=$1 and name=$2',[bucket,name]));const object=objects.get(objectKey);if(!rows.rows.length||!object)return reply(403,{});res.writeHead(200,{'Content-Type':object.mime,'Cache-Control':'no-store'});res.end(object.bytes);return;
  }
  reply(404,{});
 }catch(error){reply(error.code==='PT410'?410:error.code==='42501'?403:error.code==='PT409'||error.code==='23505'?409:400,{message:error.message,code:error.code});}
});
await mkdir(root+'/work/evidence',{recursive:true});await writeFile(root+'/work/evidence/candidate-fixture.json',JSON.stringify({environment:'synthetic PGlite/Auth/Storage adapter; actual Next application routes',url:'http://localhost:56494',accounts:users.map(u=>u.email)}));
await writeFile(root+'/work/evidence/candidate-gateway.pid',String(process.pid));
await new Promise(resolve=>server.listen(56490,'127.0.0.1',resolve));console.log('Synthetic SQL/auth/storage adapter https://localhost:56490 (not native Supabase)');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{server.close();await db.close();process.exit(0);});await new Promise(()=>{});
