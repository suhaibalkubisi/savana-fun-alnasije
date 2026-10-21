import { useEffect, useRef, useState, type FormEvent } from "react";
import { get, request, write, message, isAbort, RequestError } from "./client";
import {
  actionStates,
  roles,
  channels,
  today,
  eligibleOwners,
  type Action,
  type Boot,
  type Employee,
  type Reporter,
  type Communication,
  type Handover,
  type User,
  type Capability,
  type Document,
} from "./domain";
import { Field, Chip, Empty } from "./ui";
import {
  readAccountPending,
  saveAccountPending,
  clearAccountPending,
  captureRecoverySession,
  recoverySessionCurrent,
  type AccountPending,
  type AccountProof,
} from "./account-recovery";
type Resource = Reporter | Communication | Handover;
type Common = {
  boot: Boot;
  department: string;
  date: string;
  onError: (s: string) => void;
  onNotice: (s: string) => void;
  onDirty: (b: boolean) => void;
  onRefresh: () => void;
};

export function ActionWorkspace({
  boot,
  department,
  actions,
  employees,
  filter,
  onFilter,
  onProfile,
  onError,
  onNotice,
  onDirty,
  onRefresh,
}: Common & {
  actions: Action[];
  employees: Employee[];
  filter: string;
  onFilter: (s: string) => void;
  onProfile: (id: string) => void;
}) {
  const [edit, setEdit] = useState<Action | null>(null),
    [busy, setBusy] = useState(false),
    [attachments, setAttachments] = useState<Document[]>([]);
  const editDirty = useRef(false),
    attempt = useRef<{ payload: string; id: string } | null>(null);
  function chooseEdit(value: Action) {
    if (editDirty.current) {
      onError("احفظ التعديل الحالي أو ألغِه قبل فتح إجراء آخر.");
      return;
    }
    setEdit(value);
  }
  useEffect(() => {
    const controller = new AbortController();
    setAttachments([]);
    if (edit?.employee_id)
      get<Document[]>(
        "documents",
        { employee_id: edit.employee_id },
        controller.signal,
      )
        .then((rows) => {
          if (!controller.signal.aborted)
            setAttachments(rows.filter((d) => d.state === "active"));
        })
        .catch((e) => {
          if (!isAbort(e)) onError(message(e));
        });
    return () => controller.abort();
  }, [edit?.employee_id, onError]);
  const role = boot.user.followup_role || boot.user.role,
    canManage = ["ADMIN", "FOLLOWUP"].includes(role),
    dept = (id: string) =>
      boot.departments.find((d) => d.id === id)?.arabic_name || "—",
    user = (id: string) => boot.users.find((u) => u.id === id)?.name || "—";
  const filtered = actions.filter((a) =>
      filter === "outstanding"
        ? a.state !== "completed"
        : filter === "mine"
          ? a.responsible_id === boot.user.id
          : filter === "overdue"
            ? a.state !== "completed" && a.due_date < today()
            : filter === "decision"
              ? a.state === "decision"
              : filter === "completed"
                ? a.state === "completed"
                : true,
    ),
    owners = eligibleOwners(boot.users, edit?.department_id || ""),
    available = employees.filter(
      (e) => e.department_id === edit?.department_id,
    );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      const payload = {
        ...f,
        id: edit.id || undefined,
        version: edit.version,
      };
      const key = JSON.stringify(payload);
      if (attempt.current && attempt.current.payload !== key)
        throw Error("لم تتأكد نتيجة الطلب السابق. تحقق منه قبل تغيير بياناته.");
      attempt.current ??= { payload: key, id: crypto.randomUUID() };
      const receipt = await write<Action>(
        "action",
        payload,
        undefined,
        attempt.current.id,
      );
      const fresh = (
        await get<Action[]>("actions", {
          department_id: String(f.department_id),
        })
      ).find((a) => a.id === receipt.id);
      if (
        !fresh ||
        fresh.description !== f.description ||
        fresh.notes !== f.notes ||
        fresh.state !== f.state ||
        (f.comment &&
          !fresh.comments?.some(
            (c) =>
              c.body === f.comment &&
              (!f.attachment_document_id ||
                c.document_id === f.attachment_document_id),
          ))
      )
        throw Error(
          "لم نتأكد من حفظ الإجراء وتعليقه ومرفقه كاملاً. أعد نفس الطلب للتحقق بأمان.",
        );
      attempt.current = null;
      editDirty.current = false;
      setEdit(null);
      onDirty(false);
      onRefresh();
      onError("");
      onNotice("حُفظ الإجراء مع سجل نشاطه.");
    } catch (e) {
      if (e instanceof RequestError && e.status < 500) attempt.current = null;
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="fu-command">
        <Field label="نطاق الإجراءات">
          <select value={filter} onChange={(e) => onFilter(e.target.value)}>
            {Object.entries({
              all: "جميع الإجراءات",
              outstanding: "غير المكتملة",
              mine: "المسندة إليّ",
              overdue: "المتأخرة",
              decision: "بانتظار قرار",
              completed: "المكتملة",
            }).map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {canManage && (
          <button
            className="primary"
            onClick={() =>
              chooseEdit({
                id: "",
                version: 0,
                department_id: department,
                description: "",
                responsible_id: "",
                due_date: today(),
                state: "open",
                notes: "",
                activity: [],
                priority: "medium",
                category: "",
              })
            }
          >
            + إجراء جديد
          </button>
        )}
      </div>
      {edit && (
        <form
          key={edit.id || "new-action"}
          className="fu-panel fu-form"
          onSubmit={save}
          onChange={() => {
            editDirty.current = true;
            onDirty(true);
          }}
        >
          <h3>{edit.id ? "تحديث الإجراء" : "إجراء جديد"}</h3>
          <Field label="القسم">
            <select
              name="department_id"
              value={edit.department_id}
              required
              onChange={(e) =>
                setEdit({
                  ...edit,
                  department_id: e.target.value,
                  employee_id: undefined,
                  responsible_id: "",
                })
              }
            >
              <option value="">اختر القسم</option>
              {boot.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.arabic_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الموظف — اختياري">
            <select
              name="employee_id"
              value={edit.employee_id || ""}
              onChange={(e) =>
                setEdit({ ...edit, employee_id: e.target.value || undefined })
              }
            >
              <option value="">إجراء متعلق بالقسم</option>
              {available.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.internal_code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المسؤول ضمن صلاحية القسم">
            <select
              name="responsible_id"
              value={edit.responsible_id}
              onChange={(e) =>
                setEdit({ ...edit, responsible_id: e.target.value })
              }
              required
            >
              <option value="">اختر المسؤول</option>
              {owners.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="موعد الإنجاز">
            <input
              name="due_date"
              type="date"
              required
              defaultValue={edit.due_date}
            />
          </Field>
          <Field label="الفئة">
            <input
              name="category"
              maxLength={100}
              defaultValue={edit.category || "متابعة"}
              required
            />
          </Field>
          <Field label="الأولوية">
            <select name="priority" defaultValue={edit.priority || "medium"}>
              <option value="low">منخفضة</option>
              <option value="medium">متوسطة</option>
              <option value="high">عالية</option>
            </select>
          </Field>
          <Field label="الإجراء المطلوب">
            <textarea
              name="description"
              required
              maxLength={2000}
              defaultValue={edit.description}
            />
          </Field>
          <Field label="الحالة">
            <select name="state" defaultValue={edit.state}>
              {Object.entries(actionStates).map(([id, l]) => (
                <option key={id} value={id}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الملاحظة الحالية — قابلة للتعديل">
            <textarea name="notes" maxLength={2000} defaultValue={edit.notes} />
          </Field>
          <Field label="دليل الإنجاز عند الإغلاق">
            <textarea
              name="completion"
              maxLength={2000}
              defaultValue={edit.completion || ""}
            />
          </Field>
          <Field label="تعليق جديد — يضاف إلى السجل">
            <textarea name="comment" maxLength={2000} />
          </Field>
          <Field label="مستمسك الموظف المرفق بالتعليق — اختياري">
            <select
              key={edit.employee_id || "department"}
              name="attachment_document_id"
              disabled={!edit.employee_id}
              defaultValue=""
            >
              <option value="">دون مرفق</option>
              {attachments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || d.name}
                </option>
              ))}
            </select>
            {!edit.employee_id && (
              <small>اختر موظفاً لإرفاق أحد مستمسكاته المخوّلة.</small>
            )}
          </Field>
          <div className="fu-bulk">
            <button className="primary" disabled={busy}>
              حفظ الإجراء
            </button>
            <button
              type="button"
              onClick={() => {
                if (attempt.current) {
                  onError("تحقق من نتيجة الحفظ بإعادة نفس الطلب قبل إغلاقه.");
                  return;
                }
                editDirty.current = false;
                setEdit(null);
                onDirty(false);
              }}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
      <section className="fu-panel">
        <div className="fu-section-title">
          <h3>الإجراءات والمواعيد</h3>
          <span>{filtered.length} إجراء</span>
        </div>
        <div className="fu-scroll">
          <table>
            <thead>
              <tr>
                <th>الإجراء / القسم</th>
                <th>الموظف</th>
                <th>المسؤول</th>
                <th>موعد الإنجاز</th>
                <th>الأولوية</th>
                <th>الحالة</th>
                <th>السجل</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.description}</strong>
                    <small>
                      {dept(a.department_id)} · {a.category || "متابعة"}
                    </small>
                  </td>
                  <td>
                    {a.employee_id ? (
                      <button
                        className="fu-name"
                        onClick={() => onProfile(a.employee_id!)}
                      >
                        {employees.find((e) => e.id === a.employee_id)?.name ||
                          "ملف الموظف"}
                      </button>
                    ) : (
                      "إجراء قسم"
                    )}
                  </td>
                  <td>{user(a.responsible_id)}</td>
                  <td>
                    <Chip
                      value={
                        a.state !== "completed" && a.due_date < today()
                          ? "returned"
                          : ""
                      }
                    >
                      {a.due_date}
                    </Chip>
                  </td>
                  <td>
                    {{ low: "منخفضة", medium: "متوسطة", high: "عالية" }[
                      a.priority || "medium"
                    ] || a.priority}
                  </td>
                  <td>
                    <Chip
                      value={a.state === "completed" ? "reviewed" : "submitted"}
                    >
                      {actionStates[a.state]}
                    </Chip>
                  </td>
                  <td>
                    <details>
                      <summary>فتح</summary>
                      <p>{a.notes}</p>
                      {a.completion && <p>دليل الإغلاق: {a.completion}</p>}
                      {a.activity.map((h, i) => (
                        <p key={i}>
                          {new Date(h.at).toLocaleString("ar-IQ", {
                            timeZone: "Asia/Baghdad",
                          })}{" "}
                          · {h.actor_name || user(h.actor)} · تسجيل تحديث
                          الإجراء
                        </p>
                      ))}
                      {a.comments?.map((c) => (
                        <p key={c.id}>
                          {new Date(c.created_at).toLocaleString("ar-IQ", {
                            timeZone: "Asia/Baghdad",
                          })}{" "}
                          · {c.actor_name || "مستخدم مخوّل"}: {c.body}
                          {c.document_id && (
                            <button
                              onClick={async () => {
                                try {
                                  const v = await request<{ url: string }>(
                                    "/api/followup/documents?id=" +
                                      encodeURIComponent(c.document_id!),
                                  );
                                  window.open(
                                    v.url,
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                                } catch (e) {
                                  onError(message(e));
                                }
                              }}
                            >
                              {c.document_title || "فتح المستمسك"}
                            </button>
                          )}
                        </p>
                      ))}
                      {(canManage ||
                        (a.responsible_id === boot.user.id &&
                          role !== "VIEWER")) && (
                        <button onClick={() => chooseEdit(a)}>تعديل</button>
                      )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <Empty />}
      </section>
    </>
  );
}

const communicationKinds: Record<string, string> = {
  request: "طلب تبليغ",
  attempt: "محاولة اتصال",
  reply: "ردّ فعلي",
  resolution: "حلّ المتابعة",
};
export function ContactWorkspace({
  view,
  boot,
  department,
  date,
  onError,
  onNotice,
  onDirty,
  onRefresh,
}: Common & { view: string }) {
  const localDirty = useRef(false);
  function chooseEdit(next: Record<string, unknown>) {
    if (localDirty.current) {
      onError("احفظ التعديل الحالي أو ألغِه قبل تبديل السجل.");
      return;
    }
    setEdit(next);
  }
  const [rows, setRows] = useState<Resource[]>([]),
    [edit, setEdit] = useState<Record<string, unknown> | null>(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [reporters, setReporters] = useState<Reporter[]>([]);
  const role = boot.user.followup_role || boot.user.role,
    canWrite =
      view === "handover"
        ? false
        : view === "contacts"
          ? !!boot.capabilities?.contacts_manage
          : ["ADMIN", "FOLLOWUP"].includes(role),
    kind =
      view === "contacts"
        ? "reporters"
        : view === "communications"
          ? "communications"
          : "handovers",
    writer =
      view === "contacts"
        ? "reporter"
        : view === "communications"
          ? "communication"
          : "handover",
    dept = (id: string) =>
      boot.departments.find((d) => d.id === id)?.arabic_name ||
      "كل الأقسام المخوّلة";
  useEffect(() => {
    const controller = new AbortController();
    const f = {
      ...(department ? { department_id: department } : {}),
      ...(view === "contacts" ? {} : { start: date, end: date }),
    };
    Promise.all([
      get<Resource[]>(kind, f, controller.signal),
      get<Reporter[]>(
        "reporters",
        department ? { department_id: department } : {},
        controller.signal,
      ),
    ])
      .then(([r, p]) => {
        setRows(r);
        setReporters(p);
      })
      .catch((e) => {
        if (!isAbort(e)) onError(message(e));
      });
    return () => controller.abort();
  }, [kind, department, date, revision, view, onError]);
  function add() {
    chooseEdit({
      id: "",
      version: 0,
      department_id: department,
      work_date: date,
      owner_id: "",
      state: "open",
      active: true,
      channel: "phone",
    });
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data: Record<string, unknown> = { ...edit, ...Object.fromEntries(f) };
    if (view === "contacts") data.active = f.get("active") === "on";
    setBusy(true);
    try {
      await write<Resource>(writer, data, async (receipt) => {
        if (
          !receipt.id ||
          Number(receipt.version) <= Number(edit?.version || 0)
        )
          return false;
        const fresh = (
          await get<Resource[]>(kind, {
            department_id: String(data.department_id),
            start: String(data.work_date || date),
            end: String(data.work_date || date),
          })
        ).find((r) => r.id === receipt.id);
        const normalize = (v: unknown) => (v === "" || v == null ? null : v);
        return (
          !!fresh &&
          [...f.keys()]
            .filter((key) => key !== "active")
            .every(
              (key) =>
                normalize(
                  (fresh as unknown as Record<string, unknown>)[key],
                ) === normalize(data[key]),
            ) &&
          (view !== "contacts" || (fresh as Reporter).active === data.active)
        );
      });
      localDirty.current = false;
      setEdit(null);
      onDirty(false);
      setRevision((v) => v + 1);
      onRefresh();
      onNotice("حُفظ السجل الفعلي.");
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const editDepartment = String(edit?.department_id || ""),
    owners = eligibleOwners(boot.users, editDepartment);
  return (
    <>
      <div className="fu-command">
        <p className="fu-muted">
          {view === "contacts"
            ? "المسؤول المبلّغ مستقل عن حساب الدخول."
            : view === "communications"
              ? "سجّل التواصل الذي حدث فعلياً مع مصدره ونتيجته."
              : "تسليم الأعمال بين المسؤولين عن الخدمة المسائية."}
        </p>
        {canWrite && (
          <button className="primary" onClick={add}>
            +{" "}
            {view === "contacts"
              ? "جهة اتصال"
              : view === "communications"
                ? "سجل تواصل"
                : "تسليم مسائي"}
          </button>
        )}
      </div>
      {edit && (
        <form
          key={String(edit.id || "new")}
          className="fu-panel fu-form"
          onSubmit={save}
          onChange={() => {
            localDirty.current = true;
            onDirty(true);
          }}
        >
          <h3>السجل والاتصال الفعلي</h3>
          <Field label="القسم">
            <select
              name="department_id"
              value={editDepartment}
              required={view !== "handover"}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  department_id: e.target.value,
                  reporter_id: "",
                  owner_id: "",
                })
              }
            >
              <option value="">اختر القسم</option>
              {boot.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.arabic_name}
                </option>
              ))}
            </select>
          </Field>
          {view === "contacts" ? (
            <>
              <Field label="اسم المسؤول">
                <input
                  name="name"
                  required
                  maxLength={150}
                  defaultValue={String(edit.name || "")}
                />
              </Field>
              <Field label="وسيلة الاتصال">
                <select
                  name="channel"
                  defaultValue={String(edit.channel || "phone")}
                >
                  {Object.entries(channels)
                    .filter(([id]) => id !== "account")
                    .map(([id, l]) => (
                      <option key={id} value={id}>
                        {l}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="بيانات الاتصال">
                <input
                  name="contact"
                  maxLength={250}
                  defaultValue={String(edit.contact || "")}
                />
              </Field>
              <Field label="جهة بديلة">
                <input
                  name="backup_contact"
                  maxLength={250}
                  defaultValue={String(edit.backup_contact || "")}
                />
              </Field>
              <Field label="ربط بحساب موجود — اختياري">
                <select
                  name="linked_user_id"
                  defaultValue={String(edit.linked_user_id || "")}
                >
                  <option value="">دون حساب</option>
                  {boot.users
                    .filter(
                      (u) => u.active && u.departments.includes(editDepartment),
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </Field>
              <label>
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={edit.active !== false}
                />{" "}
                مفعّل
              </label>
            </>
          ) : view === "communications" ? (
            <>
              <Field label="تاريخ الخدمة">
                <input
                  name="work_date"
                  type="date"
                  required
                  defaultValue={String(edit.work_date || date)}
                />
              </Field>
              <Field label="المسؤول المبلّغ">
                <select
                  name="reporter_id"
                  defaultValue={String(edit.reporter_id || "")}
                >
                  <option value="">غير محدد</option>
                  {reporters
                    .filter((r) => r.department_id === editDepartment)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="نوع السجل">
                <select
                  name="kind"
                  defaultValue={String(edit.kind || "request")}
                >
                  {Object.entries(communicationKinds).map(([id, l]) => (
                    <option key={id} value={id}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="القناة">
                <select
                  name="channel"
                  defaultValue={String(edit.channel || "phone")}
                >
                  {Object.entries(channels).map(([id, l]) => (
                    <option key={id} value={id}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="التواصل الفعلي">
                <textarea
                  name="summary"
                  required
                  maxLength={2000}
                  defaultValue={String(edit.summary || "")}
                />
              </Field>
              <Field label="النتيجة">
                <textarea
                  name="outcome"
                  maxLength={2000}
                  defaultValue={String(edit.outcome || "")}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="تاريخ الخدمة">
                <input
                  name="work_date"
                  type="date"
                  required
                  defaultValue={String(edit.work_date || date)}
                />
              </Field>
              <Field label="المسؤول عن الخطوة التالية">
                <select
                  name="owner_id"
                  required
                  defaultValue={String(edit.owner_id || "")}
                >
                  <option value="">اختر مسؤولاً مخوّلاً</option>
                  {owners.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ما اكتمل">
                <textarea
                  name="completed"
                  maxLength={4000}
                  defaultValue={String(edit.completed || "")}
                />
              </Field>
              <Field label="ما بقي">
                <textarea
                  name="remaining"
                  maxLength={4000}
                  defaultValue={String(edit.remaining || "")}
                />
              </Field>
              <Field label="الخطوة التالية">
                <textarea
                  name="next_action"
                  required
                  maxLength={2000}
                  defaultValue={String(edit.next_action || "")}
                />
              </Field>
              <Field label="الحالة">
                <select
                  name="state"
                  defaultValue={String(edit.state || "open")}
                >
                  <option value="open">مفتوح</option>
                  <option value="closed">مغلق</option>
                </select>
              </Field>
            </>
          )}
          <div className="fu-bulk">
            <button className="primary" disabled={busy}>
              حفظ السجل
            </button>
            <button
              type="button"
              onClick={() => {
                localDirty.current = false;
                setEdit(null);
                onDirty(false);
              }}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
      <section className="fu-panel">
        {view === "contacts" ? (
          <div className="fu-contact-grid">
            {(rows as Reporter[]).map((r) => (
              <article className="fu-contact-card" key={r.id}>
                <div className="fu-section-title">
                  <h3>{r.name}</h3>
                  <Chip value={r.active ? "reviewed" : ""}>
                    {r.active ? "مفعّل" : "غير مفعّل"}
                  </Chip>
                </div>
                <p>{dept(r.department_id)}</p>
                <dl className="fu-details">
                  <dt>القناة</dt>
                  <dd>{channels[r.channel]}</dd>
                  <dt>الاتصال</dt>
                  <dd>
                    <bdi>{r.contact || "غير مسجّل"}</bdi>
                  </dd>
                  <dt>البديل</dt>
                  <dd>{r.backup_contact || "غير مسجّل"}</dd>
                </dl>
                {canWrite && (
                  <button onClick={() => chooseEdit({ ...r })}>
                    تعديل جهة الاتصال
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : view === "communications" ? (
          <div className="fu-timeline">
            {(rows as Communication[]).map((r) => (
              <article className="fu-timeline-item" key={r.id}>
                <div className="fu-section-title">
                  <strong>
                    {communicationKinds[r.kind]} · {dept(r.department_id)}
                  </strong>
                  <Chip value="submitted">{channels[r.channel]}</Chip>
                </div>
                <p>{r.summary}</p>
                <p>{r.outcome || "لم تُسجّل نتيجة"}</p>
                <small>
                  {r.work_date} · {r.entered_by_name || "مدخل مخوّل"}
                  {r.created_at
                    ? " · " +
                      new Date(r.created_at).toLocaleString("ar-IQ", {
                        timeZone: "Asia/Baghdad",
                      })
                    : ""}
                </small>
                {canWrite && (
                  <button onClick={() => chooseEdit({ ...r })}>
                    إضافة تصحيح للسجل
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="fu-contact-grid">
            {(rows as Handover[]).map((r) => (
              <article className="fu-contact-card" key={r.id}>
                <div className="fu-section-title">
                  <h3>{dept(r.department_id || "")}</h3>
                  <Chip value={r.state === "closed" ? "reviewed" : "submitted"}>
                    {r.state === "closed" ? "مغلق" : "مفتوح"}
                  </Chip>
                </div>
                <p>
                  {r.work_date} ·{" "}
                  {boot.users.find((u) => u.id === r.owner_id)?.name || "—"}
                </p>
                <dl className="fu-details">
                  <dt>المكتمل</dt>
                  <dd>{r.completed || "لم يُسجّل"}</dd>
                  <dt>المتبقي</dt>
                  <dd>{r.remaining || "لم يُسجّل"}</dd>
                  <dt>الخطوة التالية</dt>
                  <dd>{r.next_action}</dd>
                </dl>
                {canWrite && (
                  <button onClick={() => chooseEdit({ ...r })}>
                    تحديث التسليم
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        {!rows.length && <Empty />}
      </section>
    </>
  );
}

export function Settings({
  boot,
  onError,
  onNotice,
  onDirty,
  onRefresh,
}: Common) {
  const creationLifetime = useRef({
    active: true,
    generation: captureRecoverySession(boot.user.id),
  });
  useEffect(() => {
    creationLifetime.current.active = true;
    return () => {
      creationLifetime.current.active = false;
    };
  }, []);
  const creationCurrent = () =>
    creationLifetime.current.active &&
    recoverySessionCurrent(boot.user.id, creationLifetime.current.generation);
  const originalCallbacks = { onError, onNotice, onRefresh, onDirty };
  onError = (value) => {
    if (creationCurrent()) originalCallbacks.onError(value);
  };
  onNotice = (value) => {
    if (creationCurrent()) originalCallbacks.onNotice(value);
  };
  onRefresh = () => {
    if (creationCurrent()) originalCallbacks.onRefresh();
  };
  onDirty = (value) => {
    if (creationCurrent()) originalCallbacks.onDirty(value);
  };
  const dirtyEditors = useRef(new Set<string>());
  function dirtyEditor(key: string, value: boolean) {
    if (value) dirtyEditors.current.add(key);
    else dirtyEditors.current.delete(key);
    onDirty(dirtyEditors.current.size > 0);
  }
  function chooseAccount(u: User) {
    if (dirtyEditors.current.has("account")) {
      onError("احفظ تعديل الحساب أو ألغِه قبل تبديل المستخدم.");
      return;
    }
    setEdit(u);
  }
  const pendingCreation = useRef<AccountPending | null>(
    readAccountPending(boot.user.id),
  );
  const [creationInfo, setCreationInfo] = useState<AccountProof | null>(null);
  const [edit, setEdit] = useState<User | null>(null),
    [busy, setBusy] = useState(false),
    [newRole, setNewRole] = useState(""),
    [creationUncertain, setCreationUncertain] = useState(
      !!pendingCreation.current,
    );
  async function inspectCreation() {
    const pending = pendingCreation.current;
    if (!pending) throw Error("لا يوجد طلب محفوظ للتحقق.");
    const proof = await request<AccountProof>(
      "/api/users?" + new URLSearchParams({ request_id: pending.id }),
    );
    if (!creationCurrent())
      throw new DOMException("Session ended", "AbortError");
    if (proof.request_id !== pending.id)
      throw Error("نتيجة التحقق لا تطابق الطلب المحفوظ.");
    setCreationInfo(proof);
    return proof;
  }
  function finishCreation(form: HTMLFormElement | null, proof: AccountProof) {
    if (!creationCurrent()) return;
    if (
      proof.request_id !== pendingCreation.current?.id ||
      !["configured", "rejected", "duplicate", "not_started"].includes(
        proof.state,
      )
    )
      throw Error(
        "النتيجة ما زالت غير محسومة. احتفظ بالطلب واستكمل التحقق لاحقاً.",
      );
    clearAccountPending(boot.user.id);
    pendingCreation.current = null;
    setCreationUncertain(false);
    setCreationInfo(null);
    setNewRole("");
    form?.reset();
    dirtyEditor("new-account", false);
    onError("");
    onRefresh();
    onNotice(
      proof.state === "configured"
        ? "ثبت اكتمال الحساب. يمكنك بدء طلب حساب آخر."
        : proof.state === "not_started"
          ? "أُغلق الطلب قبل بدء الإنشاء. يمكنك بدء طلب جديد."
          : "ثبت رفض الإنشاء أو وجود الحساب مسبقاً. يمكنك بدء طلب آخر دون تكرار الطلب السابق.",
    );
  }
  const caps = boot.capabilities || {},
    unassigned = boot.users.filter(
      (u) =>
        (u.followup_role || u.role) === "SUPERVISOR" &&
        u.active &&
        (u.assignment_needed ??
          !(u.current_departments ?? u.departments ?? []).length),
    ),
    dept = (id: string) =>
      boot.departments.find((d) => d.id === id)?.arabic_name || "—";
  async function saveAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit) return;
    const f = new FormData(e.currentTarget);
    if (f.get("role") === "SUPERVISOR" && !f.getAll("departments").length) {
      onError("عيّن قسماً مخوّلاً لمسؤول القسم.");
      return;
    }
    setBusy(true);
    try {
      await write<User>(
        "account",
        {
          user_id: edit.id,
          version: edit.version,
          role: f.get("role"),
          active: f.get("active") === "on",
          departments: f.getAll("departments"),
          activate_departments_today:
            f.get("activate_departments_today") === "on",
          reason: f.get("reason"),
        },
        async (receipt) => {
          if (!receipt || Number(receipt.version) <= edit.version) return false;
          const fresh = (await get<Boot>("bootstrap")).users.find(
            (u) => u.id === edit.id,
          );
          return (
            !!fresh &&
            (fresh.followup_role || fresh.role) === f.get("role") &&
            fresh.active === (f.get("active") === "on") &&
            [...fresh.departments].sort().join(",") ===
              f.getAll("departments").map(String).sort().join(",")
          );
        },
      );
      setEdit(null);
      dirtyEditor("account", false);
      onRefresh();
      onNotice("حُفظ الدور ونطاق الأقسام.");
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="fu-panel">
        <h3>الصلاحيات والجاهزية التشغيلية</h3>
        <p className="fu-muted">
          صلاحيات بيانات التشغيل، المستمسكات الحساسة، تغيير الخدمة، والأرشيف
          مستقلة.
        </p>
        <div className="fu-permissions">
          {Object.entries({
            service_manage: "تغيير حالة الخدمة",
            identity_edit: "تصحيح الهوية",
            profile_edit: "تعديل الملف التشغيلي",
            documents_read: "قراءة المستمسكات التشغيلية",
            documents_write: "إدارة المستمسكات",
            documents_sensitive_read: "قراءة الهوية المقيّدة",
            documents_sensitive_write: "إدارة الهوية المقيّدة",
            roster_manage: "إضافة الموظفين والنقل المؤرّخ",
            archive_read: "قراءة الأرشيف",
            accounts_manage: "إدارة الحسابات",
            contacts_manage: "إدارة جهات الاتصال",
          }).map(([id, l]) => (
            <div key={id}>
              <span>{l}</span>
              <Chip value={caps[id] ? "reviewed" : ""}>
                {caps[id] ? "ممنوحة" : "غير ممنوحة"}
              </Chip>
            </div>
          ))}
        </div>
        {unassigned.length > 0 && (
          <div className="fu-warning">
            {unassigned.length} مسؤول قسم دون تعيين. يتطلب الأمر تعييناً صريحاً
            من مسؤول مخوّل.
            <ul>
              {unassigned.map((u) => (
                <li key={u.id}>
                  {u.name}
                  {caps.accounts_manage && (
                    <button disabled={busy} onClick={() => chooseAccount(u)}>
                      تعيين الأقسام
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {caps.accounts_manage && (
        <>
          <CapabilitySettings
            boot={boot}
            onError={onError}
            onNotice={onNotice}
            onDirty={(v) => dirtyEditor("capabilities", v)}
            onRefresh={onRefresh}
          />
          <section className="fu-panel">
            <h3>حسابات المستخدمين</h3>
            <div className="fu-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المستخدم</th>
                    <th>الدور</th>
                    <th>الأقسام</th>
                    <th>الحالة</th>
                    <th>إدارة</th>
                  </tr>
                </thead>
                <tbody>
                  {boot.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.name}
                        <small>
                          <bdi>{u.email}</bdi>
                        </small>
                      </td>
                      <td>{roles[u.followup_role || u.role] || "غير مخوّل"}</td>
                      <td>
                        {u.departments.map(dept).join("، ") || "دون تعيين"}
                      </td>
                      <td>{u.active ? "مفعّل" : "غير مفعّل"}</td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() => chooseAccount(u)}
                        >
                          تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {edit && (
              <form
                key={edit.id + ":" + edit.version}
                className="fu-form"
                onSubmit={saveAccount}
                onChange={() => dirtyEditor("account", true)}
              >
                <h3>{edit.name}</h3>
                <Field label="الدور">
                  <select
                    name="role"
                    defaultValue={edit.followup_role || edit.role || "VIEWER"}
                    required
                  >
                    {Object.entries(roles).map(([id, l]) => (
                      <option key={id} value={id}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <label>
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={edit.active}
                  />{" "}
                  تفعيل الحساب
                </label>
                <fieldset>
                  <legend>الأقسام المخوّلة</legend>
                  {boot.departments.map((d) => (
                    <label key={d.id}>
                      <input
                        type="checkbox"
                        name="departments"
                        value={d.id}
                        defaultChecked={edit.departments.includes(d.id)}
                      />{" "}
                      {d.arabic_name}
                    </label>
                  ))}
                </fieldset>
                {edit.active &&
                  (edit.followup_role || edit.role) === "SUPERVISOR" &&
                  (edit.assignment_needed ??
                    !(edit.current_departments ?? edit.departments ?? [])
                      .length) &&
                  !!edit.departments.length && (
                    <label className="fu-warning">
                      <input
                        type="checkbox"
                        name="activate_departments_today"
                        defaultChecked={false}
                        disabled={busy}
                      />{" "}
                      تفعيل الأقسام المحددة من اليوم صراحةً. يحافظ الحفظ العادي
                      على تواريخ التعيين السابقة؛ هذا الاختيار يسجّل بداية اليوم
                      للأقسام المحددة غير النافذة حالياً، مع سبب القرار أدناه.
                    </label>
                  )}
                <Field label="سبب تعديل الصلاحيات">
                  <textarea name="reason" required />
                </Field>
                <div className="fu-bulk">
                  <button className="primary" disabled={busy}>
                    حفظ الصلاحيات
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEdit(null);
                      dirtyEditor("account", false);
                    }}
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            )}
          </section>
          <section className="fu-panel">
            <h3>حساب جديد</h3>
            <form
              className="fu-form"
              onChange={() => dirtyEditor("new-account", true)}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                if (creationUncertain) {
                  onError(
                    "افحص الحساب الموجود واستكمل إعداده قبل محاولة إنشاء أخرى.",
                  );
                  return;
                }
                if (
                  newRole === "SUPERVISOR" &&
                  !f.getAll("departments").length
                ) {
                  onError("اختر قسم المسؤول قبل إنشاء الحساب.");
                  return;
                }
                setBusy(true);
                try {
                  const pending = {
                    id: crypto.randomUUID(),
                    email: String(f.get("email")).trim().toLowerCase(),
                  };
                  if (!creationCurrent()) return;
                  saveAccountPending(
                    boot.user.id,
                    pending,
                    creationLifetime.current.generation,
                  );
                  pendingCreation.current = pending;
                  const created = await request<{
                    ok: boolean;
                    request_id: string;
                  }>("/api/users", {
                    ...Object.fromEntries(f),
                    departments: f.getAll("departments"),
                    request_id: pending.id,
                  });
                  if (!creationCurrent()) return;
                  if (created?.ok !== true || created.request_id !== pending.id)
                    throw new RequestError(
                      "لم تتأكد نتيجة إنشاء الحساب. افحص الحساب الموجود قبل أي محاولة جديدة.",
                      503,
                    );
                  finishCreation(form, await inspectCreation());
                } catch (e) {
                  if (!creationCurrent()) return;
                  const definitive =
                    e instanceof RequestError &&
                    [400, 401, 403, 422].includes(e.status);
                  setCreationUncertain(
                    !definitive && !!pendingCreation.current,
                  );
                  if (definitive) {
                    clearAccountPending(boot.user.id);
                    pendingCreation.current = null;
                  }
                  onError(message(e));
                } finally {
                  if (creationCurrent()) setBusy(false);
                }
              }}
            >
              <fieldset
                className="fu-creation-fields"
                disabled={busy || creationUncertain}
              >
                <Field label="الاسم">
                  <input name="name" required maxLength={150} />
                </Field>
                <Field label="البريد">
                  <input name="email" type="email" dir="ltr" required />
                </Field>
                <Field label="كلمة المرور الأولية">
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="اختيار الدور صراحةً">
                  <select
                    name="role"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    required
                  >
                    <option value="">اختر الدور</option>
                    {Object.entries(roles).map(([id, l]) => (
                      <option key={id} value={id}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset>
                  <legend>الأقسام المخوّلة</legend>
                  {boot.departments.map((d) => (
                    <label key={d.id}>
                      <input type="checkbox" name="departments" value={d.id} />{" "}
                      {d.arabic_name}
                    </label>
                  ))}
                </fieldset>
                <Field label="سبب إنشاء الحساب وتحديد صلاحياته">
                  <textarea
                    name="reason"
                    minLength={5}
                    required
                    maxLength={2000}
                  />
                </Field>
              </fieldset>
              {creationUncertain && (
                <div role="alert" className="fu-form-full">
                  <p>
                    نتيجة الإنشاء تحتاج تحققاً. معرّف الطلب محفوظ؛ لا تنشئه
                    ثانية.
                    {(creationInfo?.email ||
                      pendingCreation.current?.email) && (
                      <bdi>
                        {creationInfo?.email || pendingCreation.current?.email}
                      </bdi>
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await inspectCreation();
                      } catch (e) {
                        onError(message(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    تحديث قائمة الحسابات للتحقق
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async (e) => {
                      const form = e.currentTarget.form;
                      setBusy(true);
                      try {
                        let proof = await inspectCreation();
                        if (proof.state === "not_found") {
                          proof = await request<AccountProof>("/api/users", {
                            close_unstarted_request_id:
                              pendingCreation.current?.id,
                          });
                          setCreationInfo(proof);
                        }
                        finishCreation(form, proof);
                      } catch (err) {
                        onError(message(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    إغلاق الطلب بعد التحقق من الحساب
                  </button>
                  {creationInfo?.found_user_id &&
                    !["configured", "duplicate", "rejected"].includes(
                      creationInfo.state,
                    ) && (
                      <>
                        <p>
                          الحساب موجود. استكماله سيطبق الدور{" "}
                          {roles[creationInfo.role || ""] || "المختار"}؛
                          الأقسام:{" "}
                          {creationInfo.departments?.map(dept).join("، ") ||
                            "دون تعيين"}
                          .
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async (e) => {
                            const form = e.currentTarget.form;
                            setBusy(true);
                            try {
                              const result = await request<{
                                ok: boolean;
                                request_id: string;
                              }>("/api/users", {
                                recovery_request_id:
                                  pendingCreation.current?.id,
                                user_id: creationInfo.found_user_id,
                              });
                              if (
                                result.ok !== true ||
                                result.request_id !==
                                  pendingCreation.current?.id
                              )
                                throw Error(
                                  "لم يتأكد الاستكمال. أعد التحقق من الطلب نفسه.",
                                );
                              finishCreation(form, await inspectCreation());
                            } catch (err) {
                              onError(message(err));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          استكمال إعداد الحساب الموجود
                        </button>
                      </>
                    )}
                  {creationInfo && (
                    <p>
                      {creationInfo.state === "configured"
                        ? "ثبت اكتمال الطلب."
                        : ["rejected", "duplicate"].includes(creationInfo.state)
                          ? "ثبت أن الطلب لم ينشئ حساباً جديداً."
                          : "الطلب لم يُحسم بعد. يمكنك المتابعة لاحقاً دون إعادة الإنشاء."}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      dirtyEditor("new-account", false);
                      onNotice(
                        "طلب الحساب محفوظ؛ ارجع إلى الإعدادات لاستكماله. كلمة المرور لا تُحفظ في الاسترداد.",
                      );
                    }}
                  >
                    متابعة التحقق لاحقاً
                  </button>
                </div>
              )}
              <button
                disabled={busy || !newRole || creationUncertain}
                className="primary"
              >
                إنشاء الحساب المحدد
              </button>
              <button
                type="reset"
                disabled={busy || creationUncertain}
                onClick={() => {
                  setNewRole("");
                  dirtyEditor("new-account", false);
                }}
              >
                إلغاء المسودة
              </button>
            </form>
          </section>
        </>
      )}
      {(boot.user.followup_role || boot.user.role) === "ADMIN" && (
        <>
          <section className="fu-panel">
            <h3>حالات التبليغ</h3>
            {boot.statuses.map((s) => (
              <div className="fu-policy" key={s.code}>
                <span>
                  {s.label} · {s.category} · وزن {s.weight}
                </span>
                <button
                  disabled={busy || s.code === "unresolved"}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await write("policy", { ...s, enabled: !s.enabled });
                      onRefresh();
                      onNotice("حُفظت السياسة. الحالات القديمة تبقى مقروءة.");
                    } catch (e) {
                      onError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {s.enabled ? "تعطيل للاستخدام الجديد" : "تفعيل"}
                </button>
              </div>
            ))}
            <form
              className="fu-form"
              onChange={() => dirtyEditor("policy", true)}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                setBusy(true);
                try {
                  await write("policy", {
                    ...Object.fromEntries(new FormData(e.currentTarget)),
                    weight: 0,
                    enabled: true,
                    category: "other",
                  });
                  onRefresh();
                  form.reset();
                  dirtyEditor("policy", false);
                  onNotice("حُفظت الحالة الإضافية.");
                } catch (e) {
                  onError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="رمز الحالة">
                <input name="code" pattern="[a-z][a-z0-9_]{2,30}" required />
              </Field>
              <Field label="التسمية">
                <input name="label" required maxLength={100} />
              </Field>
              <button disabled={busy}>إضافة حالة أخرى</button>
              <button type="reset" onClick={() => dirtyEditor("policy", false)}>
                إلغاء المسودة
              </button>
            </form>
          </section>
          <section className="fu-panel">
            <h3>ترتيب الأقسام</h3>
            <p>الترتيب المهيّأ معتمد في الشاشات والتقارير.</p>
            <form
              className="fu-form"
              onChange={() => dirtyEditor("department", true)}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  values = new FormData(form),
                  department = boot.departments.find(
                    (d) => d.id === values.get("id"),
                  );
                if (!department) return;
                setBusy(true);
                try {
                  await write("department_order", {
                    id: department.id,
                    version: department.version,
                    display_order: Number(values.get("display_order")),
                    reason: values.get("reason"),
                  });
                  form.reset();
                  dirtyEditor("department", false);
                  onRefresh();
                  onNotice("حُفظ ترتيب القسم مع الحفاظ على هويته وسجلاته.");
                } catch (e) {
                  onError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="القسم الحالي وترتيبه">
                <select name="id" required>
                  <option value="">اختر القسم</option>
                  {boot.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.arabic_name} · {d.display_order ?? "—"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الترتيب الجديد">
                <input
                  name="display_order"
                  type="number"
                  min="0"
                  max="10000"
                  required
                />
              </Field>
              <Field label="سبب تعديل الترتيب">
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={1000}
                  required
                />
              </Field>
              <button className="primary" disabled={busy}>
                حفظ الترتيب
              </button>
              <button
                type="reset"
                onClick={() => dirtyEditor("department", false)}
              >
                إلغاء المسودة
              </button>
            </form>
          </section>
        </>
      )}
      {caps.archive_read && (
        <details className="fu-panel">
          <summary>الأرشيف التاريخي المقيّد</summary>
          <p>نطاق تاريخي منفصل عن الخدمة المسائية.</p>
          <button
            onClick={async () => {
              try {
                const a = await get<{ imports: unknown[] }>("archive");
                onNotice(
                  "الأرشيف المخوّل: " + a.imports.length + " ملف تاريخي.",
                );
              } catch (e) {
                onError(message(e));
              }
            }}
          >
            فحص الوصول المخوّل
          </button>
        </details>
      )}
    </>
  );
}

const capabilityLabels: Record<string, string> = {
  service_manage: "تغيير حالة الخدمة — منحة صريحة",
  identity_edit: "تصحيح الاسم والرقم الوظيفي — منحة صريحة",
  profile_edit: "تعديل بيانات الملف التشغيلي",
  documents_read: "قراءة المستمسكات التشغيلية",
  documents_write: "رفع وإدارة المستمسكات التشغيلية",
  documents_sensitive_read: "قراءة مستمسكات الهوية المقيّدة",
  documents_sensitive_write: "إدارة مستمسكات الهوية المقيّدة",
  roster_manage: "توثيق العضوية والنقل المؤرّخ",
  archive_read: "قراءة الأرشيف التاريخي المقيّد",
};
function CapabilitySettings({
  boot,
  onError,
  onNotice,
  onDirty,
  onRefresh,
}: Omit<Common, "department" | "date">) {
  const [userId, setUserId] = useState(""),
    [capability, setCapability] = useState("profile_edit"),
    [rows, setRows] = useState<Capability[]>([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [loadError, setLoadError] = useState("");
  const selected = rows.find((row) => row.capability === capability),
    user = boot.users.find((u) => u.id === userId);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setRows([]);
        setLoadError("");
        setLoading(true);
      }
    });
    get<Capability[]>("capabilities", { user_id: userId }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRows(result);
      })
      .catch((e) => {
        if (!isAbort(e)) {
          setLoadError(message(e));
          onError(message(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, revision, onError]);
  function select(change: () => void) {
    if (dirty) {
      onError("احفظ تعديل الصلاحية أو ألغِه قبل تغيير الحساب أو الصلاحية.");
      return;
    }
    change();
  }
  return (
    <section className="fu-panel">
      <h3>منح الصلاحيات المستقلة أو سحبها</h3>
      <p className="fu-muted">
        الدور يحدد عمليات المتابعة ونطاق الأقسام. هذه الصلاحيات لا توسّع نطاق
        الأقسام ولا تحوّل حساب القراءة إلى محرر. لا تمنح إدارة المتابعة صلاحية
        الهوية أو الأرشيف تلقائياً.
      </p>
      <div className="fu-form">
        <Field label="الحساب">
          <select
            value={userId}
            onChange={(e) => select(() => setUserId(e.target.value))}
          >
            <option value="">اختر الحساب</option>
            {boot.users
              .filter((u) => !!roles[u.followup_role || u.role])
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {roles[u.followup_role || u.role]}
                </option>
              ))}
          </select>
        </Field>
        <Field label="الصلاحية">
          <select
            value={capability}
            onChange={(e) => select(() => setCapability(e.target.value))}
          >
            {Object.entries(capabilityLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {loading && <p role="status">جارٍ تحميل الصلاحية الحالية…</p>}
      {loadError && (
        <div className="fu-error" role="alert">
          <span>
            لم تُحمّل قرارات الصلاحيات؛ لا يمكن افتراض إعدادها الحالي.
          </span>
          <button onClick={() => setRevision((v) => v + 1)}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {user && !loading && !loadError && (
        <form
          key={userId + capability + revision}
          className="fu-form"
          onChange={() => {
            setDirty(true);
            onDirty(true);
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            setBusy(true);
            try {
              await write("capability", {
                user_id: userId,
                capability,
                version: selected?.version ?? 0,
                granted: values.get("granted") === "true",
                reason: values.get("reason"),
              });
              setDirty(false);
              onDirty(false);
              setRevision((v) => v + 1);
              onRefresh();
              onNotice("حُفظ قرار الصلاحية مع السبب وسجل التدقيق.");
            } catch (e) {
              onError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="fu-form-full">
            {selected
              ? (selected.granted ? "منح صريح مسجّل" : "سحب صريح مسجّل") +
                " · إصدار " +
                selected.version
              : "لا يوجد قرار مستقل؛ يسري الافتراضي: تعديل الملف والمستمسكات التشغيلية للمدير والمتابعة، وبقية الصلاحيات غير ممنوحة."}
          </p>
          <Field label="القرار الجديد">
            <select name="granted" required defaultValue="">
              <option value="">اختر القرار صراحةً</option>
              <option value="true">منح</option>
              <option value="false">سحب / منع</option>
            </select>
          </Field>
          <Field label="السبب">
            <textarea name="reason" minLength={3} maxLength={1000} required />
          </Field>
          <div className="fu-bulk">
            <button
              className="primary"
              disabled={
                busy ||
                ((user.followup_role || user.role) === "VIEWER" &&
                  ![
                    "documents_read",
                    "documents_sensitive_read",
                    "archive_read",
                  ].includes(capability))
              }
            >
              حفظ قرار الصلاحية
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDirty(false);
                onDirty(false);
                setRevision((v) => v + 1);
              }}
            >
              إلغاء التعديل
            </button>
          </div>
          {(user.followup_role || user.role) === "VIEWER" && (
            <p className="fu-warning fu-form-full">
              حساب القراءة لا يملك تحرير البيانات. يمكن منحه قراءة مستمسكات أو
              أرشيف بقرار مستقل، مع بقاء نطاق الأقسام مفروضاً.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
