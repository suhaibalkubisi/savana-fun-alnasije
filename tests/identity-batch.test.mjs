import {test} from 'node:test';import assert from 'node:assert/strict';
import {loadIdentityGroups,identityReviewGroup,identityDecisionPacket,executeIdentityDecisions} from '../lib/hr/identity-batch.mjs';
const rows=[1,2,3].map(n=>({id:'issue-'+n,version:7,person_code:'QA-'+n,source_name:'اسم اختبار '+n,group_token:'a'.repeat(32),candidates:[{id:'employee-'+n}],issue_type:'unmatched'}));
const employees=[1,2,3].map(n=>({id:'employee-'+n,name:'موظف اختبار '+n,employment_status:n===3?'inactive':'active',department:'قسم اختبار',version:4}));
const input={batch:{id:'batch',version:5,state:'preview',import_kind:'monthly',lifecycle_state:'preview',device_namespace:'synthetic-export'},source:{id:'source',version:2,confirmation_reason:'Independent synthetic catalog'},rows,employees,evidence:'Independent synthetic organization roster',choices:{'issue-1':{selected:true,employee_id:'employee-1'},'issue-2':{selected:true,employee_id:'employee-2'}}};
test('all review pages are loaded; drifting pages never become a partial batch',async()=>{
 const all=Array.from({length:233},(_,n)=>({id:String(n)}));assert.equal((await loadIdentityGroups(async p=>({rows:all.slice(p*100,(p+1)*100),total:233}))).length,233);
 await assert.rejects(loadIdentityGroups(async p=>({rows:all.slice(p*100,(p+1)*100),total:p?232:233})),/تغيرت/);
 await assert.rejects(loadIdentityGroups(async()=>({rows:all.slice(0,100),total:200})),/تغيرت/);
});
test('name suggestions, conflicts, multiple candidates, inactive and unknown stay distinct',()=>{
 assert.equal(identityReviewGroup(rows[0],employees),'suggested');assert.equal(identityReviewGroup(rows[2],employees),'inactive');assert.equal(identityReviewGroup({...rows[0],issue_type:'code_conflict'},employees),'conflict');assert.equal(identityReviewGroup({...rows[0],candidates:[]},employees),'unknown');assert.equal(identityReviewGroup({...rows[0],candidates:rows.flatMap(r=>r.candidates)},employees),'ambiguous');
});
test('exact selected decisions carry source, employee and issue guards; unselected unresolved',()=>{
 const p=identityDecisionPacket(input);assert.equal(p.selected_count,2);assert.equal(p.selected_decisions[0].employee_uuid,'employee-1');assert.equal(p.selected_decisions[0].expected_employee_revision,4);assert.equal(p.selected_decisions[0].expected_issue_revision,7);assert.equal(p.source_scope.expected_revision,2);assert.equal(p.preview_guard.expected_revision,5);assert.equal(p.unselected_cases[0].person_code,'QA-3');assert.equal(p.production_applied,false);assert.equal(p.attendance_approved,false);
 assert.throws(()=>identityDecisionPacket({...input,choices:{}}),/اختر/);assert.throws(()=>identityDecisionPacket({...input,source:undefined}),/وثق/);assert.throws(()=>identityDecisionPacket({...input,batch:{...input.batch,lifecycle_state:'approved'}}),/مغلقة/);assert.throws(()=>identityDecisionPacket({...input,choices:{'issue-3':{selected:true,employee_id:'employee-3'}}}),/غير النشط/);assert.throws(()=>identityDecisionPacket({...input,choices:{'issue-1':{selected:true,employee_id:'employee-1'},'issue-2':{selected:true,employee_id:'employee-1'}}}),/أكثر من مرة/);
});
test('uncertain response stops the queue and retains saved progress without automatic retries',async()=>{
 const packet=identityDecisionPacket({...input,choices:{...input.choices,'issue-3':{selected:true,employee_id:'employee-3'}},employees:employees.map(e=>({...e,employment_status:'active'}))}),writes=[],saved=[];
 const result=await executeIdentityDecisions(packet,{verify:async()=>{},resolve:async d=>{writes.push(d.id);if(d.id==='issue-2')throw Error('Lost response');},onSaved:d=>saved.push(d.issue_id)});
 assert.deepEqual(writes,['issue-1','issue-2']);assert.deepEqual(saved,['issue-1']);assert.equal(result.stopped_at,'issue-2');assert.equal(result.requires_saved_state_check,true);
});
test('new conflict detected before an individual transaction causes zero writes for that person',async()=>{
 let writes=0;const result=await executeIdentityDecisions(identityDecisionPacket(input),{verify:async()=>{throw Error('New mapping');},resolve:async()=>writes++});assert.equal(writes,0);assert.equal(result.saved.length,0);
});
