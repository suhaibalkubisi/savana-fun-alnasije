import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyPosition,scopeMonthlyPosition,monthlyMatrixRows} from '../lib/hr/monthly-position.mjs';
const person={id:'employee-1',name:'موظف تجريبي',internal_code:'FANU-000001',department_id:'dep',department:'قسم تجريبي',employment_status:'active'};
const rule={department_id:'dep',effective_from:'2020-01-01',start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6]};
function fixture(cells,extra={}) {
 return {month:'2026-09',as_of:'2026-09-24',available:true,batch:{id:'batch',lifecycle_state:'preview',coverage_start:'2026-09-01',coverage_end:'2026-09-23'},employees:[person],rules:[rule],
 sources:Object.entries(cells).map(([day,minutes],n)=>({id:`source-${n}`,source_sheet:'Punch Record',source_row:2,calendar_date:`2026-09-${day.padStart(2,'0')}`,person_code:'DVC-1',source_name:'موظف تجريبي',employee_id:person.id,punch_minutes:minutes,raw_values:['DVC-1','موظف تجريبي',`09-${day}`,minutes.map(m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`).join('\n')]})),...extra};
}
test('monthly same-day pair uses first and last shift punches, retaining intermediate evidence',()=>{
 const r=buildMonthlyPosition(fixture({10:[965,1030,1170]})).rows[0];
 assert.equal(r.cells[10].entry,965);assert.equal(r.cells[10].exit,1170);assert.equal(r.cells[10].duration,205);
 assert.equal(r.cells[10].timeline.length,3);assert.equal(r.raw_punch_count,3);assert.equal(r.summary.complete,1);
});
test('overnight exit keeps original calendar date and cannot consume the next afternoon entry',()=>{
 const r=buildMonthlyPosition(fixture({10:[965],11:[90,970],12:[100]})).rows[0];
 assert.equal(r.cells[10].exit,90);assert.equal(r.cells[10].next_day,true);assert.equal(r.cells[10].duration,565);
 assert.equal(r.cells[11].entry,970);assert.equal(r.cells[11].exit,100);
 assert.equal(r.cells[10].timeline.at(-1).calendar_date,'2026-09-11');
 const used=Object.values(r.cells).flatMap(c=>c.timeline.map(p=>p.timestamp));assert.equal(new Set(used).size,used.length);
});
test('same-calendar morning is never fabricated as the evening shift next-day exit',()=>{
 const r=buildMonthlyPosition(fixture({10:[90,965]})).rows[0];
 assert.equal(r.cells[9].state,'exit_only');assert.equal(r.cells[10].state,'single');assert.equal(r.cells[10].exit,null);assert.equal(r.cells[10].duration,null);
});
test('single punch remains incomplete and valid lateness does not require an exit',()=>{
 const r=buildMonthlyPosition(fixture({10:[1000]})).rows[0];assert.equal(r.cells[10].state,'single');
 assert.equal(r.cells[10].exit,null);assert.equal(r.cells[10].late_minutes,40);assert.equal(r.summary.late_minutes,40);assert.equal(r.summary.worked_minutes,0);
});
test('missing historical schedule exposes evidence without guessed pairing or duration',()=>{
 const r=buildMonthlyPosition(fixture({1:[90,965,1100]},{rules:[{...rule,effective_from:'2026-09-08'}]})).rows[0];
 assert.equal(r.cells[1].state,'missing_schedule');assert.equal(r.cells[1].duration,null);assert.equal(r.cells[1].entry,null);assert.equal(r.cells[1].timeline.length,3);
});
test('first-day boundary evidence remains traceable without invented previous-month attendance',()=>{
 const r=buildMonthlyPosition(fixture({1:[90,965],2:[100]})).rows[0];assert.equal(r.unassigned_timeline.length,1);
 assert.equal(r.unassigned_timeline[0].calendar_date,'2026-09-01');assert.equal(r.cells[1].exit,100);assert.equal(r.raw_punch_count,3);
});
test('last covered shift is pending without next-day evidence; future blanks are not absence',()=>{
 const r=buildMonthlyPosition(fixture({23:[960]})).rows[0];assert.equal(r.cells[23].boundary_missing,true);
 assert.equal(r.cells[24].state,'outside_coverage');assert.equal(r.cells[25].state,'future');assert.equal(r.summary.no_punch,22);
 assert.ok(!Object.values(r.cells).some(c=>c.state==='absence'));
});
test('all-month headers do not establish coverage when only partial evidence is present',()=>{
 const p=buildMonthlyPosition(fixture({4:[960,1100],12:[960],30:[]},{batch:{id:'batch',lifecycle_state:'preview'}}));
 assert.equal(p.coverage.start,'2026-09-04');assert.equal(p.coverage.end,'2026-09-12');assert.equal(p.coverage.confirmed,false);assert.equal(p.rows[0].cells[20].state,'outside_coverage');
});
test('duplicate source timestamps keep raw count but cannot create duplicate worked time',()=>{
 const f=fixture({10:[960,1100]});f.sources.push({...f.sources[0],id:'duplicate',source_row:3});
 const p=buildMonthlyPosition(f);assert.equal(p.rows[0].raw_punch_count,4);assert.equal(p.rows[0].effective_punch_count,2);assert.equal(p.rows[0].summary.worked_minutes,140);assert.equal(p.rows.length,1);
});
test('inactive employees and unmatched source identities remain visible independently',()=>{
 const f=fixture({10:[960,1100]},{employees:[{...person,employment_status:'resigned'}]});
 f.sources.push({...f.sources[0],id:'unmatched',employee_id:null,person_code:'DVC-OTHER',source_row:3});
 const p=buildMonthlyPosition(f);assert.equal(p.rows.length,2);assert.equal(p.source_counts.identities,2);assert.equal(p.source_counts.matched_identities,1);
 assert.ok(p.rows.some(r=>r.employment_status==='resigned'));assert.ok(p.rows.some(r=>!r.employee_id));
});
test('same-name employees have separate UUID rows and internal-code search selects only its employee',()=>{
 const f=fixture({10:[960,1100]});f.employees.push({...person,id:'employee-2',internal_code:'FANU-000002'});f.sources.push({...f.sources[0],id:'other',employee_id:'employee-2',person_code:'DVC-2',source_row:3});
 const p=buildMonthlyPosition(f);assert.equal(p.rows.length,2);const s=scopeMonthlyPosition(p,{search:'FANU-000002'});assert.equal(s.rows.length,1);assert.equal(s.rows[0].employee_id,'employee-2');
});
test('month-end manager and department filters do not split employee daily cells',()=>{
 const f=fixture({1:[960,1100],15:[960,1100]},{rules:[{...rule,default_manager_id:'old'},{...rule,effective_from:'2026-09-12',default_manager_id:'new'}]});
 const p=buildMonthlyPosition(f);assert.equal(p.rows.length,1);assert.equal(scopeMonthlyPosition(p,{manager_id:'new',department_id:'dep'}).rows[0].summary.complete,2);assert.equal(scopeMonthlyPosition(p,{manager_id:'old'}).rows.length,0);
});
test('manual HR annotation does not erase fingerprint evidence or turn it into applied HR data',()=>{
 const f=fixture({10:[965,1100]},{manual_records:[{employee_id:person.id,record_date:'2026-09-10',status_type:'leave',notes:'Synthetic HR decision'}]});
 const c=buildMonthlyPosition(f).rows[0].cells[10];assert.equal(c.manual.status_type,'leave');assert.equal(c.state,'complete');assert.equal(c.punch_count,2);
});
test('blocking evidence issues keep duration unavailable and pending filters reconcile',()=>{
 const f=fixture({10:[960,1100]},{issues:[{id:'issue',source_row_id:'source-0',state:'open',issue_type:'punch_conflict'}]});
 const p=scopeMonthlyPosition(buildMonthlyPosition(f),{condition:'pending'});assert.equal(p.metrics.pending,1);assert.equal(p.rows[0].cells[10].duration,null);assert.equal(p.metrics.worked_minutes,0);
});
test('matrix exports use explicit entry/exit labels and +1 without conflating punch and day counts',()=>{
 const p=buildMonthlyPosition(fixture({10:[960],11:[90]}));const rows=monthlyMatrixRows(p);
 assert.equal(rows[0][3],'دخول');assert.equal(rows[1][3],'خروج');assert.equal(rows[1][13],'01:30 (+1)');assert.equal(p.rows[0].raw_punch_count,2);assert.equal(p.metrics.complete,1);
});
test('unapproved month availability is unknown, never a fabricated zero attendance result',()=>{
 const p=buildMonthlyPosition({month:'2026-09',available:false});assert.equal(p.metrics,null);assert.deepEqual(p.rows,[]);
});

test('dashboard punch filters count scoped identities and do not include future or out-of-coverage evidence',()=>{
 const p=buildMonthlyPosition(fixture({10:[960,1100],25:[960]}));
 const punched=scopeMonthlyPosition(p,{condition:'with_punch'});
 assert.equal(punched.metrics.with_punch,1);assert.equal(punched.rows[0].summary.with_punch,1);
 assert.equal(punched.rows[0].cells[25].state,'filtered');
 const empty=scopeMonthlyPosition(p,{condition:'no_punch'});
 assert.equal(empty.metrics.with_punch,0);assert.equal(empty.metrics.complete,0);
 assert.equal(empty.rows[0].raw_punch_count,3,'source evidence counts remain whole-file reconciliation, not attendance-day counts');
});
test('February and leap years have their actual number of daily columns',()=>{
 assert.equal(buildMonthlyPosition({month:'2024-02',available:false}).days,29);assert.equal(buildMonthlyPosition({month:'2025-02',available:false}).days,28);assert.equal(buildMonthlyPosition({month:'2026-12',available:false}).days,31);
});
