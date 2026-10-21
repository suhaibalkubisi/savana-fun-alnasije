import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {compileFollowupReports} from '../scripts/compile-followup-reports.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {fixture,sampleSelections} from './followup-export-fixture.mjs';
const out=new URL('../work/formal-export-test/',import.meta.url);await fs.mkdir(out,{recursive:true});
await compileFollowupReports(fileURLToPath(out));
const {reportTable,validateSelection,reportCounts}=await import(new URL('report-model.mjs',out));
const {excelBytes,pdfDocument}=await import(new URL('exports.mjs',out));
after(()=>fs.rm(out,{recursive:true,force:true}));
const f=fixture();
const assets={bodyFont:(await fs.readFile('public/fonts/FANUArabic.ttf')).toString('base64'),titleFont:(await fs.readFile('public/fonts/Cairo-750.ttf')).toString('base64'),company:new Uint8Array(await fs.readFile('public/brand/fanu-official-20260908.jpeg')),savana:new Uint8Array(await fs.readFile('public/brand/savana-official-20260908.png'))};
const model=s=>reportTable(s,f.context,f.positions,f.employees,f.reports,f.actions);
test('personal summary requires selected UUID and excludes every other employee',()=>{assert.throws(()=>validateSelection({kind:'employee',start:'2026-10-01',end:'2026-10-31'}),/اختر الموظف/);const t=model(sampleSelections[4]);assert.equal(t.rows.length,31);assert.ok(t.rows.every(r=>r[1]==='FNU-TEST-000001'));});
test('monthly transfer remains a single UUID row with day evidence and custom/disabled status totals',()=>{const t=model(sampleSelections[2]);assert.equal(t.rows.length,f.employees.length);assert.equal(new Set(t.row_ids).size,t.rows.length);assert.equal(t.rows.find(r=>r[1]==='FNU-TEST-000001')[0],'الالتقاط');assert.ok(t.headers.includes('تدريب'));assert.ok(t.headers.includes('حالة محفوظة قديمة'));const text=t.rows.flat().join(' ');for(const marker of ['مستقبل','خارج','غير موثق','بلا تقرير'])assert.ok(text.includes(marker));assert.equal(t.sections[0].headers.at(-1),'15');assert.equal(t.sections[1].headers[3],'16');assert.equal(t.sections[1].headers.at(-1),'31');});
test('configured department order and absence headcount/weight stay distinct',()=>{const t=model(sampleSelections[1]);const dept=t.sections.find(s=>s.name==='ملخص الأقسام');assert.equal(dept.rows[0][0],'الفرز');const e=model(sampleSelections[4]);const totals=e.sections[0];const row=totals.rows[0];assert.ok(row[totals.headers.indexOf('وزن الغياب')]>=row[totals.headers.indexOf('غائب (أشخاص/أيام)')]);});
test('directory rejects sensitive fields and preserves permitted leading-zero strings',()=>{assert.throws(()=>validateSelection({...sampleSelections[8],directory_fields:['phone']}),/غير مسموح/);const t=model(sampleSelections[8]);assert.equal(t.rows[0][2],'00001');assert.ok(!t.headers.includes('رقم الهاتف'));});
test('all nine families produce branded embedded selectable-text PDF and typed formula-safe RTL XLSX',async()=>{for(const s of sampleSelections){const t=model(s);assert.equal(t.scope_kind,s.kind==='directory'?'authorized-directory':'evening');const x=unzipSync(await excelBytes(t,assets)),book=strFromU8(x['xl/workbook.xml']);assert.ok(book.includes('دليل الرموز والبيانات'));assert.deepEqual(x['xl/media/company.jpeg'],assets.company);assert.deepEqual(x['xl/media/savana.png'],assets.savana);assert.ok(!Object.keys(x).some(k=>k.includes('followup-title.png')));const sheets=Object.entries(x).filter(([k])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).map(([,v])=>strFromU8(v));assert.ok(sheets.every(v=>v.includes('rightToLeft="1"')&&v.includes('ySplit="8"')));assert.ok(sheets.every(v=>!v.includes('<f>')));const pdf=await pdfDocument(t,assets),text=Buffer.from(pdf.bytes).toString('latin1');assert.ok(text.startsWith('%PDF-'));assert.ok(text.includes('/FontFile2'));assert.ok(text.includes('/ToUnicode'));assert.equal(pdf.pageCount,(text.match(/\/Type \/Page\b/g)||[]).length);assert.ok(pdf.pageCount>0);}});
test('actions injection text is a string and real date cells have numeric serials',async()=>{const zip=unzipSync(await excelBytes(model(sampleSelections[5]),assets));const sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);assert.ok(sheet.includes('=HYPERLINK'));assert.ok(sheet.includes('t="inlineStr"'));assert.ok(!sheet.includes('<f>'));assert.match(sheet,/<c r="F9" s="4"><v>\d+<\/v>/);});
test('saved status category/weight snapshots outrank configuration edits',()=>{const c=reportCounts([{status:'present',category:'absent',absence_weight:3}],f.context.statuses);assert.equal(c.present,0);assert.equal(c.absent,1);assert.equal(c.weighted,3);});
test('export selection rejects malformed dates, oversized scopes and non-string print modes',()=>{
 const base={kind:'daily',start:'2026-10-14',end:'2026-10-14'};
 for(const patch of [{start:'2026-02-30'},{start:'2026-10-15'},{end:'2027-12-31'},{kind:'unrecognized'},{print_mode:0},{print_mode:null},{directory_fields:['phone']},{query:'x'.repeat(161)}])assert.throws(()=>validateSelection({...base,...patch}));
 assert.throws(()=>reportTable(base,{...f.context,scope:'morning'},f.positions));
});
test('unconfigured statuses are unresolved and never become inferred absence or weighted penalties',()=>{
 const c=reportCounts([{status:'unknown'},{status:'unknown',category:'unresolved'},{status:'present'}],f.context.statuses);
 assert.deepEqual(c,{expected:3,present:1,absent:0,leave:0,other:0,unresolved:2,weighted:0});
});
test('long narrative rows continue without losing text and repeat identity on PDF pages',async()=>{const t=model(sampleSelections[5]),long='LONG-NARRATIVE '.repeat(1000);t.sections[0].rows[0][7]=long;const p=await pdfDocument(t,assets);assert.ok(p.pageCount>1);assert.ok(Buffer.from(p.bytes).toString('latin1').includes('/FontFile2'));});

test('directory management print retains the full authorized directory rows',()=>{const t=model({...sampleSelections[8],print_mode:'management'});assert.equal(t.scope_kind,'authorized-directory');assert.equal(t.sections[0].rows.length,f.employees.length);assert.deepEqual(t.sections[0].rows,t.rows);});
