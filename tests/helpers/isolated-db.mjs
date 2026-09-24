import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
export async function isolatedDatabase(run,{beforeCode=false}={}) {
 const db=new PGlite();
 const admin='11111111-1111-4111-8111-111111111111';
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for (const n of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
   if(beforeCode&&n>='20260924181305')continue;
   await db.exec(await readFile(`supabase/migrations/${n}`,'utf8'));
  }
  await db.exec("set hr.test_fixture='on'");await db.exec(await readFile('supabase/seed.sql','utf8'));
  await db.query("insert into auth.users values($1,'test-admin@example.invalid','{}')",[admin]);
  await db.query("update public.profiles set role='ADMIN',is_active=true where id=$1",[admin]);
  const who=async(role='ADMIN')=>{
   await db.exec('reset role');await db.query('update public.profiles set role=$1 where id=$2',[role,admin]);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);await db.exec('set role authenticated');
  };
  const hr=async(action,data)=>(await db.query('select public.hr_write_v2($1,$2) value',[action,data])).rows[0].value;
  const read=async(kind,filters={})=>(await db.query('select public.hr_read_v4($1,$2) value',[kind,filters])).rows[0].value;
  const write=async(action,data)=>(await db.query('select public.attendance_write_v4($1,$2) value',[action,data])).rows[0].value;
  const evidence=async(filters)=>(await db.query('select public.attendance_monthly_evidence($1) value',[filters])).rows[0].value;
  await run({db,admin,who,hr,read,write,evidence});
 } finally {await db.close();}
}
