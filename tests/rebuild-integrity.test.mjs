import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretSession,dayIndex,buildDailyPosition,assignmentAt} from '../lib/hr/attendance-engine.mjs';
import {isolatedDatabase} from './helpers/isolated-db.mjs';
const rule={department_id:'department',effective_from:'2026-09-01',start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6]};
const assignment={employee_id:'employee',department_id:'department',valid_from:'2026-09-01',valid_to:null};
const punch=(date,minute)=>({timestamp:dayIndex(date)*1440+minute,calendar_date:date,minute,issues:[]});
const interpret=(timeline,extra={})=>interpretSession({day:'2026-09-10',asOf:'2026-09-25',employeeId:'employee',timeline,rules:[rule],assignments:[assignment],...extra});
test('a same-calendar morning cannot be an evening shift exit',()=>{
 const c=interpret([punch('2026-09-10',90),punch('2026-09-10',965)]);
 assert.equal(c.state,'single');assert.equal(c.exit,null);assert.equal(c.duration,null);
});
test('same-day exit inside the entry window is retained; next shift entry is excluded',()=>{
 const c=interpret([punch('2026-09-10',960),punch('2026-09-10',1200),punch('2026-09-11',960)]);
 assert.equal(c.duration,240);assert.equal(c.exit,1200);assert.equal(c.timeline.length,2);
});
test('off-day evidence has worked minutes but cannot generate lateness',()=>{
 const c=interpret([punch('2026-09-10',1000),punch('2026-09-11',90)],{rules:[{...rule,working_weekdays:[0,1,2]}]});
 assert.equal(c.expected,false);assert.equal(c.late_minutes,null);assert.equal(c.duration,530);
});

test('a transfer on the first observed day voids that day without overlapping tomorrow; explicit correction retains identity',()=>isolatedDatabase(async({db,who,hr,read})=>{
 await who();const e=(await read('employees')).rows[0];
 const today=(await db.query("select ((now() at time zone 'Asia/Baghdad')::date)::text as value")).rows[0].value;
 const record=async data=>(await db.query('select public.employee_assignment_record($1) value',[data])).rows[0].value;
 const data={employee_id:e.id,employee_version:e.version,department_id:e.department_id,shift_id:e.shift_id,direct_manager_id:e.direct_manager_id,employment_status:e.employment_status,valid_from:today,valid_to:today,reason:'Synthetic dated proof of the current day'};
 const original=await record(data);
 const edited=await hr('employee.save',{...e,employment_status:e.employment_status==='active'?'resigned':'active'});
 const history=(await db.query('select public.employee_assignments($1) value',[e.id])).rows[0].value;
 assert.equal(assignmentAt(history,e.id,today),null);
 const voided=history.find(a=>a.id===original.id);assert.ok(voided.voided_at);
 assert.equal(history.filter(a=>!a.voided_at).length,1);
 await assert.rejects(record({...data,employee_version:edited.version}),/يوجد سجل يبدأ/);
 const corrected=await record({...data,employee_version:edited.version,id:voided.id,version:voided.version,reason:'Independent synthetic administrative proof after transfer'});
 assert.equal(corrected.id,original.id);assert.equal(corrected.voided_at,null);
 assert.equal(assignmentAt([corrected],e.id,today).department_id,e.department_id);
 await db.exec('reset role');
 assert.ok((await db.query("select count(*)::integer n from public.audit_logs where entity_type='employee_assignment_history' and entity_id=$1",[original.id])).rows[0].n>=3);
}));
test('unproven historical assignment preserves raw evidence and suppresses inferred metrics',()=>{
 const c=interpret([punch('2026-09-10',1000),punch('2026-09-10',1200)],{assignments:[]});
 assert.equal(c.state,'missing_assignment');assert.equal(c.entry,null);assert.equal(c.duration,null);assert.equal(c.punch_count,2);
});
test('dated transfer uses the historical department and next-day boundary',()=>{
 const c=interpret([punch('2026-09-10',960),punch('2026-09-11',90),punch('2026-09-11',600)],{
 assignments:[{...assignment,valid_to:'2026-09-10'},{...assignment,department_id:'new',valid_from:'2026-09-11'}],
 rules:[rule,{...rule,department_id:'new',start_minute:480,entry_window_start:360,entry_window_end:1000}]});
 assert.equal(c.exit,90);assert.equal(c.duration,570);assert.equal(c.punch_count,2);
});
test('future dates and open identity issues cannot generate worked or late minutes',()=>{
 const punches=[punch('2026-09-10',1000),punch('2026-09-11',90)];
 for(const change of [{asOf:'2026-09-09'},{issues:[{id:'i',state:'open'}]}]) {
  const c=interpret(punches,change);assert.equal(c.duration,null);assert.equal(c.late_minutes,null);
 }
});
test('daily manual decision remains distinct from immutable punch evidence',()=>{
 const result=buildDailyPosition({date:'2026-09-10',as_of:'2026-09-25',employees:[{id:'employee',name:'Synthetic',department_id:'department'}],rules:[rule],assignments:[assignment],
 sources:[{id:'s',employee_id:'employee',calendar_date:'2026-09-10',punch_minutes:[1000,1200]}],manual_records:[{employee_id:'employee',status_type:'leave'}]});
 assert.equal(result.rows[0].status,'leave');assert.equal(result.rows[0].late_minutes,0);assert.equal(result.rows[0].evidence.late_minutes,40);assert.equal(result.rows[0].duration_minutes,200);
});
test('history, transaction rollback and live role denial in disposable database',async()=>{
 await isolatedDatabase(async({db,who,hr,write})=>{
  await who();
  const e=(await db.query("select public.hr_read_v4('employees','{}') value")).rows[0].value.rows[0];
  const call=async(name,data)=>(await db.query(`select public.${name}($1) value`,[data])).rows[0].value;
  const history=await call('employee_assignments',e.id);
  assert.equal(history.length,1);assert.equal(history[0].evidence_kind,'observed');
  assert.ok(history[0].valid_from>='2026-09-25','migration must not backfill historical dates');
  const data={employee_id:e.id,employee_version:e.version,department_id:e.department_id,shift_id:null,direct_manager_id:null,employment_status:'active',valid_from:'2026-09-01',valid_to:'2026-09-23',reason:'Synthetic dated organization record'};
  const original=await call('employee_assignment_record',data);
  await assert.rejects(call('employee_assignment_record',data),/تتداخل/);
  const corrected=await call('employee_assignment_record',{...data,id:original.id,version:original.version,reason:'Corrected synthetic dated record',valid_to:'2026-09-22'});
  assert.equal(corrected.id,original.id);assert.equal(corrected.version,original.version+1);
  await assert.rejects(call('employee_assignment_record',{...data,id:original.id,version:original.version}),/تغير سجل/);
  await write('rule.save',{...rule,department_id:e.department_id,default_manager_id:null});
  const decision=await hr('status.save',{employee_id:e.id,department_id:e.department_id,record_date:'2026-09-10',status_type:'leave',late_minutes:null,notes:'Original'});
  const note={employee_id:e.id,work_date:'2026-09-10',notes:'Must roll back',procedure_text:''};
  await assert.rejects(call('attendance_day_save',{note,decision:{operation:'save',data:{...decision,id:decision.id,version:0,department_id:e.department_id,status_type:'late',late_minutes:12}}}),/تعديل|تغيير/);
  const evidence=await call('attendance_daily_evidence',{date:'2026-09-10'});
  assert.equal(evidence.notes.length,0);assert.equal(evidence.manual_records[0].status_type,'leave');
  await assert.rejects(call('attendance_day_save',{note,decision:{operation:'save',data:{employee_id:e.id,department_id:e.department_id,record_date:'2026-09-10',status_type:'late',late_minutes:12}}}),/يوجد قرار/);
  await call('attendance_day_save',{note:{...note,notes:'Saved together'},decision:{operation:'save',data:{...decision,department_id:e.department_id,status_type:'late',late_minutes:12}}});
  assert.equal((await call('attendance_daily_evidence',{date:'2026-09-10'})).notes[0].notes,'Saved together');
  await who('VIEWER');await assert.rejects(call('employee_assignment_record',{...data,valid_from:'2026-08-01',valid_to:'2026-08-02'}),/صلاحية/);
  await assert.rejects(call('attendance_day_save',{note,decision:null}),/صلاحية/);
  await db.exec('reset role');await db.exec('set role anon');await assert.rejects(call('attendance_daily_evidence',{}),/permission denied/);
 });
});

