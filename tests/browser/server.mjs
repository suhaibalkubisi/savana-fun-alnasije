// Local QA only. No environment credentials, production URLs or external database connection.
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {isolatedDatabase} from '../helpers/isolated-db.mjs';
import {buildMonthlyPosition} from '../../lib/hr/monthly-position.mjs';
if(process.argv[2]!=='--synthetic-only')throw Error('Use --synthetic-only; this server never uses a production database');
await isolatedDatabase(async({db,who,hr,read,write,evidence})=>{
 await db.exec("with n as(select id,row_number() over(order by id) n from public.employees) update public.employees e set name='موظف تجريبي '||lpad(n.n::text,3,'0') from n where n.id=e.id");
 await who();
 const refs=await read('reference',{});
 for(const dep of refs.departments)await write('rule.save',{department_id:dep.id,effective_from:'2026-09-01',start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6],default_manager_id:null});
 const vite=await createServer({configFile:false,root:process.cwd(),plugins:[react()],
  // Independent from the UI test server/build: shared optimized-dependency hashes
  // caused 504 Outdated Optimize Dep during file selection in the QA browser.
  cacheDir:path.resolve('node_modules/.vite-browser-qa'),
  optimizeDeps:{include:['xlsx','jspdf','fflate']},
  resolve:{alias:[{find:'next/navigation',replacement:path.resolve('tests/browser/navigation.tsx')},{find:'next/link',replacement:path.resolve('tests/browser/link.ts')},{find:'next/image',replacement:path.resolve('tests/browser/image.ts')},{find:'@',replacement:process.cwd()}]},
  server:{middlewareMode:true,hmr:{port:24179},watch:{usePolling:true},fs:{allow:[process.cwd(),path.resolve('node_modules')]}},appType:'custom'});
 const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
 const server=createHttpServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.headers.host!=='127.0.0.1:4179'){send(res,403,{error:'Local synthetic QA only'});return;}
  if(url.pathname.startsWith('/api/')){
   try{
    if(url.pathname==='/api/auth'){
     const user=(await db.query('select * from public.hr_read_v4($1,$2) value',['session',{}])).rows[0].value;
     send(res,200,{configured:true,user});return;
    }
    if(url.pathname!=='/api/data'){send(res,404,{error:'Unsupported QA endpoint'});return;}
    if(req.method==='POST'){
     let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>8e6)throw Error('Request too large');}
     const {action,data}=JSON.parse(bytes);
     let result;
     if(action==='attendance.import.inspect') result=buildMonthlyPosition((await db.query('select public.attendance_inspect_monthly($1) value',[data])).rows[0].value);
     else if(action==='attendance.identity.resolve') result=(await db.query('select public.attendance_identity_resolve($1) value',[data])).rows[0].value;
     else if(action.startsWith('attendance.'))result=await write(action.slice(11),data);
     else result=await hr(action,data);
     send(res,200,result);return;
    }
    const filters=Object.fromEntries([...url.searchParams].filter(([k])=>k!=='kind'));const kind=url.searchParams.get('kind')||'dashboard';
    const result=kind==='attendance.monthly_position'?buildMonthlyPosition(await evidence(filters),{coverage_start:filters.coverage_start,coverage_end:filters.coverage_end}):kind.startsWith('attendance.')?(await db.query('select public.attendance_read_v4($1,$2) value',[kind.slice(11),filters])).rows[0].value:await read(kind,filters);
    send(res,200,result);return;
   }catch(error){send(res,400,{error:error.message});return;}
  }
  vite.middlewares(req,res,async()=>{
   const html=await vite.transformIndexHtml(req.url,'<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>FANU HR — بيانات اصطناعية محلية</title></head><body class="hr-product"><div id="root"></div><script type="module" src="/tests/browser/main.tsx"></script></body></html>');
   res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);
  });
 });
 await new Promise(resolve=>server.listen(4179,'127.0.0.1',resolve));
 console.log('Synthetic-only HR preview: http://127.0.0.1:4179');
 await new Promise(resolve=>{for(const signal of ['SIGINT','SIGTERM'])process.once(signal,resolve);});
 await new Promise(resolve=>server.close(resolve));await vite.close();
});
