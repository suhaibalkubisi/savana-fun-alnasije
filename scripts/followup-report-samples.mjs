import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileFollowupReports} from './compile-followup-reports.mjs';
import {fixture,sampleSelections} from '../tests/followup-export-fixture.mjs';
const target=path.resolve(process.argv[2]||'../../outputs/report-samples');
const compiled=path.resolve('work/followup-sample-exports.mjs');await fs.mkdir(path.dirname(compiled),{recursive:true});
await compileFollowupReports(path.resolve('work/followup-sample-modules'));
const {excelBytes,pdfDocument}=await import(pathToFileURL(path.resolve('work/followup-sample-modules/exports.mjs')));
const {reportTable}=await import(pathToFileURL(path.resolve('work/followup-sample-modules/report-model.mjs')));
const assets={bodyFont:(await fs.readFile('public/fonts/FANUArabic.ttf')).toString('base64'),titleFont:(await fs.readFile('public/fonts/Cairo-750.ttf')).toString('base64'),company:new Uint8Array(await fs.readFile('public/brand/fanu-official-20260908.jpeg')),savana:new Uint8Array(await fs.readFile('public/brand/savana-official-20260908.png'))};
const f=fixture();await fs.mkdir(target,{recursive:true});const records=[];
for(const selection of sampleSelections){const t=reportTable(selection,f.context,f.positions,f.employees,f.reports,f.actions);const pdf=await pdfDocument(t,assets);await fs.writeFile(path.join(target,`${selection.kind}.pdf`),pdf.bytes);await fs.writeFile(path.join(target,`${selection.kind}.xlsx`),await excelBytes(t,assets));records.push({kind:selection.kind,title:t.title,reference:t.reference,pageCount:pdf.pageCount,rows:t.rows.length,scope:t.scope});}
await fs.writeFile(path.join(target,'sample-index.json'),JSON.stringify({synthetic:true,generated_at:f.context.generated_at,records},null,2));
console.log(JSON.stringify(records));
