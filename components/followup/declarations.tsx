import { useEffect, useState } from "react";
import { get, write, message, isAbort, draftKey } from "./client";
import {
  counts,
  states,
  channels,
  revisionDiff,
  visibleSelection,
  baghdadLocalDateTime,
  declarationMatchesSaved,
  canEditDeclaration,
  type Boot,
  type Employee,
  type Report,
  type Revision,
} from "./domain";
import { Field, Chip, Empty, Metrics, ExportButtons } from "./ui";
import { reportTable } from "./report-model";
type Draft = {
  version: number | null;
  statuses: Record<string, string>;
  reporter: string;
  registry: string;
  channel: string;
  note: string;
  reported_at: string;
  evidence_reference: string;
};
export function Declaration({
  boot,
  date,
  department,
  query,
  onError,
  onNotice,
  onDirty,
  onRefresh,
  onProfile,
}: {
  boot: Boot;
  date: string;
  department: string;
  query: string;
  onError: (s: string) => void;
  onNotice: (s: string, knownSuccess?: boolean) => void;
  onDirty: (s: boolean) => void;
  onRefresh: () => void;
  onProfile: (id: string) => void;
}) {
  const accountEligible = ["ADMIN", "SUPERVISOR"].includes(
    boot.user.followup_role || boot.user.role,
  );
  const [roster, setRoster] = useState<Employee[]>([]),
    [report, setReport] = useState<Report | null>(null),
    [statuses, setStatuses] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState<string[]>([]),
    [undo, setUndo] = useState<Record<string, string>[]>([]),
    [reporter, setReporter] = useState(accountEligible ? boot.user.id : ""),
    [registry, setRegistry] = useState(""),
    [channel, setChannel] = useState(accountEligible ? "account" : ""),
    [note, setNote] = useState(""),
    [reportedAt, setReportedAt] = useState(""),
    [evidence, setEvidence] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(true),
    [restore, setRestore] = useState<Draft | null>(null),
    [preview, setPreview] = useState(false),
    [reason, setReason] = useState("");
  const role = boot.user.followup_role || boot.user.role,
    canWrite = canEditDeclaration(role, report, boot.user.id),
    readonly =
      !canWrite || (!!report && !["draft", "returned"].includes(report.state)),
    sourceValid =
      !!channel &&
      (channel === "account"
        ? report
          ? !!reporter
          : accountEligible && reporter === boot.user.id
        : !!registry),
    visible = roster.filter(
      (e) => !query || (e.name + " " + e.internal_code).includes(query),
    ),
    visibleSelected = visibleSelection(selected, visible),
    availableReporters = (boot.reporters || []).filter(
      (r) => r.active && r.department_id === department,
    );
  const c = counts(
      roster.map((e) => ({ status: statuses[e.id] || "unresolved" })),
      boot.statuses,
    ),
    key = draftKey(boot.user.id, department, date);
  useEffect(() => {
    if (!department) return;
    const controller = new AbortController();
    Promise.all([
      get<Employee[]>(
        "roster",
        { department_id: department, start: date, end: date },
        controller.signal,
      ),
      get<Report[]>(
        "reports",
        { department_id: department, start: date, end: date },
        controller.signal,
      ),
    ])
      .then(([list, reports]) => {
        const r = reports[0] || null;
        setRoster(list);
        setReport(r);
        setStatuses(
          Object.fromEntries(
            list.map((e) => [
              e.id,
              r?.entries.find((x) => x.employee_id === e.id)?.status ||
                "unresolved",
            ]),
          ),
        );
        setReporter(
          r ? r.reporter_id || "" : accountEligible ? boot.user.id : "",
        );
        setRegistry(r?.reporter_registry_id || "");
        setChannel(r?.channel || (accountEligible ? "account" : ""));
        setNote(r?.note || "");
        setReportedAt(baghdadLocalDateTime(r?.reported_at));
        setEvidence(r?.evidence_reference || "");
        try {
          const raw = sessionStorage.getItem(key);
          if (raw) {
            const saved = JSON.parse(raw) as Draft;
            if (
              saved.version === (r?.version || null) &&
              (!r || ["draft", "returned"].includes(r.state))
            )
              setRestore(saved);
            else
              onNotice(
                "يوجد تعديل محلي لإصدار سابق. لم يُطبّق على بيانات الخادم.",
              );
          }
        } catch {
          sessionStorage.removeItem(key);
        }
        setBusy(false);
      })
      .catch((e) => {
        if (!isAbort(e)) {
          onError(message(e));
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [boot.user.id, accountEligible, date, department, key, onError, onNotice]);
  useEffect(() => {
    if (!dirty) return;
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: report?.version || null,
          statuses,
          reporter,
          registry,
          channel,
          note,
          reported_at: reportedAt,
          evidence_reference: evidence,
        }),
      );
    } catch {
      onError("تعذر حفظ نسخة الاسترداد المحلية. احفظ المسودة على الخادم.");
    }
  }, [
    dirty,
    key,
    report?.version,
    statuses,
    reporter,
    registry,
    channel,
    note,
    reportedAt,
    evidence,
    onError,
  ]);
  function markDirty() {
    setDirty(true);
    onDirty(true);
    setPreview(false);
  }
  function change(ids: string[], status: string) {
    setUndo((v) => [...v, statuses]);
    setStatuses((v) => ({
      ...v,
      ...Object.fromEntries(ids.map((id) => [id, status])),
    }));
    markDirty();
  }
  async function save(kind: "save" | "submit") {
    if (!sourceValid) {
      onError(
        "حدد طريقة التبليغ والمبلّغ الفعلي. حساب المتابعة يسجّل مصدر الهاتف أو الرسالة أو الحضور الشخصي، ولا يحل محل حساب مشرف القسم.",
      );
      return;
    }
    setBusy(true);
    const data = {
      id: report?.id,
      version: report?.version,
      work_date: date,
      department_id: department,
      reporter_id: channel === "account" ? reporter : null,
      reporter_registry_id: channel === "account" ? null : registry,
      channel,
      note,
      reported_at: reportedAt
        ? new Date(reportedAt + "+03:00").toISOString()
        : null,
      evidence_reference: evidence || null,
      entries: roster.map((e) => ({
        employee_id: e.id,
        status: statuses[e.id] || "unresolved",
      })),
    };
    try {
      const r = await write<Report>(kind, data, (value) =>
        declarationMatchesSaved(value, data, kind, boot.user.id),
      );
      setReport(r);
      setDirty(false);
      onDirty(false);
      setUndo([]);
      setRestore(null);
      sessionStorage.removeItem(key);
      onNotice(
        kind === "save"
          ? "حُفظت المسودة لدى الخادم."
          : "أُرسل التبليغ للمراجعة.",
        true,
      );
      onRefresh();
    } catch (e) {
      onError(
        message(e) +
          " · احتُفظ بالتعديلات. أعد المحاولة بنفس الطلب، أو تحقّق من سجل القسم.",
      );
      try {
        const existing = await get<Report[]>("reports", {
          department_id: department,
          start: date,
          end: date,
        });
        const saved = existing.find((r) =>
          declarationMatchesSaved(r, data, kind, boot.user.id),
        );
        if (saved) {
          setReport(saved);
          setDirty(false);
          onDirty(false);
          setUndo([]);
          setRestore(null);
          sessionStorage.removeItem(key);
          onNotice("تحقّقنا من الخادم: حُفظ الطلب رغم انقطاع الاستجابة.", true);
          onRefresh();
        }
      } catch {
        /* The retained retry key reconciles an ambiguous response on retry. */
      }
    } finally {
      setBusy(false);
    }
  }
  async function transition(kind: string) {
    if (!report) return;
    setBusy(true);
    try {
      const r = await write<Report>(kind, {
        id: report.id,
        version: report.version,
        department_id: department,
        work_date: date,
        reason,
      });
      setReport(r);
      setReason("");
      onNotice("حُفظ إصدار قابل للتتبّع.");
      onRefresh();
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!department)
    return (
      <Empty>اختر القسم وتاريخ الخدمة لتحميل القائمة المسائية المؤرّخة.</Empty>
    );
  if (busy && !roster.length)
    return (
      <section className="fu-panel">
        <p role="status">جارٍ تحميل القائمة المسائية…</p>
      </section>
    );
  if (!roster.length)
    return (
      <section className="fu-panel">
        <Empty>
          لم يوثّق الانتماء المسائي للتاريخ المحدد. القائمة الفارغة لا تثبت
          حضوراً أو غياباً.
        </Empty>
        <p className="fu-muted">
          يتطلب الإبلاغ قائمة مؤرّخة يثبتها مسؤول مخوّل بإدارة الانتماء. يمكنه
          فتح ملف الموظف وتسجيل القسم الحالي مع تاريخ السريان والمصدر.
        </p>
      </section>
    );
  return (
    <>
      <div className="fu-steps">
        <span className="done">١ القسم وتاريخ الخدمة</span>
        <span className={!preview ? "active" : "done"}>٢ تسجيل الحالات</span>
        <span className={preview ? "active" : ""}>٣ المعاينة والإرسال</span>
      </div>
      {role === "SUPERVISOR" &&
        report &&
        report.reporter_id !== boot.user.id && (
          <p className="fu-warning">
            هذا التبليغ يخص مبلّغاً آخر أو سجّله قسم المتابعة. يظهر للقراءة في
            هذا الحساب؛ التحرير لدى المستخدم المخوّل.
          </p>
        )}
      {restore && (
        <div className="fu-notice" role="status">
          توجد تعديلات محلية غير محفوظة لهذا القسم والتاريخ.
          <div className="fu-bulk">
            <button
              onClick={() => {
                setStatuses(restore.statuses);
                setReporter(restore.reporter);
                setRegistry(restore.registry);
                setChannel(restore.channel);
                setNote(restore.note);
                setReportedAt(restore.reported_at);
                setEvidence(restore.evidence_reference);
                setRestore(null);
                markDirty();
                onNotice(
                  "استُعيدت تعديلات محلية؛ احفظها على الخادم بعد التحقق.",
                );
              }}
            >
              استعادة التعديلات
            </button>
            <button
              onClick={() => {
                setRestore(null);
                sessionStorage.removeItem(key);
              }}
            >
              تجاهل النسخة المحلية
            </button>
          </div>
        </div>
      )}
      <section className="fu-panel">
        <div className="fu-section-title">
          <div>
            <h3>
              {boot.departments.find((d) => d.id === department)?.arabic_name}
            </h3>
            <p>{date} · الخدمة المسائية</p>
          </div>
          <Chip value={report?.state || "draft"}>
            {states[report?.state || "draft"]}
            {report ? " · إصدار " + report.version : ""}
          </Chip>
        </div>
        {report?.return_reason && (
          <div className="fu-error">سبب الإرجاع: {report.return_reason}</div>
        )}
        <div className="fu-form">
          <Field label="طريقة التبليغ">
            <select
              disabled={readonly || !!report || role === "SUPERVISOR"}
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                markDirty();
              }}
            >
              <option value="">اختر طريقة التبليغ الفعلية</option>
              {Object.entries(channels)
                .filter(
                  ([id]) =>
                    id !== "account" ||
                    accountEligible ||
                    report?.channel === "account",
                )
                .map(([id, l]) => (
                  <option key={id} value={id}>
                    {l}
                  </option>
                ))}
            </select>
          </Field>
          {channel === "account" ? (
            <Field label="المبلّغ صاحب الحساب">
              <select
                value={reporter}
                disabled={readonly || !!report || role === "SUPERVISOR"}
                onChange={(e) => {
                  setReporter(e.target.value);
                  markDirty();
                }}
              >
                {report?.reporter_id &&
                  !boot.users.some((u) => u.id === report.reporter_id) && (
                    <option value={report.reporter_id}>
                      {report.reporter_name || "المبلّغ المسجّل سابقاً"}
                    </option>
                  )}
                {boot.users
                  .filter(
                    (u) =>
                      u.id === report?.reporter_id ||
                      (accountEligible && u.id === boot.user.id),
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <Field label="المبلّغ المسجّل دون اشتراط حساب">
              <select
                value={registry}
                disabled={readonly || !!report}
                onChange={(e) => {
                  setRegistry(e.target.value);
                  markDirty();
                }}
              >
                <option value="">اختر المسؤول من سجل القسم</option>
                {report?.reporter_registry_id &&
                  !availableReporters.some(
                    (r) => r.id === report.reporter_registry_id,
                  ) && (
                    <option value={report.reporter_registry_id}>
                      {report.reporter_name || "المبلّغ المسجّل سابقاً"}
                    </option>
                  )}
                {availableReporters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="وقت التبليغ الفعلي — بغداد">
            <input
              type="datetime-local"
              value={reportedAt}
              disabled={readonly}
              onChange={(e) => {
                setReportedAt(e.target.value);
                markDirty();
              }}
            />
          </Field>
          <Field label="مرجع الدليل أو التواصل">
            <input
              value={evidence}
              disabled={readonly}
              maxLength={250}
              onChange={(e) => {
                setEvidence(e.target.value);
                markDirty();
              }}
            />
          </Field>
          <Field label="ملاحظة">
            <input
              value={note}
              disabled={readonly}
              maxLength={2000}
              onChange={(e) => {
                setNote(e.target.value);
                markDirty();
              }}
            />
          </Field>
        </div>
        <p className="fu-muted">
          مدخل البيانات: {boot.user.name}
          {report?.entered_by_name
            ? " · المدخل الأصلي: " + report.entered_by_name
            : ""}
          . تاريخ الخدمة مستقل عن وقت إدخال التبليغ.
        </p>
      </section>
      <Metrics
        rows={roster.map((e) => ({ status: statuses[e.id] || "unresolved" }))}
        statuses={boot.statuses}
      />
      {!preview ? (
        <section className="fu-panel">
          <div className="fu-bulk">
            <button onClick={() => setSelected(visible.map((e) => e.id))}>
              تحديد الموظفين الظاهرين ({visible.length})
            </button>
            <button
              disabled={!canWrite || readonly || !visibleSelected.length}
              onClick={() => change(visibleSelected, "present")}
            >
              تعليم المحددين حاضر
            </button>
            <span>{visibleSelected.length} محدد ظاهر</span>
            <button onClick={() => setSelected([])}>إلغاء التحديد</button>
            <button
              disabled={!undo.length || readonly}
              onClick={() => {
                setStatuses(undo[undo.length - 1]);
                setUndo((v) => v.slice(0, -1));
                markDirty();
              }}
            >
              تراجع
            </button>
          </div>
          <div className="fu-scroll">
            <table>
              <thead>
                <tr>
                  <th>تحديد</th>
                  <th>اسم الموظف</th>
                  <th>الرمز الدائم</th>
                  <th>الحالة المبلّغ عنها</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr
                    key={e.id}
                    className={
                      statuses[e.id] === "unresolved" ? "unresolved" : ""
                    }
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"تحديد " + e.name}
                        checked={selected.includes(e.id)}
                        onChange={(v) =>
                          setSelected((s) =>
                            v.target.checked
                              ? [...new Set([...s, e.id])]
                              : s.filter((id) => id !== e.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="fu-name"
                        onClick={() => onProfile(e.id)}
                      >
                        {e.name}
                      </button>
                    </td>
                    <td>
                      <bdi>{e.internal_code}</bdi>
                    </td>
                    <td>
                      <select
                        aria-label={"حالة " + e.name}
                        value={statuses[e.id] || "unresolved"}
                        disabled={!canWrite || readonly}
                        onChange={(v) => change([e.id], v.target.value)}
                      >
                        {boot.statuses
                          .filter((s) => s.enabled || s.code === statuses[e.id])
                          .map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.label}
                              {!s.enabled ? " (حالة محفوظة سابقاً)" : ""}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length && <Empty />}
        </section>
      ) : (
        <section className="fu-panel">
          <h3>معاينة التبليغ</h3>
          <p>
            {c.expected} موظف: {c.present} حاضر، {c.absent} غائب، {c.leave}{" "}
            إجازة، {c.other} حالة أخرى، {c.unresolved} غير محسوم.
          </p>
          <p>وزن الغياب {c.weighted} · غياب ×٣ يمثل شخصاً واحداً ووزناً ٣.</p>
          <p>
            المبلّغ:{" "}
            {channel === "account"
              ? boot.users.find((u) => u.id === reporter)?.name
              : availableReporters.find((r) => r.id === registry)?.name}{" "}
            · {channels[channel]} · المدخل: {boot.user.name}
          </p>
          {c.unresolved > 0 && (
            <p className="fu-warning">
              يبقى {c.unresolved} شخصاً غير محسوم. الإرسال يُظهر التبليغ جزئياً.
            </p>
          )}
          <button onClick={() => setPreview(false)}>
            العودة إلى تسجيل الحالات
          </button>
        </section>
      )}
      <section className="fu-submit">
        <div>
          <strong>
            {dirty ? "تعديلات غير محفوظة" : states[report?.state || "draft"]}
          </strong>
          <p>تبليغ المسؤول والمراجعة عمليتان مستقلتان.</p>
        </div>
        {!readonly && canWrite ? (
          <div className="fu-bulk">
            <button
              disabled={busy || !sourceValid || !roster.length}
              onClick={() => save("save")}
            >
              حفظ مسودة
            </button>
            {!preview ? (
              <button className="primary" onClick={() => setPreview(true)}>
                معاينة قبل الإرسال
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !sourceValid || !roster.length}
                onClick={() => save("submit")}
              >
                إرسال للمراجعة
              </button>
            )}
          </div>
        ) : (
          canWrite &&
          report && (
            <div>
              <Field label="سبب التصحيح">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <button
                disabled={busy || !reason.trim()}
                onClick={() => transition("revise")}
              >
                فتح إصدار تصحيح
              </button>
            </div>
          )
        )}
      </section>
      {report && (
        <ExportButtons
          table={reportTable(
            {
              kind: "reporting",
              start: date,
              end: date,
              department_id: department,
              report_id: report.id,
            },
            boot,
            [],
            roster,
            [report],
            [],
          )}
          onError={onError}
        />
      )}
    </>
  );
}

export function Review({
  boot,
  reports,
  selectedId,
  onSelect,
  onRefresh,
  onError,
  onNotice,
  onProfile,
  onDirty,
}: {
  boot: Boot;
  reports: Report[];
  selectedId: string;
  onSelect: (id: string) => boolean;
  onRefresh: () => void;
  onError: (s: string) => void;
  onNotice: (s: string) => void;
  onProfile: (id: string) => void;
  onDirty: (v: boolean) => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Revision[]>([]);
  const report = reports.find((r) => r.id === selectedId),
    role = boot.user.followup_role || boot.user.role,
    canReview = ["ADMIN", "FOLLOWUP"].includes(role),
    dept = (id: string) =>
      boot.departments.find((d) => d.id === id)?.arabic_name || "—",
    label = (id: string | null) =>
      id
        ? boot.statuses.find((s) => s.code === id)?.label || id
        : "خارج الإصدار";
  async function transition(kind: string) {
    if (!report) return;
    setBusy(true);
    try {
      await write(kind, {
        id: report.id,
        version: report.version,
        work_date: report.work_date,
        department_id: report.department_id,
        reason,
      });
      setHistory([]);
      setReason("");
      onDirty(false);
      onError("");
      onRefresh();
      onNotice(
        kind === "review" &&
          report.entries.some((e) => e.status === "unresolved")
          ? "سُجلت مراجعة جزئية؛ بقيت حالات غير محسومة."
          : "حُفظت المراجعة مع نسبتها إلى المستخدم والإصدار.",
      );
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fu-review">
      <section className="fu-panel fu-review-list">
        <h3>التبليغات الواردة</h3>
        {reports
          .filter((r) => r.state !== "draft")
          .map((r) => (
            <button
              key={r.id}
              className={
                "fu-report-item " + (selectedId === r.id ? "active" : "")
              }
              onClick={() => {
                if (r.id === selectedId || !onSelect(r.id)) return;
                setReason("");
                onDirty(false);
                setHistory([]);
              }}
            >
              <strong>{dept(r.department_id)}</strong>
              <span>
                {r.work_date} · {r.reporter_name || "المبلّغ المسجّل"}
              </span>
              <div className="fu-bulk">
                <Chip value={r.state}>{states[r.state]}</Chip>
                <span>
                  {r.entries.length} موظف ·{" "}
                  {r.entries.filter((e) => e.status === "unresolved").length}{" "}
                  غير محسوم
                </span>
              </div>
            </button>
          ))}
        {!reports.some((r) => r.state !== "draft") && (
          <Empty>لا توجد تبليغات واردة في هذا النطاق.</Empty>
        )}
      </section>
      <section className="fu-panel">
        {report ? (
          <>
            <div className="fu-section-title">
              <h3>{dept(report.department_id)}</h3>
              <Chip value={report.state}>
                {states[report.state]} · إصدار {report.version}
              </Chip>
            </div>
            <p>
              تاريخ الخدمة: {report.work_date} · المبلّغ:{" "}
              {report.reporter_name ||
                boot.users.find((u) => u.id === report.reporter_id)?.name ||
                "—"}
            </p>
            <p>
              المدخل:{" "}
              {report.entered_by_name ||
                boot.users.find((u) => u.id === report.entered_by)?.name ||
                "—"}{" "}
              · {channels[report.channel]}
            </p>
            <p>
              {report.note || "بلا ملاحظة"}
              {report.evidence_reference
                ? " · المرجع: " + report.evidence_reference
                : ""}
            </p>
            <Metrics rows={report.entries} statuses={boot.statuses} />
            {report.state === "reviewed" &&
              report.entries.some((e) => e.status === "unresolved") && (
                <p className="fu-warning">
                  مراجعة جزئية — بقيت حالات غير محسومة كما بُلّغ عنها.
                </p>
              )}
            <div className="fu-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الرمز الدائم</th>
                    <th>الموظف</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {report.entries.map((e) => (
                    <tr key={e.employee_id}>
                      <td>
                        <bdi>{e.permanent_code}</bdi>
                      </td>
                      <td>
                        <button
                          className="fu-name"
                          onClick={() => onProfile(e.employee_id)}
                        >
                          {e.employee_name}
                        </button>
                      </td>
                      <td>{label(e.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Field label="سبب الإرجاع أو التصحيح">
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  onDirty(!!e.target.value);
                }}
                maxLength={2000}
              />
            </Field>
            <div className="fu-bulk">
              {canReview && report.state === "submitted" && (
                <>
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() => transition("return")}
                  >
                    إعادة للتصحيح
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => transition("review")}
                  >
                    {report.entries.some((e) => e.status === "unresolved")
                      ? "تسجيل مراجعة جزئية — بقيت حالات غير محسومة"
                      : "تسجيل اكتمال المراجعة"}
                  </button>
                </>
              )}
              {!!reason && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setReason("");
                    onDirty(false);
                  }}
                >
                  إلغاء مسودة المراجعة
                </button>
              )}
              {canReview &&
                ["submitted", "reviewed"].includes(report.state) && (
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() => transition("revise")}
                  >
                    فتح إصدار تصحيح
                  </button>
                )}
              <button
                disabled={busy}
                onClick={async () => {
                  try {
                    const h = await get<Revision[]>("revisions", {
                      id: report.id,
                    });
                    setHistory(h.sort((a, b) => a.version - b.version));
                    if (!h.length)
                      onNotice("لا توجد إصدارات سابقة مسجلة للمقارنة.");
                  } catch (e) {
                    onError(message(e));
                  }
                }}
              >
                مقارنة الإصدارات
              </button>
            </div>
            <p className="fu-muted">
              المراجعة تثبت فحص التبليغ. الحالات غير المحسومة والغياب تبقى كما
              بُلّغ عنها؛ لا ينشأ قرار رواتب أو عقوبة.
            </p>
            {history.map((h, i) => {
              const prior = i ? history[i - 1].snapshot.entries : [];
              const diff = revisionDiff(prior, h.snapshot.entries);
              return (
                <details key={h.version}>
                  <summary>
                    الإصدار {h.version} · {h.actor_name || h.actor} ·{" "}
                    {h.reason || "تغيير مسجّل"} ·{" "}
                    {new Date(h.at).toLocaleString("ar-IQ", {
                      timeZone: "Asia/Baghdad",
                    })}
                  </summary>
                  <table>
                    <thead>
                      <tr>
                        <th>الموظف</th>
                        <th>قبل</th>
                        <th>بعد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name}</td>
                          <td>{label(d.before)}</td>
                          <td>{label(d.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!diff.length && (
                    <p>
                      لا تغيير في حالات الموظفين؛ راجع بيانات الإصدار وسبب
                      العملية.
                    </p>
                  )}
                </details>
              );
            })}
          </>
        ) : (
          <Empty>
            اختر تبليغاً لفحص الحالات والمصدر والفروق بين الإصدارات.
          </Empty>
        )}
      </section>
    </div>
  );
}
