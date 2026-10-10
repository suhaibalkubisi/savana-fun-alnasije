"use client";
import {useState} from 'react';
import {mutate,useData} from '@/lib/hr/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Field} from './shared';
type Batch={id:string;version:number;device_namespace?:string;source_name:string;import_kind:'daily'|'monthly';period_start:string;period_end:string;state:string;lifecycle_state?:string};
export function SourceContinuation({current,onSaved}:{current:Batch;onSaved:()=>void}) {
 const monthly=current.import_kind==='monthly';
 const list=useData<Batch[]>('attendance.imports',{import_kind:current.import_kind});
 const [target,setTarget]=useState(''),[reason,setReason]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const nextDay=new Date(Date.parse(current.period_end+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const choices=(list.data||[]).filter(b=>b.id!==current.id&&b.device_namespace===current.device_namespace&&(monthly?b.lifecycle_state==='approved'&&b.period_start===nextDay:b.state==='preview'&&b.period_start===current.period_start&&b.period_end===current.period_end));
 async function save(){const selected=choices.find(b=>b.id===target);if(!selected)return;setBusy(true);setMessage('');try{await mutate(monthly?'attendance.boundary.record':'attendance.daily.replace',monthly?{id:current.id,version:current.version,adjacent_import_id:selected.id,reason}:{id:current.id,version:current.version,replacement_id:selected.id,replacement_version:selected.version,reason});setConfirm(false);setMessage(monthly?'حُفظ دليل الحد الفاصل. لم يُعتمد هذا الملف.':'استُبدل المصدر مع حفظ الأدلة وسجل القرار.');onSaved();}catch(e){setMessage((e as Error).message);onSaved();}finally{setBusy(false);}}
 return <details className="workspace-panel"><summary>{monthly?'دليل خروج نهاية الشهر (+1)':'استبدال المصدر اليومي — مدير النظام'}</summary><p>{monthly?'اختيار صريح لنسخة من أول يوم في مصدر الشهر التالي المعتمد، ضمن نطاق الجهاز نفسه. لا يُستعار أي ملف تلقائياً.':'اختر معاينة بديلة من التاريخ والنطاق نفسيهما. سيُلغي التأكيد المصدر الحالي ويعتمد البديل في معاملة واحدة، دون حذف الأصل.'}</p><Field label="المصدر المختار"><select value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="">اختر المصدر</option>{choices.map(b=><option key={b.id} value={b.id}>{b.source_name} · {b.period_start}</option>)}</select></Field>{!choices.length&&<p>لا يوجد مصدر مؤهل محفوظ حالياً.</p>}<Field label="سبب موثق"><Input value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} disabled={busy}/></Field><Button disabled={busy||!target||reason.trim().length<3} onClick={()=>setConfirm(true)}>مراجعة القرار</Button>{message&&<p role="status">{message}</p>}<Dialog open={confirm} onOpenChange={v=>{if(!busy)setConfirm(v);}}><DialogContent><DialogHeader><DialogTitle>{monthly?'تثبيت دليل الشهر التالي؟':'تأكيد استبدال المصدر اليومي؟'}</DialogTitle><DialogDescription>{current.source_name} ← {choices.find(b=>b.id===target)?.source_name}. {reason}</DialogDescription></DialogHeader><Button disabled={busy} onClick={save}>تأكيد القرار</Button><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>رجوع</Button></DialogContent></Dialog></details>;
}
