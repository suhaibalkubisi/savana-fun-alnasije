import { useEffect, useRef, useState, type FormEvent } from "react";
import { get, request, write, privateWrite, message, isAbort } from "./client";
import {
  actionStates,
  states,
  monthEnd,
  membershipLabel,
  type Boot,
  type Profile,
  type Position,
  type Action,
  type Document,
  type PendingDocument,
  type PhotoCrop,
} from "./domain";
import { ServiceStateDialog, serviceLabels } from "./service-state";
import { Field, Chip, Empty, Metrics } from "./ui";

const tabs = [
  ["overview", "نظرة عامة"],
  ["contact", "بيانات الاتصال"],
  ["education", "الدراسة والمجموعة"],
  ["documents", "المستمسكات"],
  ["declarations", "التبليغات المسائية"],
  ["actions", "الإجراءات"],
  ["history", "القسم والسجل"],
];
const qualifications = [
  "",
  "ابتدائية",
  "متوسطة",
  "إعدادية",
  "دبلوم",
  "بكالوريوس",
  "ماجستير",
  "دكتوراه",
  "أخرى",
];
const workStates: Record<string, string> = {
  active: "نشط",
  inactive: "غير نشط",
  resigned: "مستقيل",
  long_leave: "إجازة طويلة",
};
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("تعذر قراءة الملف"));
    reader.readAsDataURL(file);
  });
}
async function photoThumbnail(
  file: File,
  zoom: number,
  x: number,
  y: number,
  savedCrop?: PhotoCrop | null,
) {
  const source = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = source;
    await img.decode();
    const side = savedCrop
        ? savedCrop.width * img.naturalWidth
        : Math.min(img.naturalWidth, img.naturalHeight) / zoom,
      height = savedCrop ? savedCrop.height * img.naturalHeight : side,
      left = savedCrop
        ? savedCrop.x * img.naturalWidth
        : (img.naturalWidth - side) * x,
      top = savedCrop
        ? savedCrop.y * img.naturalHeight
        : (img.naturalHeight - side) * y;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("تعذر إنشاء معاينة الصورة");
    ctx.drawImage(img, left, top, side, height, 0, 0, 256, 256);
    return {
      base64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1],
      crop: savedCrop || {
        x: left / img.naturalWidth,
        y: top / img.naturalHeight,
        width: side / img.naturalWidth,
        height: side / img.naturalHeight,
      },
    };
  } finally {
    URL.revokeObjectURL(source);
  }
}
function time(value: unknown) {
  return typeof value === "string"
    ? new Date(value).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })
    : "—";
}
function text(value: unknown) {
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function EmployeeProfile({
  employeeId,
  boot,
  month,
  onBack,
  onError,
  onNotice,
  onDirty,
}: {
  employeeId: string;
  boot: Boot;
  month: string;
  onBack: () => void;
  onError: (v: string) => void;
  onNotice: (v: string) => void;
  onDirty: (v: boolean) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [profileError, setProfileError] = useState(""),
    [tab, setTab] = useState("overview"),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [position, setPosition] = useState<Position[]>([]),
    [actions, setActions] = useState<Action[]>([]),
    [detailsLoading, setDetailsLoading] = useState(false),
    [detailsError, setDetailsError] = useState(""),
    [photo, setPhoto] = useState(""),
    [uploading, setUploading] = useState(false),
    [transfer, setTransfer] = useState(false),
    [serviceOpen, setServiceOpen] = useState(false),
    [identityOpen, setIdentityOpen] = useState(false),
    [docEdit, setDocEdit] = useState<Document | null>(null),
    [resumeDoc, setResumeDoc] = useState<PendingDocument | null>(null),
    [pending, setPending] = useState<PendingDocument[]>([]),
    [pendingLoading, setPendingLoading] = useState(false),
    [pendingRevision, setPendingRevision] = useState(0),
    [abandonDoc, setAbandonDoc] = useState<PendingDocument | null>(null),
    [uploadKind, setUploadKind] = useState("general"),
    [photoFile, setPhotoFile] = useState<File | null>(null),
    [zoom, setZoom] = useState(1),
    [cropX, setCropX] = useState(0.5),
    [cropY, setCropY] = useState(0.5),
    [thumbnail, setThumbnail] = useState<Awaited<
      ReturnType<typeof photoThumbnail>
    > | null>(null);
  const editVersion = useRef<number | undefined>(undefined);
  const caps = boot.capabilities || {},
    readOnlyProfile = !!profile?.read_only,
    canEdit = !!caps.profile_edit && !readOnlyProfile;
  useEffect(() => {
    let day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Baghdad",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const controller = new AbortController();
    const timer = setInterval(() => {
      const next = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Baghdad",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      if (next !== day) {
        day = next;
        get<Profile>("profile", { employee_id: employeeId }, controller.signal)
          .then((p) => {
            if (!controller.signal.aborted) setProfile(p);
          })
          .catch((e) => {
            if (!isAbort(e)) onError(message(e));
          });
      }
    }, 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [employeeId, onError]);
  useEffect(() => {
    if (
      tab !== "documents" ||
      (!caps.documents_write && !caps.documents_sensitive_write)
    )
      return;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setPending([]);
        setPendingLoading(true);
      }
    });
    get<PendingDocument[]>(
      "pending_documents",
      { employee_id: employeeId, include_abandoned: "true" },
      controller.signal,
    )
      .then(setPending)
      .catch((e) => {
        if (!isAbort(e)) onError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPendingLoading(false);
      });
    return () => controller.abort();
  }, [
    tab,
    employeeId,
    pendingRevision,
    caps.documents_write,
    caps.documents_sensitive_write,
    onError,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) setProfileError("");
    });
    get<Profile>("profile", { employee_id: employeeId }, controller.signal)
      .then((p) => {
        if (controller.signal.aborted) return;
        setProfile(p);
        setEditing(false);
        if (p.read_only) setTab("overview");
      })
      .catch((e) => {
        if (!isAbort(e)) {
          setProfileError(message(e));
          onError(message(e));
        }
      });
    return () => controller.abort();
  }, [employeeId, revision, onError]);
  useEffect(() => {
    if (tab !== "declarations" && tab !== "actions") return;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setPosition([]);
        setActions([]);
        setDetailsError("");
        setDetailsLoading(true);
      }
    });
    const filters = {
      employee_id: employeeId,
      start: month + "-01",
      end: monthEnd(month),
    };
    if (tab === "declarations")
      get<Position[]>("position", filters, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setPosition(rows);
        })
        .catch((e) => {
          if (!isAbort(e)) {
            setDetailsError(message(e));
            onError(message(e));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailsLoading(false);
        });
    else
      get<Action[]>("actions", { employee_id: employeeId }, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setActions(rows);
        })
        .catch((e) => {
          if (!isAbort(e)) {
            setDetailsError(message(e));
            onError(message(e));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailsLoading(false);
        });
    return () => controller.abort();
  }, [tab, employeeId, month, revision, onError]);
  useEffect(() => {
    const id = profile?.employee.photo_document_id;
    if (!id || !caps.documents_read) {
      Promise.resolve().then(() => setPhoto(""));
      return;
    }
    const controller = new AbortController();
    request<{ url: string }>(
      "/api/followup/documents?id=" + encodeURIComponent(id) + "&thumbnail=1",
      undefined,
      controller.signal,
    )
      .then((v) => setPhoto(v.url))
      .catch((e) => {
        if (!isAbort(e)) onError(message(e));
      });
    return () => controller.abort();
  }, [profile?.employee.photo_document_id, caps.documents_read, onError]);
  useEffect(() => {
    if (!photoFile || uploadKind !== "photo") return;
    let active = true;
    photoThumbnail(photoFile, zoom, cropX, cropY, resumeDoc?.photo_crop)
      .then((t) => {
        if (active) setThumbnail(t);
      })
      .catch((e) => {
        if (active) onError(message(e));
      });
    return () => {
      active = false;
    };
  }, [
    photoFile,
    zoom,
    cropX,
    cropY,
    uploadKind,
    resumeDoc?.photo_crop,
    onError,
  ]);
  const changeTab = (next: string) => {
    if (readOnlyProfile && next !== "overview") {
      onError(
        "هذا السجل متاح كنظرة عامة في الدليل المخوّل؛ بقية الملف تحتاج نطاقاً تشغيلياً مخوّلاً.",
      );
      return;
    }
    if (editing || docEdit || transfer || abandonDoc) {
      onError("احفظ التعديل أو ألغِه قبل تغيير القسم.");
      return;
    }
    setTab(next);
  };
  const reload = () => {
    setRevision((v) => v + 1);
    onDirty(false);
  };
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    const f = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      employee_id: employeeId,
      version: editing ? (editVersion.current ?? profile.employee.version) : profile.employee.version,
      reason: f.get("reason"),
    };
    for (const [k, v] of f)
      if (k !== "reason")
        data[k] =
          k === "graduation_year"
            ? String(v)
              ? Number(v)
              : null
            : String(v).trim() || null;
    setBusy(true);
    try {
      await write<Profile['employee']>("profile", data, async receipt=>{
        if(receipt.id!==employeeId||Number(receipt.version)<=Number(data.version))return false;
        const fresh=await get<Profile>('profile',{employee_id:employeeId});
        return fresh.employee.id===employeeId&&fresh.employee.internal_code===profile.employee.internal_code&&Object.entries(data).filter(([key])=>!['employee_id','version','reason'].includes(key)).every(([key,value])=>(fresh.employee[key as keyof typeof fresh.employee]??null)===(value??null));
      });
      reload();
      onNotice("حُفظت بيانات الملف وسُجّل التغيير.");
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      file = f.get("file");
    if (!(file instanceof File) || !file.size) {
      onError("اختر ملفاً.");
      return;
    }
    setUploading(true);
    try {
      const kind = resumeDoc?.kind || String(f.get("kind")),
        limit = kind === "photo" ? 5 : 10;
      if (file.size > limit * 1024 * 1024)
        throw Error("الحد الأقصى " + limit + " ميغابايت");
      const derivative =
        kind === "photo"
          ? await photoThumbnail(
              file,
              zoom,
              cropX,
              cropY,
              resumeDoc?.photo_crop,
            )
          : null;
      const doc = await privateWrite<Document>({
        operation: "upload",
        employee_id: employeeId,
        title: resumeDoc?.title || f.get("title"),
        kind,
        file_name: file.name,
        mime_type: file.type,
        content_base64: await fileBase64(file),
        ...(resumeDoc
          ? {
              resume_document_id: resumeDoc.id,
              ...(resumeDoc.issued_on
                ? { issued_on: resumeDoc.issued_on }
                : {}),
              ...(resumeDoc.expires_on
                ? { expires_on: resumeDoc.expires_on }
                : {}),
              ...(resumeDoc.description
                ? { description: resumeDoc.description }
                : {}),
              ...(resumeDoc.previous_document_id
                ? { previous_document_id: resumeDoc.previous_document_id }
                : {}),
            }
          : {
              ...(f.get("issued_on") ? { issued_on: f.get("issued_on") } : {}),
              ...(f.get("expires_on")
                ? { expires_on: f.get("expires_on") }
                : {}),
              ...(f.get("description")
                ? { description: f.get("description") }
                : {}),
              ...(docEdit?.id ? { previous_document_id: docEdit.id } : {}),
            }),
        ...(derivative
          ? { thumbnail_base64: derivative.base64, photo_crop: derivative.crop }
          : {}),
      });
      let linkedPhoto = kind !== "photo";
      if (kind === "photo" && profile && canEdit) {
        try {
          await write("profile", {
            employee_id: employeeId,
            version: editing ? (editVersion.current ?? profile.employee.version) : profile.employee.version,
            photo_document_id: doc.id,
            reason: "إضافة أو استبدال صورة الموظف",
          });
          linkedPhoto = true;
        } catch (e) {
          onError(
            "حُفظت الصورة الخاصة، لكن ربطها بالملف لم يكتمل: " + message(e),
          );
        }
      }
      setDocEdit(null);
      setResumeDoc(null);
      setPhotoFile(null);
      setThumbnail(null);
      setPendingRevision((v) => v + 1);
      reload();
      onNotice(
        linkedPhoto
          ? "حُفظ الملف في التخزين الخاص."
          : "حُفظ أصل الصورة ومعاينتها الخاصة. يتطلب عرضها في الملف تعديل الملف المخوّل.",
      );
    } catch (e) {
      setPendingRevision((v) => v + 1);
      setRevision((v) => v + 1);
      onError(
        message(e) +
          " · حدّثتُ السجل للتحقق من النتيجة. راجع الملفات المكتملة أو استأنف الرفع المعلّق باختيار الأصل نفسه؛ لا تبدأ نسخة جديدة قبل التحقق.",
      );
    } finally {
      setUploading(false);
    }
  }
  async function openDocument(doc: Document) {
    try {
      const v = await request<{ url: string }>(
        "/api/followup/documents?id=" + encodeURIComponent(doc.id),
      );
      window.open(v.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      onError(message(e));
    }
  }
  function resumeUpload(doc: PendingDocument) {
    setResumeDoc(doc);
    setDocEdit({
      ...doc,
      name: doc.file_name,
      type: doc.kind,
      mime: doc.mime_type,
      size: doc.byte_size,
    });
    setUploadKind(doc.kind);
    setPhotoFile(null);
    setThumbnail(null);
    onDirty(true);
  }
  function cancelUploadForm() {
    setDocEdit(null);
    setResumeDoc(null);
    setPhotoFile(null);
    setThumbnail(null);
    onDirty(false);
  }
  async function cleanup(doc: PendingDocument) {
    setUploading(true);
    try {
      await privateWrite({ operation: "cleanup", id: doc.id });
      setPending((v) => v.filter((d) => d.id !== doc.id));
      if (abandonDoc?.id === doc.id) {
        setAbandonDoc(null);
        onDirty(false);
      }
      onNotice("اكتمل تنظيف ملفات الرفع الملغى. يبقى سجل الإلغاء محفوظاً.");
    } catch (e) {
      onError(message(e));
    } finally {
      setUploading(false);
    }
  }
  if (!profile)
    return (
      <section className="fu-panel">
        <p role={profileError ? "alert" : "status"}>
          {profileError
            ? "تعذر تحميل الملف: " + profileError
            : "جارٍ تحميل الملف المخوّل…"}
        </p>
        {profileError && (
          <button onClick={() => setRevision((v) => v + 1)}>
            إعادة المحاولة
          </button>
        )}
        <button onClick={onBack}>العودة إلى النتائج</button>
      </section>
    );
  const employee = profile.employee,
    department =
      boot.departments.find((d) => d.id === employee.department_id)
        ?.arabic_name ||
      employee.department_name ||
      "—";
  return (
    <div className="fu-profile">
      {profileError && (
        <div className="fu-error" role="alert">
          لم يكتمل تحديث الملف؛ البيانات المعروضة من آخر تحميل ناجح.{" "}
          <button onClick={() => setRevision((v) => v + 1)}>
            إعادة المحاولة
          </button>
        </div>
      )}
      <button className="fu-back" onClick={onBack}>
        ← العودة إلى النتائج السابقة
      </button>
      <section className="fu-profile-hero">
        <div className="fu-profile-identity">
          <div
            className="fu-avatar fu-avatar-large"
            style={
              photo ? { backgroundImage: "url(" + photo + ")" } : undefined
            }
          >
            {!photo && employee.name.slice(0, 1)}
          </div>
          <div>
            <h2>{employee.name}</h2>
            <p>
              <bdi>{employee.internal_code}</bdi>
            </p>
            <div className="fu-bulk">
              <Chip value="present">
                {workStates[employee.employment_status] ||
                  employee.employment_status}
              </Chip>
              <Chip value="">{department}</Chip>
              <Chip value="submitted">
                {employee.shift_name || "الوجبة غير مسجّلة"}
              </Chip>
              {employee.evening_verified !== undefined && (
                <Chip
                  value={employee.evening_verified ? "present" : "unresolved"}
                >
                  {membershipLabel(employee)}
                </Chip>
              )}
            </div>
          </div>
        </div>
        <div>
          <small>آخر تحديث</small>
          <p>{employee.updated_at ? time(employee.updated_at) : "غير مسجّل"}</p>
          {canEdit && ["overview", "contact", "education"].includes(tab) && (
            <button
              className="primary"
              onClick={() => {
                editVersion.current = profile?.employee.version;
                setEditing(true);
                onDirty(true);
              }}
            >
              تعديل البيانات المخوّلة
            </button>
          )}
        </div>
      </section>
      <div className="fu-bulk">
        {caps.service_manage && (
          <button
            onClick={() => {
              if (editing || docEdit || transfer) {
                onError("احفظ التعديل الحالي أو ألغِه أولاً.");
                return;
              }
              setServiceOpen(true);
            }}
          >
            تغيير الحالة
          </button>
        )}
        {caps.identity_edit && (
          <button
            onClick={() => {
              if (editing || docEdit || transfer) {
                onError("احفظ التعديل الحالي أو ألغِه أولاً.");
                return;
              }
              setIdentityOpen(true);
            }}
          >
            تصحيح الاسم والرقم الوظيفي
          </button>
        )}
      </div>
      {profile.service_decisions
        ?.filter(
          (s) =>
            s.valid_from >
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Baghdad",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date()),
        )
        .map((s) => (
          <p key={s.id} className="fu-warning">
            قرار مجدول: {serviceLabels[s.employment_status]} من {s.valid_from} —{" "}
            {s.reason}
          </p>
        ))}
      {(serviceOpen || identityOpen) && (
        <ServiceStateDialog
          employee={employee}
          actorId={boot.user.id}
          identity={identityOpen}
          onClose={() => {
            setServiceOpen(false);
            setIdentityOpen(false);
          }}
          onSaved={() => {
            onError("");
            reload();
            onNotice("تأكد حفظ القرار في السجل.");
          }}
          onError={onError}
          onDirty={onDirty}
        />
      )}
      <nav className="fu-tabs" aria-label="أقسام ملف الموظف">
        {tabs
          .filter(([id]) => !readOnlyProfile || id === "overview")
          .map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => changeTab(id)}
            >
              {label}
            </button>
          ))}
      </nav>
      {readOnlyProfile && (
        <p className="fu-warning">
          هذه نظرة عامة لسجل موجود في الدليل المخوّل، وليست إثبات عضوية مسائية
          أو حضور. بقيت الوجبة الأصلية كما سُجلت؛ الوصول إلى بقية الملف يخضع
          لنطاق التشغيل وصلاحياته.
        </p>
      )}
      {editing ? (
        <form
          className="fu-panel fu-form"
          onSubmit={save}
          onChange={() => onDirty(true)}
        >
          <h3>تعديل بيانات الملف</h3>
          <p className="fu-form-full fu-muted">
            القيم غير المعروفة تبقى فارغة. هذا النموذج لا يغيّر القسم أو حالة
            الخدمة.
          </p>
          {[
            ["phone", "الهاتف الأساسي"],
            ["secondary_phone", "هاتف إضافي"],
            ["emergency_name", "اسم جهة الطوارئ"],
            ["emergency_phone", "هاتف الطوارئ"],
            ["emergency_relation", "صلة القرابة"],
            ["specialization", "التخصص"],
            ["institution", "المؤسسة التعليمية"],
            ["group_name", "الوجبة / المجموعة"],
            ["reference_number", "رقم مرجعي اختياري"],
          ]
            .filter(
              ([key]) =>
                  key !== "reference_number" || (caps.documents_sensitive_write && caps.documents_sensitive_read),
            )
            .map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  name={key}
                  type={key.includes("phone") ? "tel" : "text"}
                  dir={key.includes("phone") ? "ltr" : undefined}
                  maxLength={key.includes("phone") ? 50 : 150}
                  defaultValue={
                    text(employee[key as keyof typeof employee]) === "—"
                      ? ""
                      : text(employee[key as keyof typeof employee])
                  }
                />
              </Field>
            ))}
          <Field label="التحصيل الدراسي">
            <select name="education" defaultValue={employee.education || ""}>
              {[...new Set([...qualifications, employee.education || ""])].map(
                (v) => (
                  <option key={v} value={v}>
                    {v || "غير معروف"}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="سنة التخرج">
            <input
              name="graduation_year"
              type="number"
              min="1900"
              max="2100"
              defaultValue={employee.graduation_year || ""}
            />
          </Field>
          <Field label="سبب التعديل">
            <textarea name="reason" required maxLength={500} />
          </Field>
          <div className="fu-bulk">
            <button className="primary" disabled={busy}>
              حفظ التعديل
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                onDirty(false);
              }}
            >
              إلغاء
            </button>
          </div>
        </form>
      ) : (
        <>
          {tab === "overview" && (
            <div className="fu-profile-columns">
              <section className="fu-panel">
                <h3>البيانات التشغيلية</h3>
                <dl className="fu-details">
                  <dt>القسم الحالي</dt>
                  <dd>{department}</dd>
                  <dt>المجموعة</dt>
                  <dd>{employee.group_name || "غير معروف"}</dd>
                  <dt>المسؤول</dt>
                  <dd>{employee.supervisor_name || "غير مسجّل"}</dd>
                  <dt>الرمز الدائم</dt>
                  <dd>
                    <bdi>{employee.internal_code}</bdi>
                  </dd>
                  {caps.documents_sensitive_read && (
                    <>
                      <dt>الرقم المرجعي</dt>
                      <dd>{employee.reference_number || "غير مسجّل"}</dd>
                    </>
                  )}
                </dl>
                <p className="fu-muted">
                  يحافظ الملف على الرمز الدائم وسجله السابق.
                </p>
              </section>
              <section className="fu-panel">
                <h3>خطوات المتابعة</h3>
                <button
                  className="fu-summary-link"
                  disabled={readOnlyProfile}
                  onClick={() => changeTab("declarations")}
                >
                  التبليغات اليومية ومصادرها <span>←</span>
                </button>
                <button
                  className="fu-summary-link"
                  disabled={readOnlyProfile}
                  onClick={() => changeTab("actions")}
                >
                  الإجراءات المسندة ومواعيدها <span>←</span>
                </button>
                <button
                  className="fu-summary-link"
                  disabled={readOnlyProfile}
                  onClick={() => changeTab("documents")}
                >
                  المستمسكات الخاصة وإصداراتها <span>←</span>
                </button>
                {!readOnlyProfile && caps.roster_manage && (
                  <button
                    onClick={() => {
                      setTransfer(true);
                      onDirty(true);
                    }}
                  >
                    نقل مؤرّخ أو تغيير حالة الخدمة
                  </button>
                )}
              </section>
            </div>
          )}
          {tab === "contact" && (
            <section className="fu-panel">
              <h3>معلومات الاتصال</h3>
              <dl className="fu-details">
                {[
                  ["الهاتف الأساسي", employee.phone],
                  ["الهاتف الإضافي", employee.secondary_phone],
                  ["جهة الطوارئ", employee.emergency_name],
                  ["صلة القرابة", employee.emergency_relation],
                  ["هاتف الطوارئ", employee.emergency_phone],
                ]
                  .filter(() => canEdit || caps.documents_sensitive_read)
                  .map(([k, v]) => (
                    <div className="fu-detail-row" key={k}>
                      <dt>{k}</dt>
                      <dd>
                        <bdi>{v || "غير معروف"}</bdi>
                      </dd>
                    </div>
                  ))}
              </dl>
              {!canEdit && !caps.documents_sensitive_read && (
                <p className="fu-muted">
                  معلومات الاتصال والطوارئ مقيّدة بصلاحية مستقلة؛ لا تعني القيم
                  المحجوبة أنها غير مسجّلة.
                </p>
              )}
            </section>
          )}
          {tab === "education" && (
            <section className="fu-panel">
              <h3>الدراسة والمعلومات التشغيلية</h3>
              <dl className="fu-details">
                {[
                  ["التحصيل", employee.education],
                  ["التخصص", employee.specialization],
                  ["المؤسسة", employee.institution],
                  ["سنة التخرج", employee.graduation_year],
                  ["الوجبة / المجموعة", employee.group_name],
                ].map(([k, v]) => (
                  <div className="fu-detail-row" key={String(k)}>
                    <dt>{k}</dt>
                    <dd>{v || "غير معروف"}</dd>
                  </div>
                ))}
              </dl>
              <p className="fu-muted">
                المجموعة تسمية فريق حقيقي داخل الخدمة المسائية.
              </p>
            </section>
          )}
          {tab === "documents" && (
            <>
              <section className="fu-panel">
                <div className="fu-section-title">
                  <h3>المستمسكات والصورة</h3>
                  {(caps.documents_write || caps.documents_sensitive_write) && (
                    <button
                      onClick={() => {
                        setUploadKind(
                          caps.documents_write ? "general" : "identity",
                        );
                        setResumeDoc(null);
                        setPhotoFile(null);
                        setThumbnail(null);
                        setDocEdit({
                          id: "",
                          version: 0,
                          name: "",
                          type: "general",
                          mime: "",
                          size: 0,
                        });
                        onDirty(true);
                      }}
                    >
                      إضافة مستمسك أو صورة
                    </button>
                  )}
                </div>
                {!caps.documents_read && !caps.documents_sensitive_read ? (
                  <Empty>لا توجد صلاحية لقراءة المستمسكات.</Empty>
                ) : (
                  <div className="fu-document-grid">
                    {profile.documents
                      .filter((d) => d.state !== "archived")
                      .map((d) => (
                        <article className="fu-document" key={d.id}>
                          <span className="fu-document-icon">
                            {d.mime === "application/pdf" ? "PDF" : "▧"}
                          </span>
                          <h4>{d.title || d.name}</h4>
                          <p>
                            {d.name} · {(d.size / 1024).toFixed(0)} KB
                          </p>
                          <Chip value="leave">خاص · إصدار {d.version}</Chip>
                          {d.expires_on && <p>الانتهاء: {d.expires_on}</p>}
                          <div className="fu-bulk">
                            <button onClick={() => openDocument(d)}>
                              معاينة / تحميل
                            </button>
                            {(d.type === "identity"
                              ? caps.documents_sensitive_write
                              : caps.documents_write) && (
                              <button
                                onClick={() => {
                                  setResumeDoc(null);
                                  setDocEdit(d);
                                  setUploadKind(d.type);
                                  setPhotoFile(null);
                                  setThumbnail(null);
                                  onDirty(true);
                                }}
                              >
                                إصدار بديل
                              </button>
                            )}
                          </div>
                          <details>
                            <summary>معلومات الإصدار</summary>
                            <p>
                              {d.description || "بلا وصف"} ·{" "}
                              {time(d.created_at)}
                            </p>
                            {(d.previous_document_id || d.previous_id) && (
                              <p>
                                الإصدار السابق:{" "}
                                <bdi>
                                  {d.previous_document_id || d.previous_id}
                                </bdi>
                              </p>
                            )}
                          </details>
                        </article>
                      ))}
                  </div>
                )}
                {!profile.documents.length && (
                  <Empty>لا توجد مستمسكات مسجّلة.</Empty>
                )}
                {profile.documents.some((d) => d.state === "archived") && (
                  <details className="fu-document-history">
                    <summary>
                      الإصدارات السابقة المؤرشفة (
                      {
                        profile.documents.filter((d) => d.state === "archived")
                          .length
                      }
                      )
                    </summary>
                    {profile.documents
                      .filter((d) => d.state === "archived")
                      .map((d) => (
                        <div className="fu-summary-link" key={d.id}>
                          <span>
                            {d.title || d.name}
                            <small>
                              {time(d.created_at)} · {d.name}
                            </small>
                          </span>
                          <button onClick={() => openDocument(d)}>
                            معاينة الإصدار السابق
                          </button>
                        </div>
                      ))}
                  </details>
                )}
                {(caps.documents_write || caps.documents_sensitive_write) && (
                  <section className="fu-pending-documents">
                    <div className="fu-section-title">
                      <h4>استعادة الرفع وتنظيف الملفات الملغاة</h4>
                      <button
                        disabled={uploading || pendingLoading}
                        onClick={() => setPendingRevision((v) => v + 1)}
                      >
                        تحديث السجل
                      </button>
                    </div>
                    <p className="fu-muted">
                      تظهر عملياتك المخوّلة فقط. يبقى الرفع المعلّق غير متاح
                      للقراءة حتى اكتماله. الاستئناف يتطلب اختيار الأصل نفسه؛ لا
                      تُحفظ ملفاتك في تخزين المتصفح.
                    </p>
                    {pendingLoading && (
                      <p role="status">جارٍ التحقق من العمليات المحفوظة…</p>
                    )}
                    {pending.map((d) => (
                      <article className="fu-document" key={d.id}>
                        <strong>{d.title || d.file_name}</strong>
                        <p>
                          {d.file_name} · {(d.byte_size / 1024).toFixed(0)} KB ·{" "}
                          {time(d.created_at)}
                        </p>
                        <Chip
                          value={d.state === "abandoned" ? "returned" : "leave"}
                        >
                          {d.state === "abandoned"
                            ? "رفع ملغى؛ سجل محفوظ"
                            : "رفع معلّق"}
                        </Chip>
                        <div className="fu-bulk">
                          {d.state === "pending" ? (
                            <>
                              <button
                                disabled={
                                  uploading || !!docEdit || !!abandonDoc
                                }
                                onClick={() => resumeUpload(d)}
                              >
                                استئناف بالأصل نفسه
                              </button>
                              <button
                                disabled={
                                  uploading || !!docEdit || !!abandonDoc
                                }
                                onClick={() => {
                                  setAbandonDoc(d);
                                  onDirty(true);
                                }}
                              >
                                إلغاء الرفع وتنظيفه
                              </button>
                            </>
                          ) : (
                            <button
                              disabled={uploading}
                              onClick={() => cleanup(d)}
                            >
                              إعادة فحص تنظيف الملفات الملغاة
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                    {!pendingLoading && !pending.length && (
                      <p className="fu-muted">
                        لا توجد عمليات معلّقة أو ملغاة تحتاج مراجعة في سجلّك
                        المخوّل.
                      </p>
                    )}
                    {abandonDoc && (
                      <form
                        className="fu-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const values = new FormData(e.currentTarget);
                          setUploading(true);
                          try {
                            await privateWrite({
                              operation: "abandon",
                              id: abandonDoc.id,
                              version: abandonDoc.version,
                              reason: values.get("reason"),
                            });
                            setPending((v) =>
                              v.filter((d) => d.id !== abandonDoc.id),
                            );
                            setAbandonDoc(null);
                            onDirty(false);
                            onNotice(
                              "أُلغي الرفع ونُظّفت ملفاته الخاصة. بقي سجل التدقيق محفوظاً.",
                            );
                          } catch (e) {
                            setPendingRevision((v) => v + 1);
                            onError(
                              message(e) +
                                " · راجع حالة العملية؛ إذا أصبحت ملغاة استخدم فحص التنظيف.",
                            );
                          } finally {
                            setUploading(false);
                          }
                        }}
                      >
                        <Field
                          label={
                            "سبب إلغاء: " +
                            (abandonDoc.title || abandonDoc.file_name)
                          }
                        >
                          <textarea
                            name="reason"
                            required
                            minLength={3}
                            maxLength={1000}
                          />
                        </Field>
                        <div className="fu-bulk">
                          <button className="primary" disabled={uploading}>
                            تأكيد الإلغاء والتنظيف
                          </button>
                          <button
                            type="button"
                            disabled={uploading}
                            onClick={() => {
                              setAbandonDoc(null);
                              onDirty(false);
                            }}
                          >
                            العودة دون إلغاء
                          </button>
                        </div>
                      </form>
                    )}
                  </section>
                )}
                {canEdit && employee.photo_document_id && (
                  <button
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await write("profile", {
                          employee_id: employeeId,
                          version: employee.version,
                          photo_document_id: null,
                          reason: "إزالة الصورة من عرض الملف",
                        });
                        setPhoto("");
                        reload();
                        onNotice(
                          "أُزيلت الصورة من العرض. الأصل محفوظ وفق سياسة المستمسكات.",
                        );
                      } catch (e) {
                        onError(message(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                  >
                    إزالة الصورة من الملف
                  </button>
                )}
              </section>
              {docEdit &&
                (caps.documents_write || caps.documents_sensitive_write) && (
                  <form
                    key={resumeDoc?.id || docEdit.id || "new"}
                    className="fu-panel fu-form"
                    onSubmit={upload}
                    onChange={() => onDirty(true)}
                  >
                    <h3>
                      {resumeDoc
                        ? "استئناف الرفع المحفوظ"
                        : docEdit.id
                          ? "إضافة إصدار بديل"
                          : "إضافة ملف خاص"}
                    </h3>
                    {resumeDoc && (
                      <p className="fu-warning fu-form-full">
                        اختر الأصل نفسه: {resumeDoc.file_name}. البيانات وقص
                        الصورة ثابتة للعملية المحفوظة. يتحقق الخادم من بصمة
                        الملف والإعدادات قبل تفعيله؛ لتغييرها ألغِ العملية وابدأ
                        رفعاً جديداً.
                      </p>
                    )}
                    <Field label="نوع الملف">
                      <select
                        name="kind"
                        value={uploadKind}
                        disabled={!!resumeDoc}
                        onChange={(e) => setUploadKind(e.target.value)}
                      >
                        {caps.documents_write && (
                          <>
                            <option value="general">
                              مرجع تشغيلي أو توظيف
                            </option>
                            <option value="photo">صورة الموظف</option>
                            <option value="qualification">مؤهل دراسي</option>
                            <option value="action">مرفق إجراء</option>
                          </>
                        )}
                        {caps.documents_sensitive_write && (
                          <option value="identity">مستمسك هوية مقيّد</option>
                        )}
                      </select>
                    </Field>
                    <Field label="العنوان">
                      <input
                        name="title"
                        required
                        maxLength={150}
                        defaultValue={docEdit.title || ""}
                        readOnly={!!resumeDoc}
                      />
                    </Field>
                    <Field label="الملف: PDF / JPEG / PNG">
                      <input
                        name="file"
                        type="file"
                        accept={
                          uploadKind === "photo"
                            ? "image/jpeg,image/png"
                            : "application/pdf,image/jpeg,image/png"
                        }
                        required
                        onChange={(e) => {
                          setPhotoFile(e.target.files?.[0] || null);
                          setThumbnail(null);
                        }}
                      />
                    </Field>
                    {uploadKind === "photo" && thumbnail && (
                      <div className="fu-photo-crop fu-form-full">
                        <h4>معاينة قص صورة العرض</h4>
                        <div
                          className="fu-crop-preview"
                          style={{
                            backgroundImage:
                              "url(data:image/jpeg;base64," +
                              thumbnail.base64 +
                              ")",
                          }}
                        />
                        <div className="fu-form">
                          <Field label="التكبير">
                            <input
                              aria-label="تكبير القص"
                              type="range"
                              min="1"
                              max="3"
                              step=".05"
                              value={zoom}
                              disabled={!!resumeDoc}
                              onChange={(e) => setZoom(Number(e.target.value))}
                            />
                          </Field>
                          <Field label="الموضع الأفقي">
                            <input
                              aria-label="موضع القص الأفقي"
                              type="range"
                              min="0"
                              max="1"
                              step=".01"
                              value={cropX}
                              disabled={!!resumeDoc}
                              onChange={(e) => setCropX(Number(e.target.value))}
                            />
                          </Field>
                          <Field label="الموضع العمودي">
                            <input
                              aria-label="موضع القص العمودي"
                              type="range"
                              min="0"
                              max="1"
                              step=".01"
                              value={cropY}
                              disabled={!!resumeDoc}
                              onChange={(e) => setCropY(Number(e.target.value))}
                            />
                          </Field>
                          <label>
                            <input
                              type="checkbox"
                              name="crop_confirm"
                              required
                            />{" "}
                            راجعت قص الصورة. يبقى الأصل محفوظاً دون تعديل.
                          </label>
                        </div>
                      </div>
                    )}
                    <Field label="تاريخ الإصدار">
                      <input
                        name="issued_on"
                        type="date"
                        defaultValue={docEdit.issued_on || ""}
                        readOnly={!!resumeDoc}
                      />
                    </Field>
                    <Field label="تاريخ الانتهاء عند وجوده">
                      <input
                        name="expires_on"
                        type="date"
                        defaultValue={docEdit.expires_on || ""}
                        readOnly={!!resumeDoc}
                      />
                    </Field>
                    <Field label="الوصف">
                      <textarea
                        name="description"
                        defaultValue={docEdit.description || ""}
                        readOnly={!!resumeDoc}
                      />
                    </Field>
                    <p className="fu-form-full fu-muted">
                      الصور حتى 5 MB، المستمسكات حتى 10 MB. تُحفظ النسخة الأصلية
                      خاصةً وتُنشأ صورة عرض محسّنة.
                    </p>
                    <div className="fu-bulk">
                      <button className="primary" disabled={uploading}>
                        {uploading ? "جارٍ رفع الملف…" : "رفع وحفظ"}
                      </button>
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={cancelUploadForm}
                      >
                        إلغاء
                      </button>
                    </div>
                  </form>
                )}
            </>
          )}
          {["declarations", "actions"].includes(tab) &&
            (detailsLoading || detailsError) && (
              <section className="fu-panel">
                <p role={detailsError ? "alert" : "status"}>
                  {detailsError
                    ? "تعذر تحميل النطاق؛ لم تُعرض بيانات سابقة."
                    : "جارٍ تحميل بيانات الموظف المحدد…"}
                </p>
                {detailsError && (
                  <button onClick={() => setRevision((v) => v + 1)}>
                    إعادة المحاولة
                  </button>
                )}
              </section>
            )}
          {tab === "declarations" && !detailsLoading && !detailsError && (
            <section className="fu-panel">
              <h3>التبليغات المسائية · {month}</h3>
              <Metrics rows={position} statuses={boot.statuses} period />
              <div className="fu-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>تاريخ الخدمة</th>
                      <th>القسم في التاريخ</th>
                      <th>الحالة</th>
                      <th>المراجعة</th>
                      <th>المصدر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {position.map((p, i) => (
                      <tr key={p.work_date + "-" + i}>
                        <td>{p.work_date}</td>
                        <td>{p.department_name}</td>
                        <td>
                          {boot.statuses.find((s) => s.code === p.status)
                            ?.label || "غير محسوم"}
                        </td>
                        <td>{states[p.review_state] || p.review_state}</td>
                        <td>{p.source || "تصريح قسم"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!position.length && <Empty />}
            </section>
          )}
          {tab === "actions" && !detailsLoading && !detailsError && (
            <section className="fu-panel">
              <h3>إجراءات الموظف</h3>
              {actions.map((a) => (
                <details key={a.id}>
                  <summary>
                    {a.description} · {actionStates[a.state]} · {a.due_date}
                  </summary>
                  <p>{a.notes}</p>
                  <p>
                    المسؤول:{" "}
                    {boot.users.find((u) => u.id === a.responsible_id)?.name ||
                      "—"}
                  </p>
                  {a.completion && <p>دليل الإغلاق: {a.completion}</p>}
                </details>
              ))}
              {!actions.length && (
                <Empty>لا توجد إجراءات مسجّلة لهذا الموظف.</Empty>
              )}
            </section>
          )}
          {tab === "history" && (
            <div className="fu-profile-columns">
              <section className="fu-panel">
                <h3>تاريخ الأقسام والخدمة</h3>
                {profile.assignments.map((a, i) => (
                  <article key={i} className="fu-timeline-item">
                    <strong>
                      {boot.departments.find((d) => d.id === a.department_id)
                        ?.arabic_name ||
                        text(a.department_name || "قسم سابق مسجّل")}
                    </strong>
                    <p>
                      {text(a.valid_from)} — {text(a.valid_to || "مستمر")}
                    </p>
                    <p>{text(a.reason || a.source || "سجل مؤرّخ")}</p>
                  </article>
                ))}
                {!profile.assignments.length && (
                  <Empty>لا توجد انتقالات مؤرّخة مسجّلة.</Empty>
                )}
              </section>
              <section className="fu-panel">
                <h3>سجل التغييرات</h3>
                {profile.history.map((h, i) => (
                  <details key={i}>
                    <summary>
                      {time(h.at || h.created_at)} ·{" "}
                      {text(h.actor_name || "مستخدم مخوّل")} ·{" "}
                      {(
                        {
                          service_state: "قرار حالة الخدمة",
                          employee_identity: "تصحيح الهوية",
                          profile: "تعديل الملف",
                          assignment: "قرار انتماء مؤرخ",
                          document: "إضافة مستمسك",
                          document_activate: "تفعيل مستمسك",
                        } as Record<string, string>
                      )[String(h.kind)] || "تغيير محفوظ"}
                    </summary>
                    <p>{text(h.reason)}</p>
                    <p>
                      {Object.entries(
                        (h.new_value || {}) as Record<string, unknown>,
                      )
                        .filter(([key]) =>
                          [
                            "name",
                            "employee_number",
                            "employment_status",
                            "valid_from",
                            "phone",
                            "secondary_phone",
                            "education",
                          ].includes(key),
                        )
                        .map(
                          ([key, value]) =>
                            (
                              ({
                                name: "الاسم",
                                employee_number: "الرقم الوظيفي",
                                employment_status: "حالة الخدمة",
                                valid_from: "النفاذ",
                                phone: "الهاتف",
                                secondary_phone: "هاتف إضافي",
                                education: "التحصيل",
                              }) as Record<string, string>
                            )[key] +
                            ": " +
                            (serviceLabels[String(value)] ||
                              String(value ?? "غير مسجل")),
                        )
                        .join("، ")}
                    </p>
                  </details>
                ))}
                {!profile.history.length && (
                  <Empty>لا توجد تغييرات إضافية مسجّلة.</Empty>
                )}
              </section>
            </div>
          )}
        </>
      )}
      {transfer && caps.roster_manage && (
        <form
          className="fu-panel fu-form"
          onChange={() => onDirty(true)}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            try {
              await write("assignment", {
                ...f,
                employee_id: employeeId,
                version: employee.version,
              });
              setTransfer(false);
              reload();
              onNotice("حُفظ التغيير المؤرّخ مع بقاء الأدلة السابقة.");
            } catch (e) {
              onError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>معاينة تغيير مؤرّخ</h3>
          <p className="fu-form-full">
            الحالي: {department} ·{" "}
            {workStates[employee.employment_status] ||
              employee.employment_status}
            . يسري التغيير من التاريخ المختار، وتبقى التقارير القديمة مرتبطة
            بتاريخها.
          </p>
          <Field label="القسم الجديد">
            <select
              name="department_id"
              required
              defaultValue={employee.department_id}
            >
              {boot.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.arabic_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="تاريخ السريان">
            <input name="valid_from" type="date" required />
          </Field>
          <Field label="المصدر وسبب التغيير">
            <textarea name="reason" required />
          </Field>
          <div className="fu-bulk">
            <button className="primary" disabled={busy}>
              تأكيد وحفظ التغيير المؤرّخ
            </button>
            <button
              type="button"
              onClick={() => {
                setTransfer(false);
                onDirty(false);
              }}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
