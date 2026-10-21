import {body,errorResponse,json,protectMutation,rpc,session,AppError} from '@/lib/server/supabase';
import {reportTable,validateSelection,type Selection,type ReportContext} from '@/components/followup/report-model';
import type {Position,Employee,Report,Action} from '@/components/followup/domain';
import {ExportScheduler,ExportCapacityError} from '@/components/followup/export-scheduler';
type Dataset={positions:Position[];reports:Report[];actions:Action[];employees?:Employee[]}&Partial<ReportContext>;
// Per worker isolate. Admission also bounds live authentication/RPC work.
const scheduler=new ExportScheduler(2,24,60000);
export async function POST(request:Request){
  try{
    protectMutation(request);const selection=await body(request,5000) as Selection;
    try{validateSelection(selection);}catch(e){throw new AppError((e as Error).message);}
    const queuedAt=Date.now();
    return await scheduler.run(async()=>{
    const waited=Date.now()-queuedAt,s=await session();
    const filters={start:selection.start,end:selection.end,scope:'evening',...(selection.department_id?{department_id:selection.department_id}:{}),...(selection.employee_id?{employee_id:selection.employee_id}:{}),...(selection.report_id?{report_id:selection.report_id}:{})};
    const read=<T,>(kind:string,f:unknown=filters)=>rpc<T>('followup_read',{p_kind:kind,p_filters:f},s.token);
    const [bootResult,dataResult,directoryResult]=await Promise.allSettled([
      read<ReportContext>('bootstrap',{}),
      selection.kind==='directory'?Promise.resolve({positions:[],reports:[],actions:[],scope:'authorized-directory'} as Dataset):read<Dataset>('reporting_model'),
      selection.kind==='directory'?read<Employee[]>('employee_directory',{start:selection.start,end:selection.end,...(selection.department_id?{department_id:selection.department_id}:{}),...(selection.employee_id?{employee_id:selection.employee_id}:{}),...(selection.query?{query:selection.query}:{})}):Promise.resolve([]),
    ]);
    // A failed sibling must not release admission while another RPC is running.
    if(bootResult.status==='rejected')throw bootResult.reason;
    if(dataResult.status==='rejected')throw dataResult.reason;
    if(directoryResult.status==='rejected')throw directoryResult.reason;
    const bootstrap=bootResult.value,dataset=dataResult.value,directory=directoryResult.value;
    if(selection.department_id&&!bootstrap.departments.some(d=>d.id===selection.department_id))throw new AppError('القسم خارج نطاق الصلاحية',403);
    const context={...bootstrap,...dataset,scope:selection.kind==='directory'?'authorized-directory':'evening'};
    const response=json(reportTable(selection,context,dataset.positions||[],directory.length?directory:dataset.employees||[],dataset.reports||[],dataset.actions||[]));
    response.headers.set('X-Export-Queue-Wait-Ms',String(waited));
    response.headers.set('X-Export-Concurrency-Limit','2');
    return response;
    },request.signal);
  }catch(e){
    if(e instanceof ExportCapacityError)return Response.json({error:e.message,code:'EXPORT_BUSY'},{status:429,headers:{'Cache-Control':'no-store','Retry-After':String(e.retryAfter)}});
    if(e instanceof AppError&&e.status===503)return Response.json({error:'تعذر إعداد التقرير مؤقتاً. أعد المحاولة؛ لم يُجهز ملف.',code:'EXPORT_RETRY'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'2'}});
    if(e instanceof Error&&e.name==='AbortError')return Response.json({error:'تم إلغاء طلب التقرير',code:'EXPORT_CANCELLED'},{status:499,headers:{'Cache-Control':'no-store'}});
    return errorResponse(e);
  }
}
