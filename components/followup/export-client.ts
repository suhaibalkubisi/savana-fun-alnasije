import {ExportScheduler} from './export-scheduler';
import type {Selection,ExportTable} from './report-model';
export type ExportPhase='waiting'|'preparing'|'retrying'|'rendering'|'complete'|'failed';
export type ExportProgress={phase:ExportPhase;attempt?:number;retrySeconds?:number};
export const exportProgressText=(p:ExportProgress|null)=>!p?'':({waiting:'بانتظار دور إعداد التقرير…',preparing:'جارٍ إعداد كامل بيانات التقرير؛ قد يستغرق الطلب بعض الوقت…',retrying:`الخدمة مشغولة؛ إعادة المحاولة ${p.attempt} بعد ${p.retrySeconds} ثوانٍ…`,rendering:'جارٍ إنشاء الملف من كامل بيانات التقرير…',complete:'اكتمل إعداد التقرير.',failed:'لم يكتمل إعداد التقرير. يمكنك إعادة المحاولة.'})[p.phase];
const tasks=new ExportScheduler(1,24,120000);
type Progress=(value:ExportProgress)=>void;
const cancelled=()=>new DOMException('تم إلغاء إعداد التقرير','AbortError');
function pause(ms:number,signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(cancelled());return;}
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(cancelled());};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
});}
export async function runExportTask<T>(work:()=>Promise<T>,progress:Progress,signal?:AbortSignal):Promise<T>{
  progress({phase:'waiting'});
  try{return await tasks.run(async()=>{if(signal?.aborted)throw cancelled();const value=await work();if(signal?.aborted)throw cancelled();progress({phase:'complete'});return value;},signal);}
  catch(error){if(!(error instanceof Error&&error.name==='AbortError'))progress({phase:'failed'});throw error;}
}
export async function readExportModel(selection:Selection,progress:Progress,signal?:AbortSignal):Promise<ExportTable>{
  for(let attempt=1;attempt<=3;attempt++){
    if(signal?.aborted)throw cancelled();
    progress({phase:'preparing',attempt});
    const timeout=AbortSignal.timeout(120000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
    let response:Response;
    try{response=await fetch('/api/followup/export',{method:'POST',headers:{'Content-Type':'application/json','x-hr-request':'1'},body:JSON.stringify(selection),cache:'no-store',signal:requestSignal});}
    catch(error){if(signal?.aborted)throw cancelled();if(timeout.aborted)throw Error('انتهت مهلة إعداد التقرير؛ لم يُجهز ملف. أعد المحاولة.');throw error;}
    const data=await response.json().catch(()=>null) as ExportTable&{error?:string}|null;
    if(signal?.aborted)throw cancelled();
    if(response.ok){
      const expectedScope=selection.kind==='directory'?'authorized-directory':'evening';
      if(!data||data.scope_kind!==expectedScope||!Array.isArray(data.rows)||!Array.isArray(data.headers)||!Array.isArray(data.sections)||!Array.isArray(data.sheets))throw Error('لم تصل بيانات التقرير كاملة؛ لم يُجهز ملف. أعد المحاولة.');
      return data;
    }
    if([429,503].includes(response.status)&&attempt<3){
      const seconds=Math.min(10,Math.max(1,Number(response.headers.get('Retry-After'))||2));
      progress({phase:'retrying',attempt:attempt+1,retrySeconds:seconds});await pause(seconds*1000,signal);continue;
    }
    throw Error(data?.error||'تعذر إعداد التقرير؛ لم يُجهز ملف. أعد المحاولة.');
  }
  throw Error('تعذر إعداد التقرير؛ لم يُجهز ملف.');
}
export const prepareExport=(selection:Selection,progress:Progress,signal?:AbortSignal)=>runExportTask(()=>readExportModel(selection,progress,signal),progress,signal);
