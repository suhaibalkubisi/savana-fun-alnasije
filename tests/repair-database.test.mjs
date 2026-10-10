import test from 'node:test';import assert from 'node:assert/strict';
import {isolatedDatabase} from './helpers/isolated-db.mjs';
const day='2026-09-10';
const payload=(hash,code,name)=>({source_name:'synthetic.xls',source_hash:hash.repeat(64),device_namespace:'qa-device',import_kind:'daily',period_start:day,period_end:day,rows:[{source_sheet:'test',source_row:2,calendar_date:day,person_code:code,source_name:name,raw_values:['16:00'],punch_minutes:[960],invalid:false}]});
const meta=async(db,k,f={})=>(await db.query('select public.attendance_read_v5($1,$2) value',[k,f])).rows[0].value;
test('D03: zero linked source cannot cross approval boundary',()=>isolatedDatabase(async({who,write})=>{
 await who();const b=await write('import.preview',payload('1','UNKNOWN','Unverified synthetic name'));
 await assert.rejects(write('import.apply',{id:b.id,version:b.version}),/مرتبط|صفر|linked/);
}));
test('D05/D10/D12: mapping counts, scoped explicit reprocess, immutable cancelled history and retry',()=>isolatedDatabase(async({db,who,write,read})=>{
 await who();const e=(await read('employees')).rows[0];const data=payload('2','QA-ONE',e.name);
 const a=await write('import.preview',data);const b=await write('import.preview',{...data,source_hash:'3'.repeat(64)});
 const issue=(await meta(db,'issues',{import_id:a.id})).rows[0];
 await write('issue.resolve',{id:issue.id,version:issue.version,state:'resolved',employee_id:e.id,resolution_note:'Independent synthetic device register'});
 const current=(await meta(db,'import',{id:a.id})).batch;assert.equal(current.summary.matched,1);assert.equal(current.summary.unmatched,0);
 await write('import.reprocess',{id:b.id,version:b.version});
 const refreshed=(await meta(db,'import',{id:b.id})).batch;assert.equal(refreshed.summary.matched,1);
 await write('import.cancel',{id:a.id,version:current.version});
 const retry=await write('import.preview',data);assert.notEqual(retry.id,a.id);assert.equal(retry.state,'preview');
 assert.equal(retry.previous_attempt_id,a.id);assert.equal((await write('import.preview',data)).id,retry.id);
 assert.equal((await meta(db,'import',{id:a.id})).batch.state,'cancelled');
 await assert.rejects(write('import.reprocess',{id:a.id,version:current.version}),/مغلق|تغير|المعاينة/);
 await assert.rejects(write('import.preview',{...data,device_namespace:'other-device'}),/نطاق/);
}));
test('D04: historical correction and filters use dated assignment after transfer',()=>isolatedDatabase(async({db,who,read,hr})=>{
 await who();const e=(await read('employees')).rows[0];const refs=await read('reference');
 await db.query('select public.employee_assignment_record($1)',[{employee_id:e.id,employee_version:e.version,department_id:e.department_id,employment_status:'active',valid_from:'2026-09-01',valid_to:'2026-09-30',reason:'Independent historical organization evidence'}]);
 const a=await hr('status.save',{employee_id:e.id,department_id:e.department_id,record_date:day,status_type:'absence',late_minutes:null});
 const other=refs.departments.find(d=>d.id!==e.department_id).id;const moved=await hr('employee.save',{...e,department_id:other});
 const corrected=await hr('status.save',{...a,department_id:e.department_id,status_type:'leave'});assert.equal(corrected.id,a.id);
 assert.equal((await read('absence_leave',{month:'2026-09',department_id:e.department_id})).total,1);
 assert.equal((await read('absence_leave',{month:'2026-09',department_id:other})).total,0);
 assert.ok((await read('report',{month:'2026-09',department_id:e.department_id})).rows.some(r=>r.id===e.id));
 await assert.rejects(hr('status.save',{...a,department_id:e.department_id,status_type:'late',late_minutes:5}),/تعديل/);
 assert.equal(moved.internal_code,e.internal_code);
}));
test('D06/D09: full filtered export snapshot contains 195 rows and permanent code search',()=>isolatedDatabase(async({db,who,read,hr})=>{
 await who();const emps=(await read('employees')).rows.slice(0,7);
 for(const e of emps)await db.query('select public.employee_assignment_record($1)',[{employee_id:e.id,employee_version:e.version,department_id:e.department_id,employment_status:'active',valid_from:'2026-09-01',valid_to:'2026-09-30',reason:'Synthetic acceptance assignment'}]);
 for(let n=0;n<195;n++){const e=emps[Math.floor(n/30)];await hr('status.save',{employee_id:e.id,department_id:e.department_id,record_date:'2026-09-'+String(n%30+1).padStart(2,'0'),status_type:n<147?'absence':n<185?'absence3':'leave',late_minutes:null});}
 const page=await read('absence_leave',{month:'2026-09'});assert.equal(page.rows.length,50);assert.equal(page.total,195);
 const full=await read('absence_leave',{month:'2026-09',export_all:'true'});assert.equal(full.rows.length,195);assert.equal(new Set(full.rows.map(r=>r.id)).size,195);
 assert.deepEqual(full.kpis,{absence:147,absence2:0,absence3:38,leave:10,weighted:261});
 assert.ok(full.rows.every(r=>r.internal_code?.startsWith('FANU-')));
 assert.equal((await read('absence_leave',{month:'2026-09',search:emps[0].internal_code})).total,30);
 await who('VIEWER');await assert.rejects(hr('status.save',{employee_id:emps[0].id,department_id:emps[0].department_id,record_date:'2026-10-01',status_type:'absence'}),/صلاحية/);
 await assert.rejects(db.query('update public.employees set name=$1 where id=$2',['forbidden',emps[0].id]),/permission denied/);
}));


