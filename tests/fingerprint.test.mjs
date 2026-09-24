import test, { after } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { utils, write } from "xlsx";
import { monthlyDeviceRows } from "./fixtures/monthly-device.mjs";
const output = new URL("./.fingerprint-check.mjs", import.meta.url);
const source=await readFile(fileURLToPath(new URL("../lib/hr/fingerprint.ts",import.meta.url)),"utf8");
await writeFile(fileURLToPath(output),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {parseFingerprint}=await import(output.href);
after(()=>rm(output,{force:true}));
function workbook(rows,bookType="biff8"){
 const wb=utils.book_new();utils.book_append_sheet(wb,utils.aoa_to_sheet(rows),"Punch Record");
 const b=write(wb,{bookType,type:"buffer"});return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
}
const header=["Person Code","Name","Department","Punch Date","Week","First Time Punch","Last Time Punch","Total(Hours)"];
test("real binary XLS daily parser preserves both calendar punches, ignores misleading duration",()=>{
 const result=parseFingerprint(workbook([header,["001","احمد علي","Packing","2026-09-06","Sun","01:31","16:27","14:56"]]),"daily","2026-09-06");
 assert.deepEqual(result.rows[0].punch_minutes,[91,987]);assert.equal(result.rows[0].person_code,"001");assert.equal(result.rows[0].source_row,2);
});
test("monthly MM-DD headers use explicit year and keep empty punch days",()=>{
 const result=parseFingerprint(workbook([["Person Code","Name","02-28","02-29"],["1","احمد","16:27\n01:31",""]]),"monthly","2024-02");
 assert.equal(result.rows[1].calendar_date,"2024-02-29");assert.deepEqual(result.rows[1].punch_minutes,[]);
 assert.throws(()=>parseFingerprint(workbook([["Person Code","Name","02-29"],["1","احمد",""]]),"monthly","2025-02"),/تاريخ/);
});
test("real monthly XLS and XLSX parse person identity and multiple punches",()=>{
 for (const bookType of ["biff8","xlsx"]) {
  const result=parseFingerprint(workbook([
   ["Person Code","Name","9/6","09-07"],
   ["F-100","موظف مسائي","16:05\n20:15 01:18","4:05 PM; 1:22 AM"],
  ],bookType),"monthly","2026-09");
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].person_code,"F-100");
  assert.deepEqual(result.rows[0].punch_minutes,[78,965,1215]);
  assert.deepEqual(result.rows[1].punch_minutes,[82,965]);
 }
});
test("monthly aliases are recognized and invalid cells remain visible",()=>{
 const result=parseFingerprint(workbook([
  ["كود الشخص","اسم الموظف","09-06"],
  ["22","موظف اختبار","16:02 BAD 01:10"],
 ]),"monthly","2026-09");
 assert.equal(result.rows[0].invalid,true);
 assert.deepEqual(result.rows[0].punch_minutes,[70,962]);
});
test("monthly selected month must match every detected day column",()=>{
 assert.throws(()=>parseFingerprint(workbook([
  ["Person Code","Name","10-01"],
  ["1","موظف","16:00"],
 ]),"monthly","2026-09"),/فترة/);
});
test("invalid punch tokens are flagged instead of silently accepted",()=>{
 const result=parseFingerprint(workbook([header,["1","علي","Packing","2026-09-06","Sun","25:01","16:35",""]],"xlsx"),"daily","2026-09-06");
 assert.equal(result.rows[0].invalid,true);assert.deepEqual(result.rows[0].punch_minutes,[995]);
});
test("wrong selected period and unsupported structure cannot import",()=>{
 const b=workbook([header,["1","علي","Packing","2026-09-06","Sun","16:01","16:01",""]]);
 assert.throws(()=>parseFingerprint(b,"daily","2026-09-07"),/فترة/);
 assert.throws(()=>parseFingerprint(b,"monthly","2026-09"),/الشهرية/);
 assert.throws(()=>parseFingerprint(workbook([["unknown"],["x"]]),"daily","2026-09-06"),/كود الشخص واسم الموظف/);
});
test("full device XLS preserves all identities, multiline evidence and blank future dates",()=>{
 const result=parseFingerprint(workbook(monthlyDeviceRows()),"monthly","2026-09");
 assert.deepEqual(result.source_counts,{source_rows:215,person_codes:215,calendar_cells:6450,populated_cells:4318,raw_punch_tokens:7416,unique_punch_minutes:7416});
 assert.equal(result.rows.filter(r=>r.punch_minutes.length>1).length,2946);
 assert.equal(result.rows.filter(r=>r.invalid).length,0);
 assert.equal(result.rows.filter(r=>r.calendar_date>="2026-09-24" && r.punch_minutes.length).length,0);
 assert.equal(result.rows.filter(r=>r.calendar_date>="2026-09-24").length,215*7);
 assert.deepEqual(result.rows[0].punch_minutes,[78,965,1215]);
 assert.equal(result.rows[0].raw_values[3],"01:18\n16:05\n20:15");
 assert.equal(result.rows[0].person_code,"SYN-0001");
 assert.equal(result.rows[0].source_name,"موظف تجريبي 1");
});
test("yearless device headers never infer year from the clock",()=>{
 const file=workbook(monthlyDeviceRows());
 assert.throws(()=>parseFingerprint(file,"monthly",""),/السنة/);
 assert.equal(parseFingerprint(file,"monthly","2030-09").rows[0].calendar_date,"2030-09-01");
 assert.throws(()=>parseFingerprint(file,"monthly","2026-10"),/فترة/);
});
test("same-minute deduplication is disclosed while raw evidence is retained",()=>{
 const result=parseFingerprint(workbook([["Person Code","Name","09-01"],["001","تجريبي","16:05\n16:05\n01:18"]]),"monthly","2026-09");
 assert.equal(result.source_counts.raw_punch_tokens,3);
 assert.equal(result.source_counts.unique_punch_minutes,2);
 assert.equal(result.rows[0].raw_values[3],"16:05\n16:05\n01:18");
});
