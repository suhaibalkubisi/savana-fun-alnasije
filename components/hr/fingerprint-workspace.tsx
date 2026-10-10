"use client";
import {useState} from 'react';
import {useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {Upload,FileSpreadsheet,ArrowLeft,AlertTriangle,Search,RefreshCw,ShieldCheck,CalendarDays} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {api,mutate,useData} from '@/lib/hr/api';
import {baghdadDate,type Reference} from '@/lib/hr/types';
import {parseFingerprint,type FingerprintRow} from '@/lib/hr/fingerprint';
import {currentImport,importActionVersion} from '@/lib/hr/import-workflow.mjs';
import {type MonthlyPosition} from '@/lib/hr/monthly-position.mjs';
import {formatClock12} from '@/lib/hr/time-format.mjs';
import {importDiagnostics} from '@/lib/hr/import-diagnostics.mjs';
import {download,brandedExcelBytes,tablePdfBytes} from '@/lib/hr/exports';
import {useDirtyForm} from '@/lib/hr/use-dirty-form';
import {MonthlyPositionPage} from './monthly-position';
import {FingerprintIssues} from './attendance';
import {PrintEstimate} from './print-estimate';
import {DeviceSourceSelector} from './device-source-selector';
import {MonthlyReplacement} from './monthly-replacement';
import {CorrectiveAttempt} from './corrective-attempt';
import {SourceContinuation} from './source-continuation';
import {Field,LoadState,PageTitle} from './shared';

type Batch={id:string;version:number;source_name:string;device_namespace?:string;import_kind:'daily'|'monthly';period_start:string;period_end:string;state:string;lifecycle_state?:string;lifecycle_version?:number;summary:Record<string,number>};
type Parsed=ReturnType<typeof parseFingerprint>;
type Pending={parsed:Parsed;name:string;hash:string;period:string};
const stateLabels:Record<string,string>={preview:'معاينة محفوظة',reviewed:'تمت المراجعة',approved:'معتمد',applied:'معتمد',cancelled:'ملغى',superseded:'مستبدل'};
const stages=['الملف والفترة','النتائج والمعاينة','معالجة المشاكل','الاعتماد'];

export function FingerprintWorkspace({monthly=false,reference}:{monthly?:boolean;reference:Reference}) {
 const params=useSearchParams();
 const [namespace,setNamespace]=useState('');
 const [coverageConfirmed,setCoverageConfirmed]=useState(false);
 const [period,setPeriod]=useState(monthly?baghdadDate().slice(0,7):baghdadDate());
 const [selected,setSelected]=useState(params.get('import_id')||'');
 const [batch,setBatch]=useState<Batch|null>(null),[pending,setPending]=useState<Pending|null>(null);
 const [stage,setStage]=useState(params.get('import_id')?1:0),[view,setView]=useState<'source'|'calculated'>('source');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [from,setFrom]=useState(''),[through,setThrough]=useState('');
 const [localPosition,setLocalPosition]=useState<MonthlyPosition|null>(null);
 const [confirm,setConfirm]=useState<'review'|'approve'|'apply'|'cancel'|null>(null);
 useDirtyForm(!!pending,busy);
 const list=useData<Batch[]>('attendance.imports',{import_kind:monthly?'monthly':'daily'});
 const detail=useData<{batch:Batch;review_summary:{identities:number;matched_identities:number;populated_cells:number;punch_tokens:number;open_issues:number};rows:FingerprintRow[]}>('attendance.import',{id:selected},!!selected);
 const savedPosition=useData<MonthlyPosition>('attendance.monthly_position',{month:(detail.data?.batch.period_start||period).slice(0,7),import_id:selected},monthly&&!!selected&&!pending);
 const loaded=currentImport(batch,detail.data?.batch) as Batch|null;
 const wrongKind=!!loaded&&loaded.import_kind!==(monthly?'monthly':'daily');
 const current=wrongKind?null:loaded;
 const reportPeriod=pending?.parsed.period_start||current?.period_start||period;
 const reportHref=monthly?`/monthly-position?month=${reportPeriod.slice(0,7)}${current?`&import_id=${current.id}`:''}`:`/daily-position?date=${reportPeriod}`;
 const position=pending?localPosition:savedPosition.data;
 const diagnostics=importDiagnostics(position);
 const state=current?.lifecycle_state||current?.state||'preview';
 const open=detail.data?.review_summary.open_issues;
 const editable=state==='preview'||state==='reviewed';
 const calculationBlockers=diagnostics.filter(d=>d.blocksCalculation).reduce((n,d)=>n+d.days,0);
 const coverageValid=!!namespace.trim()&&!!pending&&!!from&&!!through&&from>=pending.parsed.period_start&&through<=pending.parsed.period_end&&from<=through;
 async function inspect(p:Pending,start:string,end:string) {
  setBusy(true);setLocalPosition(null);setError('');
  try {
   const result=await api<MonthlyPosition>('/api/data',{action:'attendance.import.inspect',data:{coverage_confirmed:coverageConfirmed,device_namespace:namespace.trim(),...p.parsed,source_name:p.name,source_hash:p.hash,import_kind:'monthly',coverage_start:start,coverage_end:end}});
   setLocalPosition(result);
  }catch(e){setError(`أدلة الملف متاحة أدناه. تعذرت مطابقة النظام: ${(e as Error).message}`);}finally{setBusy(false);}
 }
 async function upload(file:File) {
  setBusy(true);setError('');setNotice('');setLocalPosition(null);setPending(null);setSelected('');setBatch(null);
  try {
   const bytes=await file.arrayBuffer();
   const parsed=parseFingerprint(bytes,monthly?'monthly':'daily',period);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
   const p={parsed,name:file.name,hash,period};
   const observed=parsed.rows.filter(r=>r.punch_minutes.length).map(r=>r.calendar_date).sort();
   const start=observed[0]||parsed.period_start,end=observed.at(-1)||parsed.period_end;
   setPending(p);setFrom(start);setThrough(end);setStage(1);setView('source');
   setNotice(parsed.warnings.join('؛ '));
   if(monthly)await inspect(p,start,end);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function save() {
  if(!pending||busy||!coverageValid)return;
  setBusy(true);setError('');
  try {
   const next=await mutate<Batch>('attendance.import.preview',{coverage_confirmed:coverageConfirmed,device_namespace:namespace.trim(),...pending.parsed,source_name:pending.name,source_hash:pending.hash,import_kind:monthly?'monthly':'daily',...(monthly?{coverage_start:from,coverage_end:through}:{})});
   setBatch(next);setSelected(next.id);setPending(null);setStage(1);setView('calculated');
   setNotice('حُفظت الأدلة للمراجعة. لم يُعتمد حضور.');list.refresh();
  }catch(e){setError((e as Error).message);list.refresh();}finally{setBusy(false);}
 }
 async function transition() {
  if(!current||!confirm||busy)return;
  setBusy(true);setError('');
  try {
   const next=await mutate<Batch>(`attendance.import.${confirm}`,{id:current.id,version:importActionVersion(current,confirm)});
   setBatch(next);setConfirm(null);setNotice(confirm==='cancel'?'أُلغي الملف مع الاحتفاظ بأدلته.':confirm==='review'?'حُفظت المراجعة. الاعتماد خطوة مستقلة.':'تم الاعتماد الصريح.');
   detail.refresh();savedPosition.refresh();list.refresh();
  }catch(e){setError((e as Error).message);detail.refresh();list.refresh();}finally{setBusy(false);}
 }
 function openBatch(b:Batch){setSelected(b.id);setBatch(b);setPending(null);setLocalPosition(null);setPeriod(monthly?b.period_start.slice(0,7):b.period_start);setStage(1);setView('calculated');setError('');setNotice('');}
 return <div className="fingerprint-product">
  <PageTitle title={monthly?'البصمة الشهرية':'البصمة اليومية'} subtitle={monthly?'ملف واحد، أدلة واضحة، واعتماد مستقل':'اقرأ دليل اليوم قبل اتخاذ قرار الحضور'} actions={<Button variant="outline" asChild><Link href={reportHref}>{monthly&&current?'موقف الملف':'الموقف المعتمد'} <ArrowLeft size={16}/></Link></Button>}/>
  <nav className="workflow-steps" aria-label="مراحل ملف البصمة">{stages.map((label,index)=><button key={label} aria-current={stage===index?'step':undefined} onClick={()=>setStage(index)}><span>{index+1}</span><div><strong>{label}</strong><small>{['تحديد المصدر ونطاقه','الأصل والحساب جنباً إلى جنب','سبب محدد وخطوة تالية','قرار صريح بصلاحية HR'][index]}</small></div></button>)}</nav>
  {current&&state==='preview'&&<Button variant="outline" asChild><Link href={`/company-onboarding?import_id=${current.id}`}>تهيئة هذا الملف · دفعة هوية واحدة ونموذج النقص</Link></Button>}
  <div className="fingerprint-layout">
   <aside className="source-rail">
    <section className="source-card"><span className="eyebrow">مصدر العمل</span><FileSpreadsheet size={26}/><h2>{pending?.name||current?.source_name||'ابدأ بملف البصمة'}</h2><span className="status-chip">{pending?'محلي · غير محفوظ':current?stateLabels[state]:'لم يُختَر ملف'}</span>
     <p>{pending?.period||current?.period_start||period}</p>
     {(pending||current)&&<dl><div><dt>هويات المصدر</dt><dd>{pending?.parsed.source_counts.person_codes??detail.data?.review_summary.identities??'—'}</dd></div><div><dt>خلايا بأدلة</dt><dd>{pending?.parsed.source_counts.populated_cells??detail.data?.review_summary.populated_cells??'—'}</dd></div><div><dt>{pending?'قيم البصمة الخام':'دقائق البصمة المحفوظة'}</dt><dd>{pending?.parsed.source_counts.raw_punch_tokens??detail.data?.review_summary.punch_tokens??'—'}</dd></div></dl>}
     {pending&&<><p className="scope-note">التحليل لا يحفظ الملف ولا يعتمد الحضور.</p><Button disabled={busy||!coverageValid} onClick={save}>حفظ الأدلة للمراجعة</Button></>}
     {current&&<Button variant="outline" disabled={busy} onClick={()=>{detail.refresh();savedPosition.refresh();list.refresh();}}><RefreshCw size={15}/>تحديث حالة الملف</Button>}
    </section>
    <details className="source-history"><summary>الملفات السابقة ({list.data?.length || 0})</summary><p>افتح الملف لمتابعة العمل من حالته المحفوظة.</p><LoadState loading={list.loading&&!list.data} error={list.error} retry={list.refresh} empty={!list.data?.length} emptyText="لا توجد ملفات محفوظة">{list.data?.map(b=><button key={b.id} aria-pressed={selected===b.id} disabled={busy||!!pending} onClick={()=>openBatch(b)}><FileSpreadsheet size={17}/><span><strong>{b.source_name}</strong><small>{b.period_start} · {stateLabels[b.lifecycle_state||b.state]}</small></span><ArrowLeft size={14}/></button>)}</LoadState></details>
   </aside>
   <main className="fingerprint-main">
    {wrongKind&&<div className="action-error" role="alert">هذا الملف يخص {loaded?.import_kind==='monthly'?'البصمة الشهرية':'البصمة اليومية'}. افتحه من مساحة العمل المناسبة.</div>}
    {error&&<div className="action-error" role="alert"><AlertTriangle size={20}/><div><strong>تحتاج هذه الخطوة إلى انتباه</strong><p>{error}</p><Button variant="outline" onClick={()=>{detail.refresh();list.refresh();if(pending&&monthly)void inspect(pending,from,through);}}>التحقق من النتيجة وإعادة القراءة</Button></div></div>}
    {notice&&<p role="status" className="action-success">{notice}</p>}
    {stage===0&&<section className="workspace-panel upload-workspace"><div className="section-heading"><div><span className="eyebrow">01 / المصدر</span><h2>{monthly?'اختر الشهر ثم ارفع الملف':'اختر تاريخ التقويم ثم ارفع الملف'}</h2></div><CalendarDays size={28}/></div><Field label={monthly?'الشهر والسنة المؤكدة':'تاريخ البصمات في الملف'}><Input type={monthly?'month':'date'} value={period} disabled={busy||!!pending} onChange={e=>setPeriod(e.target.value)}/></Field><DeviceSourceSelector value={namespace} onChange={setNamespace} disabled={busy||!!pending}/><label className="file-drop"><Upload size={36}/><strong>اختيار ملف البصمة</strong><span>XLS أو XLSX · حتى 8 ميغابايت</span><Input aria-label="ملف البصمة" type="file" accept=".xls,.xlsx" disabled={busy||!namespace.trim()} onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);e.target.value='';}}/></label><p className="scope-note">{monthly?'تواريخ الشهر قد لا تتضمن السنة. استخدم سنة المصدر المؤكدة. تُحفظ الخلايا الفارغة كما هي.':'هذا تاريخ تقويمي، وقد يجمع خروج وردية سابقة ودخول وردية جديدة. لا تعني أول وآخر بصمة زوج دخول وخروج.'}</p>{pending&&<Button variant="outline" onClick={()=>{setPending(null);setLocalPosition(null);}}>إلغاء الملف المحلي واختيار فترة أخرى</Button>}</section>}
    {busy&&<div role="status" className="processing-bar">جاري التحقق والمعالجة… يمكنك قراءة أدلة الملف المتاحة أدناه.</div>}
    {stage===1&&<>
     {!pending&&!current?<StartPrompt onStart={()=>setStage(0)}/>:<>
      {pending&&<details className="coverage-card"><summary>الفترة والتغطية · {from} — {through}</summary><label className="checkbox-label"><input type="checkbox" checked={coverageConfirmed} onChange={e=>setCoverageConfirmed(e.target.checked)}/>تحققت من أن نطاق تصدير المصدر يغطي هذه الفترة لكل هويات الصفوف؛ لا يكفي وجود بصمات في أول وآخر تاريخ.</label><p>النطاق المقترح من أول وآخر بصمة. تحقق من نطاق تصدير المصدر؛ الأيام الفارغة لا تثبت الغياب.</p><div className="filterbar"><Field label="أول تاريخ مغطى"><Input type="date" value={from} disabled={busy} min={pending.parsed.period_start} max={pending.parsed.period_end} onChange={e=>{setFrom(e.target.value);setLocalPosition(null);}}/></Field><Field label="آخر تاريخ مغطى"><Input type="date" value={through} disabled={busy} min={from} max={pending.parsed.period_end} onChange={e=>{setThrough(e.target.value);setLocalPosition(null);}}/></Field>{monthly&&<Button variant="outline" disabled={busy||!coverageValid} onClick={()=>void inspect(pending,from,through)}>تحديث الحساب للنطاق</Button>}</div></details>}
      {monthly&&<div className="evidence-switch"><Button variant={view==='source'?'default':'ghost'} onClick={()=>setView('source')}>الأدلة التقويمية</Button><Button variant={view==='calculated'?'default':'ghost'} onClick={()=>setView('calculated')}>الدخول والخروج حسب الوردية</Button><Button variant="outline" onClick={()=>setStage(2)}>تفسير النتائج <ArrowLeft size={15}/></Button></div>}
      {pending&&(view==='source'||!monthly)&&<SourceEvidence rows={pending.parsed.rows} monthly={monthly} period={pending.period}/>}
      {monthly&&view==='calculated'&&(pending?localPosition?<MonthlyPositionPage reference={reference} localPosition={localPosition} period={pending.period} embedded/>:<div className="workspace-panel"><h2>الحساب لم يكتمل</h2><p>أدلة المصدر سليمة ومتاحة في العرض التقويمي. استخدم إعادة القراءة لمطابقة النظام.</p></div>:<LoadState loading={savedPosition.loading} error={savedPosition.error} retry={savedPosition.refresh}>{position&&<MonthlyPositionPage reference={reference} importId={selected} localPosition={position} period={current!.period_start.slice(0,7)} embedded/>}</LoadState>)}
      {monthly&&!pending&&view==='source'&&<LoadState loading={savedPosition.loading} error={savedPosition.error} retry={savedPosition.refresh}>{position&&<MonthlyPositionPage reference={reference} importId={selected} localPosition={position} period={current!.period_start.slice(0,7)} initialView="evidence" embedded/>}</LoadState>}
      {!monthly&&!pending&&<><div className="workflow-notice">اليومي دخول فقط ضمن نافذة العمل الموثقة. لا يتطلب خروجاً أو ملف اليوم التالي. تبقى جميع البصمات محفوظة والمطابقة لا تعتمد الحضور.</div><LoadState loading={detail.loading} error={detail.error} retry={detail.refresh}>{detail.data&&<SourceEvidence rows={detail.data.rows} monthly={false} period={current!.period_start}/>}</LoadState><Button asChild variant="outline"><Link href={`/daily-position?date=${current!.period_start}`}>افتح حساب يوم العمل من الأدلة المعتمدة</Link></Button></>}
     </>}
    </>}
    {current&&state==='reviewed'&&!pending&&<section className="workspace-panel"><p>الملف تمت مراجعته ولم يُعتمد. يمكنك الرجوع إلى معاينة الهوية بسبب موثق، ويجب إكمال المراجعة مجدداً.</p><Button variant="outline" disabled={busy} onClick={async()=>{const reason=window.prompt('سبب إعادة فتح المعاينة غير المعتمدة');if(!reason||reason.trim().length<3)return;setBusy(true);try{const next=await mutate<Batch>('attendance.import.reopen',{id:current.id,version:importActionVersion(current,"review"),reason});setBatch(next);detail.refresh();list.refresh();setStage(2);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>إعادة فتح المعاينة قبل الاعتماد</Button></section>}
    {current&&state==='preview'&&!pending&&<section className="workspace-panel no-print"><h3>تطبيق الروابط المؤكدة على هذه المعاينة</h3><p>يعيد قراءة سجل الجهاز ويحل الروابط المثبتة فقط. لا يغير الملفات المغلقة أو يعتمد الحضور.</p><Button variant="outline" disabled={busy||detail.loading} onClick={async()=>{setBusy(true);setError('');try{await mutate('attendance.import.reprocess',{id:current.id,version:current.version});setBatch(null);detail.refresh();list.refresh();savedPosition.refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>إعادة معالجة المعاينة</Button></section>}
    {stage===2&&<section className="workspace-panel"><div className="section-heading"><div><span className="eyebrow">03 / تفسير النتيجة</span><h2>ما الذي يحتاج إلى معالجة؟</h2></div><AlertTriangle size={26}/></div><p>يمكن قراءة جميع الأدلة الآن. مشاكل الهوية والانتماء والدوام تختلف عن البصمة الناقصة.</p>{diagnostics.map(d=><details className="diagnostic-group" key={d.cause}><summary><span className={d.blocksCalculation?'severity-blocker':'severity-info'}>{d.blocksCalculation?'يمنع اكتمال الحساب':'معلومة / نقص دليل'}</span><strong>{d.label}</strong><span>{d.people.length} هوية · {d.days} يوم</span></summary><p>{d.action}</p><div className="diagnostic-people">{d.people.map(p=><div key={p.key}><span><strong>{p.name}</strong><small>{p.code||'هوية مصدر'} · {p.dates.length} يوم · {p.dates[0]} — {p.dates.at(-1)}</small></span>{p.employee_id?<Button variant="outline" asChild><Link href={`/employees/${p.employee_id}`}>ملف الموظف</Link></Button>:<span>راجع المطابقة أدناه</span>}</div>)}</div></details>)}{!diagnostics.length&&<p className="scope-note">{pending&&!monthly?'المصدر اليومي يحتفظ بالأوقات دون استنتاج الوردية. احفظ الأدلة لقراءة نتائج المطابقة.':current?'مراجعة المطابقة المحفوظة أدناه. لا يعني خلوها اكتمال أدلة كل وردية.':'اختر ملفاً لعرض أسبابه وأدلته.'}</p>}{pending?<div className="workflow-notice">لحفظ قرارات المطابقة ومتابعتها بعد التحديث، احفظ الأدلة للمراجعة أولاً.</div>:current&&state==='preview'?<FingerprintIssues reference={reference} canWrite forcedImportId={selected} embedded/>:current?<div className="workflow-notice">هذا المصدر {stateLabels[state]} ومتاح للقراءة فقط. لا تظهر ملفات الحالة المغلقة في قائمة قرارات المطابقة المفتوحة. تبقى أسباب النقص وأدلة المصدر معروضة أعلاه؛ عالج المصدر الصحيح في معاينة مفتوحة قبل الاعتماد.</div>:null}</section>}
    {stage===3&&<section className="workspace-panel approval-workspace"><ShieldCheck size={38}/><span className="eyebrow">04 / القرار الرسمي</span><h2>المراجعة لا تعني الاعتماد</h2><p>الاعتماد ينقل الملف المحدد إلى مصدر حضور رسمي. تبقى الحالات اليدوية مستقلة، ولا تُجمع المصادر اليومية والشهرية المتقاطعة.</p><dl className="approval-checks"><div><dt>حفظ المصدر</dt><dd>{pending?'لم يُحفظ':current?stateLabels[state]:'اختر ملفاً'}</dd></div><div><dt>سجلات غير محسومة — لا تدخل الحضور المعتمد</dt><dd>{pending?'المطابقة الأولية فقط':open??'لم تكتمل القراءة'}</dd></div>{monthly&&<div><dt>أيام يتعذر اكتمال حسابها</dt><dd>{position?calculationBlockers:'لم تكتمل القراءة'}</dd></div>}<div><dt>صلاحية القرار</dt><dd>يتحقق الخادم من الدور والإصدار والمشاكل داخل المعاملة</dd></div></dl><p className="scope-note">{monthly?"البصمة الواحدة تبقى خروجاً غير مسجل؛ لا يُختلق خروج أو غياب.":"يكفي دخول صحيح واحد. يمكن اعتماد الصفوف المرتبطة فقط؛ تبقى الصفوف غير المرتبطة في متابعة واضحة ولا تُعد مكتملة."}</p>{pending?<Button disabled={busy||!coverageValid} onClick={save}>حفظ الأدلة للمراجعة</Button>:current&&editable?<div className="actions"><Button disabled={busy||detail.loading||!!detail.error||open===undefined||(!monthly&&!(detail.data?.review_summary.matched_identities))||(monthly&&open>0)||(monthly&&(!position||!!savedPosition.error||calculationBlockers>0))} onClick={()=>setConfirm(monthly?(state==='reviewed'?'approve':'review'):'apply')}>{monthly?(state==='reviewed'?'اعتماد الملف الشهري':'إنهاء المراجعة'):'اعتماد المصدر اليومي'}</Button><Button variant="outline" disabled={busy} onClick={()=>setStage(2)}>معالجة المشاكل</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirm('cancel')}>إلغاء الملف مع حفظ الأدلة</Button></div>:<p>{current?`حالة الملف: ${stateLabels[state]}. لا يمكن اعتماده مجدداً.`:'ابدأ باختيار ملف.'}</p>}</section>}
    {current&&!pending&&['applied','approved','cancelled','superseded'].includes(state)&&<CorrectiveAttempt key={current.id} current={current} onSaved={next=>{setSelected(next.id);setBatch(next as Batch);setStage(2);detail.refresh();savedPosition.refresh();list.refresh();setNotice('أُنشئت معاينة جديدة للتصحيح. راجع الهوية والسياق قبل الاعتماد أو الاستبدال.');}}/>}
    {current&&monthly&&state==='approved'&&!pending&&<MonthlyReplacement current={current} onSaved={()=>{setBatch(null);detail.refresh();savedPosition.refresh();list.refresh();}}/>}
    {current&&!pending&&((monthly&&state==='preview')||(!monthly&&state==='applied'))&&<SourceContinuation key={current.id} current={current} onSaved={()=>{setBatch(null);detail.refresh();savedPosition.refresh();list.refresh();}}/>}
   </main>
  </div>
  <Dialog open={!!confirm} onOpenChange={open=>{if(!open&&!busy)setConfirm(null);}}><DialogContent><DialogHeader><DialogTitle>{confirm==='cancel'?'إلغاء هذا الاستيراد؟':confirm==='review'?'إنهاء مراجعة الملف؟':'اعتماد الحضور من هذا الملف؟'}</DialogTitle><DialogDescription>{current?.source_name} · {current?.period_start} — {current?.period_end}. {confirm==='review'?'يبقى الاعتماد خطوة مستقلة.':confirm==='cancel'?'تبقى الأدلة والسجل محفوظين.':'سيصبح هذا المصدر رسمياً بعد التحقق من جميع الشروط على الخادم.'}</DialogDescription></DialogHeader><div className="actions"><Button disabled={busy} onClick={transition}>تأكيد {confirm==='cancel'?'الإلغاء':confirm==='review'?'المراجعة':'الاعتماد'}</Button><Button variant="outline" disabled={busy} onClick={()=>setConfirm(null)}>رجوع</Button></div></DialogContent></Dialog>
 </div>;
}
function StartPrompt({onStart}:{onStart:()=>void}){return <section className="workspace-panel start-prompt"><FileSpreadsheet size={42}/><h2>أدلة واضحة تبدأ بملف المصدر</h2><p>ارفع ملفاً أو افتح استيراداً سابقاً من القائمة. ستبقى الأوقات الأصلية متاحة حتى عند وجود هوية غير محسومة.</p><Button onClick={onStart}>اختيار الملف والفترة</Button></section>;}

function SourceEvidence({rows,monthly,period}:{rows:FingerprintRow[];monthly:boolean;period:string}) {
 const [search,setSearch]=useState(''),[page,setPage]=useState(0),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
 const groups=new Map<string,FingerprintRow[]>();
 for(const r of rows){const k=r.person_code+'\0'+r.source_name;if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(r);}
 const people=[...groups.values()].filter(g=>[g[0].source_name,g[0].person_code].join(' ').includes(search));
 const dates=[...new Set(rows.map(r=>r.calendar_date))].sort();
 const visible=people.slice(page*20,(page+1)*20);
 const sourceScope={title:monthly?'أدلة البصمة الشهرية التقويمية':'أدلة البصمة اليومية التقويمية',period:period+' · مصدر غير محسوب · اتجاه البصمة غير محدد',headers:['رمز الشخص','اسم المصدر','التاريخ التقويمي','الأوقات المسجلة','موضع المصدر'],rows:people.flatMap(g=>g.map(r=>[r.person_code,r.source_name,r.calendar_date,r.punch_minutes.map(formatClock12).join(' / ')||'لا بصمات',r.source_sheet+':'+r.source_row]))};
 const matrixScope={title:sourceScope.title,period:sourceScope.period,headers:['رمز الشخص','اسم المصدر',...dates.map(d=>d.slice(-2))],rows:people.map(g=>[g[0].person_code,g[0].source_name,...dates.map(d=>g.filter(r=>r.calendar_date===d).flatMap(r=>r.punch_minutes).map(m=>formatClock12(m).replace(/^[0٠](?=[1-9١-٩])/,'').replace(/\s+([صم])/,'$1')).join('\n')||'—')]),columnWeights:[14,25,...dates.map(()=>5)],compact:true};
 async function exportSource(pdf:boolean,detailed=false){setExporting(true);setExportError('');try{const bytes=pdf?await tablePdfBytes(monthly&&!detailed?matrixScope:sourceScope):await brandedExcelBytes(sourceScope);download(bytes,`FANU-source-${period}.${pdf?'pdf':'xlsx'}`,pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}catch(e){setExportError((e as Error).message);}finally{setExporting(false);}}
 return <section className="source-evidence workspace-panel"><div className="section-heading"><div><span className="eyebrow">الأصل / دون افتراضات</span><h2>البصمات كما وردت في التقويم</h2></div><span className="status-chip">{people.length} هوية مصدر</span></div><p className="scope-note">هذه الأوقات ليست تصنيف دخول وخروج. رمز الشخص منفصل عن الكود الوظيفي الدائم. الخلية الفارغة تعني عدم وجود دليل في المصدر.</p><div className="evidence-tools"><label className="source-search"><Search size={17}/><Input aria-label="بحث في هويات المصدر" placeholder="الاسم أو رمز الشخص" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><Button variant="outline" disabled={exporting} onClick={()=>void exportSource(false)}>Excel المصدر</Button><Button variant="outline" disabled={exporting} onClick={()=>void exportSource(true)}>PDF مصفوفة المصدر</Button>{monthly&&<Button variant="ghost" disabled={exporting} onClick={()=>void exportSource(true,true)}>PDF الأدلة التفصيلية</Button>}</div><PrintEstimate report={monthly?matrixScope:sourceScope}/>{exportError&&<p role="alert">{exportError}</p>}<div className="evidence-scroll" tabIndex={0} aria-label="جدول أدلة المصدر القابل للتمرير"><table><thead><tr><th>هوية المصدر</th>{dates.map(d=><th key={d}><bdi>{d.slice(5)}</bdi><small>{new Intl.DateTimeFormat('ar-IQ',{weekday:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'))}</small></th>)}</tr></thead><tbody>{visible.map(g=><tr key={g[0].person_code+'\0'+g[0].source_name}><th><strong>{g[0].source_name}</strong><small>رمز الشخص <bdi>{g[0].person_code}</bdi></small></th>{dates.map(d=>{const cells=g.filter(r=>r.calendar_date===d),minutes=[...new Set(cells.flatMap(r=>r.punch_minutes))].sort((a,b)=>a-b);return <td key={d} className={minutes.length?'has-evidence':'no-evidence'}>{minutes.length?minutes.map(m=><bdi key={m}>{formatClock12(m)}</bdi>):<span>لا بصمات</span>}{cells.some(r=>r.invalid)&&<strong>قيمة تحتاج مراجعة</strong>}</td>;})}</tr>)}</tbody></table></div><div className="table-pagination"><span>{people.length?`${page*20+1}–${Math.min((page+1)*20,people.length)} من ${people.length}`:'لا نتائج'}</span><Button variant="outline" disabled={!page} onClick={()=>setPage(page-1)}>السابق</Button><Button variant="outline" disabled={(page+1)*20>=people.length} onClick={()=>setPage(page+1)}>التالي</Button></div>{!monthly&&<div className="daily-evidence-note"><AlertTriangle size={19}/><p>اليومي يسجّل الدخول فقط ضمن نافذة العمل الموثقة. قد تخص بصمة الصباح خروج اليوم السابق؛ تبقى محفوظة كدليل خام ولا يلزم خروج أو ملف اليوم التالي.</p></div>}</section>;
}