test('corrective attempt preserves closed raw evidence and requires separate replacement',()=>isolatedDatabase(async({db,who,read})=>{
 await who();const e=(await read('employees')).rows[0];
 const rpc=async(a,d)=>(await db.query('select public.attendance_write_v5($1,$2) value',[a,d])).rows[0].value;
 let b=await rpc('import.preview',payload('8','QA-CORRECT',e.name));
 const issue=(await meta(db,'issues',{import_id:b.id})).rows[0];
 await rpc('issue.resolve',{id:issue.id,version:issue.version,state:'resolved',employee_id:e.id,resolution_note:'Independent synthetic device register'});
 b=(await meta(db,'import',{id:b.id})).batch;
 await assert.rejects(rpc('import.apply',{id:b.id,version:b.version}),/انتماء|دوام|سياق|موثق|صالح/);
 await db.query('select public.employee_assignment_record($1)',[{employee_id:e.id,employee_version:e.version,department_id:e.department_id,employment_status:'active',valid_from:day,valid_to:day,reason:'Synthetic historical department register'}]);
 await rpc('rule.save',{department_id:e.department_id,effective_from:day,start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6],default_manager_id:null});
 const closed=await rpc('import.apply',{id:b.id,version:b.version});
 const evidence=async(id)=>(await meta(db,'import',{id})).rows.map(r=>[r.raw_values,r.punch_minutes,r.employee_id]);
 const raw=await evidence(closed.id);
 const next=await rpc('import.new_attempt',{id:closed.id,version:closed.version,reason:'Corrective review of preserved source'});
 assert.notEqual(next.id,closed.id);assert.equal(next.previous_attempt_id,closed.id);assert.equal(next.state,'preview');assert.equal(next.coverage_confirmed,false);
 assert.deepEqual(await evidence(next.id),raw);assert.deepEqual(await evidence(closed.id),raw);
 assert.equal((await rpc('import.new_attempt',{id:closed.id,version:closed.version,reason:'Safe retry'})).id,next.id);
 await assert.rejects(rpc('import.apply',{id:next.id,version:next.version}),/unique|duplicate|attendance_daily_applied_hash|الاستبدال الصريح/);
 await assert.rejects(rpc('import.reprocess',{id:closed.id,version:closed.version}),/مغلق|المعاينة/);
 const source=await rpc('source.save',{namespace:'qa-corrected-device',label:'Corrected test source',confirmation_reason:'Independent synthetic device catalog'});
 await who('HR');await assert.rejects(rpc('import.new_attempt',{id:closed.id,version:closed.version,reason:'Scope correction',device_source_id:source.id}),/صلاحية/);await who();
 await rpc('import.cancel',{id:next.id,version:next.version});
 const corrected=await rpc('import.new_attempt',{id:closed.id,version:closed.version,reason:'Scope catalog correction',device_source_id:source.id});
 assert.equal(corrected.device_namespace,'qa-corrected-device');assert.equal(corrected.summary.matched,0);assert.deepEqual((await evidence(corrected.id)).map(r=>r.slice(0,2)),raw.map(r=>r.slice(0,2)));
 assert.equal((await meta(db,'import',{id:closed.id})).batch.state,'applied');
}));
test('bulk history rejects whole batch on stale employee revision',()=>isolatedDatabase(async({db,who,read})=>{
 await who();const emps=(await read('employees')).rows.slice(0,2);
 const rows=emps.map(e=>({employee_id:e.id,employee_version:e.version,department_id:e.department_id,employment_status:'active',valid_from:day,valid_to:day,reason:'Independent synthetic historical register'}));
 rows[1].employee_version+=100;
 await assert.rejects(db.query('select public.employee_assignment_bulk($1)',[{confirmed:true,rows}]),/تغير|تعديل|إصدار/);
 const gap=(await db.query('select public.attendance_period_gaps($1) value',[{month:'2026-09'}])).rows[0].value;
 assert.ok(emps.every(e=>gap.rows.some(r=>r.employee_id===e.id&&r.reason==='missing_assignment')));
 rows[1].employee_version=emps[1].version;
 await db.query('select public.employee_assignment_bulk($1)',[{confirmed:true,rows}]);
 const after=(await db.query('select public.attendance_period_gaps($1) value',[{month:'2026-09'}])).rows[0].value;
 assert.ok(emps.every(e=>!after.rows.some(r=>r.employee_id===e.id&&r.reason==='missing_assignment'&&r.dates.includes(day))));
}));
