// Calendar evidence is immutable. These read-only calculations never create HR decisions.
const DAY = 1440;
const dayIndex = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const dateOf = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const addDays = (date, n) => dateOf(dayIndex(date) + n);
const normalize = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const ruleAt = (rules, department, day) => rules.filter(r => r.department_id === department && r.effective_from <= day).sort((a,b) => b.effective_from.localeCompare(a.effective_from))[0];
const tokenCount = (source) => {
  const value = source.raw_values?.[3];
  if (typeof value !== 'string') return source.punch_minutes.length;
  return (value.match(/\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?/gi) || []).length;
};
export const monthlyStateLabels = {
  complete: 'دخول وخروج', single: 'بصمة واحدة · خروج غير مسجل',
  exit_only: 'خارج نافذة الدخول · يحتاج تفسيراً', no_punch: 'لا توجد بصمات مسجلة',
  missing_schedule: 'الدوام غير محدد لهذه الفترة', unmatched: 'هوية تحتاج مطابقة',
  outside_coverage: 'خارج نطاق التغطية', future: 'تاريخ لاحق',
  pending: 'مشكلة مفتوحة', filtered: 'خارج الفلتر',
};
export function minuteText(value) {
  if (value == null) return '—';
  return `${String(Math.floor(value % DAY / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
}
export function monthlyCellText(cell, direction) {
  if (!cell || ['outside_coverage','future','filtered'].includes(cell.state)) return '—';
  const value = direction === 'entry' ? cell.entry : cell.exit;
  if (value != null) return minuteText(value) + (direction === 'exit' && cell.next_day ? ' (+1)' : '');
  if (['missing_schedule','unmatched','exit_only'].includes(cell.state)) return '؟';
  return direction === 'exit' && cell.state === 'single' ? 'ناقص' : '—';
}
export function summarizeMonthlyCells(cells) {
  const scoped = Object.values(cells).filter(c => !['outside_coverage','future','filtered'].includes(c.state));
  const complete = scoped.filter(c => c.state === 'complete' && !c.pending);
  return {
    dates: scoped.length,
    with_punch: scoped.filter(c => c.punch_count > 0).length,
    complete: complete.length,
    incomplete: scoped.filter(c => ['single','exit_only'].includes(c.state)).length,
    no_punch: scoped.filter(c => c.state === 'no_punch').length,
    pending: scoped.filter(c => c.pending || ['unmatched','missing_schedule','exit_only'].includes(c.state)).length,
    worked_minutes: complete.reduce((n,c) => n + (c.duration || 0),0),
    late_events: scoped.filter(c => c.late_minutes > 0).length,
    late_minutes: scoped.reduce((n,c) => n + (c.late_minutes || 0),0),
  };
}

export function buildMonthlyPosition(evidence, options = {}) {
  const month = evidence.month;
  const start = `${month}-01`;
  const end = dateOf(dayIndex(`${Number(month.slice(0,4)) + (month.slice(5)==='12'?1:0)}-${month.slice(5)==='12'?'01':String(Number(month.slice(5))+1).padStart(2,'0')}-01`)-1);
  const days = Number(end.slice(-2));
  const base = {month,days,available:!!evidence.available,batch:evidence.batch || null,rows:[],metrics:null,coverage:null,source_counts:null,other_approved:evidence.other_approved || null,daily_overlap_rows:evidence.daily_overlap_rows || 0};
  if (!evidence.available) return base;
  const sources = evidence.sources || [];
  const observed = sources.filter(s=>s.punch_minutes.length).map(s=>s.calendar_date).sort();
  const coverageFrom = options.coverage_start || evidence.batch.coverage_start || observed[0] || start;
  const coverageEnd = options.coverage_end || evidence.batch.coverage_end || observed.at(-1) || start;
  if (coverageFrom < start || coverageEnd > end || coverageEnd < coverageFrom) throw new Error('نطاق التغطية يجب أن يكون داخل الشهر وبترتيب صحيح');
  const asOf = options.as_of || evidence.as_of;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) throw new Error('تاريخ التحقق بتوقيت بغداد غير متاح');
  const employees = new Map((evidence.employees || []).map(e=>[e.id,e]));
  const rules = evidence.rules || [];
  const issues = new Map();
  for (const issue of evidence.issues || []) issues.set(issue.source_row_id,[...(issues.get(issue.source_row_id)||[]),issue]);
  const groups = new Map();
  for (const source of sources) {
    const key = source.employee_id || `source:${source.person_code || ''}:${normalize(source.source_name)}`;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(source);
  }
  const rows = [];
  for (const [key, items] of groups) {
    const employee = employees.get(items[0].employee_id);
    const rawTimeline = [];
    for (const source of items) for (const minute of source.punch_minutes) rawTimeline.push({
      timestamp:dayIndex(source.calendar_date)*DAY+minute,calendar_date:source.calendar_date,minute,
      source_id:source.id,source_sheet:source.source_sheet,source_row:source.source_row,raw_values:source.raw_values,
      issues:issues.get(source.id)||[],
    });
    rawTimeline.sort((a,b)=>a.timestamp-b.timestamp);
    const timestamps = [...new Set(rawTimeline.map(p=>p.timestamp))];
    const cells = {};
    const assigned = new Set();
    for (let n=1;n<=days;n++) {
      const day = `${month}-${String(n).padStart(2,'0')}`;
      const rule = employee && ruleAt(rules,employee.department_id,day);
      const nextRule = employee && ruleAt(rules,employee.department_id,addDays(day,1));
      const minimum = dayIndex(day)*DAY;
      const begin = minimum+(rule?.entry_window_start ?? 0);
      // This is the existing configured shift boundary, not a new duration cutoff.
      const finish = minimum+DAY+(nextRule?.entry_window_start ?? rule?.entry_window_start ?? 0);
      const associated = timestamps.filter(t=> t>=begin && t<finish);
      const calendar = timestamps.filter(t=>t>=minimum && t<minimum+DAY);
      const entry = rule ? associated.find(t=>t<=minimum+rule.entry_window_end) : undefined;
      const exit = entry == null ? undefined : associated.filter(t=>t>entry).at(-1);
      const timeline = rawTimeline.filter(p=>(rule ? associated : calendar).includes(p.timestamp));
      if (rule) for (const t of associated) assigned.add(t);
      const cellIssues = [...new Map(timeline.flatMap(p=>p.issues).map(i=>[i.id,i])).values()];
      // Include matching issues on blank cells as well as populated cells.
      for (const item of items.filter(s=>s.calendar_date===day)) for (const i of issues.get(item.id)||[]) if (!cellIssues.some(x=>x.id===i.id)) cellIssues.push(i);
      const manual = (evidence.manual_records || []).find(h=>h.employee_id===employee?.id && h.record_date===day) || null;
      let state = !employee ? 'unmatched' : !rule ? (calendar.length ? 'missing_schedule' : 'no_punch') : entry!=null && exit!=null ? 'complete' : entry!=null ? 'single' : associated.length ? 'exit_only' : 'no_punch';
      if (day>asOf) state='future';
      else if (day<coverageFrom || day>coverageEnd || !observed.length) state='outside_coverage';
      const pending = cellIssues.some(i=>i.state==='open');
      const duration = state==='complete' && !pending ? exit-entry : null;
      cells[String(n)] = {
        date:day,state,entry:entry==null?null:entry-minimum,exit:exit==null?null:exit%DAY,
        next_day:exit!=null && exit>=minimum+DAY,duration,
        late_minutes:entry!=null && rule && !pending && ['complete','single'].includes(state) ? Math.max(0,entry-minimum-rule.start_minute>rule.grace_minutes?entry-minimum-rule.start_minute:0):null,
        punch_count:(rule?associated:calendar).length,pending,issues:cellIssues,timeline,manual,
        expected:rule?rule.working_weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay()):null,
        boundary_missing:day===coverageEnd && entry!=null && exit==null,
        rule:rule?{start_minute:rule.start_minute,entry_window_start:rule.entry_window_start,entry_window_end:rule.entry_window_end,effective_from:rule.effective_from}:null,
      };
    }
    const monthEndRule = employee && ruleAt(rules,employee.department_id,end);
    const unassigned = rawTimeline.filter(p=>!assigned.has(p.timestamp));
    rows.push({key,employee_id:employee?.id||null,internal_code:employee?.internal_code||null,
      name:employee?.name || items[0].source_name,source_names:[...new Set(items.map(s=>s.source_name))],
      person_codes:[...new Set(items.map(s=>s.person_code).filter(Boolean))],department_id:employee?.department_id||null,
      department:employee?.department||'غير مطابق',manager:employee?.manager||null,
      manager_id:employee?.direct_manager_id || monthEndRule?.default_manager_id || null,
      employment_status:employee?.employment_status||null,
      raw_punch_count:items.reduce((n,s)=>n+tokenCount(s),0),effective_punch_count:timestamps.length,
      first_evidence:rawTimeline[0]?.calendar_date||null,last_evidence:rawTimeline.at(-1)?.calendar_date||null,
      cells,summary:summarizeMonthlyCells(cells),unassigned_timeline:unassigned,
    });
  }
  rows.sort((a,b)=>a.department.localeCompare(b.department,'ar')||a.name.localeCompare(b.name,'ar')||a.key.localeCompare(b.key));
  const identityKeys = new Set(sources.map(s=>`${s.person_code}\0${normalize(s.source_name)}`));
  base.rows=rows;
  base.coverage={start:coverageFrom,end:coverageEnd,observed_start:observed[0]||null,observed_end:observed.at(-1)||null,confirmed:!!evidence.batch.coverage_start,as_of:asOf};
  base.source_counts={identities:identityKeys.size,source_rows:new Set(sources.map(s=>`${s.source_sheet}\0${s.source_row}`)).size,
    matched_identities:new Set(sources.filter(s=>s.employee_id).map(s=>`${s.person_code}\0${normalize(s.source_name)}`)).size,
    populated_cells:sources.filter(s=>s.punch_minutes.length).length,raw_punches:sources.reduce((n,s)=>n+tokenCount(s),0),
    effective_punches:rows.reduce((n,r)=>n+r.effective_punch_count,0),calendar_cells:sources.length,
    open_issue_groups:rows.filter(r=>Object.values(r.cells).some(c=>c.pending)).length};
  return scopeMonthlyPosition(base,{});
}

export function scopeMonthlyPosition(position, filters) {
  const term=normalize(filters.search);
  const condition=filters.condition||'';
  const match=c=>!condition || (!['outside_coverage','future','filtered'].includes(c.state) && (condition==='pending' ? c.pending||['missing_schedule','unmatched','exit_only'].includes(c.state) : condition==='incomplete' ? ['single','exit_only'].includes(c.state) : condition==='with_punch' ? c.punch_count>0 : c.state===condition));
  const rows=position.rows.filter(r=>(!term||normalize([r.name,r.internal_code,...r.person_codes].join(' ')).includes(term))
    &&(!filters.department_id||r.department_id===filters.department_id)&&(!filters.manager_id||r.manager_id===filters.manager_id)
    &&(!filters.employee_key||r.key===filters.employee_key)
    &&(!condition||Object.values(r.cells).some(match))).map(r=>{
      const cells=Object.fromEntries(Object.entries(r.cells).map(([d,c])=>[d,match(c)?c:{...c,state:'filtered'}]));
      return {...r,cells,summary:summarizeMonthlyCells(cells)};
    });
  const metrics=position.available ? {employees:rows.length,with_punch:rows.filter(r=>r.summary.with_punch>0).length,
    ...Object.fromEntries(['dates','complete','incomplete','no_punch','pending','worked_minutes','late_events','late_minutes'].map(k=>[k,rows.reduce((n,r)=>n+r.summary[k],0)]))}:null;
  return {...position,rows,metrics};
}

export function monthlyMatrixRows(position, from=1, to=position.days) {
  return position.rows.flatMap(r=>['entry','exit'].map(direction=>[
    r.internal_code||'غير مطابق',r.name,r.department,direction==='entry'?'دخول':'خروج',
    ...Array.from({length:to-from+1},(_,i)=>monthlyCellText(r.cells[String(from+i)],direction)),
    ...(direction==='entry'?[r.summary.complete,r.summary.incomplete,r.summary.no_punch,r.summary.pending,r.summary.worked_minutes]:['','','','','']),
  ]));
}
