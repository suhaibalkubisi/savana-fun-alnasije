"use client";
import {useEffect,useState} from "react";
import {estimateTablePdfPages,tablePdfBytes} from "@/lib/hr/exports";
type Scope=Parameters<typeof tablePdfBytes>[0];
export function PrintEstimate({report}:{report:Scope|null}){
 const key=report?JSON.stringify(report):"";
 const [result,setResult]=useState({key:"",pages:0,error:""});
 useEffect(()=>{if(!key)return;let active=true;estimateTablePdfPages(JSON.parse(key) as Scope).then(pages=>{if(active)setResult({key,pages,error:""});}).catch(e=>{if(active)setResult({key,pages:0,error:(e as Error).message});});return()=>{active=false;};},[key]);
 if(!key)return null;
 return <p className="scope-note no-print" role="status">{result.key===key?(result.error?"تقدير PDF غير متاح: "+result.error:"PDF: "+result.pages+" صفحة متوقعة · "+(report!.headers.length>12?"A3 أفقي":"A4 أفقي")):"جار حساب صفحات PDF للنطاق الحالي…"}</p>;
}

