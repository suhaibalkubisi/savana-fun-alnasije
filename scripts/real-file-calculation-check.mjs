import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildMonthlyPosition} from '../lib/hr/monthly-position.mjs';
const parsed=JSON.parse(await readFile('outputs/radical/monthly-parsed.private.json','utf8'));
const oracle=JSON.parse(await readFile('outputs/radical/source-inspection.private.json','utf8'))[1];
const identities=[...new Set(oracle.cells.map(c=>c.code.trim()))];
const employeeId=code=>'isolated-'+code;
// This is an explicit TEST shift window, never an inferred production schedule.
const employees=identities.map((code,i)=>({id:employeeId(code),name:`Synthetic ${i+1}`,internal_code:`TEST-${i+1}`}));
const assignments=employees.map(e=>({employee_id:e.id,department_id:'test',department:'Test',valid_from:'2026-09-01',valid_to:'2026-10-01',employment_status:'active'}));
const rules=[{department_id:'test',effective_from:'2026-09-01',entry_window_start:720,entry_window_end:1439,start_minute:960,grace_minutes:15,working_weekdays:[0,1,2,3,4,5,6]}];
const sources=parsed.rows.map((r,i)=>({...r,id:`test-source-${i}`,employee_id:employeeId(r.person_code)}));
const context={month:'2026-09',available:true,as_of:'2026-09-30',batch:{coverage_start:'2026-09-01',coverage_end:'2026-09-30',lifecycle_state:'preview'},sources,employees,assignments,rules};
const start=performance.now();const position=buildMonthlyPosition(context);const milliseconds=performance.now()-start;
const counts={complete:0,overnight:0,single:0,empty:0,multiple:0,unassigned_first_boundary:0,checked_days:0};
// Independent scalar oracle: compare day-relative minutes using adjacent calendar cells.
for(const person of position.rows){
 const code=person.person_codes[0];
 const cells=oracle.cells.filter(c=>c.code.trim()===code);
 for(let d=1;d<=30;d++){
  const here=cells.find(c=>Number(c.date.slice(-2))===d)?.minutes||[];
  const tomorrow=cells.find(c=>Number(c.date.slice(-2))===d+1)?.minutes||[];
  const eligible=[...here.filter(m=>m>=720),...tomorrow.filter(m=>m<720).map(m=>m+1440)].sort((a,b)=>a-b);
  const entry=eligible.find(m=>m<1440);
  const end=entry===undefined?undefined:eligible.filter(m=>m>entry).at(-1);
  const cell=person.cells[String(d)];
  assert.equal(cell.entry,entry??null);assert.equal(cell.exit,end===undefined?null:end%1440);
  assert.equal(cell.duration,end===undefined?null:end-entry);
  assert.equal(cell.next_day,end!==undefined&&end>=1440);
  counts.checked_days++;counts.complete+=end!==undefined;counts.overnight+=end!==undefined&&end>=1440;counts.single+=entry!==undefined&&end===undefined;counts.empty+=!eligible.length;counts.multiple+=eligible.length>2;
 }
 counts.unassigned_first_boundary+=cells[0].minutes.filter(m=>m<720).length;
}
assert.equal(position.rows.reduce((n,r)=>n+r.raw_punch_count,0),10079);
assert.equal(position.rows.reduce((n,r)=>n+r.raw_timeline.length,0),10079);
const unresolved=buildMonthlyPosition({...context,assignments:[]});
assert(unresolved.rows.every(r=>Object.values(r.cells).every(c=>c.state==='missing_assignment'&&c.duration===null)));
const report={independent_real_file_shift_checks:counts,test_window:'12:00 to next 12:00; TEST ONLY, never a production rule',raw_punches_preserved:10079,missing_history_remains_unresolved:true,calculation_ms:milliseconds};
await writeFile('outputs/radical/calculation-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
