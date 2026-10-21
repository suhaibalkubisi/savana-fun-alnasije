// Run after inspect-punch-sources.py. Real source data stays in ignored outputs.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
const code=ts.transpileModule(await readFile('lib/hr/fingerprint.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
await writeFile('outputs/radical/parser.mjs',code);
const {parseFingerprint}=await import('../outputs/radical/parser.mjs');
const oracle=JSON.parse(await readFile('outputs/radical/source-inspection.private.json','utf8'));
const results=[];
for(const [i,path] of process.argv.slice(2).entries()){
 const source=oracle[i],sheet=source.sheets[0],bytes=await readFile(path);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);
 const start=performance.now();
 const result=parseFingerprint(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),sheet.kind,sheet.kind==='daily'?sheet.date_start:sheet.date_start.slice(0,7));
 const milliseconds=performance.now()-start;
 assert.equal(result.rows.length,source.cells.length);
 for(let n=0;n<result.rows.length;n++){
  const actual=result.rows[n],expected=source.cells[n];
  assert.deepEqual([actual.person_code,actual.source_name,actual.calendar_date,actual.punch_minutes,actual.raw_values],[expected.code.trim(),expected.name.trim(),expected.date,expected.minutes,expected.raw_values],`Every raw cell preserved: ${source.file} row ${n}`);
 }
 for(const key of ['calendar_cells','populated_cells','raw_punch_tokens','unique_punch_minutes'])assert.equal(result.source_counts[key],sheet.counts[key],key);
 await writeFile(`outputs/radical/${sheet.kind}-parsed.private.json`,JSON.stringify(result));
 results.push({file:source.file,sha256:source.sha256,kind:sheet.kind,counts:result.source_counts,milliseconds,all_raw_cells_equal:true});
}
await writeFile('outputs/radical/reconciliation.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
