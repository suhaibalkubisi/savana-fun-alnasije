import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './helpers/isolated-db.mjs';
import {buildDailyPosition} from '../lib/hr/attendance-engine.mjs';

test('post-deploy gateway preserves metadata but denies every legacy calculation path for all app roles',()=>isolatedDatabase(async({db,who,admin})=>{
 for(const role of ['ADMIN','HR','VIEWER']){
  await who(role);
  for(const fn of ['attendance_read','attendance_read_v2','attendance_read_v3','attendance_read_v4'])
   await assert.rejects(db.query(`select public.${fn}('daily','{}')`),/permission denied/);
  for(const kind of ['daily','monthly','monthly_fingerprint','unknown',null])
   await assert.rejects(db.query('select public.attendance_read_v5($1,$2)',[kind,{}]),e=>e.code==='22023');
  const metadata=await db.query("select public.attendance_read_v5('imports','{}') data");
  assert.ok(Array.isArray(metadata.rows[0].data));
  const evidence=(await db.query('select public.attendance_daily_evidence($1) data',[{date:'2026-09-10'}])).rows[0].data;
  assert.ok(Array.isArray(buildDailyPosition(evidence,{date:'2026-09-10'}).rows));
 }
 await db.exec('reset role');
 await db.query('update public.profiles set is_active=false where id=$1',[admin]);
 await db.exec('set role authenticated');
 await assert.rejects(db.query("select public.attendance_read_v5('imports','{}')"));
 await db.exec('reset role; set role anon');
 await assert.rejects(db.query("select public.attendance_read_v5('imports','{}')"),/permission denied/);
}));
