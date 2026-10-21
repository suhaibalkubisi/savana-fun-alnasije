import { useEffect, useRef, useState, type FormEvent } from "react";
import { get, write, message, RequestError } from "./client";
import { today, type Employee, type Profile } from "./domain";
import { Field } from "./ui";
import {
  readDecisionRecovery,
  saveDecisionRecovery,
  clearDecisionRecovery,
  matchesDecisionReceipt,
  restoreDecisionAttempt,
  type DecisionAttempt,
  type DecisionReceipt,
  type DecisionRecoveryProof,
} from "./decision-recovery";
import {
  captureRecoverySession,
  recoverySessionCurrent,
} from "./account-recovery";
export const serviceLabels: Record<string, string> = {
  active: "نشط",
  inactive: "غير فعال",
  resigned: "مستقيل",
  long_leave: "إجازة طويلة",
};
export type ServiceDecision = {
  id: string;
  employee_id: string;
  employment_status: string;
  valid_from: string;
  reason: string;
  employee_version: number;
  actor_name?: string;
};
export function ServiceStateDialog({
  employee,
  actorId,
  identity = false,
  onClose,
  onSaved,
  onError,
  onDirty,
}: {
  employee: Employee;
  actorId: string;
  identity?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (s: string) => void;
  onDirty: (v: boolean) => void;
}) {
  const kind = identity ? "employee_identity" : "service_state";
  let recovery: DecisionAttempt | null = null,
    recoveryError = "";
  try {
    recovery = readDecisionRecovery(actorId, employee.id, kind);
  } catch {
    recoveryError = "تعذر قراءة طلب الاستكمال. راجع المسؤول قبل قرار بديل.";
  }
  const dialog = useRef<HTMLDialogElement>(null),
    [status, setStatus] = useState(
      String(recovery?.data.employment_status || employee.employment_status),
    ),
    [date, setDate] = useState(String(recovery?.data.valid_from || today())),
    [reason, setReason] = useState(String(recovery?.data.reason || "")),
    [name, setName] = useState(String(recovery?.data.name || employee.name)),
    [number, setNumber] = useState(
      String(recovery?.data.employee_number || employee.employee_number || ""),
    ),
    [preview, setPreview] = useState(!!recovery),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(!!recovery),
    [duplicates, setDuplicates] = useState<Employee[]>([]),
    [error, setError] = useState(recoveryError);
  const attempt = useRef<DecisionAttempt | null>(recovery),
    active = useRef(true),
    generation = useRef(captureRecoverySession(actorId));
  const currentSession = () =>
    active.current && recoverySessionCurrent(actorId, generation.current);
  useEffect(() => {
    const el = dialog.current,
      trigger = document.activeElement as HTMLElement | null;
    el?.showModal();
    onDirty(true);
    active.current = true;
    return () => {
      active.current = false;
      el?.close();
      onDirty(false);
      trigger?.focus();
    };
  }, [onDirty]);
  const changed = () => {
    setPreview(false);
    setError("");
  };
  async function prepare(e: FormEvent) {
    e.preventDefault();
    if (recoveryError || (attempt.current && uncertain)) return;
    if (reason.trim().length < 5) {
      setError("اكتب سبباً واضحاً من خمسة أحرف على الأقل.");
      return;
    }
    setBusy(true);
    try {
      if (identity) {
        const rows = await get<Employee[]>("employee_duplicates", {
          employee_id: employee.id,
          name,
          employee_number: number,
        });
        setDuplicates(rows);
        if (rows.length) {
          setError("وجدنا سجلاً مطابقاً. راجع هوية الموظف قبل التصحيح.");
          return;
        }
      }
      attempt.current = {
        id: crypto.randomUUID(),
        actor: actorId,
        kind,
        data: {
          employee_id: employee.id,
          version: employee.version,
          reason: reason.trim(),
          ...(identity
            ? { name: name.trim(), employee_number: number.trim() }
            : { employment_status: status, valid_from: date }),
        },
      };
      setPreview(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function readback() {
    const p = attempt.current;
    if (!p) return false;
    const receipt = await get<DecisionReceipt | null>("request_receipt", {
      employee_id: employee.id,
      request_id: p.id,
    });
    return currentSession() && matchesDecisionReceipt(p, receipt);
  }
  async function restoreAttempt() {
    const p = attempt.current;
    if (!p || !currentSession()) return null;
    if (!p.redacted) return p;
    const proof = await get<DecisionRecoveryProof>("decision_recovery", {
      request_id: p.id,
      employee_id: employee.id,
      decision_kind: p.kind,
    });
    if (!currentSession()) return null;
    const restored = restoreDecisionAttempt(p, proof);
    if (!restored) {
      clearDecisionRecovery(p);
      attempt.current = null;
      setUncertain(false);
      setPreview(false);
      setError("أغلق الطلب بأمان. يمكنك بدء قرار جديد.");
      return null;
    }
    attempt.current = restored;
    saveDecisionRecovery(restored, generation.current);
    setReason(String(restored.data.reason));
    setName(String(restored.data.name || employee.name));
    setNumber(String(restored.data.employee_number || ""));
    setStatus(
      String(restored.data.employment_status || employee.employment_status),
    );
    setDate(String(restored.data.valid_from || today()));
    return restored;
  }
  function leaveSafely() {
    if (!currentSession()) return;
    if (attempt.current && (busy || uncertain)) {
      try {
        saveDecisionRecovery(attempt.current, generation.current);
      } catch {
        setError(
          "تعذر حفظ طلب الاستكمال. أبقِ الحوار مفتوحاً حتى تستعيد الخدمة.",
        );
        return;
      }
      onError(
        "الحفظ غير محسوم. طلب الاستكمال محفوظ في هذه الجلسة؛ افتح حوار الموظف نفسه للتحقق أو إعادة نفس الطلب.",
      );
    }
    onClose();
  }
  async function save() {
    if (!attempt.current || !currentSession()) return;
    setBusy(true);
    setError("");
    try {
      const p = await restoreAttempt();
      if (!p || !currentSession()) return;
      saveDecisionRecovery(p, generation.current);
      const stage = await write<DecisionRecoveryProof>(
        "decision_recovery_stage",
        { kind: p.kind, data: p.data },
        undefined,
        p.id,
      );
      if (!currentSession()) return;
      restoreDecisionAttempt(p, stage);
      await write(kind, p.data, undefined, p.id);
      if (!currentSession()) return;
      if (!(await readback()))
        throw Error("لم نتأكد من الحفظ. افحص السجل قبل إعادة المحاولة.");
      clearDecisionRecovery(p);
      if (currentSession()) {
        onSaved();
        onClose();
      }
    } catch (e) {
      if (!currentSession()) return;
      const p = attempt.current;
      const unknown = !(e instanceof RequestError) || e.status >= 500;
      setUncertain(unknown || uncertain);
      if (p && !unknown && !uncertain) {
        clearDecisionRecovery(p);
        attempt.current = null;
        setPreview(false);
      }
      setError(message(e));
      onError(message(e));
    } finally {
      if (currentSession()) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="fu-service-dialog"
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const nodes = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            '[tabindex]:not([tabindex="-1"]),button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
          ),
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      aria-labelledby="service-title"
      onCancel={(e) => {
        e.preventDefault();
        leaveSafely();
      }}
    >
      <form onSubmit={prepare}>
        <h2 id="service-title">
          {identity ? "تصحيح هوية الموظف" : "تغيير حالة الموظف"}
        </h2>
        <p>
          {employee.name} · <bdi>{employee.internal_code}</bdi>
        </p>
        <p>الحالة الحالية: {serviceLabels[employee.employment_status]}</p>
        {attempt.current?.redacted && (
          <p className="fu-warning">
            بيانات الطلب تُستعاد بعد التحقق. احتفظ بمعرفه وافحص السجل قبل إعادة
            المحاولة.
          </p>
        )}
        {!attempt.current?.redacted && (
          <fieldset disabled={busy || preview || uncertain}>
            {identity ? (
              <>
                <Field label="الاسم الصحيح">
                  <input
                    required
                    maxLength={150}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      changed();
                    }}
                  />
                </Field>
                <Field label="الرقم الوظيفي — اختياري">
                  <input
                    maxLength={100}
                    value={number}
                    onChange={(e) => {
                      setNumber(e.target.value);
                      changed();
                    }}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="الحالة الجديدة">
                  <select
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      changed();
                    }}
                  >
                    {Object.entries(serviceLabels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="تاريخ النفاذ">
                  <input
                    type="date"
                    required
                    min={today()}
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      changed();
                    }}
                  />
                </Field>
              </>
            )}
            <Field label="سبب التغيير">
              <textarea
                required
                minLength={5}
                maxLength={2000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  changed();
                }}
              />
            </Field>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="fu-error">
            {error}
          </p>
        )}
        {!!duplicates.length && (
          <ul>
            {duplicates.map((e) => (
              <li key={e.id}>
                {e.name} · <bdi>{e.internal_code}</bdi>
              </li>
            ))}
          </ul>
        )}
        {preview && !attempt.current?.redacted && (
          <section className="fu-warning">
            <h3>معاينة القرار</h3>
            <p>
              {identity ? name : serviceLabels[status] + " — نافذ من " + date}
            </p>
            <p>{reason}</p>
            <p>يبقى الرمز والقسم والشفت والعضوية والتبليغات السابقة محفوظة.</p>
          </section>
        )}
        <div className="fu-bulk">
          {!preview ? (
            <button className="primary" disabled={busy}>
              معاينة التغيير
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy || !!attempt.current?.redacted}
              onClick={save}
            >
              {uncertain ? "إعادة محاولة نفس القرار" : "حفظ القرار صراحةً"}
            </button>
          )}
          {uncertain && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await restoreAttempt();
                  if (!currentSession() || !attempt.current) return;
                  if (await readback()) {
                    if (attempt.current) clearDecisionRecovery(attempt.current);
                    onSaved();
                    onClose();
                  } else
                    setError(
                      "لم يظهر القرار في السجل بعد. يمكنك إعادة نفس الطلب بأمان.",
                    );
                } catch (e) {
                  if (currentSession()) setError(message(e));
                } finally {
                  if (currentSession()) setBusy(false);
                }
              }}
            >
              التحقق من السجل
            </button>
          )}
          {uncertain && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const p = attempt.current;
                if (!p || !currentSession()) return;
                setBusy(true);
                try {
                  const proof = await write<DecisionRecoveryProof>(
                    "decision_recovery_close",
                    { employee_id: employee.id, decision_kind: p.kind },
                    undefined,
                    p.id,
                  );
                  if (!currentSession()) return;
                  if (
                    proof.request_id !== p.id ||
                    proof.actor !== actorId ||
                    proof.employee_id !== employee.id ||
                    proof.kind !== p.kind
                  )
                    throw Error("نتيجة الإغلاق لا تطابق الطلب.");
                  if (proof.state === "committed") {
                    if (!(await readback()))
                      throw Error("ثبت وجود الطلب؛ أعد التحقق من إيصال الحفظ.");
                    if (!currentSession()) return;
                    clearDecisionRecovery(p);
                    onSaved();
                    onClose();
                  } else if (proof.state === "closed") {
                    clearDecisionRecovery(p);
                    attempt.current = null;
                    setUncertain(false);
                    setPreview(false);
                    setError("أغلق الطلب بأمان دون قرار جديد.");
                  } else
                    throw Error("لم يثبت إغلاق الطلب. احتفظ بمعرف الاستكمال.");
                } catch (e) {
                  if (currentSession()) setError(message(e));
                } finally {
                  if (currentSession()) setBusy(false);
                }
              }}
            >
              إغلاق الطلب بعد التحقق
            </button>
          )}
          {(uncertain || busy) && (
            <button type="button" onClick={leaveSafely}>
              إغلاق مع حفظ طلب الاستكمال
            </button>
          )}
          {!uncertain && (
            <button
              type="button"
              disabled={busy}
              onClick={preview ? () => setPreview(false) : onClose}
            >
              {preview ? "تعديل المعاينة" : "إلغاء"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
