import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { utils, write } from "xlsx";
const output = new URL("./.fingerprint-check.mjs", import.meta.url);
await build({ entryPoints:["lib/hr/fingerprint.ts"],bundle:true,platform:"node",format:"esm",packages:"external",outfile:output.pathname });
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
test("invalid punch tokens are flagged instead of silently accepted",()=>{
 const result=parseFingerprint(workbook([header,["1","علي","Packing","2026-09-06","Sun","25:01","16:35",""]],"xlsx"),"daily","2026-09-06");
 assert.equal(result.rows[0].invalid,true);assert.deepEqual(result.rows[0].punch_minutes,[995]);
});
test("wrong selected period and unsupported structure cannot import",()=>{
 const b=workbook([header,["1","علي","Packing","2026-09-06","Sun","16:01","16:01",""]]);
 assert.throws(()=>parseFingerprint(b,"daily","2026-09-07"),/فترة/);
 assert.throws(()=>parseFingerprint(b,"monthly","2026-09"),/الشهرية/);
 assert.throws(()=>parseFingerprint(workbook([["unknown"],["x"]]),"daily","2026-09-06"),/صفوف/);
});
