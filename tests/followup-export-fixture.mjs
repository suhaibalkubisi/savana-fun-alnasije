// Isolated demonstration data only; never loaded by an application route.
export function fixture(size=45){
  const departments=[{id:'dept-b',arabic_name:'الفرز',display_order:1},{id:'dept-a',arabic_name:'الالتقاط',display_order:2}];
  const user={id:'operator-test',name:'مشغل تجريبي',email:'test@example.invalid',role:'FOLLOWUP',active:true,version:1,departments:departments.map(d=>d.id)};
  const statuses=[['present','حاضر','present',0],['absent1','غائب ×1','absent',1],['absent2','غائب ×2','absent',2],['absent3','غائب ×3','absent',3],['leave','إجازة','leave',0],['unresolved','غير محسوم','unresolved',0],['training','تدريب','other',0],['old-status','حالة محفوظة قديمة','other',0]].map(([code,label,category,weight])=>({code,label,category,weight,enabled:code!=='old-status'}));
  const employees=Array.from({length:size},(_,i)=>({id:`synthetic-uuid-${i+1}`,name:`موظف تجريبي ${i+1} عبدالله حسين`,internal_code:`FNU-TEST-${String(i+1).padStart(6,'0')}`,employee_number:String(i+1).padStart(5,'0'),department_id:i%2?'dept-a':'dept-b',employment_status:'active'}));
  const positions=employees.flatMap((e,i)=>Array.from({length:31},(_,day)=>{const work_date=`2026-10-${String(day+1).padStart(2,'0')}`,department_id=i===0&&day>=7?'dept-a':e.department_id;return{employee_id:e.id,name:e.name,internal_code:e.internal_code,work_date,department_id,department_name:departments.find(d=>d.id===department_id).arabic_name,shift_id:'evening-test',status:statuses[(i+day)%statuses.length].code,review_state:day%5?'reviewed':'submitted',completeness:'complete',scope_state:day>=14?'future':i===2&&day===4?'outside_roster':i===3&&day===3?'assignment_unverified':i===4&&day===5?'missing_report':statuses[(i+day)%statuses.length].code==='unresolved'?'unresolved':'reported',source:'تصريح اصطناعي',report_id:`TEST-REPORT-${department_id}-${day+1}`,report_version:2};}));
  const reports=departments.map(d=>({id:`TEST-REPORT-${d.id}-14`,work_date:'2026-10-14',department_id:d.id,shift_id:'evening-test',reporter_id:'reporter-without-login',reporter_name:'مسؤول تجريبي بلا حساب',entered_by:user.id,entered_by_name:user.name,channel:'phone',note:'تصريح اصطناعي للمراجعة فقط',state:'submitted',version:2,submitted_at:'2026-10-14T15:30:00Z',entries:positions.filter(p=>p.department_id===d.id&&p.work_date==='2026-10-14').map(p=>({employee_id:p.employee_id,employee_name:p.name,permanent_code:p.internal_code,status:p.status}))}));
  const actions=[{id:'ACTION-TEST-1',department_id:'dept-a',employee_id:employees[0].id,description:'تأكيد حالة غير محسومة',responsible_id:user.id,due_date:'2026-10-15',state:'progress',notes:'بيانات اصطناعية. لا يوجد قرار إداري.',version:1,activity:[]},{id:'ACTION-TEST-2',department_id:'dept-b',description:'=HYPERLINK("https://example.invalid","text")',responsible_id:user.id,due_date:'2026-10-13',state:'completed',notes:'نص اختباري يظل نصاً في Excel',completion:'تم تأكيد استلام الرد في بيانات الاختبار',version:1,activity:[]}];
  const completeness=departments.map(d=>({department_id:d.id,department_name:d.arabic_name,work_date:'2026-10-14',expected:positions.filter(p=>p.department_id===d.id&&p.work_date==='2026-10-14').length,reported:reports.find(r=>r.department_id===d.id).entries.length,submitted:1,reviewed:0,unresolved:3,exceptions:1,state:'submitted',required:true}));
  const context={statuses,departments,shifts:[{id:'evening-test',name:'مسائي',scope:'evening'}],users:[user],user,evening_shift_id:'evening-test',scope:'evening',generated_at:'2026-10-14T16:00:00Z',completeness,handovers:[{work_date:'2026-10-14',department_id:'dept-a',completed_summary:'استلام التصريح',remaining_summary:'مراجعة الحالات غير المحسومة',owner_id:user.id,next_action:'متابعة الإجراء المسجل'}]};
  return{context,positions,employees,reports,actions};
}
export const sampleSelections=[
  {kind:'reporting',start:'2026-10-14',end:'2026-10-14',department_id:'dept-a',report_id:'TEST-REPORT-dept-a-14'},
  {kind:'daily',start:'2026-10-14',end:'2026-10-14'},
  {kind:'monthly',start:'2026-10-01',end:'2026-10-31'},
  {kind:'department-monthly',start:'2026-10-01',end:'2026-10-31',department_id:'dept-a'},
  {kind:'employee',start:'2026-10-01',end:'2026-10-31',employee_id:'synthetic-uuid-1'},
  {kind:'actions',start:'2026-10-01',end:'2026-10-31',action_filter:'all'},
  {kind:'completeness',start:'2026-10-14',end:'2026-10-14'},
  {kind:'handover',start:'2026-10-14',end:'2026-10-14'},
  {kind:'directory',start:'2026-10-14',end:'2026-10-14',directory_fields:['department','permanent_code','employee_number','name','employment_status']},
];
