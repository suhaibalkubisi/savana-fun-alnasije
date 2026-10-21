import {rpc,AppError} from './supabase';
import {fileOnboarding,type OnboardingBatch,type OnboardingSource,type OnboardingEvidence,type OnboardingEmployee,type OnboardingAssignment} from '@/lib/hr/onboarding.mjs';
export async function inspectFileOnboarding(id:string,token:string,proposed:{person_code:string;employee_uuid:string}[]=[]) {
 const first=await rpc('attendance_read_v5',{p_kind:'import',p_filters:{id,page:'0'}},token) as {batch:OnboardingBatch;rows:OnboardingSource[]};const batch=first.batch;if(!batch)throw new AppError('المعاينة غير موجودة');if(batch.state!=='preview'||(batch.import_kind==='monthly'&&batch.lifecycle_state!=='preview'))throw new AppError('افتح معاينة غير مغلقة لإكمال التهيئة');
 const daily=await rpc('attendance_daily_evidence',{p_filters:{date:batch.period_end}},token) as OnboardingEvidence;let evidence:OnboardingEvidence;
 if(batch.import_kind==='monthly')evidence=await rpc('attendance_monthly_evidence_v2',{p_filters:{month:String(batch.period_start).slice(0,7),import_id:id}},token) as OnboardingEvidence;
 else {const rows=[...first.rows],total=Number(batch.summary?.rows);if(!Number.isInteger(total)||total>30000)throw new AppError('عدد صفوف المعاينة غير صالح');for(let page=1;rows.length<total;page++){const next=await rpc('attendance_read_v5',{p_kind:'import',p_filters:{id,page:String(page)}},token) as typeof first;if(next.batch.version!==batch.version||!next.rows.length)throw new AppError('تغيرت المعاينة؛ حدّث القراءة');rows.push(...next.rows);}if(rows.length!==total)throw new AppError('قراءة الأدلة غير مكتملة');evidence={...daily,batch,sources:rows};}
 const matching=await rpc('attendance_read_v5',{p_kind:'matching_employees',p_filters:{}},token) as OnboardingEmployee[];
 const assignments=[...new Map([...(daily.assignments||[]),...(evidence.assignments||[])].map((a)=>[a.id,a])).values()];
 const ids=new Set([...evidence.sources.map((s)=>s.employee_id).filter((id):id is string=>!!id),...proposed.map(p=>p.employee_uuid)]);const known=new Set([...daily.employees,...(evidence.employees||[])].map((e)=>e.id));
 for(const employee of ids)if(!known.has(employee)){const history=await rpc('employee_assignments',{p_employee_id:employee},token) as OnboardingAssignment[];assignments.push(...history.map(a=>({...a,employee_id:employee})));}
 const fresh=await rpc('attendance_read_v5',{p_kind:'import',p_filters:{id,page:'0'}},token) as typeof first;if(fresh.batch.version!==batch.version||fresh.batch.state!==batch.state)throw new AppError('تغيرت المعاينة أثناء الفحص؛ حدّث القراءة');
 return fileOnboarding({batch:fresh.batch,sources:evidence.sources,employees:matching,assignments,rules:evidence.rules||daily.rules||[]},proposed);
}
