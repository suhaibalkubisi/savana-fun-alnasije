import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Disposable synthetic data only: never connect to a project or retained employee database.
const ids={admin:'11111111-1111-4111-8111-111111111111',supervisor:'22222222-2222-4222-8222-222222222222',followup:'33333333-3333-4333-8333-333333333333',viewer:'44444444-4444-4444-8444-444444444444',d1:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d2:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',shift:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const fixture=`
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table profiles(id uuid primary key,name text,email text,role text,is_active boolean,version int default 1);
create table departments(id uuid primary key default gen_random_uuid(),arabic_name text,english_name text,display_order int default 10,is_active boolean default true);
create table shifts(id uuid primary key,name text);
create table employees(id uuid primary key,name text,internal_code text unique,employee_number text,department_id uuid references departments(id),shift_id uuid references shifts(id),employment_status text default 'active',version int default 1);
create table employee_assignment_history(id uuid primary key,employee_id uuid,department_id uuid,shift_id uuid,employment_status text,valid_from date,valid_to date,voided_at timestamptz);
create table attendance_imports(id uuid primary key); create table fingerprint_source_rows(id uuid primary key,import_id uuid);
insert into profiles values('${ids.admin}','Synthetic admin','admin@example.invalid','ADMIN',true,1),('${ids.supervisor}','Synthetic supervisor','supervisor@example.invalid','VIEWER',true,1),('${ids.followup}','Synthetic followup','followup@example.invalid','VIEWER',true,1),('${ids.viewer}','Synthetic viewer','viewer@example.invalid','VIEWER',true,1);
insert into auth.sessions select id,id,null from profiles;
insert into departments(id,arabic_name) values('${ids.d1}','Synthetic department A'),('${ids.d2}','Synthetic department B');
insert into shifts values('${ids.shift}','Synthetic shift');
insert into employees(id,name,internal_code,department_id) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Synthetic employee '||i,'FANU-'||lpad(i::text,6,'0'),'${ids.d1}' from generate_series(1,20)i;
`;

async function isolated(run){
  const db=new PGlite();
  try{
    await db.exec(fixture);
    await db.exec(await fs.readFile(new URL('../supabase/followup-rebuild.sql',import.meta.url),'utf8'));
    await db.exec(`insert into fu_accounts values('${ids.supervisor}','SUPERVISOR',true,1),('${ids.followup}','FOLLOWUP',true,1),('${ids.viewer}','VIEWER',true,1); insert into fu_departments values('${ids.supervisor}','${ids.d1}'),('${ids.followup}','${ids.d1}'),('${ids.viewer}','${ids.d1}'); grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    const who=async(user,session=user)=>{
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:session})]);
      await db.exec('set role authenticated');
    };
    const read=async(kind,filters={})=>(await db.query('select followup_read($1,$2) data',[kind,filters])).rows[0].data;
    const write=async(kind,data,request=crypto.randomUUID())=>(await db.query('select followup_write($1,$2,$3) data',[kind,data,request])).rows[0].data;
    const root=async(sql,params=[])=>{await db.exec('reset role'); return db.query(sql,params);};
    const base=(date='2026-12-01')=>({department_id:ids.d1,work_date:date,shift_id:null,reporter_id:ids.supervisor,channel:'account',entries:[]});
    const stats=async()=> (await root('select (select count(*) from fu_reports)::int reports,(select count(*) from fu_revisions)::int revisions,(select count(*) from fu_requests)::int requests,(select count(*) from fu_final)::int final')).rows[0];
    await who(ids.supervisor);
    await run({db,who,read,write,root,base,stats});
  }finally{await db.close();}
}

test('cached writes recheck current department, write role, account and session authorization',()=>isolated(async({who,read,write,root,base,stats})=>{
  const data=base(); const request=crypto.randomUUID();
  const report=await write('save',data,request);
  assert.deepEqual(await write('save',data,request),report);
  await assert.rejects(write('submit',data,request),/معرّف/);
  const before=await stats();
  await root('delete from fu_departments where user_id=$1 and department_id=$2',[ids.supervisor,ids.d1]);
  await who(ids.supervisor);
  await assert.rejects(write('save',data,request),{code:'42501'});
  await assert.rejects(read('reports',{department_id:ids.d1,start:data.work_date}),{code:'42501'});
  await root('insert into fu_departments values($1,$2)',[ids.supervisor,ids.d1]);
  await root("update fu_accounts set role='VIEWER' where user_id=$1",[ids.supervisor]);
  await who(ids.supervisor);
  await assert.rejects(write('save',data,request),{code:'42501'});
  await root("update fu_accounts set role='SUPERVISOR',active=false where user_id=$1",[ids.supervisor]);
  await who(ids.supervisor);
  await assert.rejects(write('save',data,request),{code:'42501'});
  await root('update fu_accounts set active=true where user_id=$1',[ids.supervisor]);
  await root('delete from auth.sessions where user_id=$1',[ids.supervisor]);
  await who(ids.supervisor);
  await assert.rejects(write('save',data,request),{code:'42501'});
  assert.deepEqual(await stats(),before,'denied replay must not change persisted data');
}));

