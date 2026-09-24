"use client";
import {useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {FileDown,FileSpreadsheet,Printer,ArrowUpLeft,RotateCcw} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useData} from '@/lib/hr/api';
import {baghdadDate,departmentLabel,employmentLabels,statuses,type Reference} from '@/lib/hr/types';
import {scopeMonthlyPosition,monthlyCellText,monthlyMatrixRows,monthlyStateLabels,minuteText,type MonthlyPosition,type MonthlyPerson,type MonthlyCell} from '@/lib/hr/monthly-position.mjs';
import {download,tableExcelBytes,tablePdfBytes} from '@/lib/hr/exports';
import {Choice,Field,LoadState,PageTitle,SearchBox} from './shared';
import {BrandImage} from './brand-image';

const lifecycle:Record<string,string>={preview:'معاينة غير معتمدة',reviewed:'تمت المراجعة · بانتظار الاعتماد',approved:'حضور معتمد',cancelled:'ملغى · للرجوع فقط',superseded:'مستبدل · للرجوع فقط'};
const conditions=[{value:'with_punch',label:'لديها بصمات'},{value:'complete',label:'دخول وخروج'},{value:'incomplete',label:'بصمات ناقصة'},{value:'no_punch',label:'لا توجد بصمات'},{value:'pending',label:'تحتاج مراجعة'},{value:'unmatched',label:'هوية غير مطابقة'}];
const summaryHeaders=['الكود الوظيفي','الموظف','القسم','البصمات الخام في الملف','البصمات الفعلية في الملف','أيام ببصمة','دخول وخروج','بصمات ناقصة','تواريخ بلا بصمات','تحتاج مراجعة','دقائق عمل موثقة','دقائق تأخير','أول دليل في الملف','آخر دليل في الملف'];
const summaryValues=(r:MonthlyPerson)=>([r.internal_code||'غير مطابق',r.name,r.department,r.raw_punch_count,r.effective_punch_count,r.summary.with_punch,r.summary.complete,r.summary.incomplete,r.summary.no_punch,r.summary.pending,r.summary.worked_minutes,r.summary.late_minutes,r.first_evidence||'—',r.last_evidence||'—']);
const matrixHeaders=(from:number,to:number)=>['الكود الوظيفي','الموظف','القسم','الحركة',...Array.from({length:to-from+1},(_,i)=>String(from+i)),'مكتمل','ناقص','بلا بصمات','مراجعة','دقائق موثقة'];
const hourDuration=(m:number)=>`${Math.floor(m/60)} س ${m%60} د`;
const reportDate=(date:string)=>new Intl.DateTimeFormat('ar-IQ',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Baghdad'}).format(new Date(date+'T12:00:00Z'));
const exportLegend='+1 خروج اليوم التالي؛ ناقص خروج غير مسجل؛ — لا قيمة موثقة. الملخص الشهري مكرر للرجوع ولا يُجمع عبر أجزاء الأيام.';

export function MonthlyPositionPage({reference,importId,period,embedded=false,initialView='matrix',localPosition}:{reference:Reference;importId?:string;period?:string;embedded?:boolean;initialView?:'matrix'|'dashboard'|'summary';localPosition?:MonthlyPosition}) {
 const params=useSearchParams();
 const [month,setMonth]=useState(period||params.get('month')||baghdadDate().slice(0,7));
 const selectedImport=importId||params.get('import_id')||undefined;
 const [view,setView]=useState(initialView),[search,setSearch]=useState(''),[dep,setDep]=useState(''),[manager,setManager]=useState(''),[condition,setCondition]=useState(params.get('condition')||'');
 const [from,setFrom]=useState(''),[through,setThrough]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[exporting,setExporting]=useState(false);
 const [exportFileLink,setExportFileLink]=useState<{url:string;name:string;bytes:number}|null>(null);
 const [exportError,setExportError]=useState('');
 useEffect(()=>()=>{if(exportFileLink)URL.revokeObjectURL(exportFileLink.url);},[exportFileLink]);
 const q=useData<MonthlyPosition>('attendance.monthly_position',{month:period||month,import_id:selectedImport,coverage_start:from,coverage_end:through},!localPosition);
 const source=localPosition||q.data;
 const position=source?scopeMonthlyPosition(source,{search,department_id:dep,manager_id:manager,condition}):undefined;
 const selectedPerson=position?.rows.find(r=>r.key===selected)||null;
 const activeFilters=[search,dep,manager,condition,from,through].filter(Boolean).length;
 const scopeLabel=[period||month,position?.coverage?`${position.coverage.start} - ${position.coverage.end}`:'التغطية غير متاحة',lifecycle[position?.batch?.lifecycle_state||'preview'],dep?reference.departments.find(d=>d.id===dep)?.arabic_name:'كل الأقسام',manager?reference.managers.find(m=>m.id===manager)?.name:'كل المسؤولين',condition?conditions.find(c=>c.value===condition)?.label:'كل الحالات',search?`بحث: ${search}`:''].filter(Boolean).join(' · ');
 async function exportFile(pdf:boolean,detail?:MonthlyPerson) {
  if(!position?.available||exporting)return;setExporting(true);setExportError('');
  try{
   const detailRows=detail?Object.values(detail.cells).filter(c=>c.state!=='filtered').map(c=>[c.date,monthlyCellText(c,'entry'),monthlyCellText(c,'exit'),monthlyStateLabels[c.state],c.duration??'غير متاح',c.late_minutes??'غير متاح',c.timeline.map(p=>`${p.calendar_date} ${minuteText(p.minute)} [${p.source_sheet}:${p.source_row}]`).join('\n'),c.manual?statuses[c.manual.status_type as keyof typeof statuses]?.label||c.manual.status_type:'']):null;
   const exportScope=scopeLabel.replace(period||month,reportDate((period||month)+'-01')).replace(position.coverage?.start||'__none__',position.coverage?reportDate(position.coverage.start):'').replace(position.coverage?.end||'__none__',position.coverage?reportDate(position.coverage.end):'');
   const report={title:detail?`${detail.internal_code||'هوية غير مطابقة'} · ${detail.name}`:view==='summary'?'ملخص البصمة الشهري':'الموقف الشهري بالبصمة',period:exportScope+' · '+exportLegend,
    headers:detail?['تاريخ الوردية','دخول','خروج','الحالة','دقائق العمل','دقائق التأخير','الأدلة التقويمية','قرار HR']:view==='summary'?summaryHeaders:matrixHeaders(1,position.days),
    rows:detailRows|| (view==='summary'?position.rows.map(summaryValues):monthlyMatrixRows(position)),
    columnWeights:detail?[8,7,7,15,7,7,25,10]:undefined,
    ...(pdf&&!detail&&view!=='summary'?{segments:Array.from({length:Math.ceil(position.days/10)},(_,i)=>({headers:matrixHeaders(i*10+1,Math.min(position.days,i*10+10)),rows:monthlyMatrixRows(position,i*10+1,Math.min(position.days,i*10+10)),columnWeights:[10,18,13,5,...Array(Math.min(10,position.days-i*10)).fill(6),5,5,5,5,7]}))}:{}),
   };
   const bytes=pdf?await tablePdfBytes(report):tableExcelBytes(report);
   const name=`FANU-fingerprint-${position.month}${detail?'-employee':''}.${pdf?'pdf':'xlsx'}`;
   const mime=pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
   setExportFileLink({url:URL.createObjectURL(new Blob([bytes as BlobPart],{type:mime})),name,bytes:bytes.length});
   download(bytes,name,mime);
  }catch(e){const message=(e as Error).message||'تعذر تصدير التقرير';setExportError(message);toast.error(message);}finally{setExporting(false);}
 }
 return <section className={`monthly-workspace ${embedded?'monthly-embedded':''}`} aria-label="الموقف الشهري بالبصمة">
  {!embedded&&<PageTitle title="الموقف الشهري بالبصمة" subtitle="دليل البصمة مستقل عن قرارات HR اليدوية" actions={<Button asChild><Link href="/fingerprint-monthly">فتح ملفات الشهر <ArrowUpLeft size={16}/></Link></Button>}/>}
  <div className="monthly-filter-panel no-print">
   <div className="filterbar">
    {!embedded&&<Field label="الشهر والسنة"><Input type="month" value={month} onChange={e=>{setMonth(e.target.value);setFrom('');setThrough('');setSelected(null);}}/></Field>}
    <SearchBox value={search} onChange={setSearch} placeholder="الاسم، الكود الوظيفي أو رقم البصمة"/>
    <Choice label="القسم الحالي" value={dep} onChange={setDep} options={reference.departments.map(d=>({value:d.id,label:departmentLabel(d)}))}/>
    <Choice label="المسؤول بنهاية الشهر" value={manager} onChange={setManager} options={reference.managers.map(m=>({value:m.id,label:m.name}))}/>
    <Choice label="حالة البصمة" value={condition} onChange={setCondition} options={conditions}/>
   </div>
   <div className="scope-toolbar">
    <span>{activeFilters?`${activeFilters} فلاتر فعالة`:'كل النتائج ضمن الملف والفترة'}</span>
    {!!activeFilters&&<Button variant="ghost" onClick={()=>{setSearch('');setDep('');setManager('');setCondition('');setFrom('');setThrough('');}}><RotateCcw size={15}/>مسح الفلاتر</Button>}
    {!localPosition&&position?.coverage&&<details><summary>نطاق التغطية</summary><div className="flex flex-wrap gap-3 p-3"><Field label="من تاريخ"><Input type="date" value={from||position.coverage.start} onChange={e=>setFrom(e.target.value)}/></Field><Field label="إلى تاريخ"><Input type="date" value={through||position.coverage.end} onChange={e=>setThrough(e.target.value)}/></Field><p className="scope-note">تغيير النطاق هنا يرشح العرض فقط؛ لا يعدل أدلة الملف أو اعتماده.</p></div></details>}
   </div>
  </div>
  <LoadState loading={!localPosition&&q.loading&&!q.data} error={localPosition?'':q.error} retry={q.refresh}>
   {exportError&&<p role="alert" className="workflow-notice">تعذر تجهيز التقرير: {exportError}</p>}
   {exportFileLink&&<div role="status" className="workflow-notice no-print">تم تجهيز التقرير ({Math.ceil(exportFileLink.bytes/1024)} كيلوبايت). إذا لم يبدأ التنزيل: <a className="employee-link" href={exportFileLink.url} download={exportFileLink.name}>تنزيل <bdi>{exportFileLink.name}</bdi></a></div>}
   {!position?.available?<div className="monthly-unavailable"><h2>لا يوجد ملف شهري معتمد لهذه الفترة</h2><p>الأرقام غير متاحة، وليست صفراً. افتح معاينة ملف لمراجعة الأدلة؛ لا يظهر في الموقف الرسمي إلا بعد الاعتماد الصريح.</p><Button asChild variant="outline"><Link href="/fingerprint-monthly">ملفات البصمة الشهرية</Link></Button></div>:<>
    <div className="monthly-provenance" data-state={position.batch?.lifecycle_state}>
     <div><strong>{lifecycle[position.batch?.lifecycle_state||'preview']}</strong><span>{position.batch?.source_name||'معاينة محلية قبل الحفظ'}</span></div>
     <div><strong dir="ltr">{position.coverage?.start} — {position.coverage?.end}</strong><span>{position.coverage?.confirmed?'نطاق التغطية الذي حُدد عند الاستيراد':'نطاق الأدلة المرصودة · اكتمال جمع البصمات غير مؤكد'}</span></div>
     {position.batch?.approved_at&&<div><span>آخر اعتماد</span><time>{new Date(position.batch.approved_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})}</time></div>}
    </div>
    <p className="scope-note">مطابقة المصدر الأصلي كاملاً — هذه الأعداد لا تتغير بفلاتر العرض أدناه.</p>
    <div className="monthly-source-strip">
     <span><b>{position.source_counts?.identities}</b> هوية مصدر</span><span><b>{position.source_counts?.matched_identities}</b> مطابقة</span><span><b>{position.source_counts?.populated_cells}</b> خلية ممتلئة</span><span><b>{position.source_counts?.raw_punches}</b> بصمة خام</span><span><b>{position.source_counts?.effective_punches}</b> بصمة بعد دمج التكرار</span>
    </div>
    <p className="scope-note">النطاق: هويات الملف، بما فيها غير النشطين وغير المطابقين. «بلا بصمات» ليس غياباً؛ تواريخ الخدمة وسجل نقل الأقسام المؤرخ غير متاحين. القسم المعروض حالي. لا تخلط هذه الأعداد مع عدد الموظفين النشطين أو الموقف الشامل اليدوي.</p>
    {!!position.daily_overlap_rows&&<p className="workflow-notice">توجد {position.daily_overlap_rows} سجلات يومية تتقاطع مع فترة وأشخاص الملف. لا تدخل في الحساب الشهري ولا تضاعف الحضور.</p>}
    {position.other_approved&&<p className="workflow-notice">يوجد ملف معتمد آخر: {position.other_approved.source_name}. هذه معاينة فقط؛ تغييره يتطلب الاستبدال الصريح بصلاحية الإدارة.</p>}
    <div className="monthly-view-toolbar no-print">
     <div className="segmented-control" role="group" aria-label="عرض البصمة الشهرية">{([['matrix','الموقف الشهري'],['dashboard','لوحة المؤشرات'],['summary','ملخص الموظفين']] as const).map(([value,label])=><Button key={value} variant={view===value?'default':'ghost'} aria-pressed={view===value} onClick={()=>setView(value)}>{label}</Button>)}</div>
     <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={exporting||!position.rows.length} onClick={()=>exportFile(false)}><FileSpreadsheet size={16}/>Excel</Button><Button variant="outline" disabled={exporting||!position.rows.length} onClick={()=>exportFile(true)}><FileDown size={16}/>PDF</Button><Button variant="outline" onClick={()=>window.print()}><Printer size={16}/>طباعة</Button></div>
    </div>
    {view==='dashboard'?<div className="monthly-dashboard-grid">
     {([['هويات في العرض',position.metrics?.employees,''],['هويات لديها بصمات',position.metrics?.with_punch,'with_punch'],['أيام دخول وخروج موثق',position.metrics?.complete,'complete'],['أيام ببصمات ناقصة',position.metrics?.incomplete,'incomplete'],['تواريخ بلا بصمات مسجلة',position.metrics?.no_punch,'no_punch'],['أيام تحتاج مراجعة',position.metrics?.pending,'pending']] as const).map(([label,value,filter])=><button key={label} onClick={()=>{setCondition(filter);setView('matrix');}}><span>{label}</span><strong>{value??'غير متاح'}</strong><small>{filter&&filter!=='with_punch'?'موظف / يوم · ضمن النطاق المعروض':'هويات الملف ضمن الفلاتر'}</small><ArrowUpLeft size={16}/></button>)}
     <article><span>مدة العمل الموثقة</span><strong>{hourDuration(position.metrics?.worked_minutes||0)}</strong><small>الأزواج المكتملة فقط؛ لا تُحسب الناقصة أو الملتبسة</small></article>
     <article><span>مجموع التأخير المحسوب</span><strong>{position.metrics?.late_minutes} دقيقة</strong><small>حسب الدوام المؤرخ المتاح؛ ليس اقتطاعاً مالياً</small></article>
     {selectedImport&&<Button asChild variant="outline"><Link href={`/fingerprint-issues?import_id=${selectedImport}&import_kind=monthly`}>مجموعات مراجعة الهوية: {position.source_counts?.open_issue_groups} <ArrowUpLeft size={16}/></Link></Button>}
    </div>:view==='summary'?<div className="table-card monthly-scroll" tabIndex={0} role="region" aria-label="ملخص الموظفين الشهري"><table><thead><tr>{summaryHeaders.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{position.rows.map(r=><tr key={r.key}>{summaryValues(r).map((v,i)=><td key={i}>{i===1?<button className="employee-link" onClick={()=>setSelected(r.key)}>{v}</button>:<bdi>{v}</bdi>}</td>)}</tr>)}</tbody></table></div>:<MonthlyMatrix position={position} onEmployee={setSelected}/>}
    <div className="monthly-legend"><strong>دليل القراءة</strong><span>+1: خروج في اليوم التالي</span><span>ناقص: دخول بلا خروج</span><span>؟: يحتاج مطابقة أو تفسيراً</span><span>—: لا توجد قيمة موثقة أو خارج التغطية</span><span>HR: قرار يدوي مستقل</span><span>اضغط خلية لعرض الأدلة والتحذيرات</span></div>
    {view!=='summary'&&<MonthlyPrint position={position} scopeLabel={scopeLabel}/>}
    <p className="scope-note">بداية الوردية ونهايتها تتبعان نافذة الدوام الفعلية. بصمة صباح اليوم قد تخص اليوم السابق؛ لا تُستعمل بصمة عصر اليوم التالي كخروج سابق. لا تُخترع مدة عند غياب الإعدادات أو الدليل.</p>
   </>}
  </LoadState>
  <Dialog open={!!selectedPerson} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="monthly-detail-dialog"><DialogHeader><DialogTitle>{selectedPerson?.name} <bdi>{selectedPerson?.internal_code||'هوية غير مطابقة'}</bdi></DialogTitle><DialogDescription>الأدلة الأصلية وتواريخها لا تتغير عند حساب تاريخ الوردية.</DialogDescription></DialogHeader>{selectedPerson&&<>
   <div className="profile-strip"><span>رقم البصمة: <bdi>{selectedPerson.person_codes.join(' / ')}</bdi></span><span>{selectedPerson.department}</span><span>{selectedPerson.employment_status?employmentLabels[selectedPerson.employment_status as keyof typeof employmentLabels]:'غير مطابق'}</span><span>{selectedPerson.raw_punch_count} بصمة خام / {selectedPerson.summary.complete} يوم مكتمل</span></div>
   <div className="flex flex-wrap gap-2"><Button disabled={exporting} variant="outline" onClick={()=>exportFile(false,selectedPerson)}>Excel للتفاصيل</Button><Button disabled={exporting} variant="outline" onClick={()=>exportFile(true,selectedPerson)}>PDF للتفاصيل</Button>{selectedPerson.employee_id&&<Button asChild variant="outline"><Link href={`/employees/${selectedPerson.employee_id}`}>ملف الموظف</Link></Button>}{selectedImport&&<Button asChild variant="outline"><Link href={`/fingerprint-issues?import_id=${selectedImport}&import_kind=monthly`}>معالجة مشاكل الملف</Link></Button>}</div>
   <p className="scope-note">أول دليل في الملف: <bdi>{selectedPerson.first_evidence||'غير متاح'}</bdi> · آخر دليل: <bdi>{selectedPerson.last_evidence||'غير متاح'}</bdi> · أعداد الأيام والمدة تتبع الفلاتر؛ أعداد البصمات الخام والفعلية تخص أدلة الموظف في الملف كاملاً.</p>
   <Choice label="تصفية الأيام" value={condition} onChange={setCondition} options={conditions}/>
   {!!selectedPerson.unassigned_timeline.length&&<details className="workflow-notice"><summary>{selectedPerson.unassigned_timeline.length} بصمة تحتاج إعداد دوام أو دليل حدود الشهر</summary><PunchTimeline punches={selectedPerson.unassigned_timeline}/></details>}
   <div className="monthly-days">{Object.values(selectedPerson.cells).filter(c=>c.state!=='filtered').map(c=><DayEvidence key={c.date} cell={c}/>)}</div>
  </>}</DialogContent></Dialog>
 </section>;
}

function MonthlyPrint({position,scopeLabel}:{position:MonthlyPosition;scopeLabel:string}) {
 return <div className="monthly-print">{Array.from({length:Math.ceil(position.days/10)},(_,i)=>{
  const from=i*10+1,to=Math.min(position.days,from+9);
  const rows=monthlyMatrixRows(position,from,to);
  return <section key={from} className="monthly-print-segment"><div className="print-brand"><BrandImage kind="header" alt="FANU ALNASIJ — قسم الموارد البشرية – مسائي"/></div><h2>الموقف الشهري بالبصمة · أيام {from}–{to}</h2><p>{scopeLabel}</p><table><thead><tr>{matrixHeaders(from,to).map(h=><th key={h}>{h}</th>)}</tr></thead>{position.rows.map((r,n)=><tbody key={r.key}>{[0,1].map(k=><tr key={k}>{rows[n*2+k].map((v,c)=><td key={c}>{c===0||c>=4?<bdi>{v}</bdi>:v}</td>)}</tr>)}</tbody>)}</table><p>+1: خروج اليوم التالي · ناقص: خروج غير مسجل · —: لا قيمة موثقة · الملخص الشهري مكرر للرجوع فقط ولا يُجمع عبر الأجزاء.</p><footer>جزء الأيام {i+1} / {Math.ceil(position.days/10)}</footer></section>;
 })}</div>;
}
function MonthlyMatrix({position,onEmployee}:{position:MonthlyPosition;onEmployee:(key:string)=>void}) {
 return <div className="table-card monthly-scroll" tabIndex={0} role="region" aria-label="جدول الدخول والخروج الشهري، اسحب أفقياً للأيام"><div className="print-brand"><BrandImage kind="header" alt="FANU ALNASIJ — قسم الموارد البشرية – مسائي"/><h2>الموقف الشهري بالبصمة · {position.month}</h2></div><table className="monthly-matrix"><thead><tr><th className="monthly-identity">الموظف / الكود الوظيفي</th><th className="monthly-direction">الحركة</th>{Array.from({length:position.days},(_,i)=><th key={i} title={`${position.month}-${String(i+1).padStart(2,'0')}`}>{i+1}</th>)}<th>مكتمل</th><th>ناقص</th><th>بلا بصمات</th><th>مراجعة</th><th>مدة موثقة</th></tr></thead><tbody>{position.rows.flatMap(r=>['entry','exit'].map((direction,i)=><tr key={`${r.key}-${direction}`} data-employee-id={r.employee_id||undefined} className={i?'monthly-exit-row':'monthly-entry-row'}>
  {i===0&&<th rowSpan={2} className="monthly-identity"><button onClick={()=>onEmployee(r.key)} className="employee-link">{r.name}</button><bdi className="internal-code">{r.internal_code||'غير مطابق'}</bdi><small>{r.department}</small></th>}
  <th className="monthly-direction" scope="row">{i?'خروج':'دخول'}</th>{Array.from({length:position.days},(_,d)=>{const c=r.cells[String(d+1)];return <td key={d} data-state={c.state}><button aria-label={`${c.date}، ${monthlyStateLabels[c.state]}، ${i?'الخروج':'الدخول'} ${monthlyCellText(c,direction as 'entry'|'exit')}`} title={`${monthlyStateLabels[c.state]}${c.pending?' · مشكلة مفتوحة':''}${c.manual?' · قرار HR':''}`} onClick={()=>onEmployee(r.key)}><bdi>{monthlyCellText(c,direction as 'entry'|'exit')}</bdi>{i===0&&c.manual&&<small>HR</small>}{i===0&&c.pending&&<small>!</small>}</button></td>;})}
  {i===0&&<><td rowSpan={2}>{r.summary.complete}</td><td rowSpan={2}>{r.summary.incomplete}</td><td rowSpan={2}>{r.summary.no_punch}</td><td rowSpan={2}>{r.summary.pending}</td><td rowSpan={2}>{hourDuration(r.summary.worked_minutes)}</td></>}
 </tr>))}</tbody></table>{!position.rows.length&&<p className="p-8 text-center">لا توجد نتائج تطابق الفلاتر؛ جرّب مسحها.</p>}</div>;
}
function PunchTimeline({punches}:{punches:MonthlyCell['timeline']}) {return <ol className="punch-timeline">{punches.map((p,i)=><li key={`${p.source_id}-${p.minute}-${i}`}><bdi>{p.calendar_date} · {minuteText(p.minute)}</bdi><span>{p.source_sheet} · صف {p.source_row}</span><details><summary>الخلية الأصلية</summary><pre>{p.raw_values.join(' | ')}</pre></details></li>)}</ol>;}
function DayEvidence({cell}:{cell:MonthlyCell}) {return <details className="day-evidence"><summary><time dir="ltr">{cell.date}</time><strong>{monthlyStateLabels[cell.state]}</strong><span>د {monthlyCellText(cell,'entry')} · خ {monthlyCellText(cell,'exit')}</span>{cell.duration!=null&&<span>{hourDuration(cell.duration)}</span>}</summary>{cell.boundary_missing&&<p>قد لا يتضمن الملف خروج اليوم التالي؛ لا توجد مدة مؤكدة.</p>}{cell.rule?<p>نافذة الدخول {minuteText(cell.rule.entry_window_start)}–{minuteText(cell.rule.entry_window_end)}، بداية الدوام {minuteText(cell.rule.start_minute)}.</p>:<p>لا يوجد إعداد دوام مؤرخ لهذا اليوم. راجع مسؤول إعدادات الدوام دون تخمين أوقات.</p>}{cell.manual&&<p className="workflow-notice">قرار HR: {statuses[cell.manual.status_type as keyof typeof statuses]?.label||cell.manual.status_type} · {cell.manual.notes||'بلا ملاحظة'} · {new Date(cell.manual.updated_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})}</p>}{cell.issues.map(i=><p key={i.id}>{i.state==='open'?'مفتوحة':'تمت معالجتها'}: {i.details} {i.resolution_note}</p>)}<PunchTimeline punches={cell.timeline}/>{!cell.timeline.length&&<p>لا يوجد دليل بصمة مسجل لهذه الوردية.</p>}</details>;}
