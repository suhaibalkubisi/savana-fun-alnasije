import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('platform event-helper grants are owner-only and optional in local databases',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;');
  const name=(await readdir('supabase/migrations')).find(n=>n.endsWith('_restrict_platform_event_trigger.sql'));
  const sql=await readFile('supabase/migrations/'+name,'utf8');
  await db.exec(sql); // Local instances need not contain the platform helper.
  await db.exec("create function public.rls_auto_enable() returns void language sql security definer as $$select null::void$$; grant execute on function public.rls_auto_enable() to anon,authenticated;");
  await db.exec(sql);
  const {rows}=await db.query("select has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') as anonymous,has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') as signed_in,has_function_privilege(current_user,'public.rls_auto_enable()','EXECUTE') as owner");
  assert.deepEqual(rows,[{anonymous:false,signed_in:false,owner:true}]);
 }finally{await db.close();}
});
