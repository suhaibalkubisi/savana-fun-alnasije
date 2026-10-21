// A batch is an explicit list of person decisions. Each person remains a guarded
// database transaction; a lost response stops the queue until the saved state is read.
export async function loadIdentityGroups(readPage) {
  const first=await readPage(0),rows=[...first.rows],total=first.total;
  for(let page=1;rows.length<total;page++) {
    const next=await readPage(page);
    if(next.total!==total||!next.rows.length)throw Error('تغيرت قائمة المراجعة؛ أعد تحميلها');
    rows.push(...next.rows);
  }
  if(rows.length!==total||new Set(rows.map(r=>r.id)).size!==total)throw Error('تغيرت قائمة المراجعة؛ أعد تحميلها');
  return rows;
}
export function identityReviewGroup(issue,employees) {
  if(!issue.group_token||issue.issue_type==='code_conflict')return 'conflict';
  if(issue.candidates.length>1)return 'ambiguous';
  if(!issue.candidates.length)return 'unknown';
  const candidate=employees.find(e=>e.id===issue.candidates[0].id);
  return candidate?.employment_status==='active'?'suggested':'inactive';
}
export function identityDecisionPacket({batch,source,rows,choices,employees,evidence}) {
  if(batch.state!=='preview'||(batch.import_kind==='monthly'&&batch.lifecycle_state!=='preview'))throw Error('هذه المعاينة مغلقة؛ لا قرارات هوية جماعية');
  if(!source?.confirmation_reason?.trim())throw Error('وثق مصدر التصدير أولاً');
  if(evidence.trim().length<3)throw Error('أدخل مرجع دليل حقيقي للدفعة');
  const selected=rows.filter(r=>choices[r.id]?.selected);
  if(!selected.length)throw Error('اختر المطابقات التي راجعتها');
  const decisions=selected.map(r=>{
    const choice=choices[r.id],employee=employees.find(e=>e.id===choice.employee_id);
    if(!r.group_token||!employee||employee.employment_status!=='active'||r.issue_type==='code_conflict')throw Error('افصل التعارض أو الموظف غير النشط للمراجعة الفردية');
    return {issue_id:r.id,expected_issue_revision:r.version,group_token:r.group_token,person_code:r.person_code,source_name:r.source_name,employee_uuid:employee.id,employee_name:employee.name,department:employee.department,expected_employee_revision:employee.version,evidence_reference:evidence.trim(),correction_reason:choice.reason?.trim()||null,related_open_count:r.related_open_count};
  });
  if(new Set(decisions.map(d=>d.employee_uuid)).size!==decisions.length||new Set(decisions.map(d=>d.person_code)).size!==decisions.length)throw Error('لا تربط الموظف أو رمز المصدر أكثر من مرة في الدفعة؛ افصل التعارض');
  return {schema_version:1,status:'PROPOSED_PENDING_EXPLICIT_CONFIRMATION',source_scope:{id:source.id,namespace:batch.device_namespace,expected_revision:source.version},preview_guard:{id:batch.id,expected_revision:batch.version,expected_state:batch.state,lifecycle_state:batch.lifecycle_state},selected_decisions:decisions,selected_count:decisions.length,unselected_cases:rows.filter(r=>!choices[r.id]?.selected).map(r=>({person_code:r.person_code,issue_id:r.id,disposition:'UNRESOLVED'})),production_applied:false,attendance_approved:false};
}
export async function executeIdentityDecisions(packet,{verify,resolve,onSaved=()=>{}}) {
  const saved=[];
  for(const decision of packet.selected_decisions) {
    try {
      await verify(decision);
      await resolve({id:decision.issue_id,version:decision.expected_issue_revision,group_token:decision.group_token,state:'resolved',employee_id:decision.employee_uuid,resolution_note:[decision.evidence_reference,decision.correction_reason].filter(Boolean).join(' · ')});
      saved.push(decision.issue_id);onSaved(decision,saved.length);
    }catch(error){return {saved,stopped_at:decision.issue_id,error:error.message,requires_saved_state_check:true};}
  }
  return {saved,stopped_at:null,error:null,requires_saved_state_check:false};
}
