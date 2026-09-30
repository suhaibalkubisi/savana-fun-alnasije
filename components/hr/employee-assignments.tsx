"use client";
import {useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import {mutate,useData} from '@/lib/hr/api';
import {useDirtyForm} from '@/lib/hr/use-dirty-form';
import {baghdadDate,departmentLabel,employmentLabels,type Employee,type Reference} from '@/lib/hr/types';
import {Choice,Field,LoadState} from './shared';
type Assignment={id:string;version:number;department_id:string;shift_id:string|null;direct_manager_id:string|null;department:string;manager:string|null;employment_status:Employee['employment_status'];valid_from:string;valid_to:string|null;evidence_kind:string;reason:string;created_at:string;voided_at:string|null};
export function AssignmentHistory({employee,reference,canWrite}:{employee:Employee;reference:Reference;canWrite:boolean}) {
 const query=useData<Assignment[]>('employee.assignments',{employee_id:employee.id});
 const blank={valid_from:'',valid_to:'',department_id:employee.department_id,shift_id:employee.shift_id||'',direct_manager_id:employee.direct_manager_id||'',employment_status:employee.employment_status,reason:''};
 const [form,setForm]=useState(blank),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState<Assignment|null>(null);
 const guard=useDirtyForm(form,busy);
 function edit(row:Assignment){if(!guard.canClose())return;setEditing(row);setForm({valid_from:row.valid_from,valid_to:row.valid_to||'',department_id:row.department_id,shift_id:row.shift_id||'',direct_manager_id:row.direct_manager_id||'',employment_status:row.employment_status,reason:''});setError('');}
 const set=(key:string,value:string)=>setForm(current=>({...current,[key]:value}));
 async function save(event:React.FormEvent) {
  event.preventDefault();setError('');
  if(!form.valid_from||!form.valid_to||form.valid_from>form.valid_to||form.valid_to>baghdadDate()){setError('اختر فترة صحيحة تنتهي اليوم أو قبله');return;}
  if(form.reason.trim().length<3){setError('اكتب مصدر إثبات الانتماء لهذه الفترة');return;}
  setBusy(true);
  try {
   await mutate('employee.assignment.record',{...form,...(editing?{id:editing.id,version:editing.version}:{}),employee_id:employee.id,employee_version:employee.version,shift_id:form.shift_id||null,direct_manager_id:form.direct_manager_id||null});
   setForm(blank);setEditing(null);toast.success('تم توثيق الانتماء للفترة المحددة');query.refresh();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="assignment-layout">
  <div><h3>الانتماء الوظيفي عبر الزمن</h3><p className="scope-note">يعتمد تفسير البصمات على القسم الموثق في تاريخ العمل. الانتماء الحالي لا يثبت الفترات السابقة، ويوم تغييره يحتاج توثيقاً مستقلاً.</p></div>
  <LoadState loading={query.loading&&!query.data} error={query.error} retry={query.refresh} empty={!query.data?.length} emptyText="لا توجد فترات انتماء موثقة">
   <Table><TableHeader><TableRow>{['الفترة','القسم','المسؤول','الحالة','المصدر','التوثيق',''].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>
    {query.data?.map(row=><TableRow key={row.id}><TableCell><bdi>{row.valid_from}</bdi><br/><span className="text-muted-foreground">حتى <bdi>{row.valid_to||'التغيير التالي'}</bdi></span>{row.voided_at&&<p className="form-error">أوقف احتسابه بسبب تغيير الانتماء في اليوم نفسه؛ يحتاج إثباتاً مستقلاً</p>}</TableCell><TableCell>{row.department}</TableCell><TableCell>{row.manager||'غير موثق'}</TableCell><TableCell>{employmentLabels[row.employment_status]}</TableCell><TableCell>{row.evidence_kind==='verified'?'توثيق بشري':'رصد النظام'}</TableCell><TableCell className="notes-cell">{row.reason}</TableCell><TableCell>{canWrite&&row.valid_to&&row.valid_to<=baghdadDate()&&<Button variant="outline" disabled={busy} onClick={()=>edit(row)}>تصحيح الفترة</Button>}</TableCell></TableRow>)}
   </TableBody></Table>
  </LoadState>
  {canWrite&&<form className="form-stack" onSubmit={save}>
   <h3>{editing?'تصحيح فترة موثقة':'توثيق فترة سابقة'}</h3><p className="scope-note">أضف فقط ما يثبته سجل أو قرار إداري. لا يغيّر هذا النموذج بيانات الموظف الحالية ولا يعيد حساب ملف شهري سبق اعتماده. يحفظ سجل التدقيق القيم السابقة وسبب التصحيح.</p>
   <div className="form-grid">
    <Field label="من تاريخ" required><Input type="date" required max={baghdadDate()} value={form.valid_from} onChange={e=>set('valid_from',e.target.value)}/></Field>
    <Field label="إلى تاريخ" required><Input type="date" required min={form.valid_from} max={baghdadDate()} value={form.valid_to} onChange={e=>set('valid_to',e.target.value)}/></Field>
    <Choice label="القسم خلال الفترة" value={form.department_id} onChange={v=>set('department_id',v)} empty="اختر القسم" options={reference.departments.map(d=>({value:d.id,label:departmentLabel(d)}))}/>
    <Choice label="الشفت خلال الفترة" value={form.shift_id} onChange={v=>set('shift_id',v)} empty="غير موثق" options={reference.shifts.map(s=>({value:s.id,label:s.name}))}/>
    <Choice label="المسؤول خلال الفترة" value={form.direct_manager_id} onChange={v=>set('direct_manager_id',v)} empty="غير موثق" options={reference.managers.filter(m=>m.employee_id!==employee.id).map(m=>({value:m.id,label:m.name}))}/>
    <Choice label="حالة التوظيف خلال الفترة" value={form.employment_status} onChange={v=>set('employment_status',v)} options={Object.entries(employmentLabels).map(([value,label])=>({value,label}))}/>
   </div>
   <Field label="مصدر الإثبات والسبب" required hint="مثال: رقم قرار النقل وتاريخه أو مرجع سجل الموارد البشرية."><Textarea required minLength={3} maxLength={2000} value={form.reason} onChange={e=>set('reason',e.target.value)} placeholder="مرجع الإثبات الذي تمت مراجعته…"/></Field>
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="form-actions"><Button disabled={busy}>{busy?'جار التوثيق…':'حفظ الفترة الموثقة'}</Button>{editing&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{if(guard.canClose()){setEditing(null);setForm(blank);setError('');}}}>إلغاء التصحيح</Button>}</div>
  </form>}
 </div>;
}
