import {monthEnd,states,actionStates,today,type Status,type Employee,type Position,type Report,type Action,type User} from './domain';

export const reportKinds=['reporting','daily','monthly','department-monthly','employee','actions','completeness','handover','directory'] as const;
export type Selection={kind:string;start:string;end:string;department_id?:string;query?:string;employee_id?:string;report_id?:string;action_filter?:string;directory_fields?:string[];print_mode?:'detail'|'management'|'department'};
export type Cell=string|number;
export type ReportSection={name:string;headers:string[];rows:Cell[][];row_ids?:string[];columnWeights?:number[];note?:string;identityColumns?:number};
export type ExportScopeKind='evening'|'authorized-directory';
export type ExportTable=ReportSection&{title:string;scope:string;footer:string;selection?:Selection;reference:string;generated_at:string;source_status:string;legend:string[];sections:ReportSection[];sheets:ReportSection[];scope_kind:ExportScopeKind};
export type Completeness={department_id:string;department_name?:string;work_date:string;expected?:number|boolean;reported?:number|boolean;roster_count?:number;unverified_assignments?:number;submitted?:number|boolean;reviewed?:number|boolean;unresolved?:number;exceptions?:number;state?:string;required?:boolean};
type DatedPosition=Position&{scope_state?:string;source?:string;report_version?:number;display_order?:number;category?:string;absence_weight?:number;status_label?:string};
export type ReportContext={statuses:Status[];departments:{id:string;arabic_name:string;display_order?:number}[];shifts:{id:string;name:string;scope?:string}[];users:User[];user:User;evening_shift_id?:string;generated_at?:string;scope?:string;completeness?:Completeness[];handovers?:Record<string,unknown>[];communications?:Record<string,unknown>[]};
const scopeLabels:Record<string,string>={reported:'مصرّح به',unresolved:'غير محسوم',missing_report:'لم يرد تقرير',outside_roster:'خارج القائمة المؤرخة',future:'لم يحن التاريخ',assignment_unverified:'الانتماء المؤرخ غير موثق'};
const channelLabels:Record<string,string>={account:'حساب المشرف',message:'رسالة',phone:'هاتف',person:'حضوري'};
const directoryLabels:Record<string,string>={department:'القسم',permanent_code:'الكود الدائم',employee_number:'رقم الموظف',name:'الاسم',employment_status:'حالة العمل'};
export const directoryFields=Object.keys(directoryLabels);
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function validateSelection(s:Selection){
  if(!s||typeof s.kind!=='string'||typeof s.start!=='string'||typeof s.end!=='string')throw Error('حدد نوع التقرير والفترة');
  for(const field of ['department_id','employee_id','report_id','query','action_filter'] as const)if(s[field]!==undefined&&typeof s[field]!=='string')throw Error('مرشح التقرير غير صالح');
  if(s.directory_fields!==undefined&&(!Array.isArray(s.directory_fields)||s.directory_fields.some(f=>typeof f!=='string')))throw Error('حقول دليل الموظفين غير صالحة');
  if(s.print_mode!==undefined&&(typeof s.print_mode!=='string'||!['detail','management','department'].includes(s.print_mode)))throw Error('نمط الطباعة غير صالح');
  if(s.action_filter&&!['all','outstanding','mine','overdue','decision','completed'].includes(s.action_filter))throw Error('تصفية الإجراءات غير صالحة');
  if(!reportKinds.includes(s.kind as typeof reportKinds[number]))throw Error('نوع التقرير غير صالح');
  if(!validDate(s.start)||!validDate(s.end)||s.end<s.start)throw Error('فترة التقرير غير صالحة');
  if((Date.parse(s.end)-Date.parse(s.start))/86400000>366)throw Error('نطاق التقرير لا يتجاوز سنة');
  if(['monthly','department-monthly'].includes(s.kind)&&s.start.slice(0,7)!==s.end.slice(0,7))throw Error('اختر شهراً واحداً');
  if(s.kind==='department-monthly'&&!s.department_id)throw Error('اختر القسم للملخص الشهري');
  if(s.print_mode==='department'&&!s.department_id)throw Error('اختر القسم قبل طباعة نطاق القسم');
  if(s.kind==='employee'&&!s.employee_id)throw Error('اختر الموظف قبل تحميل الملخص الفردي');
  if(s.kind==='reporting'&&!s.report_id)throw Error('اختر تصريح القسم');
  if(s.directory_fields?.some(f=>!directoryFields.includes(f)))throw Error('حقل غير مسموح في دليل الموظفين');
  if(s.query&&s.query.length>160)throw Error('عبارة البحث طويلة');
}
function reference(s:Selection,at:string){let n=2166136261;for(const c of JSON.stringify([s.kind,s.start,s.end,s.department_id,s.employee_id,s.report_id,at]))n=Math.imul(n^c.charCodeAt(0),16777619);return `FUP-${s.start.replaceAll('-','')}-${(n>>>0).toString(16).toUpperCase().padStart(8,'0')}`;}
function baghdad(at:string){return new Intl.DateTimeFormat('ar-IQ',{timeZone:'Asia/Baghdad',dateStyle:'medium',timeStyle:'short'}).format(new Date(at));}
function eligible(x:DatedPosition){return !['outside_roster','future','assignment_unverified'].includes(x.scope_state||'');}
export function reportCounts(rows:{status:string;category?:string;absence_weight?:number;status_category?:string;status_weight?:number}[],statuses:Status[]){
  const c={expected:rows.length,present:0,absent:0,leave:0,other:0,unresolved:0,weighted:0};
  for(const row of rows){const configured=statuses.find(s=>s.code===row.status),category=row.status_category??row.category??configured?.category??'unresolved';const key=['present','absent','leave','other'].includes(category)?category as 'present'|'absent'|'leave'|'other':'unresolved';c[key]++;if(key==='absent')c.weighted+=row.status_weight??row.absence_weight??configured?.weight??1;}
  return c;
}
function section(name:string,headers:string[],rows:Cell[][],extra:Partial<ReportSection>={}):ReportSection{return{name,headers,rows,...extra};}

