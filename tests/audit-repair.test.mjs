import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './helpers/isolated-db.mjs';
import {buildDailyPosition,interpretDailyEntry,dayIndex} from '../lib/hr/attendance-engine.mjs';
import {buildMonthlyPosition} from '../lib/hr/monthly-position.mjs';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const day='2026-09-10';
const rule={department_id:'dep',effective_from:'2026-09-01',start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6]};
const assignment={employee_id:'e',department_id:'dep',valid_from:'2026-09-01',valid_to:null};
const timeline=(date,minutes)=>minutes.map(minute=>({timestamp:dayIndex(date)*1440+minute,calendar_date:date,minute,issues:[]}));

test('join, resignation and reactivation preserve identity and require explicit evidence for change-day history',()=>isolatedDatabase(async({db,who,hr,read})=>{
 await who();const deps=(await read('reference')).departments;
 let employee=await hr('employee.save',{name:'اختبار انضمام وإعادة تفعيل',department_id:deps[0].id,employment_status:'active'});
 const identity={id:employee.id,code:employee.internal_code};
 const dates=(await db.query("select ((now() at time zone 'Asia/Baghdad')::date)::text today,(((now() at time zone 'Asia/Baghdad')::date)+1)::text tomorrow")).rows[0];
 for(const status of ['resigned','inactive','active']) {
  employee=await hr('employee.save',{...employee,department_id:deps[1].id,employment_status:status});
  assert.equal(employee.id,identity.id);assert.equal(employee.internal_code,identity.code);
  const rows=(await db.query('select public.employee_assignments($1) value',[employee.id])).rows[0].value.filter(x=>!x.voided_at);
  assert.equal(rows.length,1);assert.equal(rows[0].valid_from,dates.tomorrow);assert.equal(rows[0].employment_status,status);
  assert.ok(!rows.some(x=>x.valid_from<=dates.today&&(!x.valid_to||x.valid_to>=dates.today)));
 }
 await db.query('select public.employee_assignment_record($1)',[{employee_id:employee.id,employee_version:employee.version,department_id:deps[1].id,employment_status:'active',valid_from:dates.today,valid_to:dates.today,reason:'Synthetic signed reactivation record explicitly confirms the change day'}]);
 const history=(await db.query('select public.employee_assignments($1) value',[employee.id])).rows[0].value.filter(x=>!x.voided_at);
 assert.equal(history.length,2);assert.ok(history.some(x=>x.valid_from===dates.today&&x.valid_to===dates.today));
}));

