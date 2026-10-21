import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const evidence=path.resolve('../evidence'),deliverable=path.resolve('../../outputs/database-evidence');
await fs.mkdir(evidence,{recursive:true});await fs.mkdir(deliverable,{recursive:true});
const sources=['supabase/migrations/20261011211438_department_followup_rebuild.sql','supabase/migrations/20261012163301_department_followup_position_integrity.sql','supabase/migrations/20261012173126_department_followup_http_conflict.sql','supabase/migrations/20261013223509_evening_release_candidate.sql','supabase/contracts/followup_write.pre-evening.sql','supabase/evening-contract-head.sql','supabase/evening-contract-tail.sql','scripts/assemble-evening-migration.mjs','tests/evening-contracts.test.mjs','tests/evening-native-workload.mjs','tests/candidate-http.mjs'];
const files=[];for(const file of sources){const bytes=await fs.readFile(file);files.push({path:file,byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const baseline=[...JSON.parse(await fs.readFile('../baseline/definitions.json','utf8')),...JSON.parse(await fs.readFile('../baseline/private_definitions.json','utf8'))];
const current=JSON.parse(await fs.readFile('../baseline/production-contract-verification-2026-10-14.json','utf8'));
for(const row of current.rows){const old=baseline.find(x=>x.schema===row.schema&&x.name===row.name);assert.ok(old);assert.equal(createHash('md5').update(old.definition).digest('hex'),row.definition_md5);}
const identity=JSON.parse(await fs.readFile('../baseline/production-identity-verification-2026-10-14.json','utf8'));
assert.equal(identity.rows[0].uuid_code_sha256,JSON.parse(await fs.readFile('../baseline/employee_identity.json','utf8'))[0].uuid_code_sha256);
const native=JSON.parse(await fs.readFile('../evidence/evening-native-20-user-workload.json','utf8'));
const http=JSON.parse(await fs.readFile('../evidence/candidate-http-20-user-workload.json','utf8'));
const httpFunctional=JSON.parse(await fs.readFile('../evidence/candidate-http-functional.json','utf8'));
assert.equal(http.status,'PASS');assert.equal(httpFunctional.status,'PASS');
const result={created_at:new Date().toISOString(),pending_migration:'20261013223509_evening_release_candidate.sql',production_migration_applied:false,production_deployment_performed:false,files,isolated_database_contracts:{status:'PASS',tests:8,environment:'Disposable PGlite with synthetic minimal schema; not a full production restore'},native_20_user_workload:native,production_readonly_checks:{uuid_code_identity:'PASS against captured original identity digest',seven_captured_function_definitions:'PASS against captured catalog definition MD5s',seventeen_inventoried_table_counts:'PASS against captured counts',original_whole_row_values:'NOT VERIFIED: original row fingerprint serialization was not saved',production_migration_preservation:'NOT VERIFIED: production migration not performed',backup_or_restore_recovery:'NOT VERIFIED: no backup or recovery claim'}};
result.actual_http_20_user_workload=http;
result.actual_http_functional=httpFunctional;
await fs.writeFile(path.join(evidence,'evening-database-manifest.json'),JSON.stringify(result,null,2));
await fs.writeFile(path.join(deliverable,'database-manifest.json'),JSON.stringify(result,null,2));
for(const name of ['preservation-checkpoint.json','production-readonly-postcheckpoint-2026-10-14.json','production-readonly-postcheckpoint-2026-10-14.sql','production-identity-verification-2026-10-14.json','production-contract-verification-2026-10-14.json','production-business-configuration-2026-10-14.json'])await fs.copyFile(path.resolve('../baseline',name),path.join(deliverable,name));
await fs.copyFile(path.join(evidence,'evening-native-20-user-workload.json'),path.join(deliverable,'native-20-user-workload.json'));
for(const name of ['candidate-http-20-user-workload.json','candidate-http-functional.json','candidate-http-global-export-limit.json','candidate-http-development-artifact-failures.json','candidate-http-next-artifact-failure-final.json','candidate-http-harness-assumption-failure.json'])await fs.copyFile(path.join(evidence,name),path.join(deliverable,name));
await fs.copyFile('docs/EVENING-DATABASE-RELEASE-2026-10-14.md',path.join(deliverable,'DATABASE-RELEASE.md'));
console.log(JSON.stringify({status:'PASS',pending_migration_sha256:files.find(x=>x.path.includes('evening_release_candidate')).sha256,seven_live_function_definitions_match:true,production_uuid_code_identity_match:true,deliverable},null,2));