test('cached privileged review and other-reporter writes are denied after a role downgrade',()=>isolated(async({who,write,root,base})=>{
  let report=await write('submit',base());
  await who(ids.followup);
  const review={...base(),id:report.id,version:report.version}; const reviewRequest=crypto.randomUUID();
  report=await write('review',review,reviewRequest);
  assert.equal(report.state,'reviewed');
  const entered={...base('2026-12-02'),channel:'phone'}; const saveRequest=crypto.randomUUID();
  const behalf=await write('save',entered,saveRequest);
  assert.equal(behalf.entered_by,ids.followup);
  await root("update fu_accounts set role='SUPERVISOR' where user_id=$1",[ids.followup]);
  await who(ids.followup);
  await assert.rejects(write('review',review,reviewRequest),{code:'42501'});
  await assert.rejects(write('save',entered,saveRequest),{code:'42501'});
}));

test('cached administrator configuration and action writes retain their current authorization requirements',()=>isolated(async({who,read,write,root})=>{
  await who(ids.admin);
  const configuration=[
    ['policy',{code:'late',label:'Synthetic configured status',category:'other',weight:0,enabled:true}],
    ['department',{name:'Synthetic department C'}],
    ['account',{user_id:ids.viewer,role:'VIEWER',active:true,version:1,departments:[ids.d1]}],
  ];
  const requests=[];
  for(const [kind,data] of configuration){const request=crypto.randomUUID(); await write(kind,data,request); requests.push([kind,data,request]);}
  await root("update fu_accounts set role='FOLLOWUP' where user_id=$1",[ids.admin]);
  await who(ids.admin);
  for(const [kind,data,request] of requests) await assert.rejects(write(kind,data,request),{code:'42501'});

  await who(ids.followup);
  const action=await write('action',{department_id:ids.d1,description:'Synthetic non-owned task',responsible_id:ids.supervisor,due_date:'2026-12-03'});
  const update={...action,state:'progress'}; const request=crypto.randomUUID();
  await write('action',update,request);
  await root("update fu_accounts set role='SUPERVISOR' where user_id=$1",[ids.followup]);
  await who(ids.followup);
  await assert.rejects(write('action',update,request),{code:'42501'});
  assert.equal((await read('actions',{department_id:ids.d1})).length,1,'scope still permits reading but does not grant modification rights');
}));

test('report, action and existing account updates require current versions and failed writes roll back',()=>isolated(async({who,write,read,base,stats})=>{
  const report=await write('save',base());
  const before=await stats();
  for(const version of [undefined,null,report.version-1]){
    const data={...base(),id:report.id,version,note:'Must never persist'};
    await who(ids.supervisor);
    await assert.rejects(write('save',data),{code:'PT409'});
    assert.deepEqual(await stats(),before);
  }
  await who(ids.admin);
  let action=await write('action',{department_id:ids.d1,description:'Synthetic task',responsible_id:ids.supervisor,due_date:'2026-12-03'});
  for(const version of [undefined,null,action.version-1]){
    await assert.rejects(write('action',{...action,version,state:'progress'}),{code:'PT409'});
  }
  action=await write('action',{...action,state:'progress'});
  assert.equal(action.version,2);
  await assert.rejects(write('account',{user_id:ids.supervisor,role:'SUPERVISOR',active:true,departments:[ids.d1]}),{code:'PT409'});
  const users=(await read('bootstrap')).users;
  assert.equal(users.find(user=>user.id===ids.supervisor).version,1);
  const saved=(await read('reports',{start:'2026-12-01'}))[0];
  assert.equal(saved.note,''); assert.equal(saved.version,report.version);
}));

