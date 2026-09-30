// Local, in-memory recovery rehearsal. Never connects to Supabase or opens a network port.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(process.argv[2]!=='--local-only')throw Error('Requires --local-only and private checkpoint paths');
const {checkpoint,recovery:r}=JSON.parse(await readFile(process.argv[3],'utf8'));
const profiles=JSON.parse(await readFile(process.argv[4],'utf8'));
const db=new PGlite();
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 const names=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
 const rebuild=names.find(n=>n.includes('rebuild_calculation_integrity'));
 for(const n of names){if(n===rebuild)break;await db.exec(await readFile('supabase/migrations/'+n,'utf8'));}
 // Baseline migrations contain initial organization rows. This database exists
 // only in memory; empty it before restoring the checkpoint's exact identities.
 await db.exec('truncate public.departments,public.shifts cascade');
 await db.exec("set timezone='UTC'");
 const tables=['profiles','departments','shifts','employees','managers','attendance_department_rules','attendance_imports','attendance_import_reviews'];
 for(const t of tables)await db.exec(`alter table public.${t} disable trigger user`);
 for(const p of profiles)await db.query("insert into auth.users values($1,$2,'{}')",[p.id,p.email]);
 // Auth/profile tables are unchanged by this release. Represent new referenced
 // actor parents only in memory, without exporting credentials or creating users.
 const actorIds=new Set(Object.values(r).filter(Array.isArray).flatMap(rows=>rows.flatMap(row=>Object.entries(row).filter(([key,value])=>key.endsWith('_by')&&typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value)).map(([,value])=>value))));
 const placeholderActors=[...actorIds].filter(id=>!profiles.some(p=>p.id===id));
 for(const id of placeholderActors){
  await db.query("insert into auth.users values($1,$2,'{}')",[id,`rehearsal-${id}@example.invalid`]);
  await db.query("insert into public.profiles(id,email,name,role,is_active) values($1,$2,'Local recovery actor placeholder','VIEWER',false) on conflict(id) do nothing",[id,`rehearsal-${id}@example.invalid`]);
 }
 async function restore(table,rows){
  if(!rows?.length)return;
  const columns=Object.keys(rows[0]);const names=columns.map(c=>'"'+c+'"').join(',');
  const updates=columns.filter(c=>c!=='id').map(c=>'"'+c+'"=excluded."'+c+'"').join(',');
  await db.query(`insert into public.${table} (${names}) select ${names} from jsonb_populate_recordset(null::public.${table},$1::jsonb) on conflict(id) do update set ${updates}`,[JSON.stringify(rows)]);
 }
 await restore('profiles',profiles);await restore('departments',r.departments);await restore('shifts',r.shifts);
 await restore('employees',r.employees.map(e=>({...e,direct_manager_id:null})));
 await restore('managers',r.managers);await restore('employees',r.employees);
 await restore('attendance_department_rules',r.rules);await restore('attendance_imports',r.imports);await restore('attendance_import_reviews',r.reviews);
 for(const t of tables)await db.exec(`alter table public.${t} enable trigger user`);
 await db.query("select setval('hr_private.employee_internal_code_seq', $1, true)",[Math.max(...r.employees.map(e=>Number(e.internal_code.slice(5))))]);
 const restored=(await db.query('select jsonb_agg(to_jsonb(e) order by id) data from public.employees e')).rows[0].data;
 if(JSON.stringify(restored)!==JSON.stringify(r.employees)){const differences=restored.flatMap((e,i)=>Object.keys({...e,...r.employees[i]}).filter(k=>JSON.stringify(e[k])!==JSON.stringify(r.employees[i][k])));console.log('Changed field names:',[...new Set(differences)]);}
 assert.deepEqual(restored,r.employees,'full employee rows, revisions and identities restore exactly');
 const checksum=async()=>(await db.query("select md5(string_agg(id::text||internal_code,'' order by id)) checksum from public.employees")).rows[0].checksum;
 assert.equal(await checksum(),checkpoint.employee_identity_checksum);
 const restoredImports=(await db.query('select jsonb_agg(to_jsonb(i) order by id) data from public.attendance_imports i')).rows[0].data;
 assert.deepEqual(restoredImports,r.imports);
 for(const f of r.functions.filter(f=>f.schema==='public'&&['attendance_write','attendance_write_v3','attendance_write_v4','attendance_inspect_monthly'].includes(f.name)))await db.exec(f.definition);
 for(const migration of names.filter(n=>n>=rebuild))await db.exec(await readFile('supabase/migrations/'+migration,'utf8'));
 assert.equal((await db.query("select has_function_privilege('authenticated','public.attendance_read_v4(text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 assert.equal(await checksum(),checkpoint.employee_identity_checksum);
 assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(e) order by id) data from public.employees e')).rows[0].data,restored);
 assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(i) order by id) data from public.attendance_imports i')).rows[0].data,restoredImports);
 const history=(await db.query('select count(*)::int n from public.employee_assignment_history')).rows[0].n;
 assert.equal(history,r.employees.length);
 const result={at:new Date().toISOString(),placeholder_auth_parents:placeholderActors.length,scope:'Affected employee, organization, rule, import, review tables and replaced function definitions. Raw punches and audit history are not rewritten by this release and are checkpointed separately.',restored_employees:restored.length,restored_imports:restoredImports.length,history_rows:history,employee_checksum:await checksum(),result:'passed'};
 await writeFile('outputs/rebuild/recovery-rehearsal.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({result:'failed',code:error.code,message:error.message,constraint:error.constraint}));process.exitCode=1;}finally{await db.close();}
