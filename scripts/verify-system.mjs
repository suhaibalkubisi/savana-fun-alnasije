// Default mode is unauthenticated, read-only HTTP. --local runs disposable tests.
// Never reads .env, creates production records, approves imports or applies migrations.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const args=new Set(process.argv.slice(2));
if([...args].some(a=>!['--local','--production-readonly'].includes(a)))throw Error('Usage: node scripts/verify-system.mjs [--local] [--production-readonly]');
const out=path.resolve('outputs/verification');await mkdir(out,{recursive:true});
const results=[];
const record=(name,status,evidence)=>{results.push({name,status,evidence});console.log(`${status}: ${name} — ${evidence}`);};
async function command(name,file,args){
 const log=path.join(out,name+'.log');let text='';const started=Date.now();
 const outcome=await new Promise(resolve=>{
  const child=spawn(file,args,{cwd:process.cwd(),env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_PATH:'.wrangler/wrangler.log'},shell:false,windowsHide:true});
  const timer=setTimeout(()=>child.kill(),600000);
  child.stdout.on('data',c=>text+=c);child.stderr.on('data',c=>text+=c);
  child.once('error',()=>{clearTimeout(timer);resolve(null);});child.once('close',code=>{clearTimeout(timer);resolve(code);});
 });
 await writeFile(log,text);record(name,outcome===0?'PASS':outcome===null?'BLOCKED':'FAIL',`${path.relative(process.cwd(),log)}; ${Math.round((Date.now()-started)/1000)}s`);
}
if(args.has('--local')){
 await command('typecheck',process.execPath,['node_modules/typescript/bin/tsc','--noEmit']);
 await command('lint',process.execPath,['node_modules/eslint/bin/eslint.js','.','--ignore-pattern','dist','--ignore-pattern','.next']);
 await command('build',process.execPath,['node_modules/vinext/dist/cli.js','build']);
 const tests=(await readdir('tests')).filter(n=>n.endsWith('.test.mjs')).map(n=>'tests/'+n);
 await command('isolated-tests',process.execPath,['--test','--test-concurrency=2',...tests]);
}else record('local checks','NOT VERIFIED','Run with --local. Database tests use disposable in-memory PGlite only.');
if(!args.size||args.has('--production-readonly')){
 const origin='https://fanu-alnasij-hr.tiny-bull-0242.chatgpt.site';
 for(const [name,route,expected] of [['public shell','/',200],['authentication boundary','/api/data?kind=dashboard',401]]){
  try{const r=await fetch(origin+route,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(30000)});await r.body?.cancel();record(name,r.status===expected?'PASS':'FAIL',`GET ${route}: HTTP ${r.status}; expected ${expected}`);}
  catch(e){record(name,'BLOCKED',`Network unavailable (${e.name}); no mutation attempted`);}
 }
 record('authenticated production workflow','NOT VERIFIED','Requires the authorized signed-in browser; this script never obtains or prints its cookies.');
 record('production database preservation','NOT VERIFIED','Reconcile a fresh connector checkpoint before and after any authorized deployment.');
}
record('downloaded export visual QA','NOT VERIFIED','Inspect actual browser downloads and record separate evidence; file generation alone does not pass this gate.');
await writeFile(path.join(out,'report.json'),JSON.stringify({at:new Date().toISOString(),productionWrites:false,results},null,2));
process.exitCode=results.some(r=>r.status==='FAIL'||r.status==='BLOCKED')?1:0;