test('additive migration preserves old rows and local backup restores the same evidence',()=>isolatedDatabase(async({db,who,hr,read,write})=>{
 await who();const dep=(await read('reference')).departments[0].id;
 const e=await hr('employee.save',{name:'اختبار ترقية محفوظ',department_id:dep,employment_status:'active'});
 await hr('status.save',{employee_id:e.id,department_id:dep,record_date:day,status_type:'leave'});
 await write('import.preview',{source_name:'Synthetic preupgrade.xls',source_hash:'a'.repeat(64),import_kind:'daily',period_start:day,period_end:day,rows:[{source_sheet:'Test',source_row:2,calendar_date:day,person_code:'UP-1',source_name:e.name,raw_values:['16:05','16:05'],punch_minutes:[965],invalid:false}]});
 await db.exec('reset role');
 const tables=['employees','fingerprint_source_rows','fingerprint_issues','hr_status_records','audit_logs','employee_assignment_history','attendance_imports','fingerprint_identities'];
 const columns={};const before={};
 for(const t of tables){columns[t]=(await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position',['public',t])).rows.map(x=>'"'+x.column_name+'"').join(',');before[t]=(await db.query('select '+columns[t]+' from public.'+t+' order by id')).rows;}
 const backup=await db.dumpDataDir();const restored=new PGlite({loadDataDir:backup});
 try{assert.deepEqual((await restored.query('select '+columns.fingerprint_source_rows+' from public.fingerprint_source_rows order by id')).rows,before.fingerprint_source_rows);}finally{await restored.close();}
 await db.exec(await readFile('supabase/migrations/20261004191207_hr_audit_repair.sql','utf8'));
 for(const t of tables)assert.deepEqual((await db.query('select '+columns[t]+' from public.'+t+' order by id')).rows,before[t],t+' changed existing rows');
 assert.equal((await db.query("select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")).rows[0].n,0);
},{beforeRepair:true}));

test('explicit boundary snapshot, daily replacement and stable approved history',()=>isolatedDatabase(async({db,who,hr,read,write,evidence})=>{
 await who();const dep=(await read('reference')).departments[0].id;
 const e=await hr('employee.save',{name:'اختبار حدود الشهر',department_id:dep,employment_status:'active'});
 await db.query('select public.employee_assignment_record($1)',[{employee_id:e.id,employee_version:e.version,department_id:dep,employment_status:'active',valid_from:'2026-09-01',valid_to:'2026-10-02',reason:'Synthetic boundary fixture register'}]);
 await write('rule.save',{...rule,department_id:dep,default_manager_id:null});
 let sequence=100;
 const preview=(kind,date,minutes)=>write('import.preview',{source_name:'Synthetic boundary.xls',source_hash:(++sequence).toString(16).padStart(64,'0'),device_namespace:'boundary-test',import_kind:kind,period_start:kind==='monthly'?date.slice(0,7)+'-01':date,period_end:kind==='monthly'?(date.startsWith('2026-09')?'2026-09-30':'2026-10-31'):date,coverage_start:date,coverage_end:date,rows:[{source_sheet:'Synthetic',source_row:2,calendar_date:date,person_code:'B-1',source_name:e.name,punch_minutes:minutes,raw_values:minutes.map(String),invalid:false}]});
 const oct=await preview('monthly','2026-10-01',[90,960]);
 await db.exec('reset role');const issue=(await db.query('select * from public.fingerprint_issues where source_row_id in(select id from public.fingerprint_source_rows where import_id=$1)',[oct.id])).rows[0];await who();
 await write('issue.resolve',{id:issue.id,version:issue.version,state:'resolved',employee_id:e.id,resolution_note:'Synthetic source register verification'});
 const or=await write('import.review',{id:oct.id,version:oct.lifecycle_version});await write('import.approve',{id:oct.id,version:or.lifecycle_version});
 const sep=await preview('monthly','2026-09-30',[960]);
 let p=buildMonthlyPosition(await evidence({month:'2026-09',import_id:sep.id}));assert.equal(p.rows[0].cells[30].exit,null,'adjacent source must not be silently borrowed');
 await db.query('select public.attendance_boundary_record($1)',[{id:sep.id,version:sep.version,adjacent_import_id:oct.id,reason:'Synthetic adjacent source continuity'}]);
 await assert.rejects(db.query('select public.attendance_boundary_record($1)',[{id:sep.id,version:sep.version,adjacent_import_id:oct.id,reason:'Stale request retry'}]),/تغيرت|مغلقة/);
 p=buildMonthlyPosition(await evidence({month:'2026-09',import_id:sep.id}));assert.equal(p.rows[0].cells[30].duration,570);assert.equal(p.rows[0].cells[30].next_day,true);assert.equal(p.rows[0].cells[30].exit,90);
 const detail=(await db.query('select public.attendance_read_v5($1,$2) value',['import',{id:sep.id}])).rows[0].value;const sr=await write('import.review',{id:sep.id,version:detail.batch.lifecycle_version});await write('import.approve',{id:sep.id,version:sr.lifecycle_version});
 const stable=JSON.stringify(buildMonthlyPosition(await evidence({month:'2026-09',import_id:sep.id})).rows[0].cells);
 await db.exec('reset role');await db.query('update public.attendance_department_rules set start_minute=900 where department_id=$1',[dep]);await who();
 assert.equal(JSON.stringify(buildMonthlyPosition(await evidence({month:'2026-09',import_id:sep.id})).rows[0].cells),stable);
 const old=await preview('daily','2026-09-30',[965]);const applied=await write('import.apply',{id:old.id,version:old.version});const replacement=await preview('daily','2026-09-30',[970]);
 await assert.rejects(write('import.apply',{id:replacement.id,version:replacement.version}),/استبدال|معتمد/);
 const payload={id:old.id,version:applied.version,replacement_id:replacement.id,replacement_version:replacement.version,reason:'Synthetic corrected daily source'};
 await who('HR');await assert.rejects(db.query('select public.attendance_daily_replace($1)',[payload]),/صلاحية/);await who();
 const result=(await db.query('select public.attendance_daily_replace($1) value',[payload])).rows[0].value;assert.equal(result.state,'applied');
 await assert.rejects(db.query('select public.attendance_daily_replace($1)',[payload]),/تغير|غير صالح/);
 const oldDetail=(await db.query('select public.attendance_read_v5($1,$2) value',['import',{id:old.id}])).rows[0].value;
 assert.equal(oldDetail.batch.state,'cancelled');assert.equal(oldDetail.rows[0].punch_minutes[0],965);
 const daily=(await db.query('select public.attendance_daily_evidence($1) value',[{date:'2026-09-30'}])).rows[0].value;
 assert.equal(buildDailyPosition(daily,{employee_id:e.id}).rows[0].entry_minute,970);
}));
test('DAILY entry-only preserves previous-exit evidence and requires neither exit nor next-day file',()=>{
 const raw=timeline(day,[90,1000]);const before=JSON.stringify(raw);
 const c=interpretDailyEntry({day,timeline:raw,rules:[rule],assignments:[assignment],employeeId:'e',asOf:day});
 assert.equal(c.entry,1000);assert.equal(c.late_minutes,40);assert.equal(c.state,'entry_recorded');assert.equal(c.pending,false);assert.equal(c.exit,null);assert.equal(c.duration,null);assert.equal(c.timeline.length,2);assert.equal(JSON.stringify(raw),before);
 const missing=interpretDailyEntry({day,timeline:raw,rules:[rule],assignments:[],employeeId:'e',asOf:day});
 assert.equal(missing.entry,null);assert.equal(missing.state,'missing_assignment');assert.equal(missing.timeline.length,2);
 const morning=interpretDailyEntry({day,timeline:timeline(day,[90]),rules:[rule],assignments:[assignment],employeeId:'e',asOf:day});
 assert.equal(morning.state,'outside_entry_window');assert.equal(morning.entry,null);
});
test('MONTHLY stays entry + exit with deduplication, overnight and next-month boundary',()=>{
 const source=(date,minutes)=>({id:date,calendar_date:date,employee_id:'e',person_code:'1',source_name:'اختبار',source_sheet:'Test',source_row:2,punch_minutes:minutes,raw_values:[]});
 const p=buildMonthlyPosition({month:'2026-09',as_of:'2026-10-02',available:true,batch:{coverage_start:'2026-09-30',coverage_end:'2026-09-30'},employees:[{id:'e',name:'اختبار'}],assignments:[assignment],rules:[rule],sources:[source('2026-09-30',[1000,960,960]),source('2026-10-01',[970,90])]});
 const c=p.rows[0].cells[30];assert.equal(c.entry,960);assert.equal(c.exit,90);assert.equal(c.next_day,true);assert.equal(c.duration,570);assert.equal(p.rows.length,1);assert.equal(c.timeline.some(x=>x.minute===970),false);
});
test('identity, legacy lifecycle, roles, preservation, daily snapshot and partial inclusion in a real isolated database',()=>isolatedDatabase(async({db,who,hr,read,write})=>{
 await who();const dep=(await read('reference')).departments[0].id;
 const e=await hr('employee.save',{name:'اختبار هوية دائمة',employee_number:'ADMIN-REF',department_id:dep,shift_id:null,direct_manager_id:null,employment_status:'active',phone:'07000000000',education:'اختبار'});
 assert.equal(e.phone,'07000000000');const permanent=e.internal_code;
 const row=(code='D1',name=e.name)=>({source_sheet:'Test',source_row:2,calendar_date:day,person_code:code,source_name:name,raw_values:['01:30','16:05'],punch_minutes:[90,965],invalid:false});
 let sequence=0;
 const preview=(rows=[row()],extra={})=>write('import.preview',{source_name:'Synthetic test.xls',source_hash:(++sequence).toString(16).padStart(64,'0'),device_namespace:'gate-A',import_kind:'daily',period_start:day,period_end:day,rows,...extra});
 const issues=async id=>(await db.query('select f.* from public.fingerprint_issues f join public.fingerprint_source_rows s on s.id=f.source_row_id where s.import_id=$1',[id])).rows;
 const sources=async id=>(await db.query('select * from public.fingerprint_source_rows where import_id=$1 order by source_row',[id])).rows;
 // Table inspection uses the local owner, never a production credential.
 const owner=async fn=>{await db.exec('reset role');try{return await fn();}finally{await who();}};
 const one=await preview([row('ADMIN-REF')]);
 let f=(await owner(()=>issues(one.id)))[0];assert.ok(f,'HR reference must never silently match a device code');
 await assert.rejects(write('issue.resolve',{id:f.id,version:f.version,state:'resolved',employee_id:e.id,resolution_note:''}),/سبب|إثبات/);
 await write('issue.resolve',{id:f.id,version:f.version,state:'resolved',employee_id:e.id,resolution_note:'Synthetic independent device register evidence'});
 await assert.rejects(write('issue.resolve',{id:f.id,version:f.version,state:'resolved',employee_id:e.id,resolution_note:'Stale attempt'}),/تعديل|تغير/);
 const known=await preview([row('ADMIN-REF')]);assert.equal((await owner(()=>sources(known.id)))[0].employee_id,e.id);
 const other=await preview([row('ADMIN-REF')],{device_namespace:'gate-B'});assert.equal((await owner(()=>sources(other.id)))[0].employee_id,null);
 const e2=await hr('employee.save',{name:'اختبار موظف آخر',employee_number:null,department_id:dep,shift_id:null,direct_manager_id:null,employment_status:'active'});
 const conflict=await preview([row('ADMIN-REF',e2.name)]);assert.equal((await owner(()=>sources(conflict.id)))[0].employee_id,null);
 const renamed=await hr('employee.save',{...e,name:'اسم الموظف الجديد'});assert.equal(renamed.id,e.id);assert.equal(renamed.internal_code,permanent);
 const afterRename=await preview([row('ADMIN-REF')]);assert.equal((await owner(()=>sources(afterRename.id)))[0].employee_id,e.id);
 await hr('employee.save',{...renamed,employment_status:'inactive'});
 const inactive=await preview([row('ADMIN-REF')]);assert.equal((await owner(()=>sources(inactive.id)))[0].employee_id,null);
 // Explicit source inclusion and frozen daily calculation, no synthetic HR absence.
 const partial=await preview([row('FRESH'),{...row('UNKNOWN','اسم بلا مرشح'),source_row:3}]);
 f=(await owner(()=>issues(partial.id)))[0];const fsource=(await owner(()=>sources(partial.id))).find(s=>s.id===f.source_row_id);
 if(fsource.source_row!==2)f=(await owner(()=>issues(partial.id)))[1];
 await write('issue.resolve',{id:f.id,version:f.version,state:'resolved',employee_id:e2.id,resolution_note:'Synthetic explicit manual evidence'});
 await db.query('select public.employee_assignment_record($1)',[{employee_id:e2.id,employee_version:e2.version,department_id:dep,employment_status:'active',valid_from:day,valid_to:day,reason:'Synthetic administrative assignment register'}]);
 await write('rule.save',{...rule,department_id:dep,default_manager_id:null});
 const applied=await write('import.apply',{id:partial.id,version:partial.version});assert.equal(applied.state,'applied');
 const daily=(await db.query('select public.attendance_daily_evidence($1) value',[{date:day}])).rows[0].value;
 const position=buildDailyPosition(daily,{employee_id:e2.id});assert.equal(position.rows[0].entry_minute,965);assert.equal(position.rows[0].duration_minutes,null);assert.equal(position.rows[0].calculation_basis,'approval_snapshot');assert.equal(position.unmatched_sources.length,1);
 const open=(await owner(()=>issues(partial.id))).find(i=>i.state==='open');
 for(const rpc of ['attendance_write','attendance_write_v2','attendance_write_v3','attendance_write_v4','attendance_write_v5'])for(const action of ['issue.resolve','issue.reprocess'])await assert.rejects(db.query(`select public.${rpc}($1,$2)`,[action,{id:open.id,version:open.version,state:'resolved',employee_id:e2.id,resolution_note:'Closed source attempt'}]),/مغلق|المعاينة/);
 await owner(async()=>{
  const s=(await sources(partial.id))[0];const original=JSON.stringify(s.raw_values);
  await assert.rejects(db.query('update public.fingerprint_source_rows set employee_id=$1 where id=$2',[e.id,s.id]),/مغلق/);
  await assert.rejects(db.query('update public.fingerprint_source_rows set punch_minutes=array[1] where id=$1',[s.id]),/الخام/);
  await assert.rejects(db.query('delete from public.fingerprint_source_rows where id=$1',[s.id]),/حذف/);
  assert.equal(JSON.stringify((await sources(partial.id))[0].raw_values),original);
 });
 // New monthly source requires explicit review and freezes identity at review.
 const monthly=await preview([row('MONTH',e2.name)],{import_kind:'monthly',period_start:'2026-09-01',period_end:'2026-09-30',coverage_start:day,coverage_end:day});
 const mf=(await owner(()=>issues(monthly.id)))[0];await write('issue.resolve',{id:mf.id,version:mf.version,state:'resolved',employee_id:e2.id,resolution_note:'Independent monthly register proof'});
 const reviewed=await write('import.review',{id:monthly.id,version:monthly.lifecycle_version});
 const resolved=(await owner(()=>issues(monthly.id)))[0];
 for(const rpc of ['attendance_write','attendance_write_v2','attendance_write_v3','attendance_write_v4','attendance_write_v5'])await assert.rejects(db.query(`select public.${rpc}($1,$2)`,['issue.resolve',{id:resolved.id,version:resolved.version,state:'resolved',employee_id:e.id,resolution_note:'Attempt after review'}]),/مغلق|المعاينة/);
 const approved=await write('import.approve',{id:monthly.id,version:reviewed.lifecycle_version});assert.equal(approved.lifecycle_state,'approved');
 await assert.rejects(write('import.approve',{id:monthly.id,version:reviewed.lifecycle_version}),/تغير|تغيير/);
 await assert.rejects(write('employee.merge',{source_employee_id:e.id,target_employee_id:e2.id,confirmed:true}),/الهوية/);
 const baseline=JSON.stringify((await db.query('select public.attendance_daily_evidence($1) value',[{date:day}])).rows[0].value.sources);
 for(const role of ['VIEWER','HR']){await who(role);if(role==='VIEWER')await assert.rejects(write('import.preview',{}),/صلاحية/);else await assert.rejects(write('rule.save',{...rule,department_id:dep}),/صلاحية/);}
 await who();await db.exec('reset role');await db.query('update public.profiles set is_active=false');await db.exec('set role authenticated');await assert.rejects(write('import.preview',{}),/صلاحية|نشط|الدخول|مفعل/);
 await db.exec('reset role');await db.query('update public.profiles set is_active=true');await who();assert.equal(JSON.stringify((await db.query('select public.attendance_daily_evidence($1) value',[{date:day}])).rows[0].value.sources),baseline);
 await db.exec('reset role');await db.exec('set role anon');await assert.rejects(db.query('select public.attendance_identity_registry($1)',[{employee_id:e.id}]),/permission denied/);
}));
