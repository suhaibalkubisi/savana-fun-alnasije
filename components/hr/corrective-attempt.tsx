"use client";
import {useState} from "react";
import {useData,mutate} from "@/lib/hr/api";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Choice,Field} from "./shared";
type Batch={id:string;version:number;source_name:string;device_namespace?:string};
type Source={id:string;namespace:string;label:string;confirmation_reason:string|null};
export function CorrectiveAttempt({current,onSaved}:{current:Batch;onSaved:(b:Batch)=>void}){
 const sources=useData<{can_configure:boolean;rows:Source[]}>("attendance.sources");
 const [source,setSource]=useState(""),[reason,setReason]=useState(""),[coverage,setCoverage]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(){if(busy)return;setBusy(true);setError("");try{const next=await mutate<Batch>("attendance.import.new_attempt",{id:current.id,version:current.version,reason,device_source_id:source||undefined,coverage_confirmed:coverage});onSaved(next);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <details className="workspace-panel"><summary>إنشاء محاولة تصحيحية من الأدلة المحفوظة</summary><p>تُنشأ معاينة جديدة من الأوقات الخام نفسها، وتُقرأ الروابط المؤكدة في نطاق الجهاز المختار. يبقى المصدر المغلق محفوظاً؛ اعتماد البديل أو استبداله قرار مستقل بعد المراجعة.</p>{sources.data?.can_configure&&<Choice label="نطاق الجهاز الصحيح من سجل موثق" empty={"الإبقاء على النطاق: "+current.device_namespace} value={source} onChange={setSource} disabled={busy} options={(sources.data.rows||[]).filter(s=>s.confirmation_reason&&s.confirmation_reason.trim().length>=3).map(s=>({value:s.id,label:s.label+" · "+s.namespace}))}/>}<Field label="سبب المحاولة التصحيحية"><Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} disabled={busy}/></Field><label><input type="checkbox" checked={coverage} disabled={busy} onChange={e=>setCoverage(e.target.checked)}/> تحققت من تغطية الجهاز للفترة وكل هويات الصفوف؛ الأيام الفارغة وحدها لا تكفي.</label>{error&&<p role="alert">{error}</p>}<Button variant="outline" disabled={busy||reason.trim().length<3} onClick={()=>void save()}>إنشاء المعاينة التصحيحية</Button></details>;
}