test('only submitted or reviewed declarations contribute final position; every correction retains revisions',()=>isolated(async({who,read,write,base,stats})=>{
  const roster=await read('roster',{department_id:ids.d1,start:'2026-12-01'});
  const data={...base(),entries:roster.map((employee,i)=>({employee_id:employee.id,status:i<15?'present':i<17?'absent1':i===17?'absent3':i===18?'leave':'unresolved'}))};
  const position=()=>read('position',{department_id:ids.d1,start:data.work_date});
  let report=await write('save',data);
  let rows=await position();
  assert.equal(rows.length,20); assert.ok(rows.every(row=>row.status==='unresolved'&&row.review_state==='draft'));
  report=await write('submit',{...data,id:report.id,version:report.version});
  rows=await position();
  const counts={expected:rows.length,present:0,absent:0,leave:0,other:0,unresolved:0,weighted:0};
  const statuses=(await read('bootstrap')).statuses;
  for(const row of rows){const status=statuses.find(status=>status.code===row.status); counts[status.category]++; if(status.category==='absent') counts.weighted+=status.weight;}
  assert.deepEqual(counts,{expected:20,present:15,absent:3,leave:1,other:0,unresolved:1,weighted:5});
  assert.ok(rows.every(row=>row.review_state==='submitted'&&row.completeness==='partial'));
  await who(ids.followup);
  report=await write('return',{...data,id:report.id,version:report.version,reason:'Synthetic correction request'});
  rows=await position();
  assert.ok(rows.every(row=>row.status==='unresolved'&&row.review_state==='returned'));
  assert.equal(report.entries.filter(entry=>entry.status==='present').length,15,'return retains the actual declaration snapshot');
  await who(ids.supervisor);
  report=await write('submit',{...data,id:report.id,version:report.version,entries:[{employee_id:roster[19].id,status:'present'}]});
  await who(ids.followup);
  report=await write('review',{...data,id:report.id,version:report.version});
  assert.ok((await position()).every(row=>row.review_state==='reviewed'&&row.completeness==='complete'));
  report=await write('revise',{...data,id:report.id,version:report.version,reason:'Synthetic post-review correction'});
  assert.ok((await position()).every(row=>row.status==='unresolved'&&row.review_state==='draft'));
  const revisions=await read('revisions',{id:report.id});
  assert.equal(revisions.length,5);
  assert.ok(revisions.some(revision=>revision.reason==='Synthetic post-review correction'&&revision.actor===ids.followup&&revision.snapshot.state==='reviewed'));
  assert.equal(new Set(revisions.map(revision=>revision.version)).size,revisions.length);
  assert.equal((await stats()).final,0);
}));

test('dated outgoing transfer blocks submission until reconciliation without modifying employee identities',()=>isolated(async({who,read,write,root,base,stats})=>{
  const roster=await read('roster',{department_id:ids.d1,start:'2026-12-01'});
  const baseline=(await root('select id,internal_code,name,department_id from employees order by id')).rows;
  await who(ids.supervisor);
  const data={...base(),entries:roster.map(employee=>({employee_id:employee.id,status:'present'}))};
  let report=await write('save',data);
  await root("insert into employee_assignment_history(id,employee_id,department_id,employment_status,valid_from) values(gen_random_uuid(),$1,$2,'active','2026-12-01')",[roster[0].id,ids.d2]);
  const before=await stats();
  await who(ids.supervisor);
  await assert.rejects(write('submit',{...data,id:report.id,version:report.version}),/تغيرت قائمة/);
  assert.deepEqual(await stats(),before,'rejected stale roster must roll back entries, revisions and retry records');
  await who(ids.supervisor);
  report=await write('reconcile',{...data,id:report.id,version:report.version,reason:'Synthetic dated transfer reconciliation'});
  assert.equal(report.entries.length,19); assert.ok(report.entries.every(entry=>entry.status==='present'));
  report=await write('submit',{...data,id:report.id,version:report.version,entries:report.entries});
  await who(ids.admin);
  const transferred=await write('submit',{...base(),department_id:ids.d2,reporter_id:ids.admin,entries:[{employee_id:roster[0].id,status:'leave'}]});
  assert.equal(transferred.entries.length,1);
  const rows=await read('position',{start:'2026-12-01'});
  assert.equal(rows.length,20); assert.equal(new Set(rows.map(row=>row.employee_id)).size,20);
  assert.equal(rows.filter(row=>row.status==='present').length,19); assert.equal(rows.filter(row=>row.status==='leave').length,1);
  const revisions=await read('revisions',{id:report.id});
  assert.ok(revisions.some(revision=>revision.snapshot.entries.length===20&&revision.reason==='Synthetic dated transfer reconciliation'));
  assert.deepEqual((await root('select id,internal_code,name,department_id from employees order by id')).rows,baseline);
}));

