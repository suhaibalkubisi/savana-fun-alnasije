import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../components/followup/domain.ts',import.meta.url),'utf8');
const moduleCode=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const domain=await import('data:text/javascript;base64,'+Buffer.from(moduleCode).toString('base64'));
const recoverySource=await readFile(new URL('../components/followup/roster-recovery.ts',import.meta.url),'utf8');
const recoveryCode=ts.transpileModule(recoverySource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {exactPreview,exactRosterStatus,parseRosterPointer}=await import('data:text/javascript;base64,'+Buffer.from(recoveryCode).toString('base64'));
const row=(id,patch={})=>({id,name:id,internal_code:'FANU-'+id,department_id:'department',version:3,evening_verified:false,employment_status:'active',...patch});
test('duplicate source UUIDs and duplicate requested UUIDs cannot be acknowledged as one setup',()=>{
 assert.throws(()=>domain.setupSelection(['one'],[row('one'),row('one')],'department'));
 const payload={department_id:'department',valid_from:domain.today(),reason:'Explicit source',employees:[{employee_id:'one',version:3},{employee_id:'one',version:3}]};
 const preview={id:'preview',expires_at:new Date(Date.now()+60000).toISOString(),department_id:payload.department_id,valid_from:payload.valid_from,reason:payload.reason,member_count:2,employees:[{...row('one'),employee_id:'one'},{...row('one'),employee_id:'one'}]};
 assert.equal(exactPreview(preview,payload),false);
});
test('recovery binds original preview and decision members while allowing committed receipts after expiry',()=>{
 const pointer={preview_id:'44444444-4444-4444-8444-444444444444',request_id:'55555555-5555-4555-8555-555555555555'};
 const preview={id:pointer.preview_id,expires_at:new Date(Date.now()-60000).toISOString(),department_id:'department',valid_from:domain.today(),reason:'Explicit source',member_count:1,employees:[{...row('one'),employee_id:'one'}]};
 const decision={id:'decision',preview_id:preview.id,department_id:preview.department_id,valid_from:preview.valid_from,reason:preview.reason,member_count:1,employees:preview.employees};
 assert.deepEqual(parseRosterPointer({...pointer,name:'private'}),pointer);assert.equal(parseRosterPointer({preview_id:'bad',request_id:pointer.request_id}),null);
 assert.equal(exactRosterStatus({preview,decision},pointer),true);assert.equal(exactRosterStatus({preview,decision:null},pointer),true);
 for(const change of [{preview_id:'other'},{member_count:2},{reason:'changed'},{employees:[{...preview.employees[0],version:99}]},{employees:[{...preview.employees[0],employee_id:'hidden'}]}])assert.equal(exactRosterStatus({preview,decision:{...decision,...change}},pointer),false);
 assert.equal(exactRosterStatus({preview:{...preview,id:'other'},decision:null},pointer),false);assert.equal(exactRosterStatus({preview,decision:undefined},pointer),false);
});
test('explicit setup starts empty and only selected visible employees enter the preview payload',()=>{
 const visible=[row('one'),row('two')];assert.throws(()=>domain.setupSelection([],visible,'department'),/حدّد/);
 assert.deepEqual(domain.setupSelection(['one','hidden'],visible,'department'),[{employee_id:'one',version:3}]);assert.deepEqual(domain.setupSelection(['two'],visible,'department'),[{employee_id:'two',version:3}]);
});
test('setup rejects a different department, already verified members and missing/stale source versions',()=>{for(const candidate of [row('one',{department_id:'other'}),row('one',{evening_verified:true}),row('one',{version:undefined}),row('one',{version:0})])assert.throws(()=>domain.setupSelection(['one'],[candidate],'department'),/تغير/);});
test('directory membership labels do not turn unknown or recorded morning shift into verified evening membership',()=>{
 assert.match(domain.membershipLabel(row('one',{shift_name:null})),/لم تُوثّق/);assert.match(domain.membershipLabel(row('one',{shift_name:'صباحي'})),/صباحي/);assert.match(domain.membershipLabel(row('one',{shift_name:'صباحي'})),/خارج القائمة/);assert.match(domain.membershipLabel(row('one',{shift_name:'مسائي'})),/لم يُوثّق/);assert.equal(domain.membershipLabel(row('one',{shift_name:null,evening_verified:true})),'قائمة مسائية موثّقة');
});
test('supervisor can edit an own account declaration but cannot edit offline or another reporter declaration',()=>{
 const report={reporter_id:'supervisor'};assert.equal(domain.canEditDeclaration('SUPERVISOR',report,'supervisor'),true);assert.equal(domain.canEditDeclaration('SUPERVISOR',{reporter_id:null},'supervisor'),false);assert.equal(domain.canEditDeclaration('SUPERVISOR',{reporter_id:'other'},'supervisor'),false);assert.equal(domain.canEditDeclaration('SUPERVISOR',null,'supervisor'),true);assert.equal(domain.canEditDeclaration('FOLLOWUP',{reporter_id:null},'operator'),true);assert.equal(domain.canEditDeclaration('VIEWER',null,'viewer'),false);
});
test('server preview acknowledgement must bind all selected UUID/version pairs, date, scope, reason and expiry',()=>{
 const payload={department_id:'department',valid_from:domain.today(),reason:'Actual operator source',employees:[{employee_id:'one',version:3},{employee_id:'two',version:4}]};const preview={id:'preview',expires_at:new Date(Date.now()+60000).toISOString(),department_id:payload.department_id,valid_from:payload.valid_from,reason:payload.reason,member_count:2,employees:[{...row('two',{version:4}),employee_id:'two'},{...row('one'),employee_id:'one'}]};assert.equal(exactPreview(preview,payload),true);
 for(const patch of [{department_id:'other'},{valid_from:'2000-01-01'},{reason:'Other source'},{member_count:1},{expires_at:new Date(Date.now()-1000).toISOString()},{expires_at:'invalid'},{employees:[preview.employees[0],preview.employees[0]]},{employees:[{...preview.employees[0],version:99},preview.employees[1]]},{employees:[{...preview.employees[0],employee_id:'hidden'},preview.employees[1]]}])assert.equal(exactPreview({...preview,...patch},payload),false,JSON.stringify(patch));
});
