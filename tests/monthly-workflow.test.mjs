import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './helpers/isolated-db.mjs';
import {buildMonthlyPosition} from '../lib/hr/monthly-position.mjs';
const month='2026-09';
async function fixture(ctx){
 const {db,who,hr,write}=ctx;const dep=(await db.query('select id from public.departments limit 1')).rows[0].id;
 await who();const e=await hr('employee.save',{name:'Synthetic monthly employee',employee_number:'TEST-DEVICE',department_id:dep,shift_id:null,direct_manager_id:null,employment_status:'active'});
 await write('rule.save',{department_id:dep,effective_from:'2026-09-01',start_minute:960,grace_minutes:15,entry_window_start:720,entry_window_end:1439,working_weekdays:[0,1,2,3,4,5,6],default_manager_id:null});
 const row=(date,minutes,name=e.name,code=e.employee_number)=>({source_sheet:'Punch Record',source_row:2,calendar_date:date,person_code:code,source_name:name,raw_values:[code,name,date,minutes.map(m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`).join('\n')],punch_minutes:minutes,invalid:false});
 const data={source_name:'Synthetic monthly.xlsx',source_hash:'a'.repeat(64),import_kind:'monthly',period_start:'2026-09-01',period_end:'2026-09-30',coverage_start:'2026-09-10',coverage_end:'2026-09-11',rows:[row('2026-09-10',[965,1000]),row('2026-09-11',[90,970]),row('2026-09-12',[100])]};
 return {e,data,row};
}
const scalar=async(db,sql)=>{await db.exec('reset role');try{return (await db.query(sql)).rows[0].n;}finally{await db.exec('set role authenticated');}};
test('immediate inspection is read-only and matches saved preview calculations, raw evidence and stable codes',()=>isolatedDatabase(async ctx=>{
 const {db,write,evidence}=ctx;const {e,data}=await fixture(ctx);
 const before=await scalar(db,'select count(*) n from public.audit_logs');
 const inspect=(await db.query('select public.attendance_inspect_monthly($1) value',[data])).rows[0].value;
 assert.equal(await scalar(db,'select count(*) n from public.attendance_imports'),0);
 assert.equal(await scalar(db,'select count(*) n from public.audit_logs'),before);
 const local=buildMonthlyPosition(inspect);assert.equal(local.rows[0].internal_code,e.internal_code);
 const batch=await write('import.preview',data);const saved=buildMonthlyPosition(await evidence({month,import_id:batch.id}));
 assert.deepEqual(saved.source_counts,local.source_counts);assert.deepEqual(saved.metrics,local.metrics);
 assert.equal(saved.rows[0].cells['10'].exit,90);assert.equal(saved.rows[0].cells['10'].duration,565);
 assert.equal(saved.rows[0].cells['11'].entry,970);assert.equal(saved.rows[0].cells['11'].exit,100);
 assert.equal(saved.rows[0].cells['12'].state,'outside_coverage');
 assert.equal((await evidence({month})).available,false);
}));
test('review, approval, replacement and cancellation preserve raw sources and manual HR; daily imports never enter monthly totals',()=>isolatedDatabase(async ctx=>{
 const {db,write,evidence,hr}=ctx;const {e,data,row}=await fixture(ctx);
 await hr('status.save',{employee_id:e.id,department_id:e.department_id,record_date:'2026-09-10',status_type:'leave',notes:'Synthetic manual leave',late_minutes:null});
 const batch=await write('import.preview',data);
 await assert.rejects(write('import.apply',{id:batch.id,version:batch.version}),/مراجعة/);
 const reviewed=await write('import.review',{id:batch.id,version:batch.lifecycle_version});
 await write('import.approve',{id:batch.id,version:reviewed.lifecycle_version});
 const approved=buildMonthlyPosition(await evidence({month}));assert.equal(approved.batch.lifecycle_state,'approved');assert.equal(approved.rows[0].cells['10'].manual.status_type,'leave');
 const daily=await write('import.preview',{...data,source_hash:'b'.repeat(64),import_kind:'daily',period_start:'2026-09-10',period_end:'2026-09-10',rows:[row('2026-09-10',[800,1100])]});
 await write('import.apply',{id:daily.id,version:daily.version});
 assert.deepEqual(buildMonthlyPosition(await evidence({month})).metrics,approved.metrics);
 const again=await write('import.preview',{...data,coverage_end:'2026-09-30'});assert.equal(again.duplicate,true);
 assert.equal((await evidence({month})).batch.coverage_end,'2026-09-11');
 const next=await write('import.preview',{...data,source_hash:'c'.repeat(64),rows:[row('2026-09-10',[960,1200])]});
 const nextReview=await write('import.review',{id:next.id,version:next.lifecycle_version});
 const current=(await evidence({month})).batch;
 await write('import.supersede',{id:batch.id,version:current.lifecycle_version,replacement_id:next.id,replacement_version:nextReview.lifecycle_version});
 assert.equal((await evidence({month})).batch.id,next.id);
 assert.equal((await evidence({month,import_id:batch.id})).batch.lifecycle_state,'superseded');
 const cancelled=await write('import.preview',{...data,source_hash:'d'.repeat(64)});await write('import.cancel',{id:cancelled.id,version:cancelled.version});
 assert.equal((await evidence({month,import_id:cancelled.id})).batch.lifecycle_state,'cancelled');
 assert.equal(await scalar(db,'select count(*) n from public.hr_status_records where deleted_at is null'),1);
 assert.equal(await scalar(db,'select count(*) n from public.fingerprint_source_rows'),8);
}));
test('inspection and approval reject unauthorized roles and blocking identity issues without persistent inspection writes',()=>isolatedDatabase(async ctx=>{
 const {db,write,who}=ctx;const {data,row}=await fixture(ctx);
 const input={...data,rows:[row('2026-09-10',[960],'Synthetic unknown','UNMATCHED-TEST')]};
 const inspected=buildMonthlyPosition((await db.query('select public.attendance_inspect_monthly($1) value',[input])).rows[0].value);
 assert.equal(inspected.source_counts.matched_identities,0);assert.equal(inspected.rows[0].cells['10'].duration,null);
 const batch=await write('import.preview',input);await assert.rejects(write('import.review',{id:batch.id,version:batch.lifecycle_version}),/مشاكل المطابقة/);
 await who('VIEWER');await assert.rejects(db.query('select public.attendance_inspect_monthly($1)',[input]),/صلاحية/);
 await assert.rejects(write('import.approve',{id:batch.id,version:batch.lifecycle_version}),/صلاحية/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select public.attendance_monthly_evidence($1)',[{month}]),/permission denied/);
}));
test('concurrent duplicate previews preserve one batch and review; internal codes do not become device mappings',()=>isolatedDatabase(async ctx=>{
 const {db,write}=ctx;const {data,row,e}=await fixture(ctx);
 const values=await Promise.all([write('import.preview',data),write('import.preview',data)]);
 assert.equal(values[0].id,values[1].id);assert.equal(await scalar(db,'select count(*) n from public.attendance_import_reviews'),1);
 const inspected=buildMonthlyPosition((await db.query('select public.attendance_inspect_monthly($1) value',[{...data,rows:[row('2026-09-10',[960],'Unknown code-only',e.internal_code)]}])).rows[0].value);
 assert.equal(inspected.source_counts.matched_identities,0);
}));