test('an incoming transfer missing from a complete submitted snapshot remains a visible roster exception',()=>isolated(async({who,read,write,root,base})=>{
  const roster=await read('roster',{department_id:ids.d1,start:'2026-12-01'});
  await write('submit',{...base(),entries:roster.map(employee=>({employee_id:employee.id,status:'present'}))});
  const incoming='99999999-9999-4999-8999-999999999999';
  await root('insert into employees(id,name,internal_code,department_id) values($1,$2,$3,$4)',[incoming,'Synthetic incoming employee','FANU-000021',ids.d2]);
  await root("insert into employee_assignment_history(id,employee_id,department_id,employment_status,valid_from) values(gen_random_uuid(),$1,$2,'active','2026-12-01')",[incoming,ids.d1]);
  await who(ids.supervisor);
  const rows=await read('position',{department_id:ids.d1,start:'2026-12-01'});
  const missing=rows.find(row=>row.employee_id===incoming);
  assert.equal(rows.length,21); assert.equal(missing.status,'unresolved');
  assert.equal(missing.review_state,'submitted');
  assert.equal(missing.completeness,'exception','a current roster member omitted from the submitted snapshot cannot be marked complete');
}));

test('a dated assignment with no shift does not inherit the current employee shift',()=>isolated(async({who,read,root})=>{
  const first=(await read('roster',{department_id:ids.d1,start:'2026-12-01'}))[0];
  await root('update employees set shift_id=$1 where id=$2',[ids.shift,first.id]);
  await root("insert into employee_assignment_history(id,employee_id,department_id,shift_id,employment_status,valid_from,valid_to) values(gen_random_uuid(),$1,$2,null,'active','2026-12-01','2026-12-01')",[first.id,ids.d1]);
  await who(ids.supervisor);
  const dated=(await read('roster',{department_id:ids.d1,start:'2026-12-01'})).find(employee=>employee.id===first.id);
  assert.equal(dated.effective_shift,null,'the explicit historical null shift is authoritative');
  assert.equal((await read('roster',{department_id:ids.d1,start:'2026-12-01',shift_id:ids.shift})).length,0);
  const position=(await read('position',{department_id:ids.d1,start:'2026-12-01'})).find(employee=>employee.employee_id===first.id);
  assert.equal(position.shift_id,null);
  const fallback=(await read('roster',{department_id:ids.d1,start:'2026-12-02'})).find(employee=>employee.id===first.id);
  assert.equal(fallback.effective_shift,ids.shift,'current shift is used when no dated assignment covers the day');
}));

test('supervisor can update assigned action progress but cannot change responsibility or description',()=>isolated(async({who,read,write})=>{
  await who(ids.admin);
  const action=await write('action',{department_id:ids.d1,description:'Synthetic assigned task',responsible_id:ids.supervisor,due_date:'2026-12-03'});
  const other=await write('action',{department_id:ids.d1,description:'Synthetic other task',responsible_id:ids.followup,due_date:'2026-12-03'});
  await who(ids.supervisor);
  await assert.rejects(write('action',{...action,description:'Unapproved replacement',state:'progress'}),{code:'42501'});
  await assert.rejects(write('action',{...action,responsible_id:ids.followup,state:'progress'}),{code:'42501'});
  await assert.rejects(write('action',{...other,state:'progress'}),{code:'42501'});
  await assert.rejects(write('action',{...action,state:'completed',completion:'   '}),/تفاصيل الإنجاز/);
  const completed=await write('action',{...action,state:'completed',completion:'Synthetic completion evidence',notes:'Synthetic note'});
  assert.equal(completed.version,2);
  const activity=(await read('actions',{department_id:ids.d1})).find(row=>row.id===action.id).activity;
  assert.equal(activity.length,2); assert.equal(activity[0].actor,ids.admin); assert.equal(activity[1].actor,ids.supervisor);
  assert.ok(activity.every(item=>item.at&&item.actor_name),'activity history identifies each synthetic actor');
}));
