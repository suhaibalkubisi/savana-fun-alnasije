import { useCallback, useEffect, useState, type FormEvent } from "react";
import { get, write, message, isAbort, RequestError, readRosterRecovery, saveRosterRecovery, clearRosterRecovery } from "./client";
import { exactPreview, exactDecision, exactRosterStatus, type RosterPreview, type RosterDecision, type RosterPayload, type RosterPointer, type RosterStatus } from "./roster-recovery";
import { today, membershipLabel, setupSelection, visibleSelection, type Boot, type Employee } from "./domain";
import { Field, Chip, Empty } from "./ui";
export function RosterSetup({ boot, department, onError, onNotice, onDirty, onRefresh, onProfile }: {
  boot: Boot; department: string; onError: (value: string) => void; onNotice: (value: string, knownSuccess?: boolean) => void; onDirty: (value: boolean) => void; onRefresh: () => void; onProfile: (id: string) => void;
}) {
  const [departmentId, setDepartmentId] = useState(department), [validFrom, setValidFrom] = useState(today()), [reason, setReason] = useState(""), [query, setQuery] = useState(""), [rows, setRows] = useState<Employee[]>([]), [loadedScope, setLoadedScope] = useState(""), [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<RosterPreview | null>(null), [recovery, setRecovery] = useState<RosterPointer | null>(null), [checking, setChecking] = useState(true), [recoveryError, setRecoveryError] = useState(""), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [loadError, setLoadError] = useState(""), [revision, setRevision] = useState(0);
  const userId = boot.user.id, allowed = !!boot.capabilities?.roster_manage && ["ADMIN", "FOLLOWUP", "SUPERVISOR"].includes(boot.user.followup_role || boot.user.role), scope = departmentId + ":" + validFrom, currentRows = loadedScope === scope ? rows : [], visible = currentRows.filter(row => !query || [row.name, row.internal_code, row.employee_number || ""].join(" ").includes(query)), visibleSelected = visibleSelection(selected, visible), locked = busy || checking || !!recovery || !!recoveryError || !!preview;
  const settle = useCallback((result: RosterDecision) => {
    let cleanup = "";
    try { clearRosterRecovery(userId); } catch { cleanup = " تعذر حذف معرّف الاسترداد المحلي؛ سيُتحقق من هذا القرار مرة أخرى عند العودة."; }
    setRecovery(null); setRecoveryError(""); setSelected([]); setReason(""); setPreview(null); setQuery(""); onDirty(false); setRevision(value => value + 1); onRefresh();
    onNotice("سُجّل قرار صريح واحد يضم " + result.member_count + " موظفين من " + result.valid_from + ". لم تتغير هوية أي موظف ولا وجبته الأصلية، وحُفظت أدلة الانتماء السابقة." + cleanup, true);
  }, [userId, onDirty, onRefresh, onNotice]);
  const restore = useCallback((value: RosterStatus) => {
    setPreview(value.preview); setDepartmentId(value.preview.department_id); setValidFrom(value.preview.valid_from); setReason(value.preview.reason); setSelected(value.preview.employees.map(row => row.employee_id)); setQuery(""); setRecoveryError(""); onDirty(true);
  }, [onDirty]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    Promise.resolve().then(async () => {
      try {
        const pointer = readRosterRecovery(userId);
        if (controller.signal.aborted) return;
        setRecovery(pointer);
        if (!pointer) return;
        onDirty(true);
        const value = await get<RosterStatus>("roster_setup_status", { preview_id: pointer.preview_id }, controller.signal);
        if (controller.signal.aborted) return;
        if (!exactRosterStatus(value, pointer)) throw Error("تعذر التحقق من نتيجة القرار. احتُفظ بمعرّف الاسترداد؛ تحقق مرة أخرى قبل بدء قرار آخر.");
        if (value.decision) settle(value.decision); else restore(value);
      } catch (error) {
        if (!controller.signal.aborted && !isAbort(error)) { setRecoveryError(message(error)); onError(message(error)); }
      } finally { if (!controller.signal.aborted) setChecking(false); }
    });
    return () => controller.abort();
  }, [allowed, userId, onDirty, onError, settle, restore]);
  useEffect(() => {
    if (!allowed || !departmentId || !validFrom) return;
    const controller = new AbortController();
    Promise.resolve().then(() => { if (!controller.signal.aborted) { setLoadedScope(""); setLoadError(""); setLoading(true); } });
    get<Employee[]>("roster_setup_candidates", { department_id: departmentId, start: validFrom, end: validFrom }, controller.signal).then(value => { if (!controller.signal.aborted) { setRows(value); setLoadedScope(scope); } }).catch(error => { if (!controller.signal.aborted && !isAbort(error)) { setLoadError(message(error)); onError(message(error)); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, departmentId, validFrom, scope, revision, onError]);
  function edit(change: () => void) { change(); setPreview(null); onDirty(true); }
  function cancel() { if (recovery || recoveryError) return; setSelected([]); setReason(""); setPreview(null); onDirty(false); }
  function filterScope(change: () => void) { change(); setRows([]); setLoadedScope(""); setSelected([]); setPreview(null); onDirty(false); }
  async function prepare(event: FormEvent) {
    event.preventDefault(); if (locked) return; setBusy(true);
    try {
      const payload: RosterPayload = { department_id: departmentId, valid_from: validFrom, reason: reason.trim(), employees: setupSelection(selected, visible, departmentId) };
      const value = await write<RosterPreview>("roster_setup_preview", payload, result => exactPreview(result, payload));
      setPreview(value); onNotice("حُفظت معاينة محددة. راجع الأشخاص والتاريخ ثم أكد القرار صراحةً.", true);
    } catch (error) { onError(message(error)); }
    finally { setBusy(false); }
  }
  async function reconcile() {
    setBusy(true);
    try {
      const pointer = recovery || readRosterRecovery(userId);
      if (!pointer) throw Error("لا يوجد معرّف استرداد محفوظ لهذا الحساب.");
      setRecovery(pointer);
      const value = await get<RosterStatus>("roster_setup_status", { preview_id: pointer.preview_id });
      if (!exactRosterStatus(value, pointer)) throw Error("تعذر التحقق من نتيجة القرار. احتُفظ بمعرّف الاسترداد.");
      if (value.decision) settle(value.decision);
      else { restore(value); onNotice("لا توجد نتيجة مسجلة حتى الآن. احتُفظ بالمعرّف؛ إعادة المحاولة الصريحة تستخدم القرار نفسه."); }
    } catch (error) { setRecoveryError(message(error)); onError(message(error)); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview) return;
    if (!recovery && Date.parse(preview.expires_at) <= Date.now()) { setPreview(null); setRevision(value => value + 1); onError("انتهت صلاحية المعاينة. أعد تحميل غير الموثّقين ثم المعاينة."); return; }
    setBusy(true); let retained = !!recovery;
    try {
      const pointer = recovery || readRosterRecovery(userId) || { preview_id: preview.id, request_id: crypto.randomUUID() };
      if (pointer.preview_id !== preview.id) throw Error("معرّف الاسترداد يعود إلى معاينة أخرى. تحقق من النتيجة أولاً.");
      saveRosterRecovery(userId, pointer); retained = true; setRecovery(pointer); onDirty(true);
      const value = await write<RosterDecision>("roster_setup_commit", { preview_id: preview.id }, result => exactDecision(result, preview), pointer.request_id);
      settle(value);
    } catch (error) {
      if (error instanceof RequestError && error.status === 410) {
        try { clearRosterRecovery(userId); setRecovery(null); setRecoveryError(""); setPreview(null); setSelected([]); setReason(""); onDirty(false); setRevision(value => value + 1); onError("رفض السجل تنفيذ القرار لأن المعاينة انتهت ولم يُسجّل قرار بها. أعد الاختيار والمعاينة من البيانات الحالية."); }
        catch { setRecoveryError("تعذر حذف معرّف الاسترداد المحلي."); onError("انتهت المعاينة، وتعذر حذف معرّف الاسترداد المحلي. تحقق من النتيجة مرة أخرى قبل بدء قرار آخر."); }
      } else onError(message(error) + (retained ? " — احتُفظ بمعرّف القرار. تحقق من النتيجة أو أعد المحاولة بالمعرّف نفسه؛ لا تبدأ قراراً آخر قبل حسم النتيجة." : " — لم يُرسل تأكيد القرار. عالج الخطأ ثم أكد المعاينة صراحةً."));
    } finally { setBusy(false); }
  }
  if (!allowed) return <Empty>تهيئة الانتماء تحتاج صلاحية مستقلة وحساباً مخوّلاً لهذا القسم.</Empty>;
  return <section className="fu-panel fu-roster-setup">
    <h3>تهيئة القائمة المسائية — موظفون غير موثّقين</h3>
    <p className="fu-muted">هذه قائمة إعداد منفصلة عن قائمة التبليغ الموثّقة. لا اختيارات تلقائية. حدد الموظفين الفعليين ثم راجع معاينة مؤرّخة قبل تسجيل عضويتهم، مع إبقاء وجبتهم الأصلية وأدلة الانتماء السابقة.</p>
    {checking && <p role="status">جارٍ التحقق من أي قرار أُرسل قبل انقطاع الجلسة…</p>}
    {!checking && (recovery || recoveryError) && <div className="fu-warning" role="status"><p>توجد محاولة تحتاج حسم النتيجة. حُفظ معرّفا المعاينة والطلب فقط في هذه الجلسة، ولم يُرسل أي تأكيد تلقائي عند العودة.</p><p>{recoveryError || "التحقق يقرأ النتيجة المسجّلة فقط. إعادة المحاولة أدناه إجراء صريح يستخدم معرّف الطلب السابق."}</p><button type="button" disabled={busy} onClick={reconcile}>التحقق من نتيجة القرار</button></div>}
    {!checking && !recovery && !recoveryError && <form onSubmit={prepare}>
      <div className="fu-form">
        <Field label="نطاق القسم"><select required value={departmentId} disabled={locked || !!selected.length || !!reason.trim()} onChange={event => filterScope(() => setDepartmentId(event.target.value))}><option value="">اختر القسم</option>{boot.departments.map(row => <option key={row.id} value={row.id}>{row.arabic_name}</option>)}</select></Field>
        <Field label="تاريخ النفاذ — اليوم أو مستقبلاً"><input type="date" required min={today()} value={validFrom} disabled={locked || !!selected.length || !!reason.trim()} onChange={event => filterScope(() => setValidFrom(event.target.value))} /></Field>
        <Field label="بحث في قائمة الإعداد"><input value={query} disabled={locked} onChange={event => setQuery(event.target.value)} placeholder="الاسم أو الرمز الدائم" /></Field>
        <Field label="مصدر القرار وسبب التوثيق"><textarea required minLength={3} maxLength={2000} value={reason} disabled={locked} onChange={event => edit(() => setReason(event.target.value))} /></Field>
      </div>
      <p className="fu-warning">لا يُضاف أحد للقائمة المسائية تلقائياً، ولا يُسمح بتأريخ رجعي. لا يُثبت هذا القرار حضوراً لأي يوم سابق. ألغِ الاختيارات والمصدر قبل تغيير القسم أو التاريخ.</p>
      {loading && <p role="status">جارٍ تحميل غير الموثّقين في النطاق…</p>}
      {loadError && <div className="fu-error" role="alert"><span>تعذر تحميل قائمة الإعداد؛ لا توجد قائمة بديلة مخمّنة.</span><button type="button" disabled={locked} onClick={() => setRevision(value => value + 1)}>إعادة المحاولة</button></div>}
      {!departmentId && <Empty>اختر نطاق القسم لعرض قائمة الإعداد.</Empty>}
      {!loading && !loadError && departmentId && <>
        <div className="fu-bulk"><button type="button" disabled={locked || !visible.length} onClick={() => edit(() => setSelected(visible.map(row => row.id)))}>تحديد جميع غير الموثّقين الظاهرين ({visible.length})</button><button type="button" disabled={locked} onClick={() => { setSelected([]); onDirty(!!reason.trim()); }}>مسح الاختيار</button><span>{visibleSelected.length} ظاهر محدد — {selected.length - visibleSelected.length} مخفي لن يدخل في المعاينة</span></div>
        <div className="fu-scroll"><table><thead><tr><th>اختيار صريح</th><th>الموظف</th><th>الرمز الدائم</th><th>الوجبة المسجّلة / التوثيق</th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td><input type="checkbox" disabled={locked} aria-label={"اختيار لهذا القرار: " + row.name} checked={selected.includes(row.id)} onChange={event => edit(() => setSelected(values => event.target.checked ? [...new Set([...values, row.id])] : values.filter(id => id !== row.id)))} /></td><td><button type="button" className="fu-name" disabled={locked} onClick={() => onProfile(row.id)}>{row.name}</button></td><td><bdi>{row.internal_code}</bdi></td><td><Chip value="unresolved">{membershipLabel(row)}</Chip></td></tr>)}</tbody></table></div>
        {!visible.length && <Empty>{currentRows.length ? "لا يوجد تطابق ظاهر مع شروط البحث." : "لا يوجد موظفون غير موثّقين مؤهلون للإعداد في هذا النطاق والتاريخ."}</Empty>}
      </>}
      <div className="fu-bulk"><button className="primary" disabled={locked || loading || !!loadError || !visibleSelected.length}>معاينة الاختيارات الظاهرة ({visibleSelected.length})</button><button type="button" disabled={busy} onClick={cancel}>إلغاء الاختيارات والمعاينة</button></div>
    </form>}
    {!checking && preview && <div className="fu-roster-preview">
      <h4>معاينة قرار واحد — {preview.member_count} موظفين</h4>
      <p>القسم: {boot.departments.find(row => row.id === preview.department_id)?.arabic_name} — النفاذ: {preview.valid_from}</p><p>المصدر والسبب: {preview.reason}</p>
      <ul>{preview.employees.map(row => <li key={row.employee_id}>{row.name} — <bdi>{row.internal_code}</bdi></li>)}</ul>
      <p>ينطبق القرار على هذه الهويات والنسخ حصراً. انتهاء المعاينة: {new Date(preview.expires_at).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}.</p>
      {recovery && <p className="fu-warning">حتى بعد انتهاء وقت المعاينة، تسترد إعادة المحاولة الصريحة القرار إن نُفّذ، أو تؤكد رفض المعاينة المنتهية. لا تُحذف محاولة معلّقة بناءً على التحقق للقراءة فقط.</p>}
      <button type="button" className="primary" disabled={busy} onClick={commit}>{busy ? "جارٍ حسم النتيجة…" : recovery ? "إعادة المحاولة صراحةً بمعرّف القرار السابق" : "أؤكد الأشخاص والتاريخ والمصدر — سجل قراراً واحداً"}</button>
      {!recovery && <button type="button" disabled={busy} onClick={cancel}>إلغاء المعاينة دون تسجيل قرار</button>}
    </div>}
  </section>;
}
