// Full application route handlers over disposable PGlite and a bounded local auth adapter.
// This is NOT native Supabase/GoTrue acceptance. No production URL or key is loaded.
import {createServer as httpServer} from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {writeFile,mkdir,readFile,readdir} from 'node:fs/promises';import path from 'node:path';
import {build} from 'esbuild';
import {utils,write as xlsWrite} from 'xlsx';
import {isolatedDatabase} from '../helpers/isolated-db.mjs';
if(process.argv[2]!=='--synthetic-only')throw Error('Use --synthetic-only; production is forbidden');
const port=4188,origin='http://127.0.0.1:'+port,out='outputs/acceptance/browser';
await mkdir(out,{recursive:true});globalThis.__hrQaContext=new AsyncLocalStorage();
const secret=randomBytes(32),users=[['11111111-1111-4111-8111-111111111111','admin@qa.invalid','ADMIN'],['22222222-2222-4222-8222-222222222222','hr@qa.invalid','HR'],['33333333-3333-4333-8333-333333333333','viewer@qa.invalid','VIEWER']];
const password='Local-QA-2026!',revoked=new Set(),refreshes=new Map();
function jwt(id){const payload=Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,iss:'isolated-local-qa'})).toString('base64url');const data=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+payload;return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');}
function subject(token){try{if(revoked.has(token))return null;const [h,p,s]=token.split('.'),expected=createHmac('sha256',secret).update(h+'.'+p).digest(),actual=Buffer.from(s,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;const claims=JSON.parse(Buffer.from(p,'base64url'));return claims.exp>Date.now()/1000&&users.some(u=>u[0]===claims.sub)?claims.sub:null;}catch{return null;}}
const allowed=new Set(['hr_read','hr_read_v4','hr_write_v2','hr_import','attendance_sources','attendance_period_gaps','employee_assignment_bulk','employee_assignment_record','employee_assignments','hr_comprehensive_evidence','attendance_daily_evidence','attendance_monthly_evidence_v2','attendance_inspect_monthly_v2','attendance_read_v5','attendance_write_v5','attendance_identity_proposal','attendance_identity_registry','attendance_identity_resolve','attendance_day_save']);
const runtimePlugin={name:'isolated-framework-adapters',setup(b){
 b.onResolve({filter:/^(server-only|next\/headers|cloudflare:workers)$/},a=>({path:a.path,namespace:'qa'}));
 b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:a.path==='server-only'?'':a.path==='next/headers'?`export async function cookies(){return globalThis.__hrQaContext.getStore().jar}`:`export const env={NEXT_PUBLIC_SUPABASE_URL:'https://qa-supabase.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_local_fixture',SUPABASE_SECRET_KEY:'sb_secret_local_fixture_signing_key_2026'}`,loader:'js'}));
}};
const routes={};
for(const kind of ['data','auth','import','users']){const file=path.resolve(out+'/'+kind+'.mjs');await build({entryPoints:['app/api/'+kind+'/route.ts'],bundle:true,platform:'node',format:'esm',packages:'external',plugins:[runtimePlugin],outfile:file});routes[kind]=await import('file:///'+file.replaceAll('\\','/'));}
await isolatedDatabase(async({db,who,hr,read,write})=>{
 await db.exec('reset role');
 await db.exec("with n as(select id,row_number() over(order by id) n from public.employees) update public.employees e set name='موظف تجريبي '||lpad(n.n::text,3,'0') from n where n.id=e.id");
 for(const [id,email,role]of users){await db.query("insert into auth.users values($1,$2,'{}') on conflict(id) do nothing",[id,email]);await db.query("update public.profiles set name=$1,role=$2,is_active=true where id=$3",['مستخدم اختبار '+role,role,id]);}
 await who();const refs=await read('reference');let selected=(await read('employees')).rows.slice(0,7);
 selected[0]={...selected[0],...await hr('employee.save',{...selected[0],name:'عبدالله حسين عبدالهادي'})};
 for(const e of selected)await db.query('select public.employee_assignment_record($1)',[{employee_id:e.id,employee_version:e.version,department_id:e.department_id,employment_status:'active',valid_from:'2026-09-01',valid_to:'2026-09-30',reason:'Synthetic September organization evidence'}]);
 for(const dep of refs.departments)await write('rule.save',{department_id:dep.id,effective_from:'2026-09-01',start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6],default_manager_id:null});
 for(let n=0;n<195;n++){const e=selected[Math.floor(n/30)];await hr('status.save',{employee_id:e.id,department_id:e.department_id,record_date:'2026-09-'+String(n%30+1).padStart(2,'0'),status_type:n<147?'absence':n<185?'absence3':'leave',late_minutes:null,notes:'اختبار محلي'});}
 await write('source.save',{namespace:'qa-gate',label:'جهاز اختبار معزول',confirmation_reason:'Independent synthetic QA device register'});
 const book=utils.book_new();utils.book_append_sheet(book,utils.aoa_to_sheet([['Person Code','Name','09-10','09-11','09-12'],['QA-1',selected[0].name,'16:00\n20:00','01:30\n16:20','01:40'],['QA-2',selected[1].name,'16:00','','']]),'Punch Record');await writeFile(out+'/synthetic-monthly.xls',xlsWrite(book,{bookType:'biff8',type:'buffer'}));
 let chain=Promise.resolve();const nativeFetch=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url);
  if(url.hostname!=='qa-supabase.invalid')throw Error('QA API cannot access external network');
  const headers=new Headers(options.headers),token=(headers.get('authorization')||'').replace(/^Bearer /,'');
  if(url.pathname==='/auth/v1/token'){
   const body=JSON.parse(options.body||'{}');const u=url.searchParams.get('grant_type')==='password'?users.find(u=>u[1]===body.email&&body.password===password):users.find(u=>u[0]===refreshes.get(body.refresh_token));
   if(!u)return Response.json({message:'Invalid local credentials'},{status:400});
   const refresh=randomBytes(20).toString('hex');refreshes.set(refresh,u[0]);return Response.json({access_token:jwt(u[0]),refresh_token:refresh,expires_in:3600});
  }
  if(url.pathname==='/auth/v1/user')return subject(token)?Response.json({id:subject(token)}):Response.json({},{status:401});
  if(url.pathname==='/auth/v1/logout'){revoked.add(token);return Response.json({});}
  const name=url.pathname.split('/').at(-1);const id=subject(token);
  if(!id)return Response.json({message:'Unauthenticated',code:'42501'},{status:401});
  if(!allowed.has(name))return Response.json({message:'Unknown RPC'},{status:404});
  const data=JSON.parse(options.body||'{}'),keys=Object.keys(data);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))return Response.json({},{status:400});
  const run=chain.then(async()=>{try{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');const q='select public.'+name+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') value';return Response.json((await db.query(q,keys.map(k=>data[k]))).rows[0].value);}catch(e){return Response.json({message:e.message,code:e.code},{status:e.code==='42501'?403:400});}});
  chain=run.then(()=>{},()=>{});return run;
 };
 const clientPlugin={name:'local-client-adapters',setup(b){b.onResolve({filter:/^next\/(navigation|link|image)$/},a=>({path:path.resolve('tests/browser/'+(a.path.endsWith('navigation')?'navigation.tsx':a.path.endsWith('link')?'link.ts':'image.ts'))}));b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'css'}));}};
 await build({entryPoints:['tests/browser/main.tsx'],bundle:true,platform:'browser',format:'esm',jsx:'automatic',plugins:[clientPlugin],outfile:out+'/client.js',define:{'process.env.NODE_ENV':'"production"'}});
 const styleFile=(await readdir('dist/client/assets')).find(n=>n.endsWith('.css'));const styles=await readFile('dist/client/assets/'+styleFile);
 const server=httpServer(async(req,res)=>{
  const url=new URL(req.url,origin);if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end();return;}
  if(url.pathname==='/qa-client.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await readFile(out+'/client.js'));return;}
  if(url.pathname==='/qa-style.css'){res.writeHead(200,{'content-type':'text/css'});res.end(styles);return;}
  if(/^\/(fonts|brand)\/[\w.\/-]+$/.test(url.pathname)){try{res.writeHead(200);res.end(await readFile('public'+url.pathname));}catch{res.writeHead(404);res.end();}return;}
  if(url.pathname==='/api/qa-export'&&req.method==='POST'){let bytes=[];for await(const part of req)bytes.push(part);const name=(url.searchParams.get('name')||'export.bin').replace(/[^\w.\-]/g,'_');await writeFile(out+'/'+name,Buffer.concat(bytes));res.writeHead(200);res.end('{}');return;}
  if(url.pathname.startsWith('/api/')){
   const kind=url.pathname.slice(5),handler=routes[kind]?.[req.method];if(!handler){res.writeHead(404);res.end('{}');return;}
   const values=new Map((req.headers.cookie||'').split(';').map(s=>s.trim().split('='))),setCookies=[];
   const jar={get:k=>values.has(k)?{value:decodeURIComponent(values.get(k))}:undefined,set:(k,v,o)=>{values.set(k,v);setCookies.push(k+'='+encodeURIComponent(v)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+o.maxAge);},delete:k=>{values.delete(k);setCookies.push(k+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');}};
   const chunks=[];for await(const p of req)chunks.push(p);const init={method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})};
   const response=await globalThis.__hrQaContext.run({jar},()=>handler(new Request(url,init)));
   res.writeHead(response.status,{...Object.fromEntries(response.headers),...(setCookies.length?{'set-cookie':setCookies}:{})});res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa-style.css"><title>FANU - قبول محلي</title></head><body class="hr-product"><div style="background:#fff2d7;padding:12px;text-align:center">قبول محلي - بيانات موظفين اصطناعية - مصادقة اختبار معزولة؛ لا يتصل بالإنتاج</div><div id="root"></div><script type="module" src="/qa-client.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));console.log('Actual API route QA: '+origin+' - native Supabase authentication is NOT tested');
 await new Promise(r=>{for(const signal of ['SIGINT','SIGTERM'])process.once(signal,r)});
 await new Promise(r=>server.close(r));globalThis.fetch=nativeFetch;
});

