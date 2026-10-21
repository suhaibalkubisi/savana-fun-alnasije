import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandImage } from "@/components/hr/brand-image";
import { counts, type Status } from "./domain";
import { message } from "./client";
import { excel, pdf, printPreview } from "./exports";
import type { ExportTable } from "./report-model";
import {readExportModel,runExportTask,exportProgressText,type ExportProgress} from './export-client';
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="fu-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Chip({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return <span className={"fu-chip " + value}>{children}</span>;
}
export function Empty({
  children = "لا توجد سجلات ضمن النطاق المحدد.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="fu-empty">
      <span aria-hidden="true">○</span>
      <p>{children}</p>
    </div>
  );
}
export function Metrics({
  rows,
  statuses,
  period = false,
}: {
  rows: { status: string; scope_state?: string }[];
  statuses: Status[];
  period?: boolean;
}) {
  const c = counts(rows, statuses);
  if(!rows.length)return <p className="fu-warning">لا توجد قائمة مؤهلة أو تبليغات ضمن هذا النطاق. لا تُستنتج منه حالة حضور أو غياب.</p>;
  return (
    <div className="fu-metrics">
      {[
        [period ? "أيام ضمن القائمة" : "إجمالي القائمة", c.expected, "total"],
        ["حاضر", c.present, "present"],
        [period ? "أيام الغياب" : "غياب", c.absent, "absent"],
        ["إجازة", c.leave, "leave"],
        ["حالات أخرى", c.other, "other"],
        ["غير محسوم", c.unresolved, "unresolved"],
      ].map(([l, v, k]) => (
        <div className={String(k)} key={k}>
          <span>{l}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}
export function ExportButtons({
  table,
  onError,
}: {
  table: ExportTable;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const [progress,setProgress]=useState<ExportProgress|null>(null);
  const [failed,setFailed]=useState('');
  const running=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const run = async (kind: string) => {
    if(running.current)return;
    running.current=true;controller.current=new AbortController();const signal=controller.current.signal;
    setBusy(kind);
    setFailed('');
    let ownedPreview:Window|null=null;
    try {
      if(kind==='print'){
        ownedPreview=window.open('about:blank','_blank');
        if(!ownedPreview)throw Error('اسمح بفتح نافذة معاينة الطباعة ثم أعد المحاولة.');
        ownedPreview.document.documentElement.dir='rtl';
        ownedPreview.document.title='معاينة التقرير';
        ownedPreview.document.body.textContent='بانتظار إعداد كامل التقرير…';
      }
      await runExportTask(async()=>{
        const fresh=table.selection?await readExportModel(table.selection,setProgress,signal):table;
        if(signal.aborted)throw new DOMException('تم الإلغاء','AbortError');
        setProgress({phase:'rendering'});
        await new Promise(resolve=>setTimeout(resolve,20));
        if(signal.aborted)throw new DOMException('تم الإلغاء','AbortError');
        if(kind==='xlsx')await excel(fresh,signal);
        else if(kind==='pdf')await pdf(fresh,signal);
        else await printPreview(fresh,signal,ownedPreview||undefined);
      },setProgress,signal);
    } catch (e) {
      ownedPreview?.close();
      if(!(e instanceof Error&&e.name==='AbortError')){setFailed(kind);onError(message(e));}
    } finally {
      running.current=false;
      setBusy("");
    }
  };
  return (
    <div className="fu-export">
      <button disabled={!!busy} onClick={() => run("print")}>
        معاينة الطباعة
      </button>
      <button disabled={!!busy} onClick={() => run("xlsx")}>
        تنزيل Excel
      </button>
      <button className="primary" disabled={!!busy} onClick={() => run("pdf")}>
        تنزيل PDF
      </button>
      {progress&&<span role="status" aria-live="polite">{exportProgressText(progress)}</span>}
      {failed&&!busy&&<button onClick={()=>run(failed)}>إعادة محاولة إعداد الملف</button>}
    </div>
  );
}
export function DataTable({ table }: { table: ExportTable }) {
  return (
    <section
      className={
        "fu-report " +
        (table.headers.length > 20 ? "fu-monthly-print" : "fu-standard-print")
      }
    >
      <div className="fu-print-brand">
        <BrandImage kind="company" alt="FANU ALNASIJ BY ZMC" />
        <strong className="fu-title">قسم المتابعة — مسائي</strong>
        <BrandImage kind="savana" alt="SAVANA" />
      </div>
      <div className="fu-report-heading">
        <h3>{table.title}</h3>
        <p>{table.scope}</p>
        <p>{table.source_status} · المرجع <bdi>{table.reference}</bdi></p>
      </div>
      {(table.sections.length?table.sections:[table]).map((section,index)=><div key={index}><h4>{section.name}</h4>
      <div className="fu-scroll">
        <table>
          <thead>
            <tr>
              {section.headers.map((v, i) => (
                <th key={i}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>
                    <bdi>{v}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!section.rows.length && <Empty />}{section.note&&<p className="fu-muted">{section.note}</p>}</div>)}
      <p className="fu-report-footer">{table.footer}</p>
    </section>
  );
}
