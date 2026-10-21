import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {fixture,sampleSelections} from './followup-export-fixture.mjs';
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
async function compile(file,replacements={}){let code=ts.transpileModule(await readFile(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [from,to]of Object.entries(replacements))code=code.replaceAll("'"+from+"'",JSON.stringify(to)).replaceAll('"'+from+'"',JSON.stringify(to));return url(code);}
const schedulerURL=await compile('components/followup/export-scheduler.ts');
const {ExportScheduler,ExportCapacityError}=await import(schedulerURL);
const clientURL=await compile('components/followup/export-client.ts',{'./export-scheduler':schedulerURL});
const {runExportTask,readExportModel,prepareExport}=await import(clientURL);
const domainURL=await compile('components/followup/domain.ts');
const {reportTable}=await import(await compile('components/followup/report-model.ts',{'./domain':domainURL}));
const modelURL=await compile('components/followup/report-model.ts',{'./domain':domainURL});
const transportURL=url(`export class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}export const body=request=>request.json();export const protectMutation=()=>{};export const session=()=>globalThis.exportRouteHarness.session();export const rpc=(...args)=>globalThis.exportRouteHarness.rpc(...args);export const json=value=>Response.json(value);export const errorResponse=error=>Response.json({error:error.message},{status:error.status||500});`);
const transport=await import(transportURL);
const {POST}=await import(await compile('app/api/followup/export/route.ts',{'@/lib/server/supabase':transportURL,'@/components/followup/report-model':modelURL,'@/components/followup/export-scheduler':schedulerURL}));
const f=fixture(),selection=sampleSelections[2],model=()=>reportTable(selection,f.context,f.positions,f.employees,f.reports,f.actions);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test('20 attached global models stay FIFO with at most two active and no lost or duplicated identities',async()=>{
 const scheduler=new ExportScheduler(2,24,1000),starts=[],completed=[];let active=0,peak=0;
 const results=await Promise.all(Array.from({length:20},(_,i)=>scheduler.run(async()=>{starts.push(i);active++;peak=Math.max(peak,active);await tick();const table=model();active--;completed.push(i);return table;})));
 assert.equal(peak,2);assert.deepEqual(starts,Array.from({length:20},(_,i)=>i));assert.equal(new Set(completed).size,20);
 for(const table of results){assert.equal(table.rows.length,f.employees.length);assert.equal(new Set(table.row_ids).size,f.employees.length);assert.deepEqual(table.rows,results[0].rows);assert.equal(table.headers.filter(h=>/^\d+$/.test(h)).length,31);}
 assert.deepEqual(scheduler.snapshot,{active:0,queued:0});
});
test('finite overflow and queued timeout do not start excess jobs or leak permits',async()=>{
 const scheduler=new ExportScheduler(1,1,15),release=await scheduler.acquire();
 const queued=scheduler.acquire();await assert.rejects(scheduler.acquire(),ExportCapacityError);
 await assert.rejects(queued,ExportCapacityError);assert.deepEqual(scheduler.snapshot,{active:1,queued:0});
 release();release();assert.deepEqual(scheduler.snapshot,{active:0,queued:0});
});
test('cancelled queued request is removed without execution; active abort keeps permit until real work settles',async()=>{
 const scheduler=new ExportScheduler(1,2,1000),hold=deferred(),activeAbort=new AbortController();let started=0;
 const active=scheduler.run(async()=>{started++;await hold.promise;},activeAbort.signal);await tick();
 const cancel=new AbortController(),queued=scheduler.run(()=>{started++;},cancel.signal);cancel.abort();await assert.rejects(queued,e=>e.name==='AbortError');
 const next=scheduler.run(()=>{started++;});activeAbort.abort();await tick();
 assert.equal(started,1);assert.deepEqual(scheduler.snapshot,{active:1,queued:1});
 hold.resolve();await Promise.all([active,next]);assert.equal(started,2);assert.deepEqual(scheduler.snapshot,{active:0,queued:0});
});
test('rejected active work frees exactly one permit and the next request still runs',async()=>{
 const scheduler=new ExportScheduler(1,2,1000),failure=scheduler.run(()=>{throw Error('synthetic failure');}),next=scheduler.run(()=>42);
 await assert.rejects(failure,/synthetic/);assert.equal(await next,42);assert.deepEqual(scheduler.snapshot,{active:0,queued:0});
});
test('actual export route holds both permits when bootstrap fails while dataset RPC is still running',async()=>{
 const hold=deferred();let sessions=0;
 globalThis.exportRouteHarness={session:async()=>{sessions++;return {token:'synthetic-token'};},rpc:async(_fn,args)=>{if(args.p_kind==='bootstrap')throw new transport.AppError('synthetic unavailable',503);return hold.promise;}};
 const request=()=>new Request('https://synthetic.invalid/api/followup/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection)});
 const calls=[POST(request()),POST(request()),POST(request())];await tick();await tick();assert.equal(sessions,2,'third request cannot start while failed request has an active sibling RPC');
 hold.resolve({positions:f.positions,reports:f.reports,actions:f.actions});
 try{const responses=await Promise.all(calls);assert.equal(sessions,3);assert.ok(responses.every(response=>response.status===503&&response.headers.get('Retry-After')==='2'));}finally{delete globalThis.exportRouteHarness;}
});
test('browser serializes preparation and rendering together and completes each full model once',async()=>{
 const original=globalThis.fetch;let calls=0,active=0,peak=0;const traces=[];
 globalThis.fetch=async()=>{calls++;return Response.json(model());};
 try{const values=await Promise.all(Array.from({length:20},(_,i)=>runExportTask(async()=>{active++;peak=Math.max(peak,active);const table=await readExportModel(selection,p=>traces.push([i,p.phase]));await tick();active--;return table;},p=>traces.push([i,p.phase]))));
 assert.equal(calls,20);assert.equal(peak,1);assert.ok(values.every(value=>value.rows.length===f.employees.length));assert.equal(traces.filter(([,phase])=>phase==='complete').length,20);
 }finally{globalThis.fetch=original;}
});
test('only explicit busy/unavailable responses retry and attempts are capped at three',async()=>{
 const original=globalThis.fetch;let calls=0;const phases=[];
 globalThis.fetch=async()=>{calls++;return calls<3?Response.json({error:'busy'},{status:calls===1?429:503,headers:{'Retry-After':'1'}}):Response.json(model());};
 try{const table=await prepareExport(selection,p=>phases.push(p));assert.equal(calls,3);assert.equal(table.rows.length,f.employees.length);assert.deepEqual(phases.filter(p=>p.phase==='retrying').map(p=>p.attempt),[2,3]);assert.equal(phases.at(-1).phase,'complete');
 calls=0;phases.length=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'unavailable'},{status:503,headers:{'Retry-After':'1'}});};
 await assert.rejects(prepareExport(selection,p=>phases.push(p)),/unavailable/);assert.equal(calls,3);assert.equal(phases.at(-1).phase,'failed');assert.ok(!phases.some(p=>p.phase==='complete'));
 }finally{globalThis.fetch=original;}
});
test('permission denial, partial JSON, and ambiguous transport failure never retry or report success',async()=>{
 const original=globalThis.fetch;
 try{for(const respond of [()=>Response.json({error:'denied'},{status:403}),()=>Response.json({scope_kind:'evening',rows:[]}),()=>{throw Error('transport failure');}]){let calls=0;const phases=[];globalThis.fetch=async()=>{calls++;return respond();};await assert.rejects(prepareExport(selection,p=>phases.push(p)));assert.equal(calls,1);assert.equal(phases.at(-1).phase,'failed');assert.ok(!phases.some(p=>p.phase==='complete'));}}
 finally{globalThis.fetch=original;}
});

