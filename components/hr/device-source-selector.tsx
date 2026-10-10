"use client";
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {mutate,useData} from "@/lib/hr/api";
import {Choice,Field,LoadState} from "./shared";
type Source={id:string;namespace:string;label:string;confirmation_reason:string|null;version:number};
export function DeviceSourceSelector({value,onChange,disabled}:{value:string;onChange:(v:string)=>void;disabled:boolean}){
 const q=useData<{can_configure:boolean;rows:Source[]}>("attendance.sources");
 const [editing,setEditing]=useState<Source|null>(null);
 const [open,setOpen]=useState(false),[label,setLabel]=useState(""),[namespace,setNamespace]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(){if(busy)return;setBusy(true);setError("");try{const s=await mutate<Source>("attendance.source.save",{id:editing?.id,version:editing?.version,namespace,label,confirmation_reason:reason});onChange(s.namespace);q.refresh();setOpen(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="device-source-selector"><LoadState loading={q.loading&&!q.data} error={q.error} retry={q.refresh}><Choice disabled={disabled} empty="اختر الجهاز / المصدر" label="الجهاز / مصدر التصدير" value={value} onChange={onChange} options={(q.data?.rows||[]).map(s=>({value:s.namespace,label:s.label+(s.confirmation_reason?"":" · تعريف يحتاج تحققاً")}))}/>{q.data?.can_configure&&<Button type="button" variant="outline" disabled={disabled} onClick={()=>{setEditing(null);setNamespace("");setLabel("");setReason("");setOpen(true);}}>تعريف مصدر جهاز</Button>}{q.data?.can_configure&&value&&<Button variant="ghost" disabled={disabled} onClick={()=>{const source=q.data?.rows.find(s=>s.namespace===value);if(!source)return;setEditing(source);setNamespace(source.namespace);setLabel(source.label);setReason(source.confirmation_reason||"");setOpen(true);}}>توثيق تعريف المصدر المختار</Button>}</LoadState><p className="scope-note">اختر المصدر الثابت لنفس الجهاز. الأرقام الإدارية والكود الوظيفي لا تعوض هوية الجهاز؛ الاسم اقتراح للمراجعة.</p><Dialog open={open} onOpenChange={v=>!busy&&setOpen(v)}><DialogContent><DialogHeader><DialogTitle>تعريف مصدر جهاز</DialogTitle><DialogDescription>تعريف نطاق ثابت لا يربط الموظفين ولا يعتمد الحضور. استخدم سجل الجهاز لتوثيق المصدر.</DialogDescription></DialogHeader><Field label="اسم المصدر"><Input value={label} onChange={e=>setLabel(e.target.value)} maxLength={150}/></Field><Field label="المعرف الثابت من سجل الأجهزة"><Input disabled={!!editing} value={namespace} onChange={e=>setNamespace(e.target.value)} maxLength={100}/></Field><Field label="مصدر تعريف الجهاز"><Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></Field>{error&&<p role="alert">{error}</p>}<Button disabled={busy||!label.trim()||!namespace.trim()||reason.trim().length<3} onClick={()=>void save()}>حفظ مصدر الجهاز</Button></DialogContent></Dialog></div>;
}

