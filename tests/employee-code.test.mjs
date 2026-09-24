import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isolatedDatabase} from './helpers/isolated-db.mjs';

test('internal code backfill includes all statuses without changing employee content, revisions or audit history',()=>isolatedDatabase(async({db})=>{
 const before=(await db.query('select to_jsonb(e) value from public.employees e order by e.id')).rows;
 const audit=(await db.query('select count(*) n from public.audit_logs')).rows[0].n;
 await db.exec(await readFile('supabase/migrations/20260924181305_employee_internal_code.sql','utf8'));
 const after=(await db.query("select to_jsonb(e)-'internal_code' value from public.employees e order by e.id")).rows;
 assert.deepEqual(after,before);assert.equal((await db.query('select count(*) n from public.audit_logs')).rows[0].n,audit);
 const codes=(await db.query('select internal_code from public.employees')).rows.map(r=>r.internal_code);
 assert.equal(codes.length,206);assert.equal(new Set(codes).size,206);assert.ok(codes.every(c=>/^FANU-\d{6,}$/.test(c)));
},{beforeCode:true}));

test('concurrent employee creations receive independent codes; edits and inactive status never change the code',()=>isolatedDatabase(async({db,who,hr})=>{
 const dep=(await db.query('select id from public.departments limit 1')).rows[0].id;await who();
 const input={name:'موظف اصطناعي',employee_number:null,department_id:dep,shift_id:null,direct_manager_id:null,employment_status:'active'};
 const created=await Promise.all(Array.from({length:12},(_,i)=>hr('employee.save',{...input,name:`${input.name} ${i}`})));
 assert.equal(new Set(created.map(e=>e.internal_code)).size,12);
 const a=created[0];const changed=await hr('employee.save',{...input,id:a.id,version:a.version,name:'اسم اصطناعي جديد',employment_status:'resigned'});
 assert.equal(changed.internal_code,a.internal_code);assert.equal(changed.id,a.id);
}));

test('codes cannot be edited or manually supplied, and issued codes are not reused after an unused employee is deleted',()=>isolatedDatabase(async({db,who,hr})=>{
 const dep=(await db.query('select id from public.departments limit 1')).rows[0].id;await who();
 const a=await hr('employee.save',{name:'Synthetic unused',employee_number:null,department_id:dep,shift_id:null,direct_manager_id:null,employment_status:'active'});
 await assert.rejects(db.query("update public.employees set internal_code='FANU-999999' where id=$1",[a.id]),/permission denied/);
 await db.exec('reset role');await assert.rejects(db.query("update public.employees set internal_code='FANU-999999' where id=$1",[a.id]),/دائم/);
 await assert.rejects(db.query("insert into public.employees(name,department_id,employment_status,internal_code) values('Synthetic manual',$1,'active','FANU-999999')",[dep]),/آلياً/);
 await db.query('delete from public.employees where id=$1',[a.id]);
 await who();const b=await hr('employee.save',{name:'Synthetic next',employee_number:null,department_id:dep,shift_id:null,direct_manager_id:null,employment_status:'active'});
 assert.notEqual(b.internal_code,a.internal_code);assert.ok(Number(b.internal_code.slice(5))>Number(a.internal_code.slice(5)));
}));

test('internal-code search, details and HR exports/report payload preserve independent employee numbers',()=>isolatedDatabase(async({db,who,read})=>{
 const e=(await db.query('select * from public.employees order by id limit 1')).rows[0];await who();
 const page=await read('employees',{search:e.internal_code});assert.equal(page.total,1);assert.equal(page.rows[0].id,e.id);
 const detail=await read('employee',{id:e.id});assert.equal(detail.internal_code,e.internal_code);assert.equal(detail.employee_number,e.employee_number);
 const report=await read('report',{month:'2026-09',search:e.internal_code,include_inactive:'true'});assert.equal(report.rows.length,1);assert.equal(report.rows[0].internal_code,e.internal_code);
 await who('VIEWER');await assert.rejects(db.query("select nextval('hr_private.employee_internal_code_seq')"),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(read('employees',{}),/permission denied/);
}));
