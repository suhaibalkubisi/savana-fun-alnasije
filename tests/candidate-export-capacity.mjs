import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import ts from 'typescript';
import {unzipSync,strFromU8} from 'fflate';
import {compileFollowupReports} from '../scripts/compile-followup-reports.mjs';
if(process.argv[2]!=='--synthetic-only')throw Error('Explicit isolated fixture flag required');
const base=process.argv.find(a=>a.startsWith('--base='))?.slice(7)||'http://localhost:56496';
assert.equal(base,'http://localhost:56496','Only built isolated preview allowed');
const python=process.argv.find(a=>a.startsWith('--python='))?.slice(9);assert.ok(python,'Bundled Python required');
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.resolve(root,'../../outputs/release/export-evidence');
await fs.mkdir(out,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const modelHash=t=>sha(JSON.stringify([t.headers,t.rows,t.row_ids,t.sections.map(s=>[s.name,s.headers,s.rows]),t.sheets.filter(s=>s.name!=='دليل الرموز والبيانات').map(s=>[s.name,s.headers,s.rows])]));
const selection={kind:'monthly',start:'2026-10-01',end:'2026-10-31'};
const users=Array.from({length:20},(_,i)=>({email:'operator'+(i+1)+'@candidate.invalid',cookies:new Map()}));
async function request(user,route,body){
 const start=performance.now(),response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(user.cookies.size?{Cookie:[...user.cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...(body===undefined?{}:{'Content-Type':'application/json','x-hr-request':'1',Origin:base})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],at=first.indexOf('=');if(at>0)user.cookies.set(first.slice(0,at),first.slice(at+1));}
 const bytes=new Uint8Array(await response.arrayBuffer());let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{data=null;}
 const queue=response.headers.get('X-Export-Queue-Wait-Ms');return {status:response.status,data,bytes:bytes.length,ms:Math.round(performance.now()-start),queue_ms:queue===null?null:Number(queue),limit:response.headers.get('X-Export-Concurrency-Limit')};
}
const evidence={status:'FAIL',environment:'Actual built Vinext Worker through isolated synthetic PGlite/Auth/Storage adapter',selection,concurrent_global_requests:20,automatic_http_retries:0,server_limit:'2 active + 24 waiting per Worker isolate; 60-second queue bound',client_limit:'1 pipeline + 24 waiting per browser runtime; 120-second queue bound',durable_fleet_queue:false,production_or_hosted_test:false,previous_peak:'Same global October monthly scope as retained 14 HTTP200 / 6 HTTP503 workload',samples:[],rendering:[],run_timestamp:new Date().toISOString()};
try{
 const logged=await Promise.all(users.map(u=>request(u,'/api/auth',{email:u.email,password:'Candidate-Isolated-2026!'})));assert.ok(logged.every(r=>r.status===200));
 const population=await request(users[0],'/api/followup?kind=employee_directory');assert.equal(population.status,200);assert.ok(population.data.length>=231);evidence.fixture_directory_population=population.data.length;
 const canonical=await request(users[0],'/api/followup?'+new URLSearchParams({kind:'position',start:selection.start,end:selection.end}));assert.equal(canonical.status,200);
 const ids=new Set(canonical.data.map(r=>r.employee_id));assert.ok(ids.size>=229);
 const reference=await request(users[0],'/api/followup/export',selection);assert.equal(reference.status,200,reference.data?.error);assert.equal(reference.data.scope_kind,'evening');assert.equal(reference.data.rows.length,ids.size);assert.deepEqual(new Set(reference.data.row_ids),ids);assert.equal(reference.data.headers.filter(h=>/^\d+$/.test(h)).length,31);
 const expected=modelHash(reference.data),started=performance.now();
 const results=await Promise.all(users.map(async(u,i)=>{const r=await request(u,'/api/followup/export',selection);evidence.samples.push({user:i+1,status:r.status,bytes:r.bytes,ms:r.ms,queue_ms:r.queue_ms,limit:r.limit,error:r.status===200?undefined:r.data?.error});return r;}));
 evidence.elapsed_ms=Math.round(performance.now()-started);evidence.canonical_scope_employees=ids.size;evidence.canonical_model_sha256=expected;evidence.canonical_position_rows=canonical.data.length;
 assert.ok(results.every(r=>r.status===200),JSON.stringify(evidence.samples));
 for(const r of results){assert.equal(r.data.scope_kind,'evening');assert.deepEqual(r.data.selection,selection);assert.equal(r.data.rows.length,ids.size);assert.equal(new Set(r.data.row_ids).size,ids.size);assert.deepEqual(new Set(r.data.row_ids),ids);assert.equal(modelHash(r.data),expected);assert.equal(r.limit,'2');assert.ok(Number.isFinite(r.queue_ms));}
 const times=results.map(r=>r.ms).sort((a,b)=>a-b);Object.assign(evidence,{http_200:20,http_503:0,missing_or_duplicate_model_rows:0,p50_ms:times[10],p95_ms:times[19],maximum_queue_wait_ms:Math.max(...results.map(r=>r.queue_ms))});
 console.log(JSON.stringify({phase:'20 raw global HTTP',status:'PASS',employees:ids.size,elapsed_ms:evidence.elapsed_ms,p95_ms:evidence.p95_ms}));
 const modules=path.resolve(root,'work/release/exports/modules');await compileFollowupReports(modules);const {pdfDocument,excelBytes}=await import(pathToFileURL(path.join(modules,'exports.mjs')));
 const moduleURL=c=>'data:text/javascript;base64,'+Buffer.from(c).toString('base64');
 async function compiled(file,replacements={}){let c=ts.transpileModule(await fs.readFile(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [a,b]of Object.entries(replacements))c=c.replaceAll("'"+a+"'",JSON.stringify(b)).replaceAll('"'+a+'"',JSON.stringify(b));return moduleURL(c);}
 const scheduler=await compiled('components/followup/export-scheduler.ts'),{runExportTask}=await import(await compiled('components/followup/export-client.ts',{'./export-scheduler':scheduler}));
 const assets={bodyFont:(await fs.readFile(path.join(root,'public/fonts/FANUArabic.ttf'))).toString('base64'),titleFont:(await fs.readFile(path.join(root,'public/fonts/Cairo-750.ttf'))).toString('base64'),company:new Uint8Array(await fs.readFile(path.join(root,'public/brand/fanu-official-20260908.jpeg'))),savana:new Uint8Array(await fs.readFile(path.join(root,'public/brand/savana-official-20260908.png')))};
 let active=0,peak=0,completed=0,completionSignals=0;const renderStarted=performance.now(),codes=reference.data.rows.map(r=>String(r[1]));
 await Promise.all(results.map((r,i)=>runExportTask(async()=>{
 active++;peak=Math.max(peak,active);const kind=i%2?'xlsx':'pdf',start=performance.now(),table=r.data;
 try{const value=kind==='pdf'?await pdfDocument(table,assets):{bytes:await excelBytes(table,assets)};assert.ok(value.bytes.length>1000);
 if(kind==='xlsx'){const zip=unzipSync(value.bytes),ix=table.sheets.findIndex(s=>s.headers.filter(h=>/^\d+$/.test(h)).length===31);assert.ok(ix>=0);const matrix=strFromU8(zip['xl/worksheets/sheet'+(ix+1)+'.xml']);assert.equal((matrix.match(/<row\b/g)||[]).length,table.rows.length+10);assert.ok(matrix.includes('rightToLeft="1"'));assert.ok(!matrix.includes('<f>'));for(const code of codes)assert.ok(matrix.includes(code),'Missing XLSX code '+code);}
 const name='global-'+String(i+1).padStart(2,'0')+'.'+kind;await fs.writeFile(path.join(out,name),value.bytes);evidence.rendering.push({job:i+1,kind,status:'PASS',file:name,ms:Math.round(performance.now()-start),bytes:value.bytes.length,sha256:sha(value.bytes),pdf_pages:value.pageCount,source_model_sha256:modelHash(table),source_reference:table.reference});completed++;console.log('Rendered '+completed+'/20');
 }finally{active--;}
 },p=>{if(p.phase==='complete')completionSignals++;})));
 assert.equal(peak,1);assert.equal(completed,20);assert.equal(completionSignals,20);assert.equal(new Set(evidence.rendering.map(j=>j.job)).size,20);evidence.render_peak_active=peak;evidence.render_elapsed_ms=Math.round(performance.now()-renderStarted);
 const verification=await new Promise((resolve,reject)=>{
 const code="import json,sys\nfrom pypdf import PdfReader\nv=json.load(sys.stdin);results=[]\nfor item in v['files']:\n reader=PdfReader(item['path']);text='\\n'.join(page.extract_text() or '' for page in reader.pages);missing=[c for c in v['codes'] if c not in text]\n if missing: raise RuntimeError(item['file']+' missing codes '+repr(missing))\n results.append({'file':item['file'],'pages':len(reader.pages),'verified_permanent_codes':len(v['codes']),'missing_codes':0,'selectable_text_characters':len(text)})\nprint(json.dumps(results,ensure_ascii=True))";
 const child=spawn(python,['-c',code],{stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',status=>{if(status!==0)reject(Error('Independent PDF verification failed: '+stderr));else{try{resolve(JSON.parse(stdout));}catch(e){reject(e);}}});child.stdin.end(JSON.stringify({codes,files:evidence.rendering.filter(i=>i.kind==='pdf').map(i=>({file:i.file,path:path.join(out,i.file)}))}));
 });
 assert.equal(verification.length,10);evidence.pdf_identity_verification=verification;evidence.render_environment='Actual export modules under browser FIFO executed in Node with20 actualHTTPmodels; independentpypdfchecks; no nativeExcel or browserUI claim';evidence.status='PASS';
}catch(error){evidence.error=error.message;process.exitCode=1;console.error(error.message);}
await fs.writeFile(path.join(out,'capacity-verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,evidence:path.join(out,'capacity-verification.json')}));
