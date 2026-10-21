// Local acceptance artifacts only. No network; inputs/output remain ignored.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {formatClock12} from '../lib/hr/time-format.mjs';
import {buildMonthlyPosition,monthlyMatrixRows} from '../lib/hr/monthly-position.mjs';
const dir=resolve('outputs/radical');await mkdir(dir,{recursive:true});
await build({absWorkingDir:process.cwd(),entryPoints:[resolve('lib/hr/exports.ts')],bundle:true,platform:'node',format:'esm',packages:'external',outfile:dir+'/export-runtime.mjs'});
globalThis.fetch=async url=>{
 const relative=String(url);if(!/^\/(brand|fonts)\/[\w./-]+$/.test(relative))throw Error('Only local report assets allowed');
 return new Response(await readFile(resolve('public'+relative)));
};
const {brandedExcelBytes,tablePdfBytes}=await import(pathToFileURL(dir+'/export-runtime.mjs'));
const timings=[];
async function save(name,scope){
 const start=performance.now();const xlsx=await brandedExcelBytes(scope);const excelMs=performance.now()-start;
 const startPdf=performance.now();const pdf=await tablePdfBytes(scope);const pdfMs=performance.now()-startPdf;
 await writeFile(dir+'/'+name+'.xlsx',xlsx);await writeFile(dir+'/'+name+'.pdf',pdf);
 timings.push({name,rows:scope.rows.length,excel_ms:excelMs,pdf_ms:pdfMs,excel_bytes:xlsx.length,pdf_bytes:pdf.length});
}
for(const kind of ['daily','monthly']){
 const parsed=JSON.parse(await readFile(dir+'/'+kind+'-parsed.private.json','utf8'));
 const scope={title:kind==='daily'?'أدلة البصمة اليومية التقويمية':'أدلة البصمة الشهرية التقويمية',period:'سبتمبر 2026 · مصدر غير محسوب · اتجاه البصمة غير محدد',headers:['رقم الجهاز','اسم المصدر','التاريخ التقويمي','الأوقات المسجلة','موضع المصدر'],rows:parsed.rows.map(r=>[r.person_code,r.source_name,r.calendar_date,r.punch_minutes.map(formatClock12).join(' / ')||'لا بصمات',`${r.source_sheet}:${r.source_row}`])};
 await save(kind+'-source.private',scope);
}
const parsed=JSON.parse(await readFile(dir+'/monthly-parsed.private.json','utf8'));
const codes=[...new Set(parsed.rows.map(r=>r.person_code))];
const employees=codes.map((code,i)=>({id:code,name:`موظف اختبار ${i+1}`,internal_code:`TEST-${String(i+1).padStart(6,'0')}`}));
const position=buildMonthlyPosition({month:'2026-09',as_of:'2026-09-30',available:true,batch:{coverage_start:'2026-09-01',coverage_end:'2026-09-30',lifecycle_state:'preview'},employees,
 sources:parsed.rows.map((r,i)=>({...r,id:'test-'+i,employee_id:r.person_code})),
 assignments:employees.map(e=>({employee_id:e.id,department_id:'test',department:'قسم الاختبار',valid_from:'2026-09-01',valid_to:'2026-10-01',employment_status:'active'})),
 rules:[{department_id:'test',effective_from:'2026-09-01',entry_window_start:720,entry_window_end:1439,start_minute:960,grace_minutes:15,working_weekdays:[0,1,2,3,4,5,6]}]});
const headers=(from,to)=>['الكود الوظيفي','الموظف','القسم','الحركة',...Array.from({length:to-from+1},(_,i)=>String(from+i)),'مكتمل','ناقص','بلا بصمات','مراجعة','دقائق بين البصمات'];
await save('monthly-test-window.private',{title:'اختبار تصدير البصمة الشهرية',period:'سبتمبر 2026 · معاينة اختبار فقط · نافذة اختبار من الظهر إلى الظهر التالي · ليست حضوراً رسمياً',headers:headers(1,30),rows:monthlyMatrixRows(position),segments:Array.from({length:5},(_,i)=>({headers:headers(i*7+1,Math.min(30,i*7+7)),rows:monthlyMatrixRows(position,i*7+1,Math.min(30,i*7+7)),columnWeights:[14,18,13,7,...Array(Math.min(7,30-i*7)).fill(10),7,7,10,7,9]}))});
await writeFile(dir+'/export-acceptance.json',JSON.stringify(timings,null,2));console.log(JSON.stringify(timings));