test('name-only matching stays unresolved; a human-confirmed mapping is reusable; cancelled issues cannot contaminate daily evidence',()=>isolatedDatabase(async({db,who,hr,write})=>{
 await who();
 const dep=(await db.query("select public.hr_read_v4('reference','{}') value")).rows[0].value.departments[0].id;
 const e=await hr('employee.save',{name:'اسم اصطناعي وحيد للمراجعة',department_id:dep,employee_number:null,shift_id:null,direct_manager_id:null,employment_status:'active'});
 const row={source_sheet:'Test',source_row:2,calendar_date:'2026-09-10',person_code:'UNVERIFIED-SYNTHETIC',source_name:e.name,raw_values:['16:00','20:00'],punch_minutes:[960,1200],invalid:false};
 const payload={source_name:'synthetic.csv',source_hash:'7'.repeat(64),import_kind:'daily',period_start:'2026-09-10',period_end:'2026-09-10',rows:[row]};
 const batch=await write('import.preview',payload);
 const read=async(k,f)=>(await db.query('select public.attendance_read_v5($1,$2) value',[k,f])).rows[0].value;
 const inspected=await read('import',{id:batch.id});
 assert.equal(inspected.rows[0].employee_id,null);assert.equal(inspected.rows[0].match_state,'unmatched');
 const issue=(await read('issues',{import_id:batch.id})).rows[0];
 await write('issue.reprocess',{id:issue.id,version:issue.version});
 assert.equal((await read('import',{id:batch.id})).rows[0].employee_id,null);
 const open=(await read('issues',{import_id:batch.id})).rows[0];
 await write('issue.resolve',{id:open.id,version:open.version,state:'resolved',employee_id:e.id,resolution_note:'Human synthetic device-register verification'});
 const cancelled=(await read('imports',{})).find(i=>i.id===batch.id);
 await write('import.cancel',{id:batch.id,version:cancelled.version});
 const second=await write('import.preview',{...payload,source_hash:'8'.repeat(64)});
 assert.equal((await read('import',{id:second.id})).rows[0].employee_id,e.id);
 await write('import.apply',{id:second.id,version:second.version});
 await db.exec('reset role');
 await db.query("insert into public.fingerprint_issues(source_row_id,issue_type,details) select id,'punch_conflict','Synthetic historical cancelled warning' from public.fingerprint_source_rows where import_id=$1",[batch.id]);
 await who();
 const evidence=(await db.query('select public.attendance_daily_evidence($1) value',[{date:'2026-09-10'}])).rows[0].value;
 assert.equal(evidence.sources.length,1);assert.equal(evidence.sources[0].import_id,second.id);assert.equal(evidence.issues.length,0);
}));