// This pure model is used by the screen and the permission-scoped reporting RPC.
// It never converts missing evidence into presence or absence.
export function reportTable(s:Selection,b:ReportContext,p:Position[]=[],employees:Employee[]=[],reports:Report[]=[],actions:Action[]=[]):ExportTable{
  validateSelection(s);
  if(b.scope&&b.scope!=='evening'&&!(s.kind==='directory'&&b.scope==='authorized-directory'))throw Error('نطاق التقرير لا يطابق نوعه');
  const dept=(id:string)=>b.departments.find(d=>d.id===id)?.arabic_name||'قسم غير محدد';
  const who=(id:string|null)=>b.users.find(u=>u.id===id)?.name||'غير محدد';
  const label=(id:string)=>b.statuses.find(t=>t.code===id)?.label||(id==='unresolved'?'غير محسوم':`حالة محفوظة: ${id}`);
  const rank=(id:string)=>b.departments.find(d=>d.id===id)?.display_order??b.departments.findIndex(d=>d.id===id);
  const sort=<T extends {department_id:string;name?:string;work_date?:string}>(xs:T[])=>xs.slice().sort((a,c)=>rank(a.department_id)-rank(c.department_id)||(a.name||'').localeCompare(c.name||'','ar')||(a.work_date||'').localeCompare(c.work_date||''));
  const allowedShift=b.evening_shift_id||b.shifts.find(x=>x.scope==='evening')?.id;
  const ps=sort((p as DatedPosition[]).filter(x=>x.work_date>=s.start&&x.work_date<=s.end&&(!allowedShift||!x.shift_id||x.shift_id===allowedShift)&&(!s.department_id||x.department_id===s.department_id)&&(!s.employee_id||x.employee_id===s.employee_id)&&(!s.query||`${x.name} ${x.internal_code}`.includes(s.query))));
  const rs=reports.filter(r=>r.work_date>=s.start&&r.work_date<=s.end&&(!allowedShift||!r.shift_id||r.shift_id===allowedShift)&&(!s.department_id||r.department_id===s.department_id));
  const expected=ps.filter(eligible),c=reportCounts(expected,b.statuses);
  const statusCodes=[...new Set([...b.statuses.map(x=>x.code),...expected.map(x=>x.status)])];
  const additional=statusCodes.filter(code=>b.statuses.find(x=>x.code===code)?.category==='other'||expected.some(x=>x.status===code&&x.category==='other'));
  const generated_at=b.generated_at||new Date().toISOString();
  const ref=reference(s,generated_at);
  const source_status=s.kind==='directory'?'سجل الموظفين وفق صلاحية الأقسام الحالية؛ ليس تصريح حضور ولا إثبات انتماء مسائي':s.kind==='employee'&&!ps.length?'الموظف معروف ومخوّل؛ لا توجد بيانات مسائية ضمن الفترة، ولا يُستنتج حضور أو غياب.':rs.length?`${rs.filter(r=>r.state==='reviewed').length} تمت مراجعتها / ${rs.length} تصريح · ${rs.some(r=>r.state!=='reviewed')?'يتضمن بيانات غير مراجعة':'المصدر مراجَع'}`:'لا توجد تصريحات مستلمة ضمن الفترة';
  const actionScope=({all:'كل الإجراءات',outstanding:'غير المكتملة',mine:'المسندة إليّ',overdue:'المتأخرة',decision:'بانتظار قرار',completed:'المغلقة'} as Record<string,string>)[s.action_filter||'all']||'كل الإجراءات';
  let scope=`${s.start} إلى ${s.end} · ${s.department_id?dept(s.department_id):'كل الأقسام المخوّلة'} · مسائي${s.employee_id?' · موظف محدد':''}${s.query?' · البحث: '+s.query:''}${s.kind==='actions'?` · ${actionScope} · مواعيد الاستحقاق كاملة (الفترة نطاق مصدر التصريحات فقط)`:''}`;
  if(s.kind==='directory')scope=`${s.start} إلى ${s.end} · ${s.department_id?dept(s.department_id):'كل الأقسام المخوّلة حالياً'} · دليل جميع الموظفين؛ لا يثبت انتماءً مسائياً${s.query?' · نتائج البحث المصرّح به':''}`;
  let footer=`الحضور المصرّح به · أيام الموظفين المؤكدة ${c.expected} = حاضر ${c.present} + غائب ${c.absent} + إجازة ${c.leave} + أخرى ${c.other} + غير محسوم ${c.unresolved} · وزن الغياب ${c.weighted} · الانتماء غير الموثق ${ps.filter(x=>x.scope_state==='assignment_unverified').length} · مراجعة التصريح لا تخوّل خصماً أو عقوبة`;
  const legend=['ح = حاضر مصرّح به؛ غ1/غ2/غ3 = غياب بوزن 1/2/3، كل رمز يمثل موظفاً واحداً','إ = إجازة؛ ؟ = غير محسوم؛ بلا تقرير = غياب الإبلاغ وليس غياب الموظف','خارج = خارج القائمة المؤرخة؛ مستقبل = لم يحن التاريخ؛ غير موثق = لا دليل على الانتماء المؤرخ','ر = مراجَع؛ م = مقدّم؛ س = مسودة؛ ع = معاد للتصحيح؛ الأرقام الملحقة هي إصدار التصريح',...additional.map((code,i)=>`أ${i+1} = ${label(code)} (${code})`)];
  const totalsHeaders=['أيام الموظفين','حاضر','غائب (أشخاص/أيام)','إجازة','أخرى','غير محسوم','وزن الغياب',...additional.map(label)];
  const totals=(xs:DatedPosition[])=>{const ys=xs.filter(eligible),t=reportCounts(ys,b.statuses);return[t.expected,t.present,t.absent,t.leave,t.other,t.unresolved,t.weighted,...additional.map(code=>ys.filter(x=>x.status===code).length)];};
  const departmentIds=b.departments.slice().sort((a,d)=>rank(a.id)-rank(d.id)).filter(d=>!s.department_id||d.id===s.department_id).map(d=>d.id);
  const byDepartment=section('ملخص الأقسام',['القسم',...totalsHeaders],departmentIds.map(id=>[dept(id),...totals(ps.filter(x=>x.department_id===id))]),{identityColumns:1});
  const groups=new Map<string,DatedPosition[]>();for(const x of ps){if(!groups.has(x.employee_id))groups.set(x.employee_id,[]);groups.get(x.employee_id)!.push(x);}
  const grouped=[...groups.values()].sort((a,d)=>{const aa=a.slice().sort((x,y)=>x.work_date.localeCompare(y.work_date)).at(-1)!,dd=d.slice().sort((x,y)=>x.work_date.localeCompare(y.work_date)).at(-1)!;return rank(aa.department_id)-rank(dd.department_id)||aa.name.localeCompare(dd.name,'ar');});
  const employeeSummary=section('ملخص الموظفين',['القسم بنهاية النطاق','الكود الدائم','الموظف',...totalsHeaders],grouped.map(xs=>{const last=xs.slice().sort((a,d)=>a.work_date.localeCompare(d.work_date)).at(-1)!;return[dept(last.department_id),last.internal_code,last.name,...totals(xs)];}),{row_ids:grouped.map(xs=>xs[0].employee_id),identityColumns:3});
  const completeness=(b.completeness||[]).filter(x=>x.work_date>=s.start&&x.work_date<=s.end&&(!s.department_id||x.department_id===s.department_id)).sort((a,d)=>a.work_date.localeCompare(d.work_date)||rank(a.department_id)-rank(d.department_id));
  const required=(x:Completeness)=>x.required??(typeof x.expected==='boolean'?x.expected:true);
  const gaps=section('اكتمال الإبلاغ',['التاريخ','القسم','مطلوب','القائمة المؤكدة','ورد إبلاغ','مقدّم','مراجَع','غير محسوم','استثناءات','حالة المصدر'],completeness.map(x=>[x.work_date,dept(x.department_id),required(x)?'مطلوب':'غير مطلوب',x.roster_count??(typeof x.expected==='number'?x.expected:0),Number(x.reported||0),Number(x.submitted||0),Number(x.reviewed||0),x.unresolved??0,x.exceptions??x.unverified_assignments??0,states[x.state||'']||scopeLabels[x.state||'']||x.state||'غير محدد']),{note:'المقام: عدد الأقسام ذات قائمة مسائية مؤرخة مؤكدة أو دليل تصريح مسائي. الأقسام غير الموثقة تعرض كاستثناء ولا تُعامل كمكتملة.'});
  const scopedActions=actions.filter(a=>(!s.department_id||a.department_id===s.department_id)&&(!s.employee_id||a.employee_id===s.employee_id));
  const filterDate=today();
  const as=scopedActions.filter(a=>s.action_filter==='outstanding'?a.state!=='completed':s.action_filter==='mine'?a.responsible_id===b.user.id:s.action_filter==='overdue'?a.state!=='completed'&&a.due_date<filterDate:s.action_filter==='decision'?a.state==='decision':s.action_filter==='completed'?a.state==='completed':true).sort((a,d)=>a.due_date.localeCompare(d.due_date)||rank(a.department_id)-rank(d.department_id));
  const actionRows=section('النواقص والإجراءات',['القسم','الكود الدائم','الموظف','الإجراء','المسؤول','الاستحقاق','الحالة','الملاحظات','تفاصيل الإغلاق'],as.map(a=>{const e=employees.find(x=>x.id===a.employee_id)||ps.find(x=>x.employee_id===a.employee_id);return[dept(a.department_id),e?.internal_code||'',e?.name||'إجراء قسم',a.description,who(a.responsible_id),a.due_date,actionStates[a.state]||a.state,a.notes||'',a.completion||''];}),{identityColumns:3,columnWeights:[15,14,20,34,18,13,16,30,30]});
  const exceptions=section('سجل الاستثناءات',['التاريخ','القسم','الكود الدائم','الموظف','الاستثناء','مرجع التصريح'],ps.filter(x=>['assignment_unverified','unresolved','missing_report'].includes(x.scope_state||'')||x.completeness==='exception'||x.status==='unresolved'&&eligible(x)).map(x=>[x.work_date,dept(x.department_id),x.internal_code,x.name,x.completeness==='exception'?'تعارض يحتاج تسوية':scopeLabels[x.scope_state||'']||'غير محسوم',x.report_id||'لا يوجد']),{identityColumns:4});
  const management=section('ملخص الإدارة',['البند','القيمة'],[['أيام الموظفين المؤكدة',c.expected],['الحضور المصرّح به',c.present],['الغياب (أشخاص/أيام)',c.absent],['وزن الغياب',c.weighted],['إجازة',c.leave],['حالات أخرى',c.other],['غير محسوم',c.unresolved],['استثناءات موظف/يوم',exceptions.rows.length],['الأقسام المقدّمة / المطلوبة',`${completeness.filter(x=>required(x)&&x.submitted).length} / ${completeness.filter(required).length}`],['الأقسام المراجَعة / المطلوبة',`${completeness.filter(x=>required(x)&&x.reviewed).length} / ${completeness.filter(required).length}`],['الإجراءات غير المكتملة',scopedActions.filter(a=>a.state!=='completed').length]],{note:'الاكتمال يقيس إبلاغ الأقسام ضمن اليوم/الفترة. لا يمثل تقييم أداء الموظفين.'});
  let main:ReportSection,sections:ReportSection[]=[];
  let title='الموقف اليومي الشامل';
  if(s.kind==='reporting'){
    const r=rs.find(x=>x.id===s.report_id);if(!r)throw Error('التصريح غير متاح ضمن صلاحيتك أو الفترة المختارة');
    const reporter=(r as Report&{reported_by_name?:string}).reported_by_name||r.reporter_name||who(r.reporter_id);
    const entries=r.entries.slice().sort((a,d)=>a.employee_name.localeCompare(d.employee_name,'ar'));
    title='سجل التبليغ اليومي';main=section(title,['الكود الدائم','الموظف','الحالة'],entries.map(e=>[e.permanent_code,e.employee_name,(e as typeof e&{status_label?:string}).status_label||label(e.status)]),{row_ids:entries.map(e=>e.employee_id),identityColumns:2});
    const rc=reportCounts(r.entries,b.statuses);
    sections=[section('بيانات التصريح',['البند','القيمة'],[['القسم',dept(r.department_id)],['تاريخ الخدمة',r.work_date],['المبلّغ',reporter],['مدخل البيانات',r.entered_by_name||who(r.entered_by)],['قناة الإبلاغ',channelLabels[r.channel]||r.channel],['الحالة / الإصدار',`${states[r.state]||r.state} / ${r.version}`],['وقت التقديم',r.submitted_at||'لم يُقدّم'],['ملاحظة / مرجع',r.note||''],['سبب الإرجاع',r.return_reason||''],['القائمة / حاضر / غائب / إجازة / أخرى / غير محسوم / الوزن',`${rc.expected} / ${rc.present} / ${rc.absent} / ${rc.leave} / ${rc.other} / ${rc.unresolved} / ${rc.weighted}`]]),main];
  }else if(s.kind==='directory'){
    title='دليل الموظفين';const fields=s.directory_fields?.length?s.directory_fields:['department','permanent_code','name','employment_status'];
    // Search is authoritative at the permission-scoped SQL read.
    const es=sort(employees.filter(e=>(!s.department_id||e.department_id===s.department_id)&&(!s.employee_id||e.id===s.employee_id)));
    footer=`دليل ${es.length} موظف ضمن صلاحية الأقسام الحالية، بما فيهم غير الموثّقين مسائياً. ليس إبلاغ حضور أو غياب.`;
    main=section(title,fields.map(f=>directoryLabels[f]),es.map(e=>fields.map(f=>f==='department'?dept(e.department_id):f==='permanent_code'?e.internal_code:f==='employee_number'?e.employee_number||'':f==='name'?e.name:({active:'نشط',inactive:'غير نشط',resigned:'مستقيل',long_leave:'إجازة طويلة'} as Record<string,string>)[e.employment_status]||e.employment_status)),{row_ids:es.map(e=>e.id),identityColumns:Math.min(fields.length,3)});sections=[main];
  }else if(['monthly','department-monthly'].includes(s.kind)){
    title=s.kind==='monthly'?'الموقف الشهري الشامل':'ملخص القسم الشهري';const days=Number(monthEnd(s.start.slice(0,7)).slice(8));
    const symbol=(x:DatedPosition)=>{if(x.scope_state&&x.scope_state!=='reported'&&x.scope_state!=='unresolved')return({missing_report:'بلا تقرير',outside_roster:'خارج',future:'مستقبل',assignment_unverified:'غير موثق'} as Record<string,string>)[x.scope_state]||scopeLabels[x.scope_state];const code=({present:'ح',absent1:'غ1',absent2:'غ2',absent3:'غ3',leave:'إ',unresolved:'؟'} as Record<string,string>)[x.status]||(additional.includes(x.status)?`أ${additional.indexOf(x.status)+1}`:x.status_label||label(x.status));return `${code} · ${({submitted:'م',reviewed:'ر',draft:'س',returned:'ع',missing:'—'} as Record<string,string>)[x.review_state]||x.review_state}${x.report_version?x.report_version:''}${x.completeness==='exception'?' تعارض':''}`;};
    const dayCell=(xs:DatedPosition[],day:number)=>{const date=`${s.start.slice(0,7)}-${String(day).padStart(2,'0')}`;if(date>s.end||date<s.start)return'خارج النطاق';const ds=xs.filter(x=>x.work_date===date);return ds.length?ds.map(symbol).join(' / '):date>today()?'مستقبل':'خارج';};
    const identity=(xs:DatedPosition[])=>{const last=xs.slice().sort((a,d)=>a.work_date.localeCompare(d.work_date)).at(-1)!;return[dept(last.department_id),last.internal_code,last.name];};
    main=section(title,['القسم بنهاية النطاق','الكود الدائم','الموظف',...Array.from({length:days},(_,i)=>String(i+1)),...totalsHeaders],grouped.map(xs=>[...identity(xs),...Array.from({length:days},(_,i)=>dayCell(xs,i+1)),...totals(xs)]),{row_ids:grouped.map(xs=>xs[0].employee_id),identityColumns:3,note:'صف واحد لكل UUID. التجميع حسب القسم في آخر تاريخ داخل النطاق، والأدلة اليومية تبقى في تاريخها. المجاميع تظهر مرة واحدة في ملخص الموظفين ولا تجمع عبر مقاطع التواريخ.'});
    sections=[...[[1,15],[16,days]].filter(([from,to])=>from<=to).map(([from,to])=>section(`الأيام ${from} إلى ${to}`,['القسم بنهاية النطاق','الكود الدائم','الموظف',...Array.from({length:to-from+1},(_,i)=>String(from+i))],grouped.map(xs=>[...identity(xs),...Array.from({length:to-from+1},(_,i)=>dayCell(xs,from+i))]),{row_ids:main.row_ids,identityColumns:3,columnWeights:[22,20,31,...Array(to-from+1).fill(9)],note:main.note})),employeeSummary];
  }else if(s.kind==='actions'){title='إجراءات المتابعة والمواعيد';main=actionRows;sections=[main];
  }else if(s.kind==='completeness'){title='اكتمال الإبلاغ وسجل الاستثناءات';main=gaps;sections=[management,gaps,exceptions,actionRows];
  }else if(s.kind==='handover'){
    title='التسليم المسائي والملخص الإداري';main=section('التسليم المسائي',['القسم','اكتمال الإبلاغ','غير محسوم','إجراءات مفتوحة','المسؤول / الإجراء التالي'],departmentIds.map(id=>{const cs=completeness.filter(x=>x.department_id===id);const pending=scopedActions.filter(a=>a.department_id===id&&a.state!=='completed');return[dept(id),`${cs.filter(x=>x.reviewed).length} مراجَع / ${cs.filter(x=>x.required!==false).length} مطلوب`,ps.filter(x=>x.department_id===id&&eligible(x)&&x.status==='unresolved').length,pending.length,pending.map(a=>`${who(a.responsible_id)}: ${a.description} (${a.due_date})`).join('؛ ')||'لا إجراء مسجل'];}),{columnWeights:[18,22,12,12,48]});
    sections=[management,main,section('سجلات التسليم المحفوظة',['التاريخ','القسم','المكتمل','المتبقي','المسؤول','الخطوة التالية'],(b.handovers||[]).map(h=>[String(h.work_date||''),dept(String(h.department_id||'')),String(h.completed||h.completed_summary||''),String(h.remaining||h.remaining_summary||''),who(String(h.owner_id||h.responsible_id||'')),String(h.next_action||'')]))];
  }else{
    title=s.kind==='employee'?'ملخص الموظف الفردي':'الموقف اليومي الشامل';
    main=section(title,['القسم المؤرخ','الكود الدائم','الموظف','التاريخ','الحالة المصرّح بها','حالة النطاق / الاكتمال','المراجعة / الإصدار','المصدر'],ps.map(x=>[dept(x.department_id),x.internal_code,x.name,x.work_date,eligible(x)?x.status_label||label(x.status):'لا تُحتسب',scopeLabels[x.scope_state||'']||(x.completeness==='exception'?'تعارض يحتاج تسوية':x.completeness==='complete'?'مكتمل':x.completeness==='partial'?'جزئي':'لم يرد تقرير'),`${states[x.review_state]||x.review_state}${x.report_version?' / '+x.report_version:''}`,x.source||x.report_id||'بلا دليل']),{row_ids:ps.map(x=>x.employee_id),identityColumns:3,columnWeights:[20,18,26,15,18,27,22,24]});sections=s.kind==='employee'?[employeeSummary,main,actionRows]:[management,byDepartment,main];
  }
  const dictionary=section('دليل الرموز والبيانات',['المصطلح','التعريف'],[['النطاق',s.kind==='directory'?'كل الموظفين ضمن صلاحية الأقسام الحالية؛ لا يثبت انتماءً مسائياً':'قسم المتابعة - مسائي فقط'],['المصدر',s.kind==='directory'?'سجل الموظفين الحالي حسب الأقسام المخوّلة':'تصريحات الأقسام وليست بصمات بيومترية'],['المجاميع',s.kind==='directory'?'عدد سجلات الموظفين المعروضة؛ لا يمثل تعداد الحضور':'أيام الموظفين المؤكدة فقط؛ المستقبل وخارج القائمة والانتماء غير الموثق لا يدخلون مقام الحضور'],['الغياب المرجح','عدد الأيام بحسب وزن الحالة؛ الموظف الغائب ×3 يظل شخصاً واحداً'],['الخصوصية','الدليل يتضمن الحقول المهنية المسموحة المختارة فقط. لا هواتف أو وثائق خاصة.'],...legend.map((x,i)=>[`رمز ${i+1}`,x]),['مرجع التقرير',ref],['وقت التوليد - بغداد',baghdad(generated_at)],['حالة المصدر',source_status]]);
  if(['monthly','department-monthly'].includes(s.kind))sections.push(section('دليل رموز الموقف الشهري',['الرمز / المصطلح','التعريف'],legend.map((value,i)=>[String(i+1),value])));
  const sheets=s.kind==='directory'?[main,dictionary]:['monthly','department-monthly'].includes(s.kind)?[management,main,byDepartment,employeeSummary,section('سجل الاستثناءات',exceptions.headers,exceptions.rows),actionRows,dictionary]:[...sections,dictionary];
  const unique=sheets.filter((x,i,xs)=>xs.findIndex(y=>y.name===x.name)===i);
  return {...main,title,scope,footer,selection:s,reference:ref,generated_at,source_status,legend,sections:s.print_mode==='management'&&s.kind!=='directory'?[management,byDepartment,gaps,actionRows]:sections,sheets:unique,scope_kind:s.kind==='directory'?'authorized-directory':'evening'};
}
