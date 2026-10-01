"use client";
import Link from 'next/link';
import {useState} from 'react';
import {ArrowLeft,Upload,CalendarPlus,FileSpreadsheet,Users,ShieldCheck,CheckCircle2} from 'lucide-react';
import {useData} from '@/lib/hr/api';
import {baghdadDate,type StatusRecord} from '@/lib/hr/types';
import type {MonthlyPosition} from '@/lib/hr/monthly-position.mjs';
import {Input} from '@/components/ui/input';
import {PageTitle,LoadState,StatusBadge,Field} from './shared';
type Dashboard={active:number;absence:number;leave:number;late:number;review:number;today:string;recent:StatusRecord[];departments:{id:string;name:string;count:number}[]};
type Batch={id:string;source_name:string;import_kind:'daily'|'monthly';period_start:string;state:string;lifecycle_state?:string};
const lifecycle:Record<string,string>={preview:'معاينة',reviewed:'بانتظار الاعتماد',applied:'معتمد',approved:'معتمد',cancelled:'ملغى',superseded:'مستبدل'};
export function WorkDashboard({canWrite}:{canWrite:boolean}) {
 const [month,setMonth]=useState(baghdadDate().slice(0,7));
 const q=useData<Dashboard>('dashboard');
 const queue=useData<{monthly_pending:number;ready_for_approval:number;open_identity_groups:number}>('attendance.work_queue');
 const imports=useData<Batch[]>('attendance.imports');
 const position=useData<MonthlyPosition>('attendance.monthly_position',{month});
 return <>
  <PageTitle title="لوحة العمل" subtitle={`قرارات HR المسجلة اليوم · ${q.data?.today||baghdadDate()} · توقيت بغداد`}/>
  <section className="work-hero"><div><span className="eyebrow">قسم الموارد البشرية – مسائي</span><h2>من دليل البصمة إلى قرار واضح</h2><p>تابع الملفات المفتوحة، عالج ما يحتاج قراراً، وارجع إلى الدليل قبل الاعتماد. المعاينات والحالات اليدوية والحضور المعتمد لها نطاقات مستقلة.</p></div><div className="work-hero-actions">{canWrite?<><Link href="/fingerprint-monthly"><Upload size={19}/>رفع ملف الشهر</Link><Link href="/status"><CalendarPlus size={19}/>تسجيل حالة يومية</Link></>:<Link href="/reports">فتح التقارير <ArrowLeft size={17}/></Link>}</div></section>
  <LoadState loading={q.loading&&!q.data} error={q.error} retry={q.refresh}>
   <div className="work-stat-grid">{([['الموظفون النشطون',q.data?.active,'/employees?status=active','الحالة الحالية'],['قرارات الغياب',q.data?.absence,'/absence-leave','المسجلة اليوم فقط'],['قرارات الإجازة',q.data?.leave,'/absence-leave','المسجلة اليوم فقط'],['حالات التأخير',q.data?.late,'/lateness','المسجلة اليوم فقط']] as const).map(([label,value,path,scope])=><Link className="work-stat" key={label} href={path}><span>{label}</span><strong>{value??'—'}</strong><small>{scope}</small></Link>)}</div>
  </LoadState>
  <div className="work-grid">
   <section className="workspace-panel work-queue"><header><h2>قائمة المتابعة</h2><Link href="/review">مركز المراجعة <ArrowLeft size={13}/></Link></header><LoadState loading={queue.loading&&!queue.data} error={queue.error} retry={queue.refresh}>
    {[{n:queue.data?.open_identity_groups,title:'هويات تحتاج قراراً',note:'مجموعات الهوية في الملفات المفتوحة · كل الفترات',link:'/fingerprint-issues',cta:'مطابقة الهوية'},{n:queue.data?.monthly_pending,title:'ملفات شهرية مفتوحة',note:'معاينات محفوظة تحتاج استكمال المراجعة',link:'/fingerprint-monthly',cta:'متابعة الملفات'},{n:queue.data?.ready_for_approval,title:'ملفات تمت مراجعتها',note:'بانتظار اعتماد صريح من المسؤول المخوّل',link:'/fingerprint-monthly',cta:'فحص الاعتماد'},{n:q.data?.review,title:'سجلات موظفين ناقصة',note:'بيانات حالية تحتاج استكمالاً · ليست غياباً',link:'/review',cta:'استكمال البيانات'}].map(t=><article className="queue-action" key={t.title}><span className="queue-count">{t.n??'—'}</span><div><h3>{t.title}</h3><p>{t.note}</p></div><Link href={t.link}>{t.cta}</Link></article>)}
   </LoadState></section>
   <section className="workspace-panel work-imports"><header><h2>أحدث ملفات البصمة</h2><FileSpreadsheet size={22}/></header><LoadState loading={imports.loading&&!imports.data} error={imports.error} retry={imports.refresh} empty={!imports.data?.length} emptyText="لم يُحفظ أي ملف بعد">{imports.data?.slice(0,6).map(b=><Link className="import-queue-item" href={`/fingerprint-${b.import_kind}?import_id=${b.id}`} key={b.id}><FileSpreadsheet size={22}/><span><strong>{b.source_name}</strong><small>{b.import_kind==='monthly'?'شهري':'يومي'} · {b.period_start}</small></span><b className="status-chip">{lifecycle[b.lifecycle_state||b.state]}</b></Link>)}</LoadState><p className="queue-period">الحالة تخص المصدر، ولا تثبت اكتمال كل وردية.</p></section>
   <section className="workspace-panel work-queue"><header><h2>دليل الحضور الشهري</h2><CheckCircle2 size={22}/></header><Field label="شهر التقرير المعتمد"><Input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></Field><LoadState loading={position.loading&&!position.data} error={position.error} retry={position.refresh}>{position.data?.available?<><div className="work-stat-grid"><div className="work-stat"><span>أيام مكتملة</span><strong>{position.data.metrics?.complete}</strong></div><div className="work-stat"><span>أيام ناقصة</span><strong>{position.data.metrics?.incomplete}</strong></div><div className="work-stat"><span>أيام غير محسومة</span><strong>{position.data.metrics?.pending}</strong></div><div className="work-stat"><span>هويات الملف</span><strong>{position.data.metrics?.employees}</strong></div></div><p className="queue-period">الملف المعتمد فقط · {position.data.coverage?.start} — {position.data.coverage?.end}</p></>:<div className="work-empty"><strong>لا يوجد مصدر شهري معتمد</strong><p>الأعداد غير متاحة. افتح المعاينة لمراجعة الأدلة دون اعتمادها.</p></div>}</LoadState><Link className="employee-link" href={`/monthly-position?month=${month}`}>فتح الموقف الشهري <ArrowLeft size={14}/></Link></section>
   <section className="workspace-panel"><div className="section-heading"><h2>آخر قرارات HR المسجلة</h2><ShieldCheck size={22}/></div>{q.data?.recent.slice(0,5).map(r=><div className="recent-row" key={r.id}><Users size={18}/><div className="recent-person"><Link href={`/employees/${r.employee_id}`}>{r.employee_name}</Link><small>{r.record_date} · {r.department}</small></div><StatusBadge type={r.status_type}/></div>)}{!q.data?.recent.length&&<p className="work-empty">لا توجد حالات مسجلة في آخر النتائج.</p>}<Link className="employee-link" href="/audit">سجل التعديلات</Link></section>
  </div>
 </>;
}
