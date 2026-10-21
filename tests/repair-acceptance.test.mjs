import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyPosition} from '../lib/hr/attendance-engine.mjs';
import {comprehensivePosition} from '../lib/hr/comprehensive-position.mjs';
import {buildMonthlyPosition} from '../lib/hr/monthly-position.mjs';
const day='2026-10-08';
const employee={id:'e',name:'موظف اختبار',internal_code:'FANU-000001'};
const assignment={employee_id:'e',department_id:'a',department:'قسم أ',valid_from:'2026-09-01',valid_to:null,employment_status:'active'};
const rule={department_id:'a',effective_from:'2026-09-01',entry_window_start:720,entry_window_end:1439,start_minute:960,grace_minutes:15,working_weekdays:[0,1,2,3,4,5,6]};
function daily(sources,extra={}) {return buildDailyPosition({date:day,as_of:'2026-10-09',employees:[employee],assignments:[assignment],rules:[rule],imports:[{id:'i'}],sources,issues:[],...extra});}
test('D02: unrelated applied file cannot prove no entry',()=>{
 const r=daily([{id:'s',calendar_date:day,employee_id:null,punch_minutes:[960]}]);
 assert.equal(r.rows[0].attendance_state,'unproven_coverage');assert.equal(r.rows[0].needs_review,true);
 assert.notEqual(r.rows[0].status,'no_entry');
});
test('daily is entry only and excludes previous overnight exit',()=>{
 const r=daily([{id:'s',calendar_date:day,employee_id:'e',punch_minutes:[90,965]}]);
 assert.equal(r.rows[0].entry_minute,965);assert.equal(r.rows[0].exit_minute,null);
 assert.equal(r.rows[0].status,'present');assert.equal(r.rows[0].needs_review,false);assert.equal(r.rows[0].raw_timeline.length,2);
});
test('incomplete current day cannot yet establish no entry',()=>{
 const r=daily([{id:'s',calendar_date:day,employee_id:'e',punch_minutes:[],coverage_confirmed:true}],{as_of:day,as_of_minute:900});
 assert.equal(r.rows[0].attendance_state,'incomplete_day');
});
test('HR decision and punch evidence both retained',()=>{
 const r=daily([{id:'s',calendar_date:day,employee_id:'e',punch_minutes:[960]}],{manual_records:[{employee_id:'e',status_type:'absence',department_id:'a'}]});
 assert.equal(r.rows[0].status,'absence');assert.equal(r.rows[0].attendance_state,'entry_recorded');assert.equal(r.rows[0].entry_minute,960);assert.equal(r.rows[0].manual_conflict,true);
});
test('observed monthly dates cannot certify blank employee dates',()=>{
 const r=buildMonthlyPosition({month:'2026-09',as_of:'2026-10-09',available:true,batch:{},employees:[employee],assignments:[assignment],rules:[rule],sources:[
 {id:'s1',employee_id:'e',calendar_date:'2026-09-01',punch_minutes:[960,1200]},
 {id:'s2',employee_id:'e',calendar_date:'2026-09-02',punch_minutes:[]},
 {id:'s3',employee_id:'e',calendar_date:'2026-09-03',punch_minutes:[960]},
 ]});
 assert.equal(r.rows[0].cells['2'].state,'unproven_coverage');assert.equal(r.rows[0].summary.no_punch,0);assert.equal(r.rows[0].summary.valid_entry,2);
});
test('monthly overnight exit belongs to shift; single punch is not pair',()=>{
 const r=buildMonthlyPosition({month:'2026-09',as_of:'2026-10-09',available:true,batch:{coverage_confirmed:true,coverage_start:'2026-09-01',coverage_end:'2026-09-03'},employees:[employee],assignments:[assignment],rules:[rule],sources:[
 {id:'s1',employee_id:'e',calendar_date:'2026-09-01',punch_minutes:[960,960]},
 {id:'s2',employee_id:'e',calendar_date:'2026-09-02',punch_minutes:[90,965]},
 ]});
 assert.equal(r.rows[0].cells['1'].entry,960);assert.equal(r.rows[0].cells['1'].exit,90);assert.equal(r.rows[0].cells['1'].next_day,true);
 assert.equal(r.rows[0].cells['2'].state,'single');assert.equal(r.rows[0].cells['2'].exit,null);assert.equal(r.rows.length,1);
});


test('unverified identity and conflicting approval contexts cannot yield entry or no-entry',()=>{
 const source={id:'s',calendar_date:day,employee_id:'e',punch_minutes:[90],coverage_confirmed:true,identity_verified:false};
 const r=daily([source]);assert.equal(r.rows[0].attendance_state,'unresolved_identity');assert.equal(r.rows[0].status,'unresolved_identity');assert.equal(r.rows[0].entry_minute,null);assert.equal(r.rows[0].needs_review,true);
 const c=daily([{...source,identity_verified:true,punch_minutes:[960],import_id:'a'},{...source,id:'t',identity_verified:true,punch_minutes:[970],import_id:'b'}],{contexts:{a:{assignments:[assignment],rules:[rule]},b:{assignments:[assignment],rules:[{...rule,start_minute:900}]}}});
 assert.equal(c.rows[0].attendance_state,'context_conflict');assert.equal(c.rows[0].status,'context_conflict');assert.equal(c.rows[0].entry_minute,null);
});

test('comprehensive ticks require approved eligible evidence and manual decisions keep precedence',()=>{
 const report={month:'2026-10',rows:[{id:'e',cells:{8:'absence'},weighted:1,absence:1}],totals:{weighted:1}};
 const d={date:day,as_of:'2026-10-09',employees:[employee],assignments:[assignment],rules:[rule],imports:[{id:'i'}],sources:[{id:'s',employee_id:'e',calendar_date:day,punch_minutes:[960],identity_verified:true}],issues:[]};
 const evidence={report,as_of:'2026-10-09',monthly:{month:'2026-10',as_of:'2026-10-09',available:false},daily:[d]};
 const actual=comprehensivePosition(evidence);assert.equal(actual.rows[0].cells[8],'absence');assert.equal(actual.rows[0].attendance_conflicts,1);assert.equal(actual.totals.weighted,1);
 const blank={...report,rows:[{...report.rows[0],cells:{}}]};assert.equal(comprehensivePosition({...evidence,report:blank}).rows[0].cells[8],'attendance');
 const unresolved={...d,sources:[{...d.sources[0],identity_verified:false}]};assert.equal(comprehensivePosition({...evidence,report:blank,daily:[unresolved]}).rows[0].cells[8],undefined);
 const future={...d,as_of:'2026-10-07'};assert.equal(comprehensivePosition({...evidence,as_of:'2026-10-07',report:blank,daily:[future]}).rows[0].cells[8],undefined);
});

test('canonical approval context takes precedence and legacy compact context remains supported',()=>{
 const frozen={assignments:[assignment],rules:[rule]},stale={assignments:[{...assignment,department_id:'b'}],rules:[{...rule,department_id:'b',entry_window_start:1200}]};const source={id:'s',import_id:'i',employee_id:'e',calendar_date:day,punch_minutes:[960],identity_verified:true,calculation_context:stale};
 const canonical=daily([source],{contexts:{i:frozen}}).rows[0];assert.equal(canonical.entry_minute,960);assert.equal(canonical.department_id,'a');assert.equal(canonical.calculation_basis,'approval_snapshot');const legacy=daily([{...source,calculation_context:frozen}]).rows[0];assert.equal(legacy.entry_minute,960);assert.equal(legacy.department_id,'a');
});
