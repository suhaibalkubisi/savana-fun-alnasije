import {nativeConfig} from './native-config.mjs';
import fs from 'node:fs/promises';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/work/native-acceptance/tools/package.json'),{Client}=require('pg'),c=await nativeConfig();
const db=new Client({host:c.host,port:c.pg_port,user:c.db_owner,password:c.password,database:c.database});await db.connect();const ready=(await db.query("select to_regclass('auth.users') as users")).rows[0].users;assert.ok(ready,'GoTrue auth migrations must finish first');
const files=(await fs.readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort(),timings=[];
for(const file of files){const start=Date.now();await db.query(await fs.readFile('supabase/migrations/'+file,'utf8'));timings.push({file,ms:Date.now()-start});}
await db.query("set hr.test_fixture='on'");await db.query(await fs.readFile('supabase/seed.sql','utf8'));await db.query("notify pgrst,'reload schema'");await fs.writeFile('outputs/integration-2026-10-10/full-native-migrations.json',JSON.stringify({native:true,postgres:(await db.query('select version() as version')).rows[0].version,migrations:timings,seed:'synthetic only',schema_cache_notified:true},null,2));console.log('Native full migration set:',files.length,'applied; synthetic fixture loaded; PostgREST cache notified');await db.end();
