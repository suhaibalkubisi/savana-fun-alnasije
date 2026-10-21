import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
export async function isolatedDatabase(run,{beforeCode=false,beforeRepair=false,throughMigration=null,dataDir}={}) {
 const db=new PGlite(dataDir);
 const admin='11111111-1111-4111-8111-111111111111';
 try {
  const fresh=!(await db.query("select to_regclass('public.employees') as value")).rows[0].value;
  if(fresh){
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   -- Supabase supplies Storage outside application migrations. Model its platform
   -- tables in isolation so candidate storage policies are tested, not skipped.
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
   alter table storage.objects enable row level security;
   grant usage on schema auth,storage to authenticated;
   grant execute on function auth.uid() to authenticated;
   grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const n of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
   if(beforeCode&&n>='20260924181305')continue;
   if(beforeRepair&&n>='20261004')continue;
   if(throughMigration&&n>throughMigration)continue;
   await db.exec(await readFile(`supabase/migrations/${n}`,'utf8'));
  }
  await db.exec("set hr.test_fixture='on'");await db.exec(await readFile('supabase/seed.sql','utf8'));
  await db.query("insert into auth.users values($1,'test-admin@example.invalid','{}')",[admin]);
  await db.query("update public.profiles set role='ADMIN',is_active=true where id=$1",[admin]);
  }
  const who=async(role='ADMIN')=>{
   await db.exec('reset role');await db.query('update public.profiles set role=$1 where id=$2',[role,admin]);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);await db.exec('set role authenticated');
  };
  const hr=async(action,data)=>(await db.query('select public.hr_write_v2($1,$2) value',[action,data])).rows[0].value;
  const read=async(kind,filters={})=>(await db.query('select public.hr_read_v4($1,$2) value',[kind,filters])).rows[0].value;
  const write=async(action,data)=>(await db.query('select public.attendance_write_v4($1,$2) value',[action,data])).rows[0].value;
  const evidence=async(filters)=>(await db.query('select public.attendance_monthly_evidence_v2($1) value',[filters])).rows[0].value;
  await run({db,admin,who,hr,read,write,evidence,fresh});
 } finally {await db.close();}
}
// Archive-era lifecycle compatibility is intentionally tested before the
// Follow-up cutover retired its HR/attendance RPCs. The default fixture above
// still applies the latest schema; current denial tests use the latest schema.
export const historicalDatabase=(run,options={})=>isolatedDatabase(run,{
 throughMigration:'20261011055923_company_identity_batch.sql',...options,
});
