"use client";
import {useData} from '@/lib/hr/api';
import {LoadState} from './shared';
type Proposal={device_namespace:string;person_code:string;classification:string;candidates:{id:string;name:string;internal_code:string;employment_status:string;historical_rows:number;import_ids:string[]}[];conflicts:string[]};
export function IdentityProposal({issueId}:{issueId:string}) {
 const q=useData<Proposal>('attendance.identity_proposal',{issue_id:issueId});
 return <section className="identity-proposal"><h3>أدلة الربط — اقتراح يحتاج قراراً</h3><LoadState loading={q.loading&&!q.data} error={q.error} retry={q.refresh}>{q.data&&<><p>نطاق الجهاز: <bdi>{q.data.device_namespace}</bdi> · {q.data.classification}</p>{q.data.candidates.map(c=><p key={c.id}>{c.name} · {c.internal_code} · {c.employment_status==='active'?'نشط':'غير نشط'} · {c.historical_rows} صفاً سابقاً في {c.import_ids.length} ملفات معتمدة</p>)}{q.data.conflicts.map(c=><p key={c} role="status">{c}</p>)}<p>تحقق من سجل الجهاز أو دليل إداري مستقل. التأكيد يحفظ UUID ونطاق الجهاز والكود ومصدر القرار؛ لا يعتمد حضوراً.</p></>}</LoadState></section>;
}
export function EmployeeIdentityRegistry({employeeId}:{employeeId:string}) {
 const q=useData<{id:string;person_code:string;device_namespace:string;source_name:string;is_active:boolean;confirmation_reason:string;created_at:string}[]>('attendance.identity_registry',{employee_id:employeeId});
 return <section className="workspace-panel"><h2>الربط الدائم للأجهزة</h2><p>الهوية هي UUID الموظف؛ الكود الوظيفي والمرجع الإداري وأرقام الأجهزة حقول منفصلة. تُسجّل المطابقة الصريحة من معاينة مفتوحة مع سببها.</p><LoadState loading={q.loading} error={q.error} retry={q.refresh} empty={!q.data?.length} emptyText="لا توجد روابط أجهزة مؤكدة. افتح معاينة الملف وراجع أدلة المرشحين.">{q.data?.map(i=><article key={i.id}><strong><bdi>{i.device_namespace} / {i.person_code}</bdi></strong><p>{i.source_name} · {i.is_active?'مؤكد':'غير نشط'}</p><p>{i.confirmation_reason || 'ربط سابق؛ راجع سجل التدقيق'} · {i.created_at.slice(0,10)}</p></article>)}</LoadState></section>;
}
