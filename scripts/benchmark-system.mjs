// Synthetic-only measurement. Never reads environment secrets or production data.
import {build} from 'esbuild';
import {utils,write} from 'xlsx';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {buildMonthlyPosition,scopeMonthlyPosition,monthlyMatrixRows} from '../lib/hr/monthly-position.mjs';
import {isolatedDatabase} from '../tests/helpers/isolated-db.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out='outputs/benchmark';await mkdir(out,{recursive:true});
await writeFile(`${out}/baseline.ts`,execFileSync('git',['show','0681008bd65129542a43cce3c531dedbba967a21:lib/hr/fingerprint.ts']));
for(const [entry,name] of [[`${out}/baseline.ts`,'baseline'],['lib/hr/fingerprint.ts','current'],['lib/hr/exports.ts','exports']])await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',packages:'external',outfile:`${out}/${name}.mjs`});
const baseline=await import(`../${out}/baseline.mjs`),current=await import(`../${out}/current.mjs`),exports=await import(`../${out}/exports.mjs`);
const results=[];
async function measure(name,fn,runs=1){let value;const ms=[];for(let i=0;i<runs;i++){const start=performance.now();value=await fn();ms.push(+(performance.now()-start).toFixed(1));}results.push({name,ms});return value;}
const workbook=utils.book_new();utils.book_append_sheet(workbook,utils.aoa_to_sheet([
 ['Person Code','Name',...Array.from({length:30},(_,i)=>`09-${String(i+1).padStart(2,'0')}`)],
 ...Array.from({length:250},(_,i)=>[`BENCH-${i}`,`موظف قياس اصطناعي ${i}`,...Array(30).fill('16:00\n23:00')])
]),'Punch Record');const bytes=write(workbook,{bookType:'biff8',type:'buffer'});
const input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
await measure('parse deployed-version parser, same fixture',()=>baseline.parseFingerprint(input,'monthly','2026-09'),3);
const parsed=await measure('parse current parser, same fixture',()=>current.parseFingerprint(input,'monthly','2026-09'),3);
assert.equal(parsed.rows.length,7500);
await isolatedDatabase(async({db,who,hr,read,write:attendance,evidence})=>{
 await who();const department=(await read('reference')).departments[0].id;
 await attendance('rule.save',{department_id:department,effective_from:'2026-09-01',start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6],default_manager_id:null});
 for(let i=0;i<250;i++){
  const e=await hr('employee.save',{name:`موظف قياس اصطناعي ${i}`,employee_number:`BENCH-${i}`,department_id:department,shift_id:null,direct_manager_id:null,employment_status:'active'});
  await db.query('select public.employee_assignment_record($1)',[{employee_id:e.id,employee_version:e.version,department_id:department,employment_status:'active',valid_from:'2026-09-01',valid_to:'2026-09-30',reason:'Synthetic performance measurement only'}]);
 }
 const batch=await measure('database identity match and preview creation, 7500 rows',()=>attendance('import.preview',{source_name:'synthetic-benchmark.xls',source_hash:createHash('sha256').update(bytes).digest('hex'),import_kind:'monthly',period_start:'2026-09-01',period_end:'2026-09-30',coverage_start:'2026-09-01',coverage_end:'2026-09-30',rows:parsed.rows}));
 const raw=await measure('database monthly evidence, 250 identities',()=>evidence({month:'2026-09',import_id:batch.id,source:'preview'}));
 const model=await measure('canonical monthly report, 7500 employee-days',()=>buildMonthlyPosition(raw),3);
 assert.equal(model.rows.length,250);
 const filtered=await measure('employee filter, 250 identities',()=>scopeMonthlyPosition(model,{search:'BENCH-100'}),3);assert.equal(filtered.rows.length,1);
 const rows=monthlyMatrixRows(model);assert.equal(rows.length,500);
 const headers=['الكود الوظيفي','الموظف','القسم','الحركة',...Array.from({length:30},(_,i)=>String(i+1)),'مكتمل','ناقص','بلا بصمات','مراجعة','دقائق موثقة'];
 const excel=await measure('Excel generation, 500 rows',()=>exports.tableExcelBytes({title:'قياس اصطناعي',period:'سبتمبر 2026',headers,rows}));
 const font=(await readFile('public/fonts/DejaVuSans.ttf')).toString('base64');
 const pdf=await measure('Arabic PDF generation, 500 rows / 7-day segments',()=>exports.tablePdfBytes({title:'قياس اصطناعي',period:'سبتمبر 2026',headers,rows,fontBase64:font,segments:Array.from({length:5},(_,i)=>({headers:[...headers.slice(0,4),...headers.slice(4+i*7,4+Math.min(30,(i+1)*7)),...headers.slice(-5)],rows:rows.map(r=>[...r.slice(0,4),...r.slice(4+i*7,4+Math.min(30,(i+1)*7)),...r.slice(-5)])}))}));
 results.push({name:'output bytes',excel:excel.length,pdf:pdf.length,source:bytes.length});
});
await writeFile(`${out}/results.json`,JSON.stringify({at:new Date().toISOString(),fixture:'250 synthetic employees, 30 days, 15000 punches',productionWrites:false,limitations:'Local PGlite and Node timings, not production network latency. Only parsing has a comparable deployed-version baseline; do not infer speed improvement for other operations.',results},null,2));console.log(JSON.stringify(results));