test('directory route exports every authorized staff row without leaking a private search value',async()=>{
 const staff=f.employees.map((e,i)=>({...e,shift_id:i%2?'morning':null,employment_status:i%3?'inactive':'active',evening_verified:false,phone:'07001231234'})),kinds=[];
 globalThis.exportRouteHarness={session:async()=>({token:'directory-token'}),rpc:async(_fn,a,token)=>{assert.equal(token,'directory-token');kinds.push(a.p_kind);if(a.p_kind==='bootstrap')return f.context;if(a.p_kind==='employee_directory'){assert.equal(a.p_filters.query,'0700');return staff;}throw Error('Unexpected operational roster request');}};
 try{const r=await POST(new Request('https://synthetic.invalid/api/followup/export',{method:'POST',body:JSON.stringify({...sampleSelections[8],query:'0700'})}));assert.equal(r.status,200);const t=await r.json();assert.deepEqual(kinds.sort(),['bootstrap','employee_directory']);assert.equal(t.rows.length,staff.length);assert.deepEqual(new Set(t.row_ids),new Set(staff.map(e=>e.id)));assert.equal(t.scope_kind,'authorized-directory');assert.ok(t.scope.includes('لا يثبت انتماءً مسائياً'));assert.ok(!t.scope.includes('0700'));assert.ok(t.source_status.includes('ليس تصريح حضور'));assert.ok(!JSON.stringify(t).includes('07001231234'));}
 finally{delete globalThis.exportRouteHarness;}
});
test('actual route admits two active plus24 waiting and explicitly rejects overflow',async()=>{
 const hold=deferred();let sessions=0;
 globalThis.exportRouteHarness={session:async()=>{sessions++;return {token:'overflow-token'};},rpc:async(_fn,a)=>a.p_kind==='bootstrap'?f.context:hold.promise};
 const calls=Array.from({length:27},()=>POST(new Request('https://synthetic.invalid/api/followup/export',{method:'POST',body:JSON.stringify(selection)})));
 await tick();await tick();const started=sessions;hold.resolve({positions:f.positions,reports:f.reports,actions:f.actions});
 try{const rs=await Promise.all(calls);assert.equal(started,2);assert.equal(rs.filter(r=>r.status===200).length,26);const busy=rs.find(r=>r.status===429);assert.ok(busy);assert.equal(busy.headers.get('Retry-After'),'2');const b=await busy.json();assert.equal(b.code,'EXPORT_BUSY');assert.equal(b.rows,undefined);for(const r of rs.filter(r=>r.status===200))assert.equal((await r.json()).rows.length,f.employees.length);}
 finally{delete globalThis.exportRouteHarness;}
});
test('browser accepts directory scope only for directory requests',async()=>{
 const original=globalThis.fetch,dir=sampleSelections[8],table=reportTable(dir,{...f.context,scope:'authorized-directory'},[],f.employees,[],[]);
 try{globalThis.fetch=async()=>Response.json(table);assert.equal((await readExportModel(dir,()=>{})).scope_kind,'authorized-directory');await assert.rejects(readExportModel(selection,()=>{}));globalThis.fetch=async()=>Response.json({...table,scope_kind:'evening'});await assert.rejects(readExportModel(dir,()=>{}));}
 finally{globalThis.fetch=original;}
});
