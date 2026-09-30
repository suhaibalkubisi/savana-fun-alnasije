// One read-only interpretation path for daily and monthly evidence.
// All times are calendar minutes in Asia/Baghdad, supplied by the database.
export const DAY = 1440;
export const dayIndex = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
export const dateOf = day => new Date(day * 86400000).toISOString().slice(0, 10);
export const addDays = (date, n) => dateOf(dayIndex(date) + n);
export function assignmentAt(history, employeeId, day) {
  return (history || []).find(a => !a.voided_at && a.employee_id === employeeId && a.valid_from <= day && (!a.valid_to || a.valid_to >= day)) || null;
}
export function scheduleAt(rules, history, employeeId, day) {
  const assignment = assignmentAt(history, employeeId, day);
  const rule = assignment && rules.filter(r => r.department_id === assignment.department_id && r.effective_from <= day).sort((a,b) => b.effective_from.localeCompare(a.effective_from))[0];
  return {assignment, rule: rule || null};
}
export function interpretSession({day, timeline, rules, assignments, employeeId, asOf, issues = []}) {
  const {assignment, rule} = scheduleAt(rules, assignments, employeeId, day);
  const next = scheduleAt(rules, assignments, employeeId, addDays(day,1));
  const midnight = dayIndex(day) * DAY;
  // Missing next-day history cannot establish an overnight boundary.
  const finish = midnight + DAY + (next.rule?.entry_window_start ?? 0);
  const evidence = timeline.filter(p => p.timestamp >= midnight + (rule?.entry_window_start ?? 0) && p.timestamp < (rule ? finish : midnight + DAY));
  const stamps = [...new Set(evidence.map(p => p.timestamp))].sort((a,b)=>a-b);
  const entry = rule ? stamps.find(t => t <= midnight + rule.entry_window_end) : undefined;
  const exit = entry == null ? undefined : stamps.filter(t=>t>entry).at(-1);
  const expected = rule ? rule.working_weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay()) : null;
  const unresolved = [...new Map([...issues,...evidence.flatMap(p=>p.issues || [])].map(i=>[i.id,i])).values()];
  let state = !employeeId ? 'unmatched' : !assignment ? 'missing_assignment' : !rule ? 'missing_schedule' : entry!=null && exit!=null ? 'complete' : entry!=null ? 'single' : stamps.length ? 'exit_only' : 'no_punch';
  if (day > asOf) state = 'future';
  const pending = unresolved.some(i=>i.state==='open') || ['missing_assignment','missing_schedule','unmatched','exit_only'].includes(state);
  return {date:day,state,entry:entry==null?null:entry-midnight,exit:exit==null?null:exit%DAY,
    next_day:exit!=null && exit>=midnight+DAY,duration:state==='complete'&&!pending?exit-entry:null,
    late_minutes:expected && entry!=null && !pending && ['complete','single'].includes(state) ? (entry-midnight>rule.start_minute+rule.grace_minutes?entry-midnight-rule.start_minute:0) : null,
    punch_count:stamps.length,pending,issues:unresolved,timeline:evidence,expected,assignment,
    rule:rule?{start_minute:rule.start_minute,entry_window_start:rule.entry_window_start,entry_window_end:rule.entry_window_end,effective_from:rule.effective_from}:null};
}
export function buildDailyPosition(evidence, filters={}) {
  const {date,as_of:asOf} = evidence;
  const term=String(filters.search || '').trim().toLocaleLowerCase();
  const sources=evidence.sources || [];
  const issues=evidence.issues || [];
  const timeline=sources.flatMap(s=>s.punch_minutes.map(minute=>({timestamp:dayIndex(s.calendar_date)*DAY+minute,calendar_date:s.calendar_date,minute,source_id:s.id,employee_id:s.employee_id,issues:issues.filter(i=>i.source_row_id===s.id)})));
  const rows=(evidence.employees || []).map(e=>{
    const c=interpretSession({day:date,timeline:timeline.filter(p=>p.employee_id===e.id),rules:evidence.rules || [],assignments:evidence.assignments,employeeId:e.id,asOf});
    const manual=(evidence.manual_records || []).find(r=>r.employee_id===e.id);
    const note=(evidence.notes || []).find(r=>r.employee_id===e.id);
    const state=c.state==='single'?'pending_exit':c.state==='no_punch'?'no_entry':c.state;
    const status=manual?.status_type || (c.pending?c.state==='complete'||c.state==='single'?'pending_review':c.state:c.expected===false?'off_day':c.entry===null?state:c.late_minutes>0?'late':'present');
    return {employee_id:e.id,internal_code:e.internal_code,employee_number:e.employee_number,name:e.name,
      department_id:c.assignment?.department_id || manual?.department_id || null,department:c.assignment?.department || (manual?.department_id === e.department_id ? e.department : 'انتماء الفترة غير موثق'),
      manager:c.assignment?.manager || null,assignment_verified:!!c.assignment,
      person_code:sources.find(s=>s.employee_id===e.id)?.person_code || null,
      employment_status:c.assignment?.employment_status || e.employment_status,
      scheduled_start_minute:c.rule?.start_minute ?? null,entry_minute:c.entry,exit_minute:c.exit,next_day:c.next_day,duration_minutes:c.duration,
      attendance_state:state,status,late_minutes:manual?manual.status_type==='late'?manual.late_minutes:0:c.late_minutes,
      manual_status:manual?.status_type || null,status_record_id:manual?.id || null,status_record_version:manual?.version || null,
      notes:[manual?.notes,note?.notes].filter(Boolean).join(' — '),procedure_text:note?.procedure_text || '',note_id:note?.id || null,note_version:note?.version || null,
      expected:c.expected,daily_note_text:note?.notes || '',needs_review:c.pending,evidence:c};
  }).filter(r=>(!filters.department_id || filters.department_id===r.department_id) && (!term || [r.name,r.internal_code,r.employee_number,r.person_code].join(' ').toLocaleLowerCase().includes(term)));
  return {date,as_of:asOf,rows};
}
