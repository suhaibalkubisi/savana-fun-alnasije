"use client";
import {useState} from "react";
import {useData,mutate} from "@/lib/hr/api";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {Choice,Field} from "./shared";
type Batch={id:string;version:number;source_name:string;import_kind:"daily"|"monthly";period_start:string;period_end:string;state:string;lifecycle_state?:string;lifecycle_version?:number;device_namespace?:string};
export function MonthlyReplacement({current,onSaved}:{current:Batch;onSaved:()=>void}){
 const list=useData<Batch[]>("attendance.imports",{import_kind:"monthly"});
 const role=useData<{can_configure:boolean}>("attendance.sources");
 const [selected,setSelected]=useState(""),[reason,setReason]=useState(""),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const options=(list.data||[]).filter(b=>b.id!==current.id&&b.lifecycle_state==="reviewed"&&b.period_start===current.period_start&&b.period_end===current.period_end);
 const target=options.find(b=>b.id===selected);
 async function save(){if(!target||busy)return;setBusy(true);setError("");try{await mutate("attendance.import.supersede",{id:current.id,version:current.lifecycle_version,replacement_id:target.id,replacement_version:target.lifecycle_version,reason});setConfirm(false);onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!role.data?.can_configure)return null;
 return <details className="workspace-panel"><summary>استبدال المصدر الشهري المعتمد - مدير النظام</summary><p>اختر معاينة من الشهر نفسه تمت مراجعتها. ينتقل الاعتماد في معاملة واحدة وتبقى أدلة المصدر السابق وسياقه محفوظة.</p><Choice label="المصدر البديل الذي تمت مراجعته" value={selected} onChange={setSelected} disabled={busy} options={options.map(b=>({value:b.id,label:b.source_name+" · "+b.device_namespace}))}/><Field label="سبب الاستبدال"><Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></Field>{!options.length&&<p>لا توجد معاينة بديلة مؤهلة؛ ارفع المصدر الصحيح وأكمل مراجعته أولاً.</p>}<Button disabled={busy||!target||reason.trim().length<3} onClick={()=>setConfirm(true)}>معاينة قرار الاستبدال</Button>{error&&<p role="alert">{error}</p>}<Dialog open={confirm} onOpenChange={o=>!busy&&setConfirm(o)}><DialogContent><DialogHeader><DialogTitle>تأكيد استبدال المصدر الرسمي؟</DialogTitle><DialogDescription>{current.source_name} / {current.device_namespace} ← {target?.source_name} / {target?.device_namespace}. {reason}</DialogDescription></DialogHeader><p>لا تُدمج نطاقات الأجهزة أو بيانات المصدرين. يتحقق الخادم من الصلاحية والإصدار وسلامة اعتماد البديل.</p><Button disabled={busy} onClick={()=>void save()}>تأكيد الاستبدال</Button></DialogContent></Dialog></details>;
}

